import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PwaNavError } from "../../core/errors.js";
import {
  buildCleanLaunchArgs,
  buildLaunchArgs,
  cleanDebuggingPortConfigured,
  findSite,
  firefoxPwaDir,
  isLoginBarrier,
  launchCommandHint,
  launchPwa,
  launchPwaClean,
  parseConfig,
  readConfig,
  runtimePath,
  waitForPort,
} from "../pwa-runtime.js";

const SITE_A = "01TESTSITEAAAAAAAAAAAAAAAA";
const fixture = {
  profiles: {},
  extra: 1,
  sites: {
    [SITE_A]: {
      ulid: SITE_A,
      profile: "01TESTPROFILEAAAAAAAAAAAA",
      config: { document_url: "http://localhost:8080/app/login", name: "x" },
      manifest: { name: "Test App" },
    },
    "01TESTSITEBBBBBBBBBBBBBBBB": {
      profile: "01TESTPROFILEBBBBBBBBBBBB",
      config: { document_url: "http://localhost:9090/" },
    },
  },
};

function expectCode(fn: () => unknown, expected: string, re?: RegExp): void {
  assert.throws(fn, (e: unknown) => {
    assert.ok(e instanceof PwaNavError);
    assert.equal(e.code, expected);
    if (re) assert.match(`${e.message} ${e.hint ?? ""}`, re);
    return true;
  });
}

test("firefoxPwaDir per platform, XDG, Flatpak, and override", () => {
  assert.equal(firefoxPwaDir("win32", { APPDATA: "C:\\A" }), join("C:\\A", "FirefoxPWA"));
  assert.equal(firefoxPwaDir("linux", { HOME: "/h" }), join("/h", ".local", "share", "firefoxpwa"));
  assert.equal(firefoxPwaDir("linux", { XDG_DATA_HOME: "/xdg" }), join("/xdg", "firefoxpwa"));
  assert.equal(firefoxPwaDir("darwin", { HOME: "/h" }), join("/h", "Library", "Application Support", "firefoxpwa"));
  assert.equal(firefoxPwaDir("win32", { PWA_NAV_FIREFOXPWA_DIR: "/x" }), "/x");
  assert.equal(firefoxPwaDir("linux", { PWA_NAV_FIREFOXPWA_DIR: "/x" }), "/x");
  assert.equal(firefoxPwaDir("darwin", { PWA_NAV_FIREFOXPWA_DIR: "/x" }), "/x");
  expectCode(() => firefoxPwaDir("win32", {}), "invalid_args");
  expectCode(() => firefoxPwaDir("linux", {}), "invalid_args");
  expectCode(() => firefoxPwaDir("darwin", {}), "invalid_args");
  expectCode(() => firefoxPwaDir("freebsd", {}), "invalid_args");
});

test("firefoxPwaDir resolves Flatpak data directory when present on Linux", async () => {
  const tmp = await mkdtemp(join(tmpdir(), "pwa-flatpak-"));
  try {
    const flatpakDir = join(tmp, ".var", "app", "org.filips.FirefoxPWA", "data", "firefoxpwa");
    await mkdir(flatpakDir, { recursive: true });
    assert.equal(firefoxPwaDir("linux", { HOME: tmp }), flatpakDir);
  } finally {
    await rm(tmp, { recursive: true, force: true });
  }
});

