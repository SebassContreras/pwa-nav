import { spawn, type ChildProcess } from "node:child_process";
import { PwaNavError } from "../core/errors.js";
import {
  DEFAULT_LAUNCH_TIMEOUT_MS,
  firefoxPwaDir,
  launchCommandHint,
  runtimePath,
  tcpProbe,
  validatePort,
  waitForPort,
  type PortProbe,
} from "./pwa-runtime.js";
import { ensureStandaloneProfile } from "./standalone-profile.js";

export const LINKEDIN_URL = "https://www.linkedin.com";
export const LINKEDIN_SLUG = "linkedin";

export interface StandaloneLaunchOptions {
  url?: string;
  appSlug?: string;
  port: number;
  headless?: boolean;
  host?: string;
  timeoutMs?: number;
  platform?: string;
  env?: NodeJS.ProcessEnv;
  cacheDir?: string;
  probe?: PortProbe;
  intervalMs?: number;
  spawnFn?: (binary: string, args: string[]) => ChildProcess;
}

export interface StandaloneLaunchResult {
  appSlug: string;
  url: string;
  port: number;
  profileDir: string;
  command: string;
  pid: number | undefined;
}

export function buildStandaloneLaunchArgs(options: {
  profileDir: string;
  appSlug: string;
  port: number;
  url: string;
  headless?: boolean;
}): string[] {
  validatePort(options.port);
  const args = [
    "--profile",
    options.profileDir,
    "--pwa",
    options.appSlug,
    "--remote-debugging-port",
    String(options.port),
  ];
  if (options.headless === true) {
    args.push("--headless");
  }
  args.push(options.url);
  return args;
}

function defaultSpawn(binary: string, args: string[]): ChildProcess {
  return spawn(binary, args, { detached: true, stdio: "ignore" });
}

export async function launchStandaloneApp(options: StandaloneLaunchOptions): Promise<StandaloneLaunchResult> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const host = options.host ?? "127.0.0.1";
  const probe = options.probe ?? tcpProbe;
  const url = options.url ?? LINKEDIN_URL;
  const appSlug = options.appSlug ?? LINKEDIN_SLUG;
  validatePort(options.port);

  const dir = firefoxPwaDir(platform, env);
  const binary = runtimePath(dir, platform);
  const profileDir = await ensureStandaloneProfile(appSlug, { cacheDir: options.cacheDir });

  const args = buildStandaloneLaunchArgs({
    profileDir,
    appSlug,
    port: options.port,
    url,
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
  child.on("error", () => undefined);
  child.unref();

  await waitForPort(host, options.port, options.timeoutMs ?? DEFAULT_LAUNCH_TIMEOUT_MS, probe, {
    launchHint: command,
    ...(options.intervalMs === undefined ? {} : { intervalMs: options.intervalMs }),
  });

  return {
    appSlug,
    url,
    port: options.port,
    profileDir,
    command,
    pid: child.pid,
  };
}
