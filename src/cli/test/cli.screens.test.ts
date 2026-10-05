// CLI tests for spec 005 (T009): snapshot --screen/--learn and @id targets.
// Live paths run against the in-process fake BiDi server; PWA_NAV_PORT points at a closed port.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { startFakeBidiServer, type FakeBidiServer } from "../../bidi/fake-server.js";
import type { RawElement } from "../../browser/collector.js";
import { learnScreen } from "../../screens/screen-learn.js";
import type { ScreenMap } from "../../screens/screen-map.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");
const CLI = existsSync(join(HERE, "..", "..", "cli.js"))
  ? join(HERE, "..", "..", "cli.js")
  : join(ROOT, "dist", "cli.js");
const ORIGIN = "http://localhost:8080";
const SECRET = "hunter2-SECRET";

const CLOSED_PORT = await (async (): Promise<number> => {
  const probe = await startFakeBidiServer();
  const { port } = probe;
  await probe.close();
  return port;
})();

interface Result {
  status: number | null;
  stdout: string;
  stderr: string;
}

function run(dir: string, args: string[]): Promise<Result> {
  return new Promise((resolve, reject) => {
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env["PWA_NAV_BACKEND"];
    delete env["PWA_NAV_SCREENS_DIR"];
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: dir,
      env: {
        ...env,
        PWA_NAV_PORT: String(CLOSED_PORT),
        PWA_NAV_KILL_SWITCH: join(dir, "kill-file"),
        PWA_NAV_FIREFOXPWA_DIR: join(dir, "nopwa"),
        PWA_NAV_CACHE_DIR: join(dir, ".agent"),
      },
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

const LOGIN_RAW: RawElement[] = [
  { role: "textbox", name: "Email", nameSource: "label", occurrence: 0, inputType: "text" },
  { role: "textbox", name: "Password", nameSource: "label", occurrence: 0, inputType: "password" },
  { role: "button", name: "Show password", nameSource: "aria-label", occurrence: 0, buttonType: "button" },
  { role: "button", name: "Sign in", nameSource: "content", occurrence: 0, buttonType: "submit" },
  { role: "link", name: "Forgot password?", nameSource: "content", occurrence: 0, href: "/forgot-password" },
  { role: "link", name: "Help center", nameSource: "content", occurrence: 0, href: "https://help.example.com" },
];

interface Page {
  url: string;
  title: string;
  raw: RawElement[];
}

async function withFake(fn: (dir: string, server: FakeBidiServer, page: Page) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "pwa-nav-screens-"));
  const server = await startFakeBidiServer();
  const page: Page = { url: `${ORIGIN}/login`, title: "Demo App", raw: LOGIN_RAW };
  server.handle("session.subscribe", () => ({ subscription: "s" }));
  server.handle("input.performActions", () => ({}));
  server.handle("input.releaseActions", () => ({}));
  server.handle("browsingContext.getTree", () => ({
    contexts: [{ context: "ctx", url: page.url, children: [], userContext: "default" }],
  }));
  server.handle("script.evaluate", () => ok(page.url));
  server.handle("script.callFunction", (params) => {
    const decl = (params as { functionDeclaration: string }).functionDeclaration;
    if (decl.startsWith("(includeAll) =>")) return ok({ url: page.url, title: page.title, raw: page.raw });
    if (decl.startsWith("(index, role")) {
      return { type: "success", realm: "r", result: { type: "node", sharedId: "node-1" } };
    }
    if (decl.includes("isContentEditable")) return ok({ ok: true, kind: "text", sensitive: false });
    if (decl.includes("MutationObserver")) return ok(true);
    if (decl.includes("elementFromPoint")) return ok({ ok: true });
    if (decl.startsWith("() => ({ url: location.href")) return ok({ url: page.url, title: page.title });
    return ok(true);
  });
  try {
    await fn(dir, server, page);
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
}

async function seedDemo(dir: string): Promise<string> {
  await mkdir(join(dir, "screens"), { recursive: true });
  const target = join(dir, "screens", "demo-app.screens.json");
  await copyFile(join(ROOT, "examples", "screens", "demo-app.screens.json"), target);
  return target;
}

async function allow(dir: string): Promise<void> {
  await mkdir(join(dir, ".agent"), { recursive: true });
  await writeFile(join(dir, ".agent", "allow.json"), JSON.stringify({ origins: [ORIGIN] }), "utf8");
}

const count = (s: FakeBidiServer, method: string): number => s.commands.filter((c) => c.method === method).length;
const inputFrames = (s: FakeBidiServer): number => count(s, "input.performActions");
const collects = (s: FakeBidiServer): number => count(s, "script.callFunction");
const port = (s: FakeBidiServer): string => String(s.port);

test("snapshot --screen prints the golden compact view without collecting or writing a snapshot", async () => {
  await withFake(async (dir, server, page) => {
    await seedDemo(dir);
    const golden = (
      await readFile(join(ROOT, "checks", "fixtures", "views", "demo-login.view.txt"), "utf8")
    ).replace(/\r\n/g, "\n");
    const r = await run(dir, ["snapshot", "--screen", "--port", port(server)]);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout.trim(), golden.trim());
    assert.equal(collects(server), 0);
    assert.ok(!existsSync(join(dir, ".agent", "snapshot.json")));

    page.url = `${ORIGIN}/nowhere`;
    const unmapped = await run(dir, ["snapshot", "--screen", "--port", port(server)]);
    assert.equal(unmapped.status, 13, unmapped.stderr);
    assert.match(unmapped.stderr, /^error: unmapped screen: \/nowhere on http:\/\/localhost:8080$/m);
    assert.match(unmapped.stderr, /^hint: .*snapshot --learn/m);

    page.url = "http://other.test/login";
    const other = await run(dir, ["snapshot", "--screen", "--port", port(server)]);
    assert.equal(other.status, 13, other.stderr);
    assert.equal(collects(server), 0);
  });
});

test("--screen / --learn flag validation exits 2", async () => {
  await withFake(async (dir, server) => {
    await seedDemo(dir);
    const p = ["--port", port(server)];
    const cases: [string[], RegExp][] = [
      [["snapshot", "--screen", "--learn"], /mutually exclusive/],
      [["snapshot", "--screen", "--json"], /cannot be combined/],
      [["snapshot", "--screen", "-i"], /cannot be combined/],
      [["snapshot", "--screen", "--all"], /cannot be combined/],
      [["snapshot", "--screen", "--input", "x.txt"], /cannot be combined/],
      [["snapshot", "--learn", "--json"], /cannot be combined/],
      [["snapshot", "--prune"], /--prune requires --learn/],
      [["snapshot", "--locale", "en"], /--locale requires --learn/],
      [["snapshot", "--learn", "--locale", "not a tag"], /invalid --locale/],
      [["snapshot", "--learn", "--access", "maybe"], /invalid --access/],
      [["snapshot", "--learn", "--app-id", "Bad Id"], /invalid --app-id/],
      [["snapshot", "--learn", "--backend", "offline"], /live backend/],
    ];
    for (const [args, pattern] of cases) {
      const r = await run(dir, [...args, ...p]);
      assert.equal(r.status, 2, `${args.join(" ")}: ${r.stdout}${r.stderr}`);
      assert.match(r.stderr, pattern);
    }
    assert.equal(collects(server), 0);
  });
});

test("--learn creates a new map (locale required), then is idempotent", async () => {
  await withFake(async (dir, server) => {
    const p = ["--port", port(server)];
    const missing = await run(dir, ["snapshot", "--learn", ...p]);
    assert.equal(missing.status, 2, missing.stderr);
    assert.match(missing.stderr, /--locale/);
    assert.match(missing.stderr, /lang attribute is not\s+trustworthy/);
    assert.ok(!existsSync(join(dir, "screens")));

    const first = await run(dir, ["snapshot", "--learn", "--locale", "es-ES", "--access", "public", ...p]);
    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /^snapshot ok: 6 elements -> .*\.agent[/\\]snapshot\.json \(id ([\w-]+)\)$/m);
    assert.match(first.stdout, /^new screen$/m);
    const path = join(".agent", "screens", "localhost-8080.screens.json");
    assert.ok(first.stdout.includes("screens") && first.stdout.includes("localhost-8080.screens.json (written)"), first.stdout);
    const map = JSON.parse(await readFile(join(dir, path), "utf8")) as ScreenMap;
    assert.equal(map.app.id, "localhost-8080");
    assert.equal(map.app.name, "Demo App");
    assert.equal(map.app.locale, "es-ES");
    assert.equal(map.app.origin, ORIGIN);
    assert.equal(map.screens[0]?.id, "login");

    const before = (await stat(join(dir, path))).mtimeMs;
    // The locale flag is ignored for an existing map; stored app info is kept.
    const again = await run(dir, ["snapshot", "--learn", "--locale", "en", "--access", "public", ...p]);
    assert.equal(again.status, 0, again.stderr);
    assert.match(again.stdout, /^no changes$/m);
    assert.ok(again.stdout.includes("screens") && again.stdout.includes("localhost-8080.screens.json (unchanged)"), again.stdout);
    assert.equal((await stat(join(dir, path))).mtimeMs, before);
    const kept = JSON.parse(await readFile(join(dir, path), "utf8")) as ScreenMap;
    assert.equal(kept.app.locale, "es-ES");

    // Explicit file: created at that path with --app-id/--app-name.
    const explicit = await run(dir, [
      "snapshot", "--learn", "--locale", "en", "--screen-map", "custom.screens.json",
      "--app-id", "my-app", "--app-name", "My App", ...p,
    ]);
    assert.equal(explicit.status, 0, explicit.stderr);
    const custom = JSON.parse(await readFile(join(dir, "custom.screens.json"), "utf8")) as ScreenMap;
    assert.deepEqual([custom.app.id, custom.app.name], ["my-app", "My App"]);
  });
});