test("runtimePath per platform with fallback and checkExists", () => {
  assert.equal(runtimePath("/d", "win32"), join("/d", "runtime", "firefox.exe"));
  // Linux defaults to local runtime/firefox
  assert.equal(runtimePath("/d", "linux"), join("/d", "runtime", "firefox"));
  // Linux uses local if exists
  assert.equal(
    runtimePath("/d", "linux", (p) => p === join("/d", "runtime", "firefox")),
    join("/d", "runtime", "firefox"),
  );
  // Linux falls back to /usr/lib/firefoxpwa/runtime/firefox if local does not exist
  assert.equal(
    runtimePath("/d", "linux", (p) => p === "/usr/lib/firefoxpwa/runtime/firefox"),
    "/usr/lib/firefoxpwa/runtime/firefox",
  );
  // Linux falls back to /usr/lib64/firefoxpwa/runtime/firefox
  assert.equal(
    runtimePath("/d", "linux", (p) => p === "/usr/lib64/firefoxpwa/runtime/firefox"),
    "/usr/lib64/firefoxpwa/runtime/firefox",
  );

  // macOS defaults to Firefox.app bundle
  assert.equal(
    runtimePath("/d", "darwin"),
    join("/d", "runtime", "Firefox.app", "Contents", "MacOS", "firefox"),
  );
  // macOS returns Firefox.app bundle if exists
  assert.equal(
    runtimePath("/d", "darwin", (p) => p === join("/d", "runtime", "Firefox.app", "Contents", "MacOS", "firefox")),
    join("/d", "runtime", "Firefox.app", "Contents", "MacOS", "firefox"),
  );
  // macOS returns symlink/binary if it exists and app bundle does not
  assert.equal(
    runtimePath("/d", "darwin", (p) => p === join("/d", "runtime", "firefox")),
    join("/d", "runtime", "firefox"),
  );

  // Unsupported platform
  expectCode(() => runtimePath("/d", "freebsd"), "invalid_args", /cannot locate runtime binary/);
});

test("parseConfig valid, tolerates extras", () => {
  const cfg = parseConfig(fixture);
  assert.equal(cfg.sites.length, 2);
  const first = cfg.sites[0];
  assert.ok(first);
  assert.equal(first.origin, "http://localhost:8080");
  assert.equal(first.name, "Test App");
});

test("parseConfig invalid shapes name the problem", () => {
  expectCode(() => parseConfig(null), "invalid_args", /root/);
  expectCode(() => parseConfig({}), "invalid_args", /sites/);
  expectCode(() => parseConfig({ sites: { A: 1 } }), "invalid_args", /sites\.A/);
  expectCode(() => parseConfig({ sites: { A: { config: { document_url: "http://a" } } } }), "invalid_args", /profile/);
  expectCode(() => parseConfig({ sites: { A: { profile: "p" } } }), "invalid_args", /document_url/);
  expectCode(
    () => parseConfig({ sites: { A: { profile: "p", config: { document_url: "nope" } } } }),
    "invalid_args",
    /not a URL/,
  );
});

test("findSite single / none / multiple / explicit", () => {
  const cfg = parseConfig(fixture);
  assert.equal(findSite(cfg, "http://localhost:9090").ulid, "01TESTSITEBBBBBBBBBBBBBBBB");
  expectCode(() => findSite(cfg, "http://nope:1"), "no_browser", /localhost:8080.*localhost:9090/);
  const dup = parseConfig({
    sites: {
      S1: { profile: "p1", config: { document_url: "http://localhost:8080/a" } },
      S2: { profile: "p2", config: { document_url: "http://localhost:8080/b" } },
    },
  });
  expectCode(() => findSite(dup, "http://localhost:8080"), "invalid_args", /--site.*S1, S2/);
  assert.equal(findSite(dup, "http://localhost:8080", "S2").profile, "p2");
  expectCode(() => findSite(dup, "http://localhost:8080", "S9"), "invalid_args");
});

test("buildLaunchArgs and port validation", () => {
  assert.deepEqual(buildLaunchArgs({ profileDir: "/p", siteId: "S", port: 9222 }), [
    "--profile",
    "/p",
    "--pwa",
    "S",
    "--remote-debugging-port",
    "9222",
  ]);
  assert.ok(buildLaunchArgs({ profileDir: "/p", siteId: "S", port: 9222, headless: true }).includes("--headless"));
  for (const port of [1023, 65536, 1.5, Number.NaN]) {
    expectCode(() => buildLaunchArgs({ profileDir: "/p", siteId: "S", port }), "invalid_args");
  }
  buildLaunchArgs({ profileDir: "/p", siteId: "S", port: 1024 });
  buildLaunchArgs({ profileDir: "/p", siteId: "S", port: 65535 });
});

