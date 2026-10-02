import assert from "node:assert/strict";
import { test } from "node:test";
import { EXIT_CODES, PwaNavError, exitCodeOf, isPwaNavError, type ErrorCode } from "./errors.js";
import { StaleRefError, isStaleRefError } from "./refs.js";

const ALL_CODES: ErrorCode[] = [
  "invalid_args",
  "stale_ref",
  "no_browser",
  "session_busy",
  "origin_blocked",
  "kill_switch",
  "not_actionable",
  "timeout",
  "protocol",
  "sensitive_target",
  "unknown_target",
  "unmapped_screen",
  "journey_step_failed",
  "file_upload_blocked",
];

test("every code has a positive exit code", () => {
  for (const code of ALL_CODES) {
    assert.ok(Number.isInteger(EXIT_CODES[code]) && EXIT_CODES[code] > 1, code);
  }
  assert.equal(Object.keys(EXIT_CODES).length, ALL_CODES.length);
});

test("exit codes are unique", () => {
  const values = Object.values(EXIT_CODES);
  assert.equal(new Set(values).size, values.length);
});

test("table values match the spec", () => {
  assert.equal(EXIT_CODES.invalid_args, 2);
  assert.equal(EXIT_CODES.stale_ref, 3);
  assert.equal(EXIT_CODES.protocol, 10);
  assert.equal(EXIT_CODES.sensitive_target, 11);
  assert.equal(EXIT_CODES.unknown_target, 12);
  assert.equal(EXIT_CODES.unmapped_screen, 13);
  assert.equal(EXIT_CODES.journey_step_failed, 14);
  assert.equal(EXIT_CODES.file_upload_blocked, 15);
});

test("PwaNavError carries code, hint, cause and exitCode", () => {
  const cause = new Error("root");
  const err = new PwaNavError("no_browser", "port closed", { hint: "launch it", cause });
  assert.ok(err instanceof Error);
  assert.ok(isPwaNavError(err));
  assert.equal(err.code, "no_browser");
  assert.equal(err.hint, "launch it");
  assert.equal(err.cause, cause);
  assert.equal(err.exitCode, 4);
  assert.equal(new PwaNavError("timeout", "x").hint, undefined);
});

test("StaleRefError keeps message, code and snapshotId", () => {
  const err = new StaleRefError("s1", 'unknown ref "e9" for snapshotId "s1"');
  assert.ok(err instanceof PwaNavError);
  assert.ok(err instanceof StaleRefError);
  assert.ok(isStaleRefError(err));
  assert.equal(err.code, "stale_ref");
  assert.equal(err.name, "StaleRefError");
  assert.equal(err.snapshotId, "s1");
  assert.equal(
    err.message,
    'unknown ref "e9" for snapshotId "s1" (code: stale_ref, snapshotId: s1). Re-snapshot to get a fresh snapshotId + ref.',
  );
  assert.equal(exitCodeOf(err), 3);
});

test("exitCodeOf returns 1 for non-PwaNavError values", () => {
  assert.equal(exitCodeOf(new Error("boom")), 1);
  assert.equal(exitCodeOf("str"), 1);
  assert.equal(exitCodeOf(null), 1);
  assert.equal(exitCodeOf(new PwaNavError("invalid_args", "bad")), 2);
});
