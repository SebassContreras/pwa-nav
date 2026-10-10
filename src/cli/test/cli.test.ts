// CLI end-to-end tests (spec 004, T011): spawn `node dist/cli.js` in a temp cwd.
// Live paths run against the in-process fake BiDi server; no real browser is involved.
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { startFakeBidiServer, type FakeBidiServer } from "../../bidi/fake-server.js";
import type { RawElement } from "../../browser/collector.js";

const CLI = existsSync(join(dirname(fileURLToPath(import.meta.url)), "..", "..", "cli.js"))
  ? join(dirname(fileURLToPath(import.meta.url)), "..", "..", "cli.js")
  : resolve(dirname(fileURLToPath(import.meta.url)), "../../../dist/cli.js");
const URL_A = "https://app.test/login";

// A port that was just released: nothing listens on it, so a command that forgets
// --port gets connection-refused instead of reaching a real browser on 9222.
const CLOSED_PORT = await (async (): Promise<number> => {
  const probe = await startFakeBidiServer();
  const { port } = probe;
  await probe.close();
  return port;
})();
const SECRET = "hunter2-SECRET";

interface Result {
  status: number | null;
  stdout: string;
  stderr: string;
}

function baseEnv(dir: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  // Never inherit backend overrides, and point the default port at a closed one: a test
  // that forgets --port must hit connection-refused instead of a real browser on 9222.
  delete env["PWA_NAV_BACKEND"];
  delete env["PWA_NAV_SCREENS_DIR"];
  return {
    ...env,
    PWA_NAV_PORT: String(CLOSED_PORT),
    PWA_NAV_KILL_SWITCH: join(dir, "kill-file"),
    PWA_NAV_FIREFOXPWA_DIR: join(dir, "nopwa"),
    // The temp cwd has no project markers: pin the cache dir so nothing leaks into ~/.pwa-nav.
    PWA_NAV_CACHE_DIR: join(dir, ".agent"),
    ...extra,
  };
}

// Sync runner for tests that need no server in this process.
function runSync(dir: string, args: string[]): Result {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    cwd: dir,
    env: baseEnv(dir),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30_000,
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

// Async runner: the fake server lives in this process and must keep serving.
function run(dir: string, args: string[], env: NodeJS.ProcessEnv = {}): Promise<Result> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: dir,
      env: baseEnv(dir, env),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (d: string) => (stdout += d));
    child.stderr.setEncoding("utf8").on("data", (d: string) => (stderr += d));
    const timer = setTimeout(() => child.kill(), 30_000);
    child.on("error", reject);
    child.on("close", (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr });
    });
  });
}

async function withDir(fn: (dir: string) => Promise<void> | void): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "pwa-nav-cli-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

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

const RAW: RawElement[] = [
  { role: "textbox", name: "User", nameSource: "label", occurrence: 0, inputType: "text" },
  { role: "textbox", name: "Password", nameSource: "label", occurrence: 0, inputType: "password" },
  { role: "button", name: "Go", nameSource: "content", occurrence: 0 },
];

async function withFake(fn: (dir: string, server: FakeBidiServer) => Promise<void>): Promise<void> {
  await withDir(async (dir) => {
    const server = await startFakeBidiServer();
    const page = { url: URL_A };
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
      if (decl.startsWith("(includeAll) =>")) return ok({ url: page.url, title: "T", raw: RAW });
      if (decl.startsWith("(index, role")) {
        return { type: "success", realm: "r", result: { type: "node", sharedId: "node-1" } };
      }
      if (decl.includes("isContentEditable")) return ok({ ok: true, kind: "text", sensitive: false });
      if (decl.includes("MutationObserver")) return ok(true);
      if (decl.includes("elementFromPoint")) return ok({ ok: true });
      if (decl.startsWith("() => ({ url: location.href")) return ok({ url: page.url, title: "T" });
      return ok(true);
    });
    try {
      await fn(dir, server);
    } finally {
      await server.close();
    }
  });
}

const inputFrames = (s: FakeBidiServer): number => s.commands.filter((c) => c.method === "input.performActions").length;

