// Opt-in E2E (spec 004, T012): the real compiled CLI against a REAL headless Firefox.
// Run with PWA_NAV_E2E=1 (after `pnpm build`). Skipped by default, so `pnpm test` stays fast.
// Safety: own temp profile, own free port, own child process (only that PID tree is killed).
// It never uses port 9222, %APPDATA%\FirefoxPWA\profiles\* or `--pwa`.
import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer as createHttpServer, type Server } from "node:http";
import { createServer as createNetServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, test } from "node:test";
import { fileURLToPath } from "node:url";
import { withTopLevelContext } from "./bidi/session.js";
import { endpointFor } from "./browser/bidi-backend.js";
import { tcpProbe, waitForPort } from "./browser/pwa-runtime.js";
import type { Snapshot } from "./core/snapshot.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, "cli.js");
const FIXTURES = join(HERE, "..", "checks", "fixtures", "e2e");
const FIREFOX =
  process.env["PWA_NAV_E2E_FIREFOX"] ??
  join(process.env["APPDATA"] ?? "", "FirefoxPWA", "runtime", process.platform === "win32" ? "firefox.exe" : "firefox");

function skipReason(): string | undefined {
  if (process.env["PWA_NAV_E2E"] !== "1") return "set PWA_NAV_E2E=1 to run the real-Firefox E2E";
  if (!existsSync(FIREFOX)) return `Firefox runtime not found at ${FIREFOX} (set PWA_NAV_E2E_FIREFOX)`;
  return undefined;
}

const SECRET = "Sup3r-S3cret-pw!";
const UNICODE = "Ünïcödé 😀";

interface Result {
  status: number | null;
  stdout: string;
  stderr: string;
  ms: number;
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createNetServer();
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      srv.close(() => {
        resolve(port);
      });
    });
  });
}

// Kills only the tree we spawned.
function killTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    child.kill("SIGKILL");
  }
}

const skip = skipReason();