test("launchCommandHint contains the flag, per shell", () => {
  const args = buildLaunchArgs({ profileDir: "C:\\p q", siteId: "S", port: 9222 });
  const ps = launchCommandHint("C:\\r\\firefox.exe", args, "win32");
  assert.match(ps, /^Start-Process -FilePath 'C:\\r\\firefox\.exe'/);
  assert.match(ps, /'--remote-debugging-port', '9222'/);
  const sh = launchCommandHint("/r/firefox", args, "linux");
  assert.match(sh, /'\/r\/firefox'/);
  assert.match(sh, /--remote-debugging-port.*9222.*&$/);
  const mac = launchCommandHint("/Applications/Firefox.app/Contents/MacOS/firefox", args, "darwin");
  assert.match(mac, /'\/Applications\/Firefox\.app\/Contents\/MacOS\/firefox'/);
  assert.match(mac, /--remote-debugging-port.*9222.*&$/);
});

test("waitForPort succeeds after retries", async () => {
  let calls = 0;
  await waitForPort("127.0.0.1", 9222, 1000, () => Promise.resolve(++calls >= 3), { intervalMs: 1 });
  assert.equal(calls, 3);
});

test("waitForPort times out with launch hint", async () => {
  await assert.rejects(
    waitForPort("127.0.0.1", 9222, 20, () => Promise.resolve(false), { intervalMs: 2, launchHint: "CMD --x" }),
    (e: unknown) => e instanceof PwaNavError && e.code === "timeout" && (e.hint ?? "").includes("CMD --x"),
  );
});