test("--learn on the committed example is idempotent; a renamed button is drift and keeps its id", async () => {
  await withFake(async (dir, server, page) => {
    const file = await seedDemo(dir);
    const p = ["--port", port(server)];
    const before = (await stat(file)).mtimeMs;
    const same = await run(dir, ["snapshot", "--learn", "--access", "public", ...p]);
    assert.equal(same.status, 0, same.stderr);
    assert.match(same.stdout, /^no changes$/m);
    assert.ok(same.stdout.includes("demo-app.screens.json (unchanged)"), same.stdout);
    assert.equal((await stat(file)).mtimeMs, before);

    page.raw = LOGIN_RAW.map((e) => (e.name === "Sign in" ? { ...e, name: "Log in" } : e));
    const drift = await run(dir, ["snapshot", "--learn", "--access", "public", ...p]);
    assert.equal(drift.status, 0, drift.stderr);
    assert.match(drift.stdout, /~ renamed @sign-in "Sign in" -> "Log in"/);
    assert.match(drift.stdout, /DRIFT/);
    assert.ok(drift.stdout.includes("(written)"));
    const map = JSON.parse(await readFile(file, "utf8")) as ScreenMap;
    const ids = map.screens[0]?.actions.map((a) => `${a.id}:${a.name}`);
    assert.deepEqual(ids, ["show-password:Show password", "sign-in:Log in"]);

    // A removed element is kept and flagged; --prune drops it.
    page.raw = page.raw.filter((e) => e.name !== "Help center");
    const kept = await run(dir, ["snapshot", "--learn", "--access", "public", ...p]);
    assert.match(kept.stdout, /- missing @help-center/);
    assert.ok((await readFile(file, "utf8")).includes("help-center"));
    const pruned = await run(dir, ["snapshot", "--learn", "--prune", "--access", "public", ...p]);
    assert.equal(pruned.status, 0, pruned.stderr);
    assert.ok(!(await readFile(file, "utf8")).includes("help-center"));
  });
});

