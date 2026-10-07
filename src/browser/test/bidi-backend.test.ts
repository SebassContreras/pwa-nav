import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { OfflineBackend, type ActionResult } from "../../backend/backend.js";
import { createBackend, DEFAULT_HOST, DEFAULT_PORT } from "../../backend/backend-factory.js";
import { startFakeBidiServer, type FakeBidiServer, type ReceivedCommand } from "../../bidi/fake-server.js";
import { PwaNavError } from "../../core/errors.js";
import { addAllowedOrigin, loadAllowList } from "../../core/gate.js";
import {
  parseActOp,
  performAct,
  performClick,
  performFill,
  performLiveSnapshot,
  performOpen,
  performScreenshot,
  performUpload,
  readPngDimensions,
} from "../../ops/ops.js";
import { latestSnapshotId, loadLocators, load, StaleRefError } from "../../core/refs.js";
import type { RawElement } from "../collector.js";
import { BidiBackend, endpointFor, type BidiBackendOptions } from "../bidi-backend.js";

const URL_A = "https://app.test/login";
const SECRET = "hunter2-SECRET";

const baseRaw = (): RawElement[] => [
  { role: "textbox", name: "User", nameSource: "label", occurrence: 0, inputType: "text" },
  { role: "textbox", name: "Password", nameSource: "label", occurrence: 0, inputType: "password" },
  { role: "button", name: "Go", nameSource: "content", occurrence: 0 },
];

// Minimal JS -> BiDi RemoteValue encoder for scripted replies.
function remote(value: unknown): unknown {
  if (value === undefined) return { type: "undefined" };
  if (value === null) return { type: "null" };
  if (typeof value === "string") return { type: "string", value };
  if (typeof value === "number") return { type: "number", value };
  if (typeof value === "boolean") return { type: "boolean", value };
  if (Array.isArray(value)) return { type: "array", value: value.map(remote) };
  return { type: "object", value: Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, remote(v)]) };
}
const ok = (value: unknown): unknown => ({ type: "success", realm: "r", result: remote(value) });

interface Page {
  url: string;
  raw: RawElement[];
}

interface Env {
  dir: string;
  server: FakeBidiServer;
  page: Page;
  backend: BidiBackend;
  env: NodeJS.ProcessEnv;
  killFile: string;
}

async function withEnv(
  fn: (e: Env) => Promise<void>,
  extra: Partial<BidiBackendOptions> = {},
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "pwa-nav-backend-"));
  const server = await startFakeBidiServer();
  const page: Page = { url: URL_A, raw: baseRaw() };
  server.handle("session.subscribe", () => ({ subscription: "s" }));
  server.handle("input.performActions", () => ({}));
  server.handle("input.releaseActions", () => ({}));
  server.handle("browsingContext.getTree", () => ({
    contexts: [{ context: "ctx", url: page.url, children: [], userContext: "default" }],
  }));
  server.handle("browsingContext.navigate", (params) => {
    page.url = (params as { url: string }).url;
    return { navigation: "n1", url: page.url };
  });
  server.handle("script.evaluate", () => ok(page.url));
  server.handle("script.callFunction", (params) => {
    const decl = (params as { functionDeclaration: string }).functionDeclaration;
    if (decl.startsWith("(includeAll) =>")) return ok({ url: page.url, title: "T", raw: page.raw });
    if (decl.startsWith("(index, role")) {
      return { type: "success", realm: "r", result: { type: "node", sharedId: "node-1" } };
    }
    if (decl.includes("isContentEditable")) return ok({ ok: true, kind: "text", sensitive: false });
    if (decl.includes("MutationObserver")) return ok(true);
    if (decl.includes("elementFromPoint")) return ok({ ok: true });
    if (decl.startsWith("() => ({ url: location.href")) return ok({ url: page.url, title: "T" });
    return ok(true);
  });
  const killFile = join(dir, "kill");
  const env: NodeJS.ProcessEnv = { PWA_NAV_KILL_SWITCH: killFile, PWA_NAV_FIREFOXPWA_DIR: join(dir, "nopwa") };
  const backend = new BidiBackend({ port: server.port, agentDir: dir, env, platform: "linux", ...extra });
  try {
    await fn({ dir, server, page, backend, env, killFile });
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
}