async function liveSnapshot(dir: string, port: number): Promise<string> {
  const r = await run(dir, ["snapshot", "--port", String(port)]);
  assert.equal(r.status, 0, r.stderr);
  const match = /^snapshot ok: 3 elements -> .*\.agent[/\\]snapshot\.json \(id ([\w-]+)\)$/m.exec(r.stdout);
  assert.ok(match, r.stdout);
  return match[1] ?? "";
}

test("help lists the new flags, env names and the exit-code table", async () => {
  await withDir((dir) => {
    const r = runSync(dir, ["--help"]);
    assert.equal(r.status, 0);
    for (const needle of [
      "--backend",
      "--port",
      "--context",
      "--armed",
      "--launch",
      "--allow-origin",
      "--all",
      "PWA_NAV_BACKEND",
      "PWA_NAV_PORT",
      "Exit codes:",
      "origin_blocked",
      "kill_switch",
    ]) {
      assert.ok(r.stdout.includes(needle), `help is missing ${needle}`);
    }
    assert.equal(runSync(dir, ["click", "-h"]).status, 0);
    return Promise.resolve();
  });
});

test("invalid options and arguments exit 2 with the old message plus usage", async () => {
  await withDir((dir) => {
    const cases: [string[], RegExp][] = [
      [["snapshot", "--bogus"], /unknown snapshot option: --bogus/],
      [["click", "--snapshot", "s1", "--nope", "e1"], /unknown click option: --nope/],
      [["snapshot", "--input"], /missing value for --input <file>\./],
      [["click", "e1"], /missing --snapshot <id>\./],
      [["click", "--snapshot", "s1"], /missing <ref>\./],
      [["fill", "--snapshot", "s1", "e1"], /missing <ref> <text>\./],
      [["act", "--snapshot", "s1"], /missing <op>\.\.\./],
      [["act", "--snapshot", "s1", "bogus"], /invalid act op: bogus/],
      [["extract", "--snapshot", "s1"], /missing --mode text\|links\./],
      [["qa", "run"], /missing <check-file>\./],
      [["open"], /missing <url>\./],
      [["open", "https://a.test", "--port", "80"], /invalid port: 80/],
      [["snapshot", "--backend", "nope"], /invalid --backend: nope/],
      [["snapshot", "-i", "--all"], /mutually exclusive/],
      [["open", "https://a.test", "--backend", "offline", "--launch"], /require --backend bidi/],
      [["frobnicate"], /unknown command: frobnicate/],
    ];
    for (const [args, pattern] of cases) {
      const r = runSync(dir, args);
      assert.equal(r.status, 2, `${args.join(" ")}: ${r.stderr}`);
      assert.match(r.stderr, pattern);
      assert.match(r.stderr, /Usage:/);
    }
    return Promise.resolve();
  });
});

test("offline snapshot via --input is unchanged", async () => {
  await withDir(async (dir) => {
    await writeFile(join(dir, "tree.txt"), '- button "Go" [ref=e1]\n- textbox "Email" [ref=e2]\n', "utf8");
    const r = runSync(dir, ["snapshot", "-i", "--json", "--input", "tree.txt", "--url", "https://x.test/", "--title", "T"]);
    assert.equal(r.status, 0, r.stderr);
    const snap = JSON.parse(r.stdout) as { url: string; title: string; elements: { ref: string; role: string }[] };
    assert.equal(snap.url, "https://x.test/");
    assert.equal(snap.title, "T");
    assert.deepEqual(
      snap.elements.map((e) => `${e.ref}:${e.role}`),
      ["e1:button", "e2:textbox"],
    );
    const plain = runSync(dir, ["snapshot", "--input", "tree.txt", "--out", "out/snap.json"]);
    assert.match(plain.stdout, /^snapshot ok: 2 elements -> out\/snap\.json \(id [\w-]+\)$/m);
    assert.ok(existsSync(join(dir, "out", "snap.json")));
    assert.ok(existsSync(join(dir, ".agent", "refs", "latest.json")));
  });
});

