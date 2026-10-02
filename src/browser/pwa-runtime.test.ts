import assert from "node:assert/strict";
import type { ChildProcess } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PwaNavError } from "../core/errors.js";
import {
  buildLaunchArgs,
  findSite,
  firefoxPwaDir,
  launchCommandHint,
  launchPwa,
  parseConfig,
  readConfig,
  runtimePath,
  waitForPort,
} from "./pwa-runtime.js";

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

test("firefoxPwaDir per platform and override", () => {
  assert.equal(firefoxPwaDir("win32", { APPDATA: "C:\\A" }), join("C:\\A", "FirefoxPWA"));
  assert.equal(firefoxPwaDir("linux", { HOME: "/h" }), join("/h", ".local", "share", "firefoxpwa"));
  assert.equal(firefoxPwaDir("darwin", { HOME: "/h" }), join("/h", "Library", "Application Support", "firefoxpwa"));
  assert.equal(firefoxPwaDir("win32", { PWA_NAV_FIREFOXPWA_DIR: "/x" }), "/x");
  expectCode(() => firefoxPwaDir("win32", {}), "invalid_args");
  expectCode(() => firefoxPwaDir("freebsd", {}), "invalid_args");
});

test("runtimePath per platform", () => {
  assert.equal(runtimePath("/d", "win32"), join("/d", "runtime", "firefox.exe"));
  assert.equal(runtimePath("/d", "linux"), join("/d", "runtime", "firefox"));
  expectCode(() => runtimePath("/d", "darwin"), "invalid_args", /TBD/);
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
  assert.match(sh, /--remote-debugging-port.*9222/);
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