test("fill @password is refused (11) before any collection or input; text never printed", async () => {
  await withFake(async (dir, server) => {
    await seedDemo(dir);
    const r = await run(dir, ["fill", "@password", SECRET, "--armed", "--port", port(server)]);
    assert.equal(r.status, 11, r.stderr);
    assert.equal(collects(server), 0);
    assert.equal(inputFrames(server), 0);
    assert.ok(!(r.stdout + r.stderr).includes(SECRET));
    const unknown = await run(dir, ["click", "@nope", "--port", port(server)]);
    assert.equal(unknown.status, 12, unknown.stderr);
    assert.match(unknown.stderr, /available ids/);
    assert.equal(collects(server), 0);
  });
});

test("click @show-password: dry-run plan, then armed click prints the compact view", async () => {
  await withFake(async (dir, server) => {
    await seedDemo(dir);
    const p = ["--port", port(server)];
    const dry = await run(dir, ["click", "@show-password", ...p]);
    assert.equal(dry.status, 0, dry.stderr);
    const lines = dry.stdout.trim().split("\n");
    assert.equal(lines[0], 'click @show-password: button "Show password" (action, occurrence 0)');
    assert.match(lines[1] ?? "", /^click dry-run: /);
    assert.equal(lines[lines.length - 1], "no input sent (pass --armed to execute)");
    assert.equal(inputFrames(server), 0);

    const blocked = await run(dir, ["click", "@show-password", "--armed", ...p]);
    assert.equal(blocked.status, 6, blocked.stderr);
    assert.equal(inputFrames(server), 0);

    await allow(dir);
    const done = await run(dir, ["click", "@show-password", "--armed", ...p]);
    assert.equal(done.status, 0, done.stderr);
    assert.ok(inputFrames(server) > 0);
    assert.match(done.stdout, /^click ok: /m);
    assert.match(done.stdout, /^login \/login public fp:40288a29$/m);
    assert.ok(!done.stdout.includes("no input sent"));
    assert.ok(!done.stdout.includes('"elements"'));
    assert.ok(existsSync(join(dir, ".agent", "snapshot.json")));
    assert.equal(server.sessionActive, false);
  });
});