test("offline backend keeps open/click/fill behavior", async () => {
  await withDir(async (dir) => {
    await writeFile(join(dir, "tree.txt"), '- button "Go" [ref=e1]\n', "utf8");
    const open = runSync(dir, ["open", "https://x.test/", "--backend", "offline"]);
    assert.equal(open.status, 0, open.stderr);
    assert.match(open.stdout, /^open ok: https:\/\/x\.test\/ -> .*\.agent[/\\]session\.json$/m);
    const snap = runSync(dir, ["snapshot", "--input", "tree.txt", "--json"]);
    const id = (JSON.parse(snap.stdout) as { snapshotId: string }).snapshotId;
    const click = runSync(dir, ["click", "--snapshot", id, "e1", "--backend", "offline"]);
    assert.equal(click.status, 0, click.stderr);
    assert.match(click.stdout, /^click ok: e1 \(button "Go"\) -> .*\.agent[/\\]snapshot\.json \(id [\w-]+\)$/m);
    assert.ok(!click.stdout.includes("no input sent"));
    const stale = runSync(dir, ["click", "--snapshot", id, "e1", "--backend", "offline"]);
    assert.equal(stale.status, 3);
  });
});

test("open with nothing listening exits 4 and prints a hint line", async () => {
  await withDir(async (dir) => {
    const probe = await startFakeBidiServer();
    const { port } = probe;
    await probe.close();
    const r = await run(dir, ["open", "https://app.test/", "--allow-origin", "--port", String(port)]);
    assert.equal(r.status, 4, `${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /^error: /m);
    assert.match(r.stderr, new RegExp(`^hint: .*--remote-debugging-port.*${String(port)}`, "m"));
    // Env port is honored too.
    const viaEnv = await run(dir, ["open", "https://app.test/", "--allow-origin"], { PWA_NAV_PORT: String(port) });
    assert.equal(viaEnv.status, 4, viaEnv.stderr);
  });
});

test("open is gated: exit 6 + hint without allow-list, no BiDi frame; flag and allow.json permit; kill-switch 7", async () => {
  await withFake(async (dir, server) => {
    const port = String(server.port);
    const blocked = await run(dir, ["open", URL_A, "--port", port]);
    assert.equal(blocked.status, 6, blocked.stderr);
    assert.match(blocked.stderr, /^error: origin not allow-listed: https:\/\/app\.test$/m);
    assert.match(blocked.stderr, /^hint: re-run: open <url> --allow-origin to allow this origin$/m);
    assert.equal(server.commands.length, 0);
    assert.ok(!existsSync(join(dir, ".agent", "allow.json")));

    const launch = await run(dir, ["open", URL_A, "--launch", "--port", port]);
    assert.equal(launch.status, 6, launch.stderr);
    assert.equal(server.commands.length, 0);

    const flagged = await run(dir, ["open", URL_A, "--allow-origin", "--port", port]);
    assert.equal(flagged.status, 0, flagged.stderr);
    const again = await run(dir, ["open", URL_A, "--port", port]);
    assert.equal(again.status, 0, again.stderr);

    // Snapshot stays ungated.
    await liveSnapshot(dir, server.port);

    await writeFile(join(dir, "kill-file"), "", "utf8");
    const before = server.commands.length;
    const killed = await run(dir, ["open", URL_A, "--port", port]);
    assert.equal(killed.status, 7, killed.stderr);
    assert.equal(server.commands.length, before);
  });
});

test("bidi dry-run: no input sent, exit 0; password text is never printed", async () => {
  await withFake(async (dir, server) => {
    const id = await liveSnapshot(dir, server.port);
    const click = await run(dir, ["click", "--snapshot", id, "e3", "--port", String(server.port)]);
    assert.equal(click.status, 0, click.stderr);
    assert.deepEqual(click.stdout.trim().split("\n"), [
      'click dry-run: click button "Go" (occurrence 0) [enabled, visible]',
      "no input sent (pass --armed to execute)",
    ]);
    const fill = await run(dir, ["fill", "--snapshot", id, "e2", SECRET, "--port", String(server.port)]);
    assert.equal(fill.status, 0, fill.stderr);
    assert.match(fill.stdout, /^fill dry-run: /m);
    assert.match(fill.stdout, /no input sent \(pass --armed to execute\)$/m);
    assert.ok(!fill.stdout.includes(SECRET) && !fill.stderr.includes(SECRET));
    const act = await run(dir, ["act", "--snapshot", id, "click:e3", `fill:e2=${SECRET}`, "--port", String(server.port)]);
    assert.equal(act.status, 0, act.stderr);
    assert.ok(!act.stdout.includes(SECRET));
    assert.match(act.stdout, /no input sent/);
    assert.equal(inputFrames(server), 0);
    assert.equal(server.sessionActive, false);
  });
});

test("armed gating: origin_blocked (6) -> allow-origin -> executed -> kill_switch (7)", async () => {
  await withFake(async (dir, server) => {
    const port = String(server.port);
    const id = await liveSnapshot(dir, server.port);

    // Armed without an allow-listed origin: blocked, message + hint on stderr, nothing sent.
    const blocked = await run(dir, ["click", "--snapshot", id, "e3", "--armed", "--port", port]);
    assert.equal(blocked.status, 6, blocked.stderr);
    assert.match(blocked.stderr, /^error: origin not allow-listed: https:\/\/app\.test$/m);
    assert.match(blocked.stderr, /^hint: re-run: open <url> --allow-origin/m);
    assert.equal(inputFrames(server), 0);

    // A stray env var must never arm: still a dry-run.
    const env = await run(dir, ["click", "--snapshot", id, "e3", "--port", port], {
      PWA_NAV_ARMED: "1",
      PWA_NAV_ARM: "1",
    });
    assert.match(env.stdout, /dry-run/);
    assert.equal(inputFrames(server), 0);

    const open = await run(dir, ["open", URL_A, "--allow-origin", "--port", port]);
    assert.equal(open.status, 0, open.stderr);
    const allow = JSON.parse(await readFile(join(dir, ".agent", "allow.json"), "utf8")) as { origins: string[] };
    assert.deepEqual(allow.origins, ["https://app.test"]);

    const done = await run(dir, ["click", "--snapshot", id, "e3", "--armed", "--port", port]);
    assert.equal(done.status, 0, done.stderr);
    assert.match(done.stdout, /^click ok: click button "Go" \(occurrence 0\) \[enabled, visible\] -> .*\.agent[/\\]snapshot\.json \(id ([\w-]+)\)$/m);
    assert.ok(!done.stdout.includes("no input sent"));
    assert.equal(inputFrames(server), 1);

    // The old id is superseded: stale_ref (3).
    const stale = await run(dir, ["click", "--snapshot", id, "e3", "--armed", "--port", port]);
    assert.equal(stale.status, 3, stale.stderr);

    // Kill-switch present: exit 7, hint printed, no further input.
    const fresh = await liveSnapshot(dir, server.port);
    await writeFile(join(dir, "kill-file"), "", "utf8");
    const killed = await run(dir, ["click", "--snapshot", fresh, "e3", "--armed", "--port", port]);
    assert.equal(killed.status, 7, killed.stderr);
    assert.match(killed.stderr, /^hint: remove the kill-switch file/m);
    assert.equal(inputFrames(server), 1);
    // Dry-run is unaffected by the kill-switch.
    const dry = await run(dir, ["click", "--snapshot", fresh, "e3", "--port", port]);
    assert.equal(dry.status, 0, dry.stderr);
    assert.equal(server.sessionActive, false);
  });
});

test("live snapshot --json and --all", async () => {
  await withFake(async (dir, server) => {
    const port = String(server.port);
    const r = await run(dir, ["snapshot", "--json", "--all", "--port", port]);
    assert.equal(r.status, 0, r.stderr);
    const snap = JSON.parse(r.stdout) as { elements: unknown[]; snapshotId: string };
    assert.equal(snap.elements.length, 3);
    const side = JSON.parse(await readFile(join(dir, ".agent", "refs", `${snap.snapshotId}.locators.json`), "utf8")) as {
      includeAll?: boolean;
    };
    assert.equal(side.includeAll, true);
    const flags = server.commands
      .filter((c) => c.method === "script.callFunction")
      .map((c) => (c.params as { arguments?: { value?: unknown }[] }).arguments?.[0]?.value);
    assert.ok(flags.includes(true));
  });
});

test("cli: upload requires <ref> and <path>", async () => {
  await withDir((dir) => {
    const r = runSync(dir, ["upload", "--snapshot", "s1", "e1"]);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /missing <ref> <path>/);
  });
});

test("cli: upload dry-run and armed", async () => {
  await withFake(async (dir, server) => {
    const port = String(server.port);
    const testFile = join(dir, "avatar.png");
    await writeFile(testFile, "img-data", "utf8");

    const rawBackup = [...RAW];
    RAW.push({ role: "textbox", name: "Avatar", nameSource: "label", occurrence: 0, inputType: "file" });
    try {
      const snapRes = await run(dir, ["snapshot", "--port", port]);
      assert.equal(snapRes.status, 0, snapRes.stderr);
      const match = /^snapshot ok: \d+ elements -> .*\.agent[/\\]snapshot\.json \(id ([\w-]+)\)$/m.exec(snapRes.stdout);
      assert.ok(match, snapRes.stdout);
      const id = match[1] ?? "";

      // Dry-run
      const dry = await run(dir, ["upload", "--snapshot", id, "e4", testFile, "--port", port]);
      assert.equal(dry.status, 0, dry.stderr);
      assert.match(dry.stdout, /upload dry-run: upload textbox "Avatar"/);
      assert.match(dry.stdout, /no input sent/);
      assert.equal(server.commands.filter((c) => c.method === "input.setFiles").length, 0);

      // Armed without allow-origin fails with origin_blocked
      const blocked = await run(dir, ["upload", "--snapshot", id, "e4", testFile, "--armed", "--port", port]);
      assert.equal(blocked.status, 6, blocked.stderr);

      // Allow origin
      await run(dir, ["open", URL_A, "--allow-origin", "--port", port]);

      // Armed
      const armed = await run(dir, ["upload", "--snapshot", id, "e4", testFile, "--armed", "--port", port]);
      assert.equal(armed.status, 0, armed.stderr);
      assert.match(armed.stdout, /upload ok: upload textbox "Avatar"/);
      assert.equal(server.commands.filter((c) => c.method === "input.setFiles").length, 1);
    } finally {
      RAW.length = 0;
      RAW.push(...rawBackup);
    }
  });
});

test("cli: act upload:<ref>=<path>", async () => {
  await withFake(async (dir, server) => {
    const port = String(server.port);
    const testFile = join(dir, "avatar.png");
    await writeFile(testFile, "img-data", "utf8");

    const rawBackup = [...RAW];
    RAW.push({ role: "textbox", name: "Avatar", nameSource: "label", occurrence: 0, inputType: "file" });
    try {
      await run(dir, ["open", URL_A, "--allow-origin", "--port", port]);
      const snapRes = await run(dir, ["snapshot", "--port", port]);
      assert.equal(snapRes.status, 0, snapRes.stderr);
      const match = /^snapshot ok: \d+ elements -> .*\.agent[/\\]snapshot\.json \(id ([\w-]+)\)$/m.exec(snapRes.stdout);
      assert.ok(match, snapRes.stdout);
      const id = match[1] ?? "";

      const dry = await run(dir, ["act", "--snapshot", id, `upload:e4=${testFile}`, "--port", port]);
      assert.equal(dry.status, 0, dry.stderr);
      assert.match(dry.stdout, /upload textbox "Avatar"/);

      const armed = await run(dir, ["act", "--snapshot", id, `upload:e4=${testFile}`, "--armed", "--port", port]);
      assert.equal(armed.status, 0, armed.stderr);
      assert.match(armed.stdout, /upload ok: upload textbox "Avatar"/);
      assert.equal(server.commands.filter((c) => c.method === "input.setFiles").length, 1);
    } finally {
      RAW.length = 0;
      RAW.push(...rawBackup);
    }
  });
});

test("cli: screenshot command offline and live with --out", async () => {
  // Offline screenshot
  const dir = await mkdtemp(join(tmpdir(), "pwa-nav-cli-screenshot-"));
  try {
    const offlineRes = runSync(dir, ["screenshot", "--backend", "offline"]);
    assert.equal(offlineRes.status, 0, offlineRes.stderr);
    assert.match(offlineRes.stdout, /screenshot saved to .*\.agent[/\\]screenshot\.png/);
    assert.equal(existsSync(join(dir, ".agent", "screenshot.png")), true);

    // Custom out path
    const customOut = join(dir, "custom-shot.png");
    const customRes = runSync(dir, ["screenshot", "--backend", "offline", "--out", customOut]);
    assert.equal(customRes.status, 0, customRes.stderr);
    assert.match(customRes.stdout, /screenshot saved to .*custom-shot\.png/);
    assert.equal(existsSync(customOut), true);

    // Invalid format
    const badFormat = runSync(dir, ["screenshot", "--backend", "offline", "--format", "bmp"]);
    assert.equal(badFormat.status, 2, badFormat.stderr);
    assert.match(badFormat.stderr, /invalid --format: bmp/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }

  // Live screenshot via fake BiDi server
  await withFake(async (liveDir, server) => {
    const port = String(server.port);
    const liveOut = join(liveDir, "live-screenshot.png");
    const liveRes = await run(liveDir, ["screenshot", "--out", liveOut, "--port", port]);
    assert.equal(liveRes.status, 0, liveRes.stderr);
    assert.match(liveRes.stdout, /screenshot saved to .*live-screenshot\.png/);
    assert.equal(existsSync(liveOut), true);

    const shotCommands = server.commands.filter((c) => c.method === "browsingContext.captureScreenshot");
    assert.equal(shotCommands.length, 1);
  });
});

test("cli: snapshot with --screenshot flag", async () => {
  await withFake(async (dir, server) => {
    const port = String(server.port);
    const res = await run(dir, ["snapshot", "--screenshot", "--port", port]);
    assert.equal(res.status, 0, res.stderr);
    assert.match(res.stdout, /snapshot ok:/);
    assert.match(res.stdout, /screenshot saved to .*\.agent[/\\]screenshot\.png/);
    assert.equal(existsSync(join(dir, ".agent", "screenshot.png")), true);

    const shotCommands = server.commands.filter((c) => c.method === "browsingContext.captureScreenshot");
    assert.equal(shotCommands.length, 1);
  });
});

test("cli: extract with --query, --role and pagination", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pwa-nav-cli-extract-"));
  try {
    const snapPath = join(dir, "tree.txt");
    await writeFile(
      snapPath,
      `- heading "Dashboard" [ref=e1]
- textbox "Search files" [ref=e2]: admin
- button "Submit query" [ref=e3]
- button "Delete file" [disabled] [ref=e4]
- button "Generate video" [ref=e5]
`,
      "utf8",
    );
    const snap = runSync(dir, ["snapshot", "--input", snapPath, "--json"]);
    assert.equal(snap.status, 0, snap.stderr);
    const { snapshotId } = JSON.parse(snap.stdout) as { snapshotId: string };

    // Query filter
    const queryRes = runSync(dir, ["extract", "--snapshot", snapshotId, "--mode", "text", "--query", "video"]);
    assert.equal(queryRes.status, 0, queryRes.stderr);
    assert.equal(queryRes.stdout.trim(), 'e5 button "Generate video"');

    // Role filter
    const roleRes = runSync(dir, ["extract", "--snapshot", snapshotId, "--mode", "text", "--role", "textbox"]);
    assert.equal(roleRes.status, 0, roleRes.stderr);
    assert.equal(roleRes.stdout.trim(), 'e2 textbox "Search files": admin');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("cli: wait command finds element or times out", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pwa-nav-cli-wait-"));
  try {
    const snapPath = join(dir, "tree.txt");
    await writeFile(
      snapPath,
      `- heading "Dashboard" [ref=e1]
- button "Submit query" [ref=e2]
`,
      "utf8",
    );
    runSync(dir, ["snapshot", "--input", snapPath]);

    // Success in offline mode
    const okRes = runSync(dir, ["wait", "--backend", "offline", "--query", "Submit", "--timeout", "500ms"]);
    assert.equal(okRes.status, 0, okRes.stderr);
    assert.match(okRes.stdout, /wait ok: visible "Submit"/);

    // Timeout when not found
    const timeoutRes = runSync(dir, ["wait", "--backend", "offline", "--query", "NonExistent", "--timeout", "100ms"]);
    assert.equal(timeoutRes.status, 9, timeoutRes.stderr);
    assert.match(timeoutRes.stderr, /timed out/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

