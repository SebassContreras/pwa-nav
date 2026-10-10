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

import type { PwaInstanceRegistry } from "./port-allocator.js";
import { allocatePort } from "./port-allocator.js";
import { FileInstanceRegistry } from "./instance-registry.js";

export interface StandaloneLaunchOptions {
  url: string;
  appSlug: string;
  port?: number;
  headless?: boolean;
  host?: string;
  timeoutMs?: number;
  platform?: string;
  env?: NodeJS.ProcessEnv;
  cacheDir?: string;
  probe?: PortProbe;
  registry?: PwaInstanceRegistry;
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

export function buildCleanStandaloneLaunchArgs(options: {
  profileDir: string;
  appSlug: string;
  url: string;
  headless?: boolean;
}): string[] {
  const args = [
    "--profile",
    options.profileDir,
    "--pwa",
    options.appSlug,
  ];
  if (options.headless === true) {
    args.push("--headless");
  }
  args.push(options.url);
  return args;
}

export interface CleanStandaloneLaunchOptions {
  url: string;
  appSlug: string;
  headless?: boolean;
  platform?: string;
  env?: NodeJS.ProcessEnv;
  cacheDir?: string;
  spawnFn?: (binary: string, args: string[]) => ChildProcess;
}

export interface CleanStandaloneLaunchResult {
  appSlug: string;
  url: string;
  profileDir: string;
  command: string;
  pid: number | undefined;
}

export async function launchStandaloneAppClean(
  options: CleanStandaloneLaunchOptions,
): Promise<CleanStandaloneLaunchResult> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const url = options.url;
  const appSlug = options.appSlug;

  const dir = firefoxPwaDir(platform, env);
  const binary = runtimePath(dir, platform);
  const profileDir = await ensureStandaloneProfile(appSlug, { cacheDir: options.cacheDir });

  const args = buildCleanStandaloneLaunchArgs({
    profileDir,
    appSlug,
    url,
    ...(options.headless === undefined ? {} : { headless: options.headless }),
  });
  const command = launchCommandHint(binary, args, platform);

  const child = (options.spawnFn ?? defaultSpawn)(binary, args);
  child.on("error", () => undefined);
  child.unref();

  return {
    appSlug,
    url,
    profileDir,
    command,
    pid: child.pid,
  };
}

function defaultSpawn(binary: string, args: string[]): ChildProcess {
  return spawn(binary, args, { detached: true, stdio: "ignore" });
}

export async function launchStandaloneApp(options: StandaloneLaunchOptions): Promise<StandaloneLaunchResult> {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const host = options.host ?? "127.0.0.1";
  const probe = options.probe ?? tcpProbe;
  const url = options.url;
  const appSlug = options.appSlug;

  const registry = options.registry ?? new FileInstanceRegistry({ cacheDir: options.cacheDir, probe, host });
  const activeInstances = await registry.prune();
  const reservedPorts = activeInstances.map((i) => i.port);

  let port = options.port;
  if (port === undefined) {
    port = await allocatePort(reservedPorts, { host, probe });
  } else {
    validatePort(port);
  }

  const dir = firefoxPwaDir(platform, env);
  const binary = runtimePath(dir, platform);
  const profileDir = await ensureStandaloneProfile(appSlug, { cacheDir: options.cacheDir });

  const args = buildStandaloneLaunchArgs({
    profileDir,
    appSlug,
    port,
    url,
    ...(options.headless === undefined ? {} : { headless: options.headless }),
  });
  const command = launchCommandHint(binary, args, platform);

  if (await probe(host, port)) {
    throw new PwaNavError(
      "invalid_args",
      `port ${String(port)} is already listening: already running, attach instead`,
    );
  }

  const child = (options.spawnFn ?? defaultSpawn)(binary, args);
  child.on("error", () => undefined);
  child.unref();

  await waitForPort(host, port, options.timeoutMs ?? DEFAULT_LAUNCH_TIMEOUT_MS, probe, {
    launchHint: command,
    ...(options.intervalMs === undefined ? {} : { intervalMs: options.intervalMs }),
  });

  const result: StandaloneLaunchResult = {
    appSlug,
    url,
    port,
    profileDir,
    command,
    pid: child.pid,
  };

  await registry.register({
    appSlug,
    url,
    port,
    pid: child.pid,
    profileDir,
    startedAt: new Date().toISOString(),
  });

  return result;
}