const inputs = (s: FakeBidiServer): ReceivedCommand[] => s.commands.filter((c) => c.method === "input.performActions");
const armedBackend = (e: Env, extra: Partial<BidiBackendOptions> = {}): BidiBackend =>
  new BidiBackend({
    port: e.server.port,
    agentDir: e.dir,
    env: e.env,
    platform: "linux",
    armed: true,
    ...extra,
  });

async function allow(e: Env): Promise<void> {
  await addAllowedOrigin(URL_A, e.dir);
}

async function expectError(promise: Promise<unknown>, code: string): Promise<PwaNavError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof PwaNavError, String(error));
    assert.equal(error.code, code, error.message);
    return error;
  }
  throw new Error(`expected ${code}`);
}

async function captureLog<T>(fn: () => Promise<T>): Promise<{ value: T; out: string }> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]): void => {
    lines.push(args.map(String).join(" "));
  };
  try {
    return { value: await fn(), out: lines.join("\n") };
  } finally {
    console.log = original;
  }
}

test("endpoint and defaults", () => {
  assert.equal(endpointFor(9222), "ws://127.0.0.1:9222/session");
  assert.equal(endpointFor(1234, "::1"), "ws://[::1]:1234/session");
  assert.equal(DEFAULT_PORT, 9222);
  assert.equal(DEFAULT_HOST, "127.0.0.1");
  assert.ok(createBackend({ mode: "offline" }) instanceof OfflineBackend);
  assert.ok(createBackend({ mode: "bidi" }) instanceof BidiBackend);
});

test("open: navigates with wait=complete, writes session.json, ends the session", async () => {
  await withEnv(async (e) => {
    const session = await e.backend.open("https://app.test/home", { allowOrigin: true });
    assert.equal(session.url, "https://app.test/home");
    const nav = e.server.commands.find((c) => c.method === "browsingContext.navigate");
    assert.deepEqual(nav?.params, { context: "ctx", url: "https://app.test/home", wait: "complete" });
    const stored = JSON.parse(await readFile(join(e.dir, "session.json"), "utf8")) as { url: string };
    assert.equal(stored.url, "https://app.test/home");
    assert.equal(e.server.sessionActive, false);
    assert.equal(await e.backend.currentUrl(), "https://app.test/home");
    assert.deepEqual(await loadAllowList(e.dir), ["https://app.test"]);
  });
});

test("open: --allow-origin round trip and invalid URL", async () => {
  await withEnv(async (e) => {
    await e.backend.open("https://app.test/home", { allowOrigin: true });
    assert.deepEqual(await loadAllowList(e.dir), ["https://app.test"]);
    await expectError(e.backend.open("ftp://x.test"), "invalid_args");
    assert.equal(e.server.commands.filter((c) => c.method === "browsingContext.navigate").length, 1);
  });
});