describe("E2E: real Firefox over BiDi", { skip }, () => {
  let child: ChildProcess | undefined;
  let http: Server | undefined;
  let profile = "";
  let cwd = "";
  let port = 0;
  let base = "";
  const timings: string[] = [];
  const onExit = (): void => {
    if (child !== undefined) killTree(child);
  };

  async function cli(args: string[], opts: { cwd?: string; env?: NodeJS.ProcessEnv } = {}): Promise<Result> {
    const started = Date.now();
    const dir = opts.cwd ?? cwd;
    return new Promise((resolve, reject) => {
      const proc = spawn(process.execPath, [CLI, ...args, "--port", String(port)], {
        cwd: dir,
        env: { ...process.env, PWA_NAV_KILL_SWITCH: join(dir, "kill-file"), ...opts.env },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      proc.stdout.setEncoding("utf8").on("data", (d: string) => (stdout += d));
      proc.stderr.setEncoding("utf8").on("data", (d: string) => (stderr += d));
      const timer = setTimeout(() => proc.kill(), 60_000);
      proc.on("error", reject);
      proc.on("close", (status) => {
        clearTimeout(timer);
        const ms = Date.now() - started;
        timings.push(`${String(ms).padStart(5)} ms  exit ${String(status)}  ${args[0] ?? ""}`);
        resolve({ status, stdout, stderr, ms });
      });
    });
  }

  async function snap(dir = cwd): Promise<Snapshot> {
    const r = await cli(["snapshot", "-i"], { cwd: dir });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(await readFile(join(dir, ".agent", "snapshot.json"), "utf8")) as Snapshot;
  }

  function ref(s: Snapshot, role: string, name: string): string {
    const found = s.elements.find((e) => e.role === role && e.name === name);
    assert.ok(found, `no ${role} "${name}" in snapshot: ${JSON.stringify(s.elements.map((e) => `${e.role}:${e.name}`))}`);
    return found.ref;
  }

  // In-page evaluation through the protocol (own short session, ended by withSession).
  function evalPage(expression: string): Promise<unknown> {
    return withTopLevelContext(endpointFor(port), (client, context) => client.evaluate(context, expression));
  }

  before(async () => {
    process.on("exit", onExit);
    profile = await mkdtemp(join(tmpdir(), "pwa-nav-e2e-profile-"));
    cwd = await mkdtemp(join(tmpdir(), "pwa-nav-e2e-cwd-"));
    await writeFile(join(profile, "user.js"), 'user_pref("remote.prefs.recommended", false);\n');

    const server = createHttpServer((req, res) => {
      const path = (req.url ?? "/").split("?")[0] ?? "/";
      if (path === "/api/login-delayed") {
        setTimeout(() => {
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        }, 400);
        return;
      }
      const file = path === "/other.html" ? "other.html" : "index.html"; // SPA fallback for /welcome
      readFile(join(FIXTURES, file)).then(
        (body) => {
          res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
          res.end(body);
        },
        () => {
          res.writeHead(500);
          res.end();
        },
      );
    });
    http = server;
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    base = `http://127.0.0.1:${String(typeof address === "object" && address !== null ? address.port : 0)}`;

    port = await freePort();
    child = spawn(
      FIREFOX,
      ["--profile", profile, "--headless", "--no-remote", "--remote-debugging-port", String(port), "about:blank"],
      { stdio: "ignore" },
    );
    child.on("error", () => undefined);
    await waitForPort("127.0.0.1", port, 60_000);
  });

  after(async () => {
    console.log(`E2E timings:\n${timings.join("\n")}`);
    process.off("exit", onExit);
    if (child !== undefined) killTree(child);
    const server = http;
    if (server !== undefined) {
      try {
        server.closeAllConnections();
      } catch {}
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 2000);
        server.close(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
    // Windows may hold profile files briefly after the kill.
    for (const dir of [profile, cwd]) {
      if (dir !== "") {
        try {
          await rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
        } catch {}
      }
    }
  });

  test("open navigates and writes the session file", async () => {
    assert.equal(await tcpProbe("127.0.0.1", port), true);
    const r = await cli(["open", `${base}/`, "--allow-origin"]);
    assert.equal(r.status, 0, r.stderr);
    const session = JSON.parse(await readFile(join(cwd, ".agent", "session.json"), "utf8")) as { url: string };
    assert.equal(session.url, `${base}/`);
    const allow = JSON.parse(await readFile(join(cwd, ".agent", "allow.json"), "utf8")) as { origins: string[] };
    assert.deepEqual(allow.origins, [base]);
  });

  test("snapshot -i lists the interactive elements, never the password value", async () => {
    const s = await snap();
    const pairs = s.elements.map((e) => `${e.role}:${e.name}`);
    for (const want of [
      "textbox:Email",
      "textbox:Note",
      "textbox:Password",
      "button:Show password",
      "button:Sign in",
      "link:Other page",
      "button:Disabled action",
      "button:Covered action",
    ]) {
      assert.ok(pairs.includes(want), `missing ${want} in ${pairs.join(", ")}`);
    }
    assert.ok(!pairs.includes("button:Hidden action"), "display:none button must be excluded");
    assert.equal(s.elements.find((e) => e.name === "Password")?.value, undefined);
    assert.equal(s.elements.find((e) => e.name === "Disabled action")?.disabled, true);
    assert.equal(s.title, "E2E Login");
  });

  test("fill: dry-run sends nothing, armed types (incl. unicode) into a controlled input", async () => {
    let s = await snap();
    const note = ref(s, "textbox", "Note");
    const dry = await cli(["fill", "--snapshot", s.snapshotId, note, UNICODE]);
    assert.equal(dry.status, 0, dry.stderr);
    assert.match(dry.stdout, /dry-run/);
    assert.equal(await evalPage("document.getElementById('echo').textContent"), "");

    const armed = await cli(["fill", "--snapshot", s.snapshotId, "--armed", note, UNICODE]);
    assert.equal(armed.status, 0, armed.stderr + armed.stdout);
    assert.equal(await evalPage("document.getElementById('echo').textContent"), UNICODE);
    assert.equal(await evalPage("document.getElementById('note').value"), UNICODE);

    // The armed fill superseded the old snapshot.
    const stale = await cli(["fill", "--snapshot", s.snapshotId, "--armed", note, "x"]);
    assert.equal(stale.status, 3, stale.stderr);

    s = await snap();
    assert.equal(s.elements.find((e) => e.name === "Note")?.value, UNICODE);
    // Replacing existing text (select-all + type) keeps controlled state in sync.
    const again = await cli(["fill", "--snapshot", s.snapshotId, "--armed", ref(s, "textbox", "Note"), "second"]);
    assert.equal(again.status, 0, again.stderr);
    assert.equal(await evalPage("document.getElementById('echo').textContent"), "second");
  });

  test("fill: a value rewritten one frame after typing is caught by the readback", async () => {
    const s = await snap();
    const r = await cli(["fill", "--snapshot", s.snapshotId, "--armed", ref(s, "textbox", "Masked"), "abcdef"]);
    assert.equal(r.status, 8, r.stdout + r.stderr);
    assert.match(r.stderr, /value after typing differs/);
    assert.ok(!r.stderr.includes("abcdef"));
  });

  test("fill contenteditable and click below the fold (scrolled into view)", async () => {
    let s = await snap();
    const rich = await cli(["fill", "--snapshot", s.snapshotId, "--armed", ref(s, "textbox", "Rich"), UNICODE]);
    assert.equal(rich.status, 0, rich.stderr);
    assert.equal(await evalPage("document.getElementById('rich').textContent"), UNICODE);
    s = await snap();
    assert.equal(await evalPage("window.scrollY"), 0);
    const far = await cli(["click", "--snapshot", s.snapshotId, "--armed", ref(s, "button", "Far button")]);
    assert.equal(far.status, 0, far.stderr);
    assert.ok(Number(await evalPage("document.body.dataset.far")) > 1000, "page must have scrolled before the click");
  });

  test("password fill: length-only readback, secret never printed or stored", async () => {
    const s = await snap();
    const r = await cli(["fill", "--snapshot", s.snapshotId, "--armed", ref(s, "textbox", "Password"), SECRET]);
    assert.equal(r.status, 0, r.stderr);
    assert.ok(!r.stdout.includes(SECRET) && !r.stderr.includes(SECRET));
    assert.equal(await evalPage("document.getElementById('password').value"), SECRET);
    const next = await snap();
    const stored = await readFile(join(cwd, ".agent", "snapshot.json"), "utf8");
    assert.ok(!stored.includes(SECRET));
    assert.equal(next.elements.find((e) => e.name === "Password")?.value, undefined);
  });

  test("not_actionable: disabled, covered and zero-size targets", async () => {
    const s = await snap();
    for (const [name, reason] of [
      ["Disabled action", /disabled/],
      ["Covered action", /covered by/],
      ["Zero size", /not visible/],
    ] as const) {
      const r = await cli(["click", "--snapshot", s.snapshotId, "--armed", ref(s, "button", name)]);
      assert.equal(r.status, 8, `${name}: ${r.stderr}`);
      assert.match(r.stderr, reason, name);
    }
  });

  test("full navigation click: settle waits for load, old snapshot is stale", async () => {
    const s = await snap();
    const r = await cli(["click", "--snapshot", s.snapshotId, "--armed", ref(s, "link", "Other page")]);
    assert.equal(r.status, 0, r.stderr);
    const next = await snap();
    assert.equal(next.title, "E2E Other");
    assert.equal(next.url, `${base}/other.html`);
    assert.ok(next.elements.some((e) => e.role === "link" && e.name === "Back to login"));
    const old = await cli(["click", "--snapshot", s.snapshotId, "--armed", "e1"]);
    assert.equal(old.status, 3);
    // Back to the login page for the following tests.
    const back = await cli(["click", "--snapshot", next.snapshotId, "--armed", ref(next, "link", "Back to login")]);
    assert.equal(back.status, 0, back.stderr);
  });

  test("click Sign in: SPA route change without page load", async () => {
    const s = await snap();
    await evalPage("window.__marker = 'same-document'");
    const r = await cli(["click", "--snapshot", s.snapshotId, "--armed", ref(s, "button", "Sign in")]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(await evalPage("window.__marker"), "same-document", "no page load may have happened");
    const welcome = await snap();
    assert.equal(welcome.url, `${base}/welcome`);
    assert.ok(welcome.elements.some((e) => e.role === "button" && e.name === "Sign out"));
    const all = await cli(["snapshot", "--all"]);
    assert.equal(all.status, 0, all.stderr);
    const full = JSON.parse(await readFile(join(cwd, ".agent", "snapshot.json"), "utf8")) as Snapshot;
    assert.ok(full.elements.some((e) => e.role === "heading" && e.name === "Welcome back"));
    const old = await cli(["click", "--snapshot", s.snapshotId, "--armed", "e1"]);
    assert.equal(old.status, 3, old.stderr);
  });

  test("click Async sign in: SPA route change after delayed fetch settles correctly", async () => {
    assert.equal((await cli(["open", `${base}/`])).status, 0);
    const s = await snap();
    const r = await cli(["click", "--snapshot", s.snapshotId, "--armed", ref(s, "button", "Async sign in")]);
    assert.equal(r.status, 0, r.stderr);
    const welcome = await snap();
    assert.equal(welcome.url, `${base}/welcome-async`);
    assert.equal(welcome.title, "E2E Welcome Async");
    assert.ok(welcome.elements.some((e) => e.role === "button" && e.name === "Sign out"));
  });

  test("act: multi-op batch yields ONE new snapshot", async () => {
    assert.equal((await cli(["open", `${base}/`])).status, 0);
    const s = await snap();
    const r = await cli([
      "act",
      "--snapshot",
      s.snapshotId,
      "--armed",
      `fill:${ref(s, "textbox", "Email")}=${UNICODE}`,
      `fill:${ref(s, "textbox", "Note")}=batch`,
      `click:${ref(s, "button", "Sign in")}`,
    ]);
    assert.equal(r.status, 0, r.stderr + r.stdout);
    assert.equal((r.stdout.match(/\(id [^)]+\)/g) ?? []).length, 1, r.stdout);
    const next = await snap();
    assert.equal(next.url, `${base}/welcome`);
  });

  test("origin gate: armed without allow-list exits 6", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pwa-nav-e2e-gate-"));
    try {
      // Put the page on the login form via the (allow-listed) main cwd, then use the fresh cwd.
      assert.equal((await cli(["open", `${base}/`, "--allow-origin"])).status, 0);
      // open itself is gated too: nothing is allow-listed in this fresh cwd.
      const blockedOpen = await cli(["open", `${base}/`], { cwd: dir });
      assert.equal(blockedOpen.status, 6, blockedOpen.stderr);
      const s = await snap(dir);
      const r = await cli(["click", "--snapshot", s.snapshotId, "--armed", ref(s, "button", "Sign in")], { cwd: dir });
      assert.equal(r.status, 6, r.stderr);
      // Dry-run is still allowed.
      const dry = await cli(["click", "--snapshot", s.snapshotId, ref(s, "button", "Sign in")], { cwd: dir });
      assert.equal(dry.status, 0, dry.stderr);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("kill-switch: armed action exits 7", async () => {
    assert.equal((await cli(["open", `${base}/`])).status, 0);
    const s = await snap();
    const killFile = join(cwd, "kill-now");
    await writeFile(killFile, "stop");
    const r = await cli(["click", "--snapshot", s.snapshotId, "--armed", ref(s, "button", "Sign in")], {
      env: { PWA_NAV_KILL_SWITCH: killFile },
    });
    assert.equal(r.status, 7, r.stderr);
    assert.equal(await evalPage("location.pathname"), "/");
  });

  test("20 consecutive snapshots leave no active session", async () => {
    const durations: number[] = [];
    for (let i = 0; i < 20; i++) {
      const r = await cli(["snapshot", "-i"]);
      assert.equal(r.status, 0, `run ${String(i)}: ${r.stderr}`);
      assert.ok(!r.stderr.includes("Maximum number of active sessions"));
      durations.push(r.ms);
    }
    console.log(`snapshot x20 ms: min ${String(Math.min(...durations))} max ${String(Math.max(...durations))}`);
    // A fresh session must still be creatable (no orphan).
    assert.equal(await evalPage("1 + 1"), 2);
  });

  test("screenshot: captures PNG to disk and verifies binary header", async () => {
    assert.equal((await cli(["open", `${base}/`])).status, 0);
    const shotPath = join(cwd, "test-screenshot.png");
    const r = await cli(["screenshot", "--out", shotPath]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /screenshot saved to/);
    assert.equal(existsSync(shotPath), true);

    const buf = await readFile(shotPath);
    assert.equal(buf.length > 100, true);
    // Verify PNG magic bytes
    assert.equal(buf[0], 0x89);
    assert.equal(buf[1], 0x50);
    assert.equal(buf[2], 0x4e);
    assert.equal(buf[3], 0x47);
  });
});
