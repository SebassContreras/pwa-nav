// Typed errors + exit-code map (spec 004 design, "Error codes -> exit codes").
// Codes 11-13 are reserved for spec 005 (screen map).
export type ErrorCode =
  | "invalid_args"
  | "stale_ref"
  | "no_browser"
  | "session_busy"
  | "origin_blocked"
  | "kill_switch"
  | "not_actionable"
  | "timeout"
  | "protocol"
  | "sensitive_target"
  | "unknown_target"
  | "unmapped_screen"
  | "journey_step_failed";

export const EXIT_CODES: Readonly<Record<ErrorCode, number>> = {
  invalid_args: 2,
  stale_ref: 3,
  no_browser: 4,
  session_busy: 5,
  origin_blocked: 6,
  kill_switch: 7,
  not_actionable: 8,
  timeout: 9,
  protocol: 10,
  sensitive_target: 11,
  unknown_target: 12,
  unmapped_screen: 13,
  journey_step_failed: 14,
};

export interface PwaNavErrorOptions {
  hint?: string;
  cause?: unknown;
}

export class PwaNavError extends Error {
  readonly code: ErrorCode;
  readonly hint?: string;

  constructor(code: ErrorCode, message: string, options: PwaNavErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "PwaNavError";
    this.code = code;
    if (options.hint !== undefined) {
      this.hint = options.hint;
    }
  }

  get exitCode(): number {
    return EXIT_CODES[this.code];
  }
}

export function isPwaNavError(error: unknown): error is PwaNavError {
  return error instanceof PwaNavError;
}

// Mapped exit code for PwaNavError, 1 for anything else.
export function exitCodeOf(error: unknown): number {
  return isPwaNavError(error) ? error.exitCode : 1;
}