test("open: no_browser carries a launch hint when the site is in the firefoxpwa config", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pwa-nav-nobrowser-"));
  const probe = await startFakeBidiServer();
  const { port } = probe;
  await probe.close();
  try {
    await writeFile(
      join(dir, "config.json"),
      JSON.stringify({
        sites: { SITEULID1: { profile: "PROF1", config: { document_url: "https://app.test/login" } } },
      }),
    );
    const env = { PWA_NAV_FIREFOXPWA_DIR: dir };
    const withConfig = new BidiBackend({
      port,
      agentDir: dir,
      env,
      platform: "linux",
      session: { transport: { connectTimeoutMs: 1000 } },
    });
    const error = await expectError(withConfig.open("https://app.test/home", { allowOrigin: true }), "no_browser");
    assert.match(error.hint ?? "", /SITEULID1/);
    assert.match(error.hint ?? "", new RegExp(`--remote-debugging-port.+${String(port)}`));

    const generic = new BidiBackend({
      port,
      agentDir: dir,
      env,
      platform: "linux",
      session: { transport: { connectTimeoutMs: 1000 } },
    });
    const other = await expectError(generic.open("https://other.test/", { allowOrigin: true }), "no_browser");
    assert.match(other.hint ?? "", /--remote-debugging-port/);
    assert.doesNotMatch(other.hint ?? "", /SITEULID1/);
    assert.match(other.hint ?? "", /--launch/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("open --launch: launches only when the port is closed, then navigates", async () => {
  const launched: string[] = [];
  const launchFn: NonNullable<BidiBackendOptions["launchFn"]> = (options) => {
    launched.push(`${options.origin} ${String(options.port)}`);
    return Promise.resolve({ siteId: "S", port: options.port, command: "cmd", pid: undefined });
  };
  const launchStandardFn: NonNullable<BidiBackendOptions["launchStandardFn"]> = (options) => {
    launched.push(`${options.targetUrl} ${String(options.port)}`);
    return Promise.resolve({ port: options.port, command: "stdcmd", pid: undefined });
  };
  await withEnv(
    async (e) => {
      await e.backend.open("https://app.test/home", { allowOrigin: true });
      assert.deepEqual(launched, [`https://app.test/home ${String(e.server.port)}`]);
    },
    { launch: true, launchFn, launchStandardFn, probe: () => Promise.resolve(false) },
  );
  launched.length = 0;
  await withEnv(
    async (e) => {
      await e.backend.open("https://app.test/home", { allowOrigin: true });
      assert.deepEqual(launched, []);
    },
    { launch: true, launchFn, launchStandardFn, probe: () => Promise.resolve(true) },
  );
});

test("open: blocked without allow-list or flag, before any BiDi frame; allow.json and flag permit", async () => {
  await withEnv(async (e) => {
    const error = await expectError(e.backend.open("https://app.test/home"), "origin_blocked");
    assert.equal(error.message, "origin not allow-listed: https://app.test");
    assert.equal(error.hint, "re-run: open <url> --allow-origin to allow this origin");
    assert.equal(e.server.commands.length, 0);
    await expectError(e.backend.open("https://app.test/home"), "origin_blocked");
    // A different origin in allow.json does not help.
    await addAllowedOrigin("https://other.test", e.dir);
    await expectError(e.backend.open("https://app.test/home"), "origin_blocked");
    assert.equal(e.server.commands.length, 0);
    // Pre-seeded origin: allowed without the flag, no allow.json rewrite needed.
    await addAllowedOrigin("https://app.test", e.dir);
    await e.backend.open("https://app.test/other");
    assert.equal(e.server.commands.filter((c) => c.method === "browsingContext.navigate").length, 1);
  });
});

test("open: kill-switch blocks navigation (kill_switch) even when allowed, before any frame", async () => {
  await withEnv(async (e) => {
    await allow(e);
    await writeFile(e.killFile, "", "utf8");
    await expectError(e.backend.open(URL_A), "kill_switch");
    await expectError(e.backend.open(URL_A, { allowOrigin: true }), "kill_switch");
    assert.equal(e.server.commands.length, 0);
    assert.deepEqual(await loadAllowList(e.dir), ["https://app.test"]);
  });
});

test("open --launch: blocked before probe and spawn", async () => {
  let probed = 0;
  let launched = 0;
  await withEnv(
    async (e) => {
      await expectError(e.backend.open("https://app.test/home"), "origin_blocked");
      assert.equal(probed, 0);
      assert.equal(launched, 0);
      assert.equal(e.server.commands.length, 0);
    },
    {
      launch: true,
      probe: () => {
        probed++;
        return Promise.resolve(false);
      },
      launchFn: () => {
        launched++;
        return Promise.resolve({ siteId: "S", port: 1, command: "cmd", pid: undefined });
      },
    },
  );
});

test("snapshot/extract stay ungated by the open allow-list", async () => {
  await withEnv(async (e) => {
    const { value: snapshot } = await captureLog(() => performLiveSnapshot(e.backend));
    assert.equal(snapshot.url, URL_A);
    assert.deepEqual(await loadAllowList(e.dir), []);
    assert.ok(e.server.commands.length > 0);
  });
});

test("collect -> snapshot -> locator sidecar with extras; public snapshot unchanged", async () => {
  await withEnv(async (e) => {
    e.page.raw = [...baseRaw(), { role: "button", name: "Go", nameSource: "content", occurrence: 1 }];
    const { out, value: snapshot } = await captureLog(() => performLiveSnapshot(e.backend));
    assert.match(out, /^snapshot ok: 4 elements/);
    assert.equal(snapshot.url, URL_A);
    assert.equal(await latestSnapshotId({ agentDir: e.dir }), snapshot.snapshotId);
    assert.deepEqual(Object.keys(snapshot.elements[1] ?? {}).sort(), ["name", "ref", "role"]);
    const side = await loadLocators(snapshot.snapshotId, { agentDir: e.dir });
    assert.ok(side);
    assert.deepEqual(side.locators["e4"], { role: "button", name: "Go", occurrence: 1 });
    assert.equal(side.extras?.["e2"]?.inputType, "password");
    assert.equal(e.server.sessionActive, false);
  });
});

async function seed(e: Env): Promise<string> {
  const { value } = await captureLog(() => performLiveSnapshot(e.backend));
  return value.snapshotId;
}

test("click dry-run: no input frames, no supersede, plan returned", async () => {
  await withEnv(async (e) => {
    const id = await seed(e);
    const r = await e.backend.click(id, "e3");
    assert.equal(r.kind, "dry-run");
    assert.match(r.plan, /^click button "Go"/);
    assert.equal(r.snapshotId, id);
    assert.equal(inputs(e.server).length, 0);
    assert.equal(await latestSnapshotId({ agentDir: e.dir }), id);
    const { out } = await captureLog(() => performClick(id, "e3", { backend: e.backend }));
    assert.match(out, /^click dry-run: click button "Go"/);
    assert.equal(e.server.sessionActive, false);
  });
});

test("armed click: input sent, new snapshot supersedes the old one", async () => {
  await withEnv(async (e) => {
    const id = await seed(e);
    await allow(e);
    const armed = armedBackend(e);
    const { value: next, out } = await captureLog(() => performClick(id, "e3", { backend: armed }));
    assert.notEqual(next, id);
    assert.match(out, new RegExp(`^click ok: click button "Go".* -> .*snapshot.json \\(id ${next}\\)$`));
    assert.equal(inputs(e.server).length, 1);
    assert.equal(await latestSnapshotId({ agentDir: e.dir }), next);
    await expectError(armed.click(id, "e3"), "stale_ref");
    assert.equal(inputs(e.server).length, 1);
    assert.ok(await load(next, { agentDir: e.dir }));
    assert.equal(e.server.sessionActive, false);
  });
});

test("ops armed option drives a default-armed-less backend", async () => {
  await withEnv(async (e) => {
    const id = await seed(e);
    await allow(e);
    await captureLog(() => performClick(id, "e3", { backend: e.backend, armed: true }));
    assert.equal(inputs(e.server).length, 1);
  });
});

test("fill dry-run and armed on a normal field", async () => {
  await withEnv(async (e) => {
    const id = await seed(e);
    const dry = await e.backend.fill(id, "e1", "marc");
    assert.equal(dry.kind, "dry-run");
    assert.match(dry.plan, /fill textbox "User".* with "marc"/);
    assert.equal(inputs(e.server).length, 0);
    await allow(e);
    const done = await armedBackend(e).fill(id, "e1", "marc");
    assert.equal(done.kind, "done");
    assert.notEqual(done.snapshotId, id);
    assert.equal(inputs(e.server).length, 1);
  });
});

test("password fill never echoes the text (dry-run and armed)", async () => {
  await withEnv(async (e) => {
    const id = await seed(e);
    await allow(e);
    const dry = await captureLog(() => performFill(id, "e2", SECRET, { backend: e.backend }));
    assert.doesNotMatch(dry.out, new RegExp(SECRET));
    assert.match(dry.out, /redacted/);
    const armedRun = await captureLog(async () => {
      const r = await armedBackend(e).fill(id, "e2", SECRET);
      return r;
    });
    assert.doesNotMatch(JSON.stringify(armedRun.value), new RegExp(SECRET));
    const armedOps = await captureLog(async () => {
      const fresh = await seed(e);
      return performFill(fresh, "e2", SECRET, { backend: armedBackend(e) });
    });
    assert.doesNotMatch(armedOps.out, new RegExp(SECRET));
    // Stored files never contain the text either.
    const side = await readFile(join(e.dir, "snapshot.json"), "utf8");
    assert.doesNotMatch(side, new RegExp(SECRET));
    // A stale-ref error does not echo it.
    const stale = await expectError(armedBackend(e).fill(id, "e2", SECRET), "stale_ref");
    assert.doesNotMatch(`${stale.message} ${stale.hint ?? ""}`, new RegExp(SECRET));
  });
});

test("password detected through extras even when the live element lost its type", async () => {
  await withEnv(async (e) => {
    const id = await seed(e);
    const [user, pass, go] = e.page.raw;
    assert.ok(user && pass && go);
    const bare: RawElement = { role: pass.role, name: pass.name, nameSource: pass.nameSource, occurrence: 0 };
    e.page.raw = [user, bare, go];
    const dry = await e.backend.fill(id, "e2", SECRET);
    assert.doesNotMatch(dry.plan, new RegExp(SECRET));
    assert.match(dry.plan, /redacted/);
  });
});

test("blocked by kill-switch: no input", async () => {
  await withEnv(async (e) => {
    const id = await seed(e);
    await allow(e);
    await writeFile(e.killFile, "");
    await expectError(armedBackend(e).click(id, "e3"), "kill_switch");
    assert.equal(inputs(e.server).length, 0);
    assert.equal(await latestSnapshotId({ agentDir: e.dir }), id);
  });
});

test("blocked by origin: not allow-listed, and live page on another origin", async () => {
  await withEnv(async (e) => {
    const id = await seed(e);
    const before = e.server.commands.length;
    await expectError(armedBackend(e).click(id, "e3"), "origin_blocked");
    assert.equal(e.server.commands.length, before, "nothing sent to the browser");
    await allow(e);
    e.page.url = "https://evil.test/login";
    await expectError(armedBackend(e).click(id, "e3"), "origin_blocked");
    assert.equal(inputs(e.server).length, 0);
    assert.equal(e.server.sessionActive, false);
  });
});

test("stale ref before input: unknown ref, vanished element, changed URL", async () => {
  await withEnv(async (e) => {
    const id = await seed(e);
    await allow(e);
    const armed = armedBackend(e);
    await expectError(armed.click(id, "e99"), "stale_ref");
    e.page.url = "https://app.test/other";
    await expectError(armed.click(id, "e3"), "stale_ref");
    e.page.url = URL_A;
    e.page.raw = baseRaw().slice(0, 2);
    await expectError(armed.click(id, "e3"), "stale_ref");
    assert.equal(inputs(e.server).length, 0);
    assert.equal(e.server.sessionActive, false);
  });
});

test("act: upfront stale abort sends nothing; batch writes exactly one new snapshot", async () => {
  await withEnv(async (e) => {
    const id = await seed(e);
    await allow(e);
    const armed = armedBackend(e);
    const before = e.server.commands.length;
    await expectError(
      armed.act(id, [{ kind: "fill", ref: "e1", text: "marc" }, { kind: "click", ref: "e99" }]),
      "stale_ref",
    );
    assert.equal(e.server.commands.length, before, "nothing sent, no session opened");

    const sessions = (): number => e.server.commands.filter((c) => c.method === "session.new").length;
    const s0 = sessions();
    const { value: next, out } = await captureLog(() =>
      performAct(
        id,
        [
          { kind: "fill", ref: "e1", text: "marc" },
          { kind: "fill", ref: "e2", text: SECRET },
          { kind: "click", ref: "e3" },
        ],
        { backend: armed },
      ),
    );
    assert.equal(sessions() - s0, 1, "one session for the whole batch");
    assert.equal(inputs(e.server).length, 3);
    assert.notEqual(next, id);
    assert.equal(await latestSnapshotId({ agentDir: e.dir }), next);
    assert.match(out, /act ok: 3 ops .*\(id /);
    assert.doesNotMatch(out, new RegExp(SECRET));
    assert.equal((out.match(/\(id /g) ?? []).length, 1);
    await expectError(armed.click(id, "e3"), "stale_ref");
  });
});

test("act dry-run prints the whole plan and changes nothing", async () => {
  await withEnv(async (e) => {
    const id = await seed(e);
    const { value, out } = await captureLog(() =>
      performAct(id, [{ kind: "fill", ref: "e1", text: "marc" }, { kind: "click", ref: "e3" }], {
        backend: e.backend,
      }),
    );
    assert.equal(value, id);
    assert.match(out, /^fill dry-run: .*\nclick dry-run: /);
    assert.equal(inputs(e.server).length, 0);
    assert.equal(await latestSnapshotId({ agentDir: e.dir }), id);
  });
});

test("act: kill-switch re-checked before each armed op (file created between ops)", async () => {
  await withEnv(
    async (e) => {
      const id = await seed(e);
      await allow(e);
      const results: ActionResult[] = [];
      const error = await expectError(
        armedBackend(e, {
          onOpDone: async (index) => {
            if (index === 0) await writeFile(e.killFile, "");
          },
        }).act(
          id,
          [
            { kind: "click", ref: "e3" },
            { kind: "click", ref: "e3" },
          ],
          { onResult: (_op, r) => results.push(r) },
        ),
        "kill_switch",
      );
      assert.match(error.message, /kill-switch/);
      assert.equal(inputs(e.server).length, 1, "second op never sent");
      assert.equal(results.length, 1);
      // First op already acted: the old snapshot is superseded.
      assert.notEqual(await latestSnapshotId({ agentDir: e.dir }), id);
      assert.equal(e.server.sessionActive, false);
    },
    {},
  );
});

test("act: ops after the first compare against the previous op's URL", async () => {
  await withEnv(async (e) => {
    const id = await seed(e);
    await allow(e);
    e.server.handle("input.performActions", () => {
      e.page.url = "https://app.test/next"; // first op navigates
      return {};
    });
    const armed = armedBackend(e);
    // Second op sees the new URL as expected (not stale vs initial snapshot URL).
    const result = await armed.act(id, [
      { kind: "click", ref: "e3" },
      { kind: "click", ref: "e3" },
    ]);
    assert.equal(result.results.length, 2);
    const stored = await load(result.snapshotId, { agentDir: e.dir });
    assert.equal(stored?.url, "https://app.test/next");
  });
});

test("20 consecutive operations leave no active session", async () => {
  await withEnv(async (e) => {
    const id = await seed(e);
    for (let i = 0; i < 10; i++) {
      await e.backend.collect();
      assert.equal(e.server.sessionActive, false);
      await e.backend.click(id, "e3");
      assert.equal(e.server.sessionActive, false);
    }
    const created = e.server.commands.filter((c) => c.method === "session.new").length;
    const ended = e.server.commands.filter((c) => c.method === "session.end").length;
    assert.equal(created, ended);
    assert.equal(created, 21);
  });
});

test("a failing operation still ends the session", async () => {
  await withEnv(async (e) => {
    const id = await seed(e);
    e.server.handle("script.callFunction", () => {
      throw new Error("boom");
    });
    await assert.rejects(e.backend.click(id, "e3"));
    assert.equal(e.server.sessionActive, false);
  });
});

test("offline path: ops default behavior unchanged (intent log, supersede, same output)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pwa-nav-offline-"));
  try {
    const backend = new OfflineBackend({ agentDir: dir });
    const { out: openOut } = await captureLog(() => performOpen("https://x.test/", { backend }));
    assert.equal(openOut, `open ok: https://x.test/ -> ${dir}/session.json`);
    assert.equal(await backend.currentUrl(), "https://x.test/");
    const { save } = await import("../../core/refs.js");
    await save(
      { snapshotId: "o1", url: "https://x.test/", title: "t", elements: [{ ref: "e1", role: "button", name: "Go" }] },
      { agentDir: dir },
    );
    const { value: next, out } = await captureLog(() => performClick("o1", "e1", { backend }));
    assert.equal(out, `click ok: e1 (button "Go") -> ${dir}/snapshot.json (id ${next})`);
    const log = await readFile(join(dir, "actions.log"), "utf8");
    assert.match(log, /"ref":"e1"/);
    await assert.rejects(performClick("o1", "e1", { backend }), StaleRefError);
    const act = await captureLog(() =>
      performAct(next, [{ kind: "fill", ref: "e1", text: "x" }, { kind: "click", ref: "e1" }], { backend }),
    );
    assert.equal(act.out.split("\n").length, 2);
    assert.doesNotMatch(act.out, /act ok/);
    await expectError(backend.collect(), "invalid_args");
    await assert.rejects(performOpen("nope", { backend }), /invalid URL/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// includeAll flag of each collect call, in order (arguments[0] of the collector function).
const collectFlags = (s: FakeBidiServer): unknown[] =>
  s.commands
    .filter(
      (c) =>
        c.method === "script.callFunction" &&
        (c.params as { functionDeclaration: string }).functionDeclaration.startsWith("(includeAll) =>"),
    )
    .map((c) => (c.params as { arguments: { value: unknown }[] }).arguments[0]?.value);

test("includeAll is recorded in the sidecar and reused by actions without a caller flag", async () => {
  await withEnv(async (e) => {
    const { value: full } = await captureLog(() => performLiveSnapshot(e.backend, { includeAll: true }));
    assert.equal((await loadLocators(full.snapshotId, { agentDir: e.dir }))?.includeAll, true);
    await e.backend.click(full.snapshotId, "e3");
    assert.deepEqual(collectFlags(e.server), [true, true]);

    const { value: lean } = await captureLog(() => performLiveSnapshot(e.backend));
    assert.equal((await loadLocators(lean.snapshotId, { agentDir: e.dir }))?.includeAll, false);
    await e.backend.click(lean.snapshotId, "e3");
    assert.deepEqual(collectFlags(e.server).slice(2), [false, false]);
  });
});

test("armed act on an includeAll snapshot keeps the mode for the persisted snapshot", async () => {
  await withEnv(async (e) => {
    const { value: full } = await captureLog(() => performLiveSnapshot(e.backend, { includeAll: true }));
    await allow(e);
    const next = await captureLog(() => performClick(full.snapshotId, "e3", { backend: armedBackend(e) }));
    assert.equal((await loadLocators(next.value, { agentDir: e.dir }))?.includeAll, true);
    assert.ok(collectFlags(e.server).every((flag) => flag === true));
  });
});

test("upload dry-run and armed on a file input", async () => {
  await withEnv(async (e) => {
    e.page.raw = [...baseRaw(), { role: "textbox", name: "Avatar", nameSource: "label", occurrence: 0, inputType: "file" }];
    const id = await seed(e);
    const testFile = join(e.dir, "avatar.png");
    await writeFile(testFile, "fake-image");

    const dry = await e.backend.upload(id, "e4", [testFile]);
    assert.equal(dry.kind, "dry-run");
    assert.match(dry.plan, /upload textbox "Avatar".* with/);
    assert.equal(e.server.commands.filter((c) => c.method === "input.setFiles").length, 0);

    const { out: dryOut } = await captureLog(() => performUpload(id, "e4", [testFile], { backend: e.backend }));
    assert.match(dryOut, /^upload dry-run: upload textbox "Avatar"/);

    await allow(e);
    const done = await armedBackend(e).upload(id, "e4", [testFile]);
    assert.equal(done.kind, "done");
    assert.notEqual(done.snapshotId, id);

    const setFilesCommands = e.server.commands.filter((c) => c.method === "input.setFiles");
    assert.equal(setFilesCommands.length, 1);
    assert.deepEqual(setFilesCommands[0]?.params, {
      context: "ctx",
      element: { sharedId: "node-1" },
      files: [testFile],
    });
  });
});

test("upload fails fast with file_upload_blocked for blocked files", async () => {
  await withEnv(async (e) => {
    e.page.raw = [...baseRaw(), { role: "textbox", name: "Avatar", nameSource: "label", occurrence: 0, inputType: "file" }];
    const id = await seed(e);
    const envFile = join(e.dir, ".env");
    await writeFile(envFile, "SECRET=1");

    await expectError(e.backend.upload(id, "e4", [envFile]), "file_upload_blocked");
  });
});

test("performAct supports upload: operation", async () => {
  await withEnv(async (e) => {
    e.page.raw = [...baseRaw(), { role: "textbox", name: "Avatar", nameSource: "label", occurrence: 0, inputType: "file" }];
    const id = await seed(e);
    const testFile = join(e.dir, "doc.pdf");
    await writeFile(testFile, "fake-doc");

    const dry = await captureLog(() => performAct(id, [parseActOp(`upload:e4=${testFile}`)], { backend: e.backend }));
    assert.match(dry.out, /upload textbox "Avatar"/);

    await allow(e);
    const armed = await captureLog(() => performAct(id, [parseActOp(`upload:e4=${testFile}`)], { backend: armedBackend(e) }));
    assert.match(armed.out, /upload ok: upload textbox "Avatar"/);
  });
});

test("screenshot captures PNG buffer via BidiBackend and OfflineBackend", async () => {
  // OfflineBackend returns 1x1 png buffer
  const offline = new OfflineBackend({ agentDir: ".agent" });
  const offlineBuf = await offline.screenshot();
  assert.ok(Buffer.isBuffer(offlineBuf));
  assert.equal(offlineBuf.length > 0, true);

  // BidiBackend delegates to browsingContext.captureScreenshot
  await withEnv(async (e) => {
    e.server.handle("browsingContext.captureScreenshot", (params) => {
      const p = params as { context: string; format?: { type: string } };
      assert.equal(p.context, "ctx");
      assert.equal(p.format?.type, "image/png");
      return { data: Buffer.from("fake-png-bytes").toString("base64") };
    });

    const buf = await e.backend.screenshot({ format: "png" });
    assert.ok(Buffer.isBuffer(buf));
    assert.equal(buf.toString(), "fake-png-bytes");

    const commands = e.server.commands.filter((c) => c.method === "browsingContext.captureScreenshot");
    assert.equal(commands.length, 1);
  });
});

test("performScreenshot writes image to disk and reads dimensions", async () => {
  await withEnv(async (e) => {
    // 1x1 transparent PNG
    const pngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    e.server.handle("browsingContext.captureScreenshot", () => ({ data: pngBase64 }));

    const outPath = join(e.dir, "evidence", "shot.png");
    const result = await performScreenshot({ backend: e.backend, outPath, quiet: true });

    assert.equal(result.path, outPath);
    assert.equal(result.width, 1);
    assert.equal(result.height, 1);

    const onDisk = await readFile(outPath);
    assert.deepEqual(onDisk, Buffer.from(pngBase64, "base64"));
    assert.deepEqual(readPngDimensions(onDisk), { width: 1, height: 1 });
  });
});

