// firefoxpwa runtime discovery + direct launch (spec 004, T006).
// `firefoxpwa site launch -- args` drops --remote-debugging-port, so the runtime binary is spawned directly.
// Never writes to the profile (no user.js/prefs.js).
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { connect } from "node:net";
import { join } from "node:path";
import { PwaNavError } from "../core/errors.js";

export const DIR_ENV = "PWA_NAV_FIREFOXPWA_DIR";
export const MIN_PORT = 1024;
export const MAX_PORT = 65535;
export const POLL_INTERVAL_MS = 200;
export const DEFAULT_LAUNCH_TIMEOUT_MS = 30_000;

export interface PwaSite {
  ulid: string;
  profile: string;
  documentUrl: string;
  origin: string;
  name?: string;
}

export interface PwaConfig {
  sites: PwaSite[];
}

export interface LaunchArgsInput {
  profileDir: string;
  siteId: string;
  port: number;
  headless?: boolean;
}

type Env = Readonly<Record<string, string | undefined>>;

// Standard PWAsForFirefox data directory conventions per platform.
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
  const override = env[DIR_ENV];
  if (override !== undefined && override !== "") return override;
  const dir = DATA_DIR_TABLE[platform]?.(env);
  if (dir === undefined) {
    throw new PwaNavError("invalid_args", `cannot locate the firefoxpwa data dir on platform "${platform}"`, {
      hint: `set ${DIR_ENV} to the directory containing config.json`,
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
    hint: "launch the runtime manually with --profile <dir> --pwa <ULID> --remote-debugging-port <port>",
  });
}

export function profileDirOf(dir: string, site: Pick<PwaSite, "profile">): string {
  return join(dir, "profiles", site.profile);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Validates the shape we depend on; extra fields are tolerated.
export function parseConfig(raw: unknown): PwaConfig {
  if (!isRecord(raw)) {
    throw new PwaNavError("invalid_args", "firefoxpwa config.json: root must be an object");
  }
  const sitesRaw = raw["sites"];
  if (!isRecord(sitesRaw)) {
    throw new PwaNavError("invalid_args", "firefoxpwa config.json: `sites` must be an object keyed by site ULID");
  }
  const sites: PwaSite[] = [];
  for (const [ulid, value] of Object.entries(sitesRaw)) {
    if (!isRecord(value)) {
      throw new PwaNavError("invalid_args", `firefoxpwa config.json: sites.${ulid} must be an object`);
    }
    const profile = value["profile"];
    if (typeof profile !== "string" || profile === "") {
      throw new PwaNavError("invalid_args", `firefoxpwa config.json: sites.${ulid}.profile must be a non-empty string`);
    }
    const cfg = value["config"];
    const documentUrl = isRecord(cfg) ? cfg["document_url"] : undefined;
    if (typeof documentUrl !== "string") {
      throw new PwaNavError(
        "invalid_args",
        `firefoxpwa config.json: sites.${ulid}.config.document_url must be a string`,
      );
    }
    let origin: string;
    try {
      origin = new URL(documentUrl).origin;
    } catch (cause) {
      throw new PwaNavError("invalid_args", `firefoxpwa config.json: sites.${ulid}.config.document_url is not a URL`, {
        cause,
      });
    }
    const manifest = value["manifest"];
    const name = isRecord(manifest) && typeof manifest["name"] === "string" ? manifest["name"] : undefined;
    sites.push({ ulid, profile, documentUrl, origin, ...(name === undefined ? {} : { name }) });
  }
  return { sites };
}

export async function ensureStealthPrefsConfigured(dir: string): Promise<boolean> {
  const profilesDir = join(dir, "profiles");
  try {
    const entries = await readdir(profilesDir, { withFileTypes: true });
    let updatedAny = false;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const userJsPath = join(profilesDir, entry.name, "user.js");
      let content = "";
      try {
        content = await readFile(userJsPath, "utf8");
      } catch {
        // file does not exist yet
      }
      let needsUpdate = false;
      let newContent = content;
      if (!newContent.includes("remote.prefs.recommended")) {
        newContent +=
          (newContent.length > 0 && !newContent.endsWith("\n") ? "\n" : "") +
          'user_pref("remote.prefs.recommended", false);\n';
        needsUpdate = true;
      }
      if (!newContent.includes("dom.webdriver.enabled")) {
        newContent +=
          (newContent.length > 0 && !newContent.endsWith("\n") ? "\n" : "") +
          'user_pref("dom.webdriver.enabled", false);\n';
        needsUpdate = true;
      }
      if (needsUpdate) {
        await writeFile(userJsPath, newContent, "utf8");
        updatedAny = true;
      }
    }
    return updatedAny;
  } catch {
    return false;
  }
}

