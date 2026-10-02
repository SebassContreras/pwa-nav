// Armed gate: kill-switch + origin allow-list (spec 004 design, "Key decisions").
import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { PwaNavError } from "./errors.js";

export const DEFAULT_AGENT_DIR = ".agent";
export const KILL_SWITCH_ENV = "PWA_NAV_KILL_SWITCH";

export type GateDecision =
  | { kind: "dry-run" }
  | { kind: "armed" }
  | { kind: "blocked"; error: PwaNavError };

export interface GateInput {
  armed: boolean;
  killSwitchActive: boolean;
  origin: string;
  allowedOrigins: readonly string[];
}

// Normalized origin, or null when not a parseable URL with a real origin.
export function normalizeOrigin(value: string): string | null {
  try {
    const { origin } = new URL(value);
    return origin === "null" ? null : origin;
  } catch {
    return null;
  }
}

// Pure decision core: no I/O. The kill-switch only aborts armed actions.
export function decideAction(input: GateInput): GateDecision {
  if (!input.armed) {
    return { kind: "dry-run" };
  }
  if (input.killSwitchActive) {
    return {
      kind: "blocked",
      error: new PwaNavError("kill_switch", "kill-switch is active; armed action aborted", {
        hint: "remove the kill-switch file to resume",
      }),
    };
  }
  const origin = normalizeOrigin(input.origin);
  const allowed = new Set(
    input.allowedOrigins.map(normalizeOrigin).filter((o): o is string => o !== null),
  );
  if (origin === null || !allowed.has(origin)) {
    const shown = origin ?? input.origin;
    return {
      kind: "blocked",
      error: new PwaNavError("origin_blocked", `origin not allow-listed: ${shown}`, {
        hint: `re-run: open <url> --allow-origin (adds ${origin ?? "<origin>"} to the allow-list)`,
      }),
    };
  }
  return { kind: "armed" };
}

export function killSwitchPath(env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env[KILL_SWITCH_ENV];
  return fromEnv !== undefined && fromEnv !== "" ? fromEnv : join(DEFAULT_AGENT_DIR, "kill");
}

export async function isKillSwitchActive(path: string = killSwitchPath()): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function allowListPath(agentDir: string): string {
  return join(agentDir, "allow.json");
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

export async function loadAllowList(agentDir: string = DEFAULT_AGENT_DIR): Promise<string[]> {
  const file = allowListPath(agentDir);
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    if (isMissing(error)) {
      return [];
    }
    throw new PwaNavError("invalid_args", `cannot read ${file}`, { cause: error });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new PwaNavError("invalid_args", `malformed ${file}: invalid JSON`, {
      hint: 'expected {"origins": ["https://example.com"]}',
      cause: error,
    });
  }
  const origins = (parsed as { origins?: unknown } | null)?.origins;
  if (!Array.isArray(origins) || !origins.every((o): o is string => typeof o === "string")) {
    throw new PwaNavError("invalid_args", `malformed ${file}: "origins" must be a string array`, {
      hint: 'expected {"origins": ["https://example.com"]}',
    });
  }
  return origins;
}

// Adds a normalized http(s) origin; idempotent, sorted, temp file + rename.
export async function addAllowedOrigin(
  origin: string,
  agentDir: string = DEFAULT_AGENT_DIR,
): Promise<string[]> {
  const normalized = normalizeOrigin(origin);
  if (normalized === null || !/^https?:\/\//.test(normalized)) {
    throw new PwaNavError("invalid_args", `invalid origin for --allow-origin: ${origin}`, {
      hint: "use an http(s) origin such as https://example.com",
    });
  }
  const current = await loadAllowList(agentDir);
  const next = [
    ...new Set([...current.map((o) => normalizeOrigin(o) ?? o), normalized]),
  ].sort();
  const file = resolve(allowListPath(agentDir));
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${String(process.pid)}.tmp`;
  await writeFile(tmp, JSON.stringify({ origins: next }, null, 2) + "\n", "utf8");
  await rename(tmp, file);
  return next;
}

export interface AssertArmedOptions {
  armed: boolean;
  origin: string;
  agentDir?: string;
  env?: NodeJS.ProcessEnv;
}

// Per-action check: re-reads kill-switch and allow-list each call, so a
// kill file created mid-batch stops the remaining actions.
export async function assertArmedAllowed(options: AssertArmedOptions): Promise<GateDecision> {
  if (!options.armed) {
    return { kind: "dry-run" };
  }
  const [killSwitchActive, allowedOrigins] = await Promise.all([
    isKillSwitchActive(killSwitchPath(options.env)),
    loadAllowList(options.agentDir),
  ]);
  return decideAction({
    armed: true,
    killSwitchActive,
    origin: options.origin,
    allowedOrigins,
  });
}

export interface AssertNavigationOptions {
  /** URL (or origin) being opened. */
  url: string;
  /** `--allow-origin` passed on this same call: consent to navigate there. */
  allowOrigin: boolean;
  agentDir?: string;
  env?: NodeJS.ProcessEnv;
}

// `open` navigates the user's real window: kill-switch blocks it, and the origin must be
// allow-listed or consented via --allow-origin on this call. No --armed needed. Runs before any I/O to the browser.
export async function assertNavigationAllowed(options: AssertNavigationOptions): Promise<void> {
  if (await isKillSwitchActive(killSwitchPath(options.env))) {
    throw new PwaNavError("kill_switch", "kill-switch is active; navigation aborted", {
      hint: "remove the kill-switch file to resume",
    });
  }
  const origin = normalizeOrigin(options.url);
  if (origin === null) {
    throw new PwaNavError("invalid_args", `invalid URL (expected http/https): ${options.url}`);
  }
  if (options.allowOrigin) return;
  const allowed = (await loadAllowList(options.agentDir)).map(normalizeOrigin);
  if (!allowed.includes(origin)) {
    throw new PwaNavError("origin_blocked", `origin not allow-listed: ${origin}`, {
      hint: "re-run: open <url> --allow-origin to allow this origin",
    });
  }
}

const FORBIDDEN_FILE_NAMES = new Set([
  ".env",
  ".env.local",
  ".env.production",
  ".env.development",
  "id_rsa",
  "id_ed25519",
  "id_ecdsa",
  "id_dsa",
]);

export function isPathInside(targetPath: string, rootDir: string): boolean {
  const targetResolved = resolve(targetPath);
  const rootResolved = resolve(rootDir);
  const rel = process.platform === "win32"
    ? relative(rootResolved.toLowerCase(), targetResolved.toLowerCase())
    : relative(rootResolved, targetResolved);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function assertFileUploadAllowed(
  filePath: string,
  safeRoots: readonly string[] = [process.cwd(), resolve(DEFAULT_AGENT_DIR)],
): void {
  const resolved = resolve(filePath);
  const base = basename(resolved).toLowerCase();
  if (base.startsWith(".env") || FORBIDDEN_FILE_NAMES.has(base)) {
    throw new PwaNavError("file_upload_blocked", `upload of sensitive file ${filePath} is blocked`, {
      hint: "Sensitive files (.env, private keys) cannot be uploaded.",
    });
  }

  const isInside = safeRoots.some((root) => isPathInside(resolved, root));
  if (!isInside) {
    throw new PwaNavError("file_upload_blocked", `file ${filePath} is outside allowed upload paths`, {
      hint: "Files can only be uploaded from workspace root or .agent/ directory.",
    });
  }
}

