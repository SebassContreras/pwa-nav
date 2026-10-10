// pwa-runtime: Standalone Firefox runtime discovery and socket probing.
// Directly spawns the standalone Firefox PWA runtime binary with BiDi enabled.
// Zero dependencies on external PWAsForFirefox extension configurations or config.json.
import { existsSync } from "node:fs";
import { connect } from "node:net";
import { join } from "node:path";
import { PwaNavError } from "../core/errors.js";

export const DIR_ENV = "PWA_NAV_RUNTIME_DIR";
export const LEGACY_DIR_ENV = "PWA_NAV_FIREFOXPWA_DIR";
export const MIN_PORT = 1024;
export const MAX_PORT = 65535;
export const POLL_INTERVAL_MS = 200;
export const DEFAULT_LAUNCH_TIMEOUT_MS = 30_000;

export type Env = Readonly<Record<string, string | undefined>>;

// Standard standalone runtime directory conventions per platform.
// win32: %APPDATA%\FirefoxPWA
// linux: $XDG_DATA_HOME/firefoxpwa (or Flatpak ~/.var/app/org.filips.FirefoxPWA/data/firefoxpwa, or ~/.local/share/firefoxpwa)
// darwin: ~/Library/Application Support/firefoxpwa
const DATA_DIR_TABLE: Readonly<Record<string, (env: Env) => string | undefined>> = {
  win32: (env) => (env["APPDATA"] === undefined ? undefined : join(env["APPDATA"], "FirefoxPWA")),
  linux: (env) => {
    const xdg = env["XDG_DATA_HOME"];
    if (xdg !== undefined && xdg !== "") return join(xdg, "firefoxpwa");
    const home = env["HOME"];
    if (home === undefined) return undefined;
    const flatpakData = join(home, ".var", "app", "org.filips.FirefoxPWA", "data", "firefoxpwa");
    const standardData = join(home, ".local", "share", "firefoxpwa");
    if (existsSync(flatpakData) && !existsSync(standardData)) {
      return flatpakData;
    }
    return standardData;
  },
  darwin: (env) =>
    env["HOME"] === undefined ? undefined : join(env["HOME"], "Library", "Application Support", "firefoxpwa"),
};

export function firefoxPwaDir(platform: string, env: Env): string {
  const override = env[DIR_ENV] ?? env[LEGACY_DIR_ENV];
  if (override !== undefined && override !== "") return override;
  const dir = DATA_DIR_TABLE[platform]?.(env);
  if (dir === undefined) {
    throw new PwaNavError("invalid_args", `cannot locate the runtime data dir on platform "${platform}"`, {
      hint: `set ${DIR_ENV} to the directory containing runtime/firefox`,
    });
  }
  return dir;
}

export function runtimePath(
  dir: string,
  platform: string,
  checkExists: (path: string) => boolean = existsSync,
): string {
  if (platform === "win32") {
    return join(dir, "runtime", "firefox.exe");
  }
  if (platform === "linux") {
    const local = join(dir, "runtime", "firefox");
    if (checkExists(local)) return local;
    const sysPath = "/usr/lib/firefoxpwa/runtime/firefox";
    if (checkExists(sysPath)) return sysPath;
    const sysPath64 = "/usr/lib64/firefoxpwa/runtime/firefox";
    if (checkExists(sysPath64)) return sysPath64;
    return local;
  }
  if (platform === "darwin") {
    const appBundle = join(dir, "runtime", "Firefox.app", "Contents", "MacOS", "firefox");
    if (checkExists(appBundle)) return appBundle;
    const symlinkOrBinary = join(dir, "runtime", "firefox");
    if (checkExists(symlinkOrBinary)) return symlinkOrBinary;
    return appBundle;
  }
  throw new PwaNavError("invalid_args", `cannot locate runtime binary on platform "${platform}"`, {
    hint: "launch the runtime manually with --profile <dir> --pwa <slug> --remote-debugging-port <port>",
  });
}

export function validatePort(port: number): number {
  if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
    throw new PwaNavError(
      "invalid_args",
      `port must be an integer in ${String(MIN_PORT)}-${String(MAX_PORT)}, got ${String(port)}`,
    );
  }
  return port;
}

// Exact copy-paste command for `no_browser` hints.
export function launchCommandHint(binary: string, args: readonly string[], platform: string): string {
  if (platform === "win32") {
    const ps = (s: string): string => `'${s.replaceAll("'", "''")}'`;
    return `Start-Process -FilePath ${ps(binary)} -ArgumentList ${args.map(ps).join(", ")}`;
  }
  // POSIX shell (Linux, macOS bash/zsh): background execution with single-quoted arguments.
  const sh = (s: string): string => `'${s.replaceAll("'", "'\\''")}'`;
  return `${sh(binary)} ${args.map(sh).join(" ")} &`;
}

export type PortProbe = (host: string, port: number) => Promise<boolean>;

export const tcpProbe: PortProbe = (host, port) =>
  new Promise((resolve) => {
    const socket = connect({ host, port });
    const done = (ok: boolean): void => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(1000, () => {
      done(false);
    });
    socket.once("connect", () => {
      done(true);
    });
    socket.once("error", () => {
      done(false);
    });
  });

const sleep = (ms: number): Promise<void> =>
  new Promise((r) => {
    setTimeout(r, ms);
  });

// Waits for the port (never the PID); timeout error carries the launch command.
export async function waitForPort(
  host: string,
  port: number,
  timeoutMs: number,
  probe: PortProbe = tcpProbe,
  options: { intervalMs?: number; launchHint?: string } = {},
): Promise<void> {
  const interval = options.intervalMs ?? POLL_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await probe(host, port)) return;
    if (Date.now() >= deadline) break;
    await sleep(interval);
  }
  throw new PwaNavError("timeout", `port ${host}:${String(port)} did not open within ${String(timeoutMs)}ms`, {
    ...(options.launchHint === undefined ? {} : { hint: `launch manually: ${options.launchHint}` }),
  });
}

export function isLoginBarrier(url: string, pageText?: string): boolean {
  try {
    const parsed = new URL(url.startsWith("http") ? url : `https://${url}`);
    if (parsed.hostname.toLowerCase().includes("accounts.google.com")) return true;
    if (/\/(login|signin|sign-in|auth0|oauth)/i.test(parsed.pathname)) return true;
  } catch {
    // not a valid URL
  }
  if (pageText !== undefined) {
    if (
      pageText.includes("This browser or app may not be secure") ||
      pageText.includes("no sea seguro") ||
      pageText.includes("Sign in with Google") ||
      pageText.includes("Iniciar sesión con Google")
    ) {
      return true;
    }
  }
  return false;
}