export async function ensureDebuggingPortConfigured(
  dir?: string,
  port: number = 9222,
  platform: string = process.platform,
  env: Env = process.env,
): Promise<boolean> {
  let targetDir = dir;
  if (targetDir === undefined) {
    try {
      targetDir = firefoxPwaDir(platform, env);
    } catch {
      return false;
    }
  }
  let modified = false;
  const file = join(targetDir, "config.json");
  try {
    const text = await readFile(file, "utf8");
    const json: unknown = JSON.parse(text);
    if (isRecord(json)) {
      const args = Array.isArray(json["arguments"]) ? (json["arguments"] as unknown[]) : [];
      const hasFlag = args.some(
        (a) => typeof a === "string" && (a === "--remote-debugging-port" || a.includes("--remote-debugging-port")),
      );
      if (!hasFlag) {
        json["arguments"] = [...args, "--remote-debugging-port", String(port)];
        await writeFile(file, JSON.stringify(json, null, 2) + "\n", "utf8");
        modified = true;
      }
    }
  } catch {
    // ignore read/write error for config.json
  }
  const stealthModified = await ensureStealthPrefsConfigured(targetDir);
  return modified || stealthModified;
}

export async function readConfig(dir: string): Promise<PwaConfig> {
  const file = join(dir, "config.json");
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (cause) {
    throw new PwaNavError("no_browser", `cannot read ${file}: firefoxpwa not installed or no PWA created`, {
      cause,
      hint: `set ${DIR_ENV} if the data dir is elsewhere`,
    });
  }
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (cause) {
    throw new PwaNavError("invalid_args", `${file} is not valid JSON`, { cause });
  }
  return parseConfig(json);
}

export async function listInstalledSites(
  platform: string = process.platform,
  env: Env = process.env,
): Promise<PwaSite[]> {
  try {
    const dir = firefoxPwaDir(platform, env);
    const cfg = await readConfig(dir);
    return cfg.sites;
  } catch {
    return [];
  }
}