test("fill @email: dry-run never echoes the text; armed fill sends input", async () => {
  await withFake(async (dir, server) => {
    await seedDemo(dir);
    const p = ["--port", port(server)];
    const dry = await run(dir, ["fill", "@email", SECRET, ...p]);
    assert.equal(dry.status, 0, dry.stderr);
    assert.match(dry.stdout, /^fill @email: textbox "Email" \(field, occurrence 0\)$/m);
    assert.equal(inputFrames(server), 0);
    await allow(dir);
    const done = await run(dir, ["fill", "@email", "me@x.test", "--armed", ...p]);
    assert.equal(done.status, 0, done.stderr);
    assert.ok(inputFrames(server) > 0);
    assert.match(done.stdout, /^login \/login public/m);
  });
});

test("an @id missing from the live page is stale_ref (3)", async () => {
  await withFake(async (dir, server, page) => {
    await seedDemo(dir);
    page.raw = LOGIN_RAW.filter((e) => e.name !== "Show password");
    const r = await run(dir, ["click", "@show-password", "--armed", "--port", port(server)]);
    assert.equal(r.status, 3, r.stderr);
    assert.match(r.stderr, /@show-password/);
    assert.match(r.stderr, /snapshot --learn/);
    assert.equal(inputFrames(server), 0);
  });
});

test("act flow:login is human-only (11) even with garbage inputs, before any collection", async () => {
  await withFake(async (dir, server) => {
    await seedDemo(dir);
    const variants: string[][] = [[], ["garbage"], [`password=${SECRET}`, "=="], ["email=a@b.c", `password=${SECRET}`]];
    for (const extra of variants) {
      const r = await run(dir, ["act", "flow:login", ...extra, "--armed", "--port", port(server)]);
      assert.equal(r.status, 11, r.stderr);
      assert.ok(!(r.stdout + r.stderr).includes(SECRET));
    }
    assert.equal(collects(server), 0);
    assert.equal(inputFrames(server), 0);
  });
});

test("a non-human flow runs as one batch with one new snapshot", async () => {
  await withFake(async (dir, server, page) => {
    page.url = `${ORIGIN}/search`;
    page.title = "Search";
    page.raw = [
      { role: "textbox", name: "Query", nameSource: "label", occurrence: 0, inputType: "text" },
      { role: "button", name: "Search", nameSource: "content", occurrence: 0, buttonType: "submit" },
    ];
    const screen = learnScreen(page.raw, { url: page.url, title: page.title, appOrigin: ORIGIN }, { access: "public" });
    screen.flows = [
      {
        id: "search",
        description: "Search for a term.",
        humanOnly: false,
        inputSchema: {
          type: "object",
          required: ["query"],
          properties: { query: { type: "string", minLength: 1 } },
          additionalProperties: false,
        },
        steps: [
          { op: "fill", target: "@query", from: "query" },
          { op: "click", target: "@search" },
        ],
      },
    ];
    const map: ScreenMap = {
      schemaVersion: "1.0.0",
      app: { id: "synthetic", name: "Synthetic", origin: ORIGIN, locale: "en", learnedAt: "2026-10-01T00:00:00Z" },
      screens: [screen],
    };
    await mkdir(join(dir, "screens"), { recursive: true });
    await writeFile(join(dir, "screens", "synthetic.screens.json"), JSON.stringify(map), "utf8");
    const p = ["--port", port(server)];

    const bad = await run(dir, ["act", "flow:search", `other=${SECRET}`, ...p]);
    assert.equal(bad.status, 2, bad.stderr);
    assert.ok(!(bad.stdout + bad.stderr).includes(SECRET));
    const none = await run(dir, ["act", "flow:search", ...p]);
    assert.equal(none.status, 2, none.stderr);
    assert.equal(collects(server), 0);

    const dry = await run(dir, ["act", "flow:search", `query=${SECRET}`, ...p]);
    assert.equal(dry.status, 0, dry.stderr);
    assert.match(dry.stdout, /^fill @query: textbox "Query"/m);
    assert.match(dry.stdout, /^click @search: button "Search"/m);
    assert.match(dry.stdout, /no input sent/);
    assert.equal(inputFrames(server), 0);

    await allow(dir);
    const locators = async (): Promise<number> =>
      (await readdir(join(dir, ".agent", "refs"))).filter((f) => f.endsWith(".locators.json")).length;
    const refsBefore = await locators();
    const done = await run(dir, ["act", "flow:search", `query=${SECRET}`, "--armed", ...p]);
    assert.equal(done.status, 0, done.stderr);
    assert.match(done.stdout, /^act ok: 2 ops -> .*\.agent[/\\]snapshot\.json \(id ([\w-]+)\)$/m);
    assert.ok(inputFrames(server) >= 2);
    // One fresh snapshot (resolution) + ONE new snapshot at the end of the batch.
    assert.equal((await locators()) - refsBefore, 2);
    assert.match(done.stdout, /^search \/search public/m);

    // Plain semantic act tokens work too.
    const tokens = await run(dir, ["act", "fill:@query=hello", "click:@search", ...p]);
    assert.equal(tokens.status, 0, tokens.stderr);
  });
});

