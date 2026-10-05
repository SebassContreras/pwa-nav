import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export interface StorageOptions {
  cacheDir?: string;
  screensDir?: string;
}

/**
 * Searches upward from startDir for project root markers (.git, .agent, package.json, pnpm-workspace.yaml).
 * Returns the project root directory or null if outside a project.
 */
export function findProjectRoot(startDir: string = process.cwd()): string | null {
  let current = resolve(startDir);
  const home = resolve(homedir());

  for (;;) {
    // If we hit homedir, do not treat it as a project root unless .git exists directly in homedir
    if (current === home) {
      if (existsSync(join(current, ".git"))) {
        return current;
      }
      return null;
    }

    if (
      existsSync(join(current, ".git")) ||
      existsSync(join(current, ".agent")) ||
      existsSync(join(current, "package.json")) ||
      existsSync(join(current, "pnpm-workspace.yaml"))
    ) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      // Reached filesystem root
      return null;
    }
    current = parent;
  }
}

/**
 * Returns the default global user directory (~/.pwa-nav) to prevent cluttering $HOME.
 */
export function getGlobalDataDir(): string {
  return join(homedir(), ".pwa-nav");
}

/**
 * Resolves the cache directory (cache, snapshots, session, allow-list, screen maps):
 * 1. options.cacheDir (--cache-dir)
 * 2. env.PWA_NAV_CACHE_DIR
 * 3. Project root: <projectRoot>/.agent
 * 4. Global fallback: ~/.pwa-nav
 */
export function resolveAgentDir(
  options: { cacheDir?: string | undefined } = {},
  env: Record<string, string | undefined> = process.env,
  cwd: string = process.cwd(),
): string {
  const fromOption = options.cacheDir;
  if (fromOption !== undefined && fromOption.trim() !== "") {
    return resolve(cwd, fromOption);
  }

  const fromEnv = env.PWA_NAV_CACHE_DIR;
  if (fromEnv !== undefined && fromEnv.trim() !== "") {
    return resolve(cwd, fromEnv);
  }

  const projectRoot = findProjectRoot(cwd);
  if (projectRoot !== null) {
    return join(projectRoot, ".agent");
  }

  return getGlobalDataDir();
}

/**
 * Resolves the screens directory:
 * 1. options.screensDir
 * 2. env.PWA_NAV_SCREENS_DIR
 * 3. Legacy ./screens in cwd if it already exists
 * 4. Default: <cache-dir>/screens
 */
export function resolveScreensDir(
  options: { screensDir?: string | undefined; cacheDir?: string | undefined } = {},
  env: Record<string, string | undefined> = process.env,
  cwd: string = process.cwd(),
): string {
  const fromOption = options.screensDir;
  if (fromOption !== undefined && fromOption.trim() !== "") {
    return resolve(cwd, fromOption);
  }

  const fromEnv = env.PWA_NAV_SCREENS_DIR;
  if (fromEnv !== undefined && fromEnv.trim() !== "") {
    return resolve(cwd, fromEnv);
  }

  return join(resolveAgentDir({ cacheDir: options.cacheDir }, env, cwd), "screens");
}