// `siteId` (from --site) disambiguates several sites on one origin.
export function findSite(config: PwaConfig, target: string, siteId?: string): PwaSite {
  if (siteId !== undefined) {
    const site = config.sites.find((s) => s.ulid === siteId);
    if (site === undefined) {
      throw new PwaNavError("invalid_args", `site ${siteId} not found`, {
        hint: `candidates: ${config.sites.map((s) => s.ulid).join(", ") || "none"}`,
      });
    }
    return site;
  }

  // 1. Exact origin match
  const byOrigin = config.sites.filter((s) => s.origin === target);
  if (byOrigin.length === 1 && byOrigin[0] !== undefined) return byOrigin[0];
  if (byOrigin.length > 1) {
    throw new PwaNavError("invalid_args", `several PWAs match origin ${target}; pass --site <ULID>`, {
      hint: `candidates: ${byOrigin.map((s) => s.ulid).join(", ")}`,
    });
  }

  // 2. Exact ULID match
  const byUlid = config.sites.find((s) => s.ulid === target);
  if (byUlid !== undefined) return byUlid;

  // 3. Name or slug match (case insensitive)
  const normTarget = target.trim().toLowerCase();
  const byName = config.sites.filter(
    (s) => s.name?.toLowerCase() === normTarget || (normTarget.length >= 3 && s.name?.toLowerCase().includes(normTarget)),
  );
  if (byName.length === 1 && byName[0] !== undefined) return byName[0];

  // 4. Hostname / Domain heuristic (e.g. notebooklm.google.com matches notebook.google.com)
  try {
    const urlObj = new URL(target.startsWith("http") ? target : `https://${target}`);
    const host = urlObj.hostname.toLowerCase();
    const byHost = config.sites.filter((s) => {
      try {
        const sHost = new URL(s.origin).hostname.toLowerCase();
        if (sHost === host) return true;
        const hostParts = host.split(".");
        const sParts = sHost.split(".");
        const baseHost = hostParts.slice(-2).join(".");
        const sBaseHost = sParts.slice(-2).join(".");
        return baseHost === sBaseHost && (
          (host.includes("notebook") && sHost.includes("notebook")) ||
          host.startsWith(sParts[0] ?? "") ||
          sHost.startsWith(hostParts[0] ?? "")
        );
      } catch {
        return false;
      }
    });
    if (byHost.length === 1 && byHost[0] !== undefined) return byHost[0];
  } catch {
    // not a URL
  }

  const known = [...new Set(config.sites.map((s) => s.name ? `${s.name} (${s.origin})` : s.origin))];
  throw new PwaNavError("no_browser", `no installed PWA matches "${target}"`, {
    hint: `known installed apps: ${known.join(", ") || "none"}`,
  });
}

export function validatePort(port: number): number {
  if (!Number.isInteger(port) || port < MIN_PORT || port > MAX_PORT) {
    throw new PwaNavError("invalid_args", `port must be an integer in ${String(MIN_PORT)}-${String(MAX_PORT)}, got ${String(port)}`);
  }
  return port;
}

export function buildLaunchArgs(input: LaunchArgsInput): string[] {
  validatePort(input.port);
  const args = ["--profile", input.profileDir, "--pwa", input.siteId, "--remote-debugging-port", String(input.port)];
  if (input.headless === true) args.push("--headless");
  return args;
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

export interface LaunchOptions {
  origin: string;
  port: number;
  siteId?: string;
  headless?: boolean;
  host?: string;
  timeoutMs?: number;
  platform?: string;
  env?: Env;
  probe?: PortProbe;
  intervalMs?: number;
  // Injectable for tests; default is child_process.spawn.
  spawnFn?: (binary: string, args: string[]) => ChildProcess;
}

export interface LaunchResult {
  siteId: string;
  port: number;
  command: string;
  pid: number | undefined;
}

function defaultSpawn(binary: string, args: string[]): ChildProcess {
  return spawn(binary, args, { detached: true, stdio: "ignore" });
}

export async function launchPwa(options: LaunchOptions): Promise<LaunchResult> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const host = options.host ?? "127.0.0.1";
  const probe = options.probe ?? tcpProbe;
  validatePort(options.port);

  const dir = firefoxPwaDir(platform, env);
  const site = findSite(await readConfig(dir), options.origin, options.siteId);
  const binary = runtimePath(dir, platform);
  const args = buildLaunchArgs({
    profileDir: profileDirOf(dir, site),
    siteId: site.ulid,
    port: options.port,
    ...(options.headless === undefined ? {} : { headless: options.headless }),
  });
  const command = launchCommandHint(binary, args, platform);

  if (await probe(host, options.port)) {
    throw new PwaNavError(
      "invalid_args",
      `port ${String(options.port)} is already listening: already running, attach instead`,
    );
  }

  const child = (options.spawnFn ?? defaultSpawn)(binary, args);
  // Spawn failure surfaces as the port timeout below, with the launch hint.
  child.on("error", () => undefined);
  child.unref();
  await waitForPort(host, options.port, options.timeoutMs ?? DEFAULT_LAUNCH_TIMEOUT_MS, probe, {
    launchHint: command,
    ...(options.intervalMs === undefined ? {} : { intervalMs: options.intervalMs }),
  });
  return { siteId: site.ulid, port: options.port, command, pid: child.pid };
}
