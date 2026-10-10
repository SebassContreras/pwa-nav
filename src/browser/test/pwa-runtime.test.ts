import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PwaNavError } from "../../core/errors.js";
import {
  firefoxPwaDir,
  isLoginBarrier,
  launchCommandHint,
  runtimePath,
  validatePort,
  waitForPort,
} from "../pwa-runtime.js";

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
  assert.equal(firefoxPwaDir("win32", { PWA_NAV_RUNTIME_DIR: "/x" }), "/x");
  assert.equal(firefoxPwaDir("linux", { PWA_NAV_RUNTIME_DIR: "/x" }), "/x");
  assert.equal(firefoxPwaDir("darwin", { PWA_NAV_RUNTIME_DIR: "/x" }), "/x");
  assert.equal(firefoxPwaDir("win32", { PWA_NAV_FIREFOXPWA_DIR: "/x" }), "/x");
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

test("validatePort integer bounds checking", () => {
  assert.equal(validatePort(9222), 9222);
  assert.equal(validatePort(1024), 1024);
  assert.equal(validatePort(65535), 65535);
  for (const port of [1023, 65536, 1.5, Number.NaN]) {
    expectCode(() => validatePort(port), "invalid_args");
  }
});

test("launchCommandHint formats command per shell platform", () => {
  const args = ["--profile", "C:\\p q", "--pwa", "app-slug", "--remote-debugging-port", "9222"];
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

test("isLoginBarrier detects google accounts, auth routes and security strings", () => {
  assert.equal(isLoginBarrier("https://accounts.google.com/signin/v2/identifier"), true);
  assert.equal(isLoginBarrier("https://app.example.com/login"), true);
  assert.equal(isLoginBarrier("https://app.example.com/signin"), true);
  assert.equal(isLoginBarrier("https://notebook.google.com/u/0/"), false);
  assert.equal(isLoginBarrier("https://app.example.com/", "This browser or app may not be secure"), true);
  assert.equal(isLoginBarrier("https://app.example.com/", "Es posible que este navegador o aplicación no sea seguro"), true);
  assert.equal(isLoginBarrier("https://app.example.com/", "Welcome back to your dashboard"), false);
});
