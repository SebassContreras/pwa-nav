import type { Backend } from "../backend/backend.js";
import { PwaNavError } from "../core/errors.js";

export interface BackendRequest {
  armed: boolean;
  launch?: boolean;
  siteId?: string;
}

export type BackendFactory = (request: BackendRequest) => Backend;

export interface ScreenSource {
  /** `--screen-map <file>`; wins over directory selection. */
  screenMap?: string;
  /** `--screens-dir <dir>` (env PWA_NAV_SCREENS_DIR, default <cache-dir>/screens). */
  screensDir?: string | undefined;
  /** Resolved `--cache-dir` (env PWA_NAV_CACHE_DIR). */
  cacheDir?: string;
}

export interface ToolContext {
  backendFactory: BackendFactory;
  /** Operator-level (CLI flag / env). Never a tool argument. */
  armed: boolean;
  mode: "offline" | "bidi";
  screens: ScreenSource;
  agentDir?: string;
  backend?: Backend;
}

export interface ToolOutcome {
  /** Human-readable text representation (e.g. for CLI stdout or MCP text block). */
  text?: string;
  /** Structured output for machine/agent consumers. */
  structured: Record<string, unknown>;
}

export interface ToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

export const ACTION_HINTS: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
};

export const READONLY_HINTS: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

export function invalid(message: string, hint?: string): PwaNavError {
  return new PwaNavError("invalid_args", message, hint !== undefined ? { hint } : undefined);
}

export const NO_INPUT_LINE = "no input sent (pass --armed to execute)";

export function isDryRun(ctx: ToolContext): boolean {
  return ctx.mode === "bidi" && !ctx.armed;
}