async function withDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "pwa-runtime-"));
  try {
    await writeFile(join(dir, "config.json"), JSON.stringify(fixture));
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("readConfig from temp dir; missing => no_browser", async () => {
  await withDir(async (dir) => {
    assert.equal((await readConfig(dir)).sites.length, 2);
    await assert.rejects(
      readConfig(join(dir, "missing")),
      (e: unknown) => e instanceof PwaNavError && e.code === "no_browser",
    );
  });
});

test("launchPwa spawns with injected spawn and waits for port", async () => {
  await withDir(async (dir) => {
    const spawned: { binary?: string; args?: string[] } = {};
    let unrefd = false;
    const fake = {
      pid: 42,
      on: () => fake,
      unref: () => {
        unrefd = true;
      },
    } as unknown as ChildProcess;
    const res = await launchPwa({
      origin: "http://localhost:8080",
      port: 9333,
      platform: "linux",
      env: { PWA_NAV_FIREFOXPWA_DIR: dir },
      probe: () => Promise.resolve(spawned.binary !== undefined),
      intervalMs: 1,
      spawnFn: (binary, args) => {
        spawned.binary = binary;
        spawned.args = args;
        return fake;
      },
    });
    assert.equal(res.siteId, SITE_A);
    assert.equal(res.pid, 42);
    assert.ok(unrefd);
    assert.equal(spawned.binary, join(dir, "runtime", "firefox"));
    assert.deepEqual((spawned.args ?? []).slice(0, 4), [
      "--profile",
      join(dir, "profiles", "01TESTPROFILEAAAAAAAAAAAA"),
      "--pwa",
      SITE_A,
    ]);
  });
});

test("launchPwa spawns on macOS (darwin) with correct bundle binary and args", async () => {
  await withDir(async (dir) => {
    const spawned: { binary?: string; args?: string[] } = {};
    const fake = {
      pid: 43,
      on: () => fake,
      unref: () => undefined,
    } as unknown as ChildProcess;
    const res = await launchPwa({
      origin: "http://localhost:8080",
      port: 9444,
      platform: "darwin",
      env: { PWA_NAV_FIREFOXPWA_DIR: dir },
      probe: () => Promise.resolve(spawned.binary !== undefined),
      intervalMs: 1,
      spawnFn: (binary, args) => {
        spawned.binary = binary;
        spawned.args = args;
        return fake;
      },
    });
    assert.equal(res.siteId, SITE_A);
    assert.equal(res.pid, 43);
    assert.equal(spawned.binary, join(dir, "runtime", "Firefox.app", "Contents", "MacOS", "firefox"));
    assert.deepEqual((spawned.args ?? []).slice(0, 4), [
      "--profile",
      join(dir, "profiles", "01TESTPROFILEAAAAAAAAAAAA"),
      "--pwa",
      SITE_A,
    ]);
  });
});

test("launchPwa spawns on Windows (win32) with .exe binary and args", async () => {
  await withDir(async (dir) => {
    const spawned: { binary?: string; args?: string[] } = {};
    const fake = {
      pid: 44,
      on: () => fake,
      unref: () => undefined,
    } as unknown as ChildProcess;
    const res = await launchPwa({
      origin: "http://localhost:8080",
      port: 9555,
      platform: "win32",
      env: { PWA_NAV_FIREFOXPWA_DIR: dir },
      probe: () => Promise.resolve(spawned.binary !== undefined),
      intervalMs: 1,
      spawnFn: (binary, args) => {
        spawned.binary = binary;
        spawned.args = args;
        return fake;
      },
    });
    assert.equal(res.siteId, SITE_A);
    assert.equal(res.pid, 44);
    assert.equal(spawned.binary, join(dir, "runtime", "firefox.exe"));
  });
});

test("launchPwa refuses when port already listening", async () => {
  await withDir(async (dir) => {
    await assert.rejects(
      launchPwa({
        origin: "http://localhost:8080",
        port: 9333,
        platform: "linux",
        env: { PWA_NAV_FIREFOXPWA_DIR: dir },
        probe: () => Promise.resolve(true),
        spawnFn: () => {
          throw new Error("must not spawn");
        },
      }),
      (e: unknown) => e instanceof PwaNavError && e.message.includes("already running, attach instead"),
    );
  });
});

test("cleanDebuggingPortConfigured removes port flags from config.json", async () => {
  await withDir(async (dir) => {
    // Write config with dirty arguments
    const configPath = join(dir, "config.json");
    await writeFile(
      configPath,
      JSON.stringify({ ...fixture, arguments: ["--some-flag", "--remote-debugging-port", "9222"] }),
    );

    const cleaned = await cleanDebuggingPortConfigured(dir);
    assert.equal(cleaned, true);

    const cfgText = await readFile(configPath, "utf8");
    const cfg = JSON.parse(cfgText) as { arguments?: string[] };
    assert.deepEqual(cfg.arguments, ["--some-flag"]);

    // Idempotent second run
    const second = await cleanDebuggingPortConfigured(dir);
    assert.equal(second, false);
  });
});

test("buildCleanLaunchArgs and launchPwaClean omit debugging port", async () => {
  const args = buildCleanLaunchArgs({ profileDir: "/tmp/profile", siteId: "01SITE" });
  assert.deepEqual(args, ["--profile", "/tmp/profile", "--pwa", "01SITE"]);

  await withDir(async (dir) => {
    const spawned: { binary?: string; args?: string[] } = {};
    const fake = { pid: 99, on: () => fake, unref: () => undefined } as unknown as ChildProcess;
    const res = await launchPwaClean({
      origin: "http://localhost:8080",
      platform: "linux",
      env: { PWA_NAV_FIREFOXPWA_DIR: dir },
      spawnFn: (binary, a) => {
        spawned.binary = binary;
        spawned.args = a;
        return fake;
      },
    });
    assert.equal(res.siteId, SITE_A);
    assert.equal(res.pid, 99);
    assert.ok(spawned.args?.includes("--pwa"));
    assert.ok(!spawned.args?.includes("--remote-debugging-port"));
  });
});

test("isLoginBarrier detects google accounts, auth routes and security strings", () => {
  assert.equal(isLoginBarrier("https://accounts.google.com/signin/v2/identifier"), true);
  assert.equal(isLoginBarrier("https://app.example.com/login"), true);
  assert.equal(isLoginBarrier("https://app.example.com/signin"), true);
  assert.equal(isLoginBarrier("https://notebook.google.com/u/0/"), false);
  assert.equal(isLoginBarrier("https://app.example.com/", "This browser or app may not be secure"), true);
  assert.equal(isLoginBarrier("https://app.example.com/", "Es posible que este navegador o aplicación no sea seguro"), true);
  assert.equal(isLoginBarrier("https://app.example.com/", "Welcome back to your dashboard"), false);
});