test("offline @id, mixed tokens and --snapshot with @id exit 2", async () => {
  await withFake(async (dir, server) => {
    await seedDemo(dir);
    const p = ["--port", port(server)];
    const cases: string[][] = [
      ["click", "@show-password", "--backend", "offline"],
      ["fill", "@email", "x", "--backend", "offline"],
      ["upload", "@avatar", "x.png", "--backend", "offline"],
      ["act", "click:@show-password", "--backend", "offline"],
      ["act", "click:@show-password", "e3", ...p],
      ["act", "fill:e2=x", "click:@show-password", ...p],
      ["click", "@show-password", "--snapshot", "s1", ...p],
      ["upload", "@avatar", "--snapshot", "s1", "x.png", ...p],
      ["click", "@Bad_Id", ...p],
    ];
    for (const args of cases) {
      const r = await run(dir, args);
      assert.equal(r.status, 2, `${args.join(" ")}: ${r.stderr}`);
    }
    assert.equal(collects(server), 0);
  });
});

test("help documents the screen flags, @id grammar and exit codes", async () => {
  await withFake(async (dir) => {
    const r = await run(dir, ["--help"]);
    for (const needle of [
      "--screen",
      "--learn",
      "--prune",
      "--locale",
      "--screen-map",
      "--screens-dir",
      "PWA_NAV_SCREENS_DIR",
      "@id",
      "flow:<id>",
      "journey",
      "sensitive_target",
      "unknown_target",
      "unmapped_screen",
    ]) {
      assert.ok(r.stdout.includes(needle), `help is missing ${needle}`);
    }
  });
});

test("journey command: dry-run, missing args, and execution", async () => {
  await withFake(async (dir, server) => {
    await seedDemo(dir);
    const mapRaw = await readFile(join(dir, "screens", "demo-app.screens.json"), "utf8");
    const map = JSON.parse(mapRaw) as ScreenMap;
    map.journeys = [
      {
        id: "demo-journey",
        description: "Test demo journey",
        inputSchema: {
          type: "object",
          required: ["user"],
          properties: { user: { type: "string" } },
        },
        steps: [
          {
            screenId: "login",
            action: "fill:@email=${inputs.user}",
            expectScreen: "login",
          },
        ],
      },
    ];
    await writeFile(join(dir, "screens", "demo-app.screens.json"), JSON.stringify(map), "utf8");
    const p = ["--port", port(server)];

    // Missing name -> exit 2
    const missingName = await run(dir, ["journey", ...p]);
    assert.equal(missingName.status, 2);

    // Invalid input args (not key=value) -> exit 2
    const badInput = await run(dir, ["journey", "demo-journey", "not-key-value", ...p]);
    assert.equal(badInput.status, 2);

    // Dry-run mode -> prints plan and returns 0 without calling browser
    const dry = await run(dir, ["journey", "demo-journey", "user=alice@example.com", ...p]);
    assert.equal(dry.status, 0, dry.stderr);
    assert.match(dry.stdout, /journey "demo-journey": Test demo journey/);
    assert.match(dry.stdout, /Step 1 \[login\]: fill @email \[fill @email\] -> expectScreen: login/);
    assert.match(dry.stdout, /no input sent \(pass --armed to execute\)/);

    // Armed execution -> executes step and checks transition
    await allow(dir);
    const armed = await run(dir, ["journey", "demo-journey", "user=alice@example.com", "--armed", ...p]);
    assert.equal(armed.status, 0, armed.stderr);
    assert.match(armed.stdout, /journey step 1\/1 \[login\]: fill @email/);
  });
});
