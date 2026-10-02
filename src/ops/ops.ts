// Shared perform layer for pwa-nav (specs 001/002/003).
// Single source of truth for open/snapshot/click/fill/extract/act behavior.
// Both src/cli.ts (command handlers) and src/qa.ts (check runner) call these
// functions; no logic is duplicated between the two entry points.
// Default backend is OfflineBackend (click/fill log intent + supersede the snapshot,
// snapshot input from a caller-supplied ARIA tree); BidiBackend drives a live browser.
// extract is read-only (never supersedes) and never calls the backend.
import { writeFile } from "node:fs/promises";
import { normalize } from "../core/snapshot.js";
import type { Snapshot } from "../core/snapshot.js";
import {
  agentPath,
  ensureParentDir,
  isHttpUrl,
  loadSession,
  OfflineBackend,
  parseSession,
  type ActOp,
  type ActionResult,
  type Backend,
  type ScreenshotOptions,
  type Session,
} from "../backend/backend.js";
import type { RawElement } from "../browser/collector.js";
import { buildLiveSnapshot } from "../browser/live-snapshot.js";
import {
  load as loadSnapshot,
  save as saveSnapshot,
  saveLive,
  StaleRefError,
} from "../core/refs.js";

// Re-exported so existing callers keep their imports.
export { ensureParentDir, isHttpUrl, loadSession, parseSession };
export type { ActOp, Backend, Session };

export const DEFAULT_SESSION_PATH = ".agent/session.json";
export const DEFAULT_SNAPSHOT_PATH = ".agent/snapshot.json";
export const DEFAULT_ACTIONS_PATH = ".agent/actions.log";
export const DEFAULT_SCREENSHOT_PATH = ".agent/screenshot.png";

export interface SnapshotPerformOptions {
  url: string;
  title: string;
  outPath: string;
  quiet?: boolean;
  agentDir?: string;
}

export interface ScreenshotPerformOptions extends OpOptions {
  outPath?: string;
  quiet?: boolean;
  format?: ScreenshotOptions["format"];
  clip?: ScreenshotOptions["clip"];
}

export type ExtractMode = "text" | "links";

// Optional trailing argument of every perform*: omitted = OfflineBackend (fixture behavior).
export interface OpOptions {
  backend?: Backend;
  /** Live backends: perform the action. Default false = dry-run. Offline ignores it. */
  armed?: boolean;
  /** open: add the URL origin to the allow-list. */
  allowOrigin?: boolean;
  /** Live backends: fallback for snapshots whose sidecar predates the includeAll record. */
  includeAll?: boolean;
}

function backendOf(options: OpOptions): Backend {
  return options.backend ?? new OfflineBackend();
}

function actionContext(options: OpOptions): { armed?: boolean; includeAll?: boolean } {
  return {
    ...(options.armed === undefined ? {} : { armed: options.armed }),
    ...(options.includeAll === undefined ? {} : { includeAll: options.includeAll }),
  };
}

// "click ok: <plan> -> <snapshot path> (id X)" / "click dry-run: <plan>".
function reportLine(kind: ActOp["kind"], result: ActionResult, agentDir: string): string {
  if (result.kind === "dry-run") {
    return `${kind} dry-run: ${result.plan}`;
  }
  const head = `${kind} ok: ${result.plan}`;
  return result.interim === true
    ? head
    : `${head} -> ${agentPath(agentDir, "snapshot.json")} (id ${result.snapshotId})`;
}

export async function performOpen(url: string, options: OpOptions = {}): Promise<Session> {
  const backend = backendOf(options);
  const session = await backend.open(url, { allowOrigin: options.allowOrigin === true });
  console.log(`open ok: ${url} -> ${agentPath(backend.agentDir, "session.json")}`);
  return session;
}

export interface LiveSnapshotOptions {
  /** Extra copy of snapshot.json; the store under backend.agentDir is always written. */
  outPath?: string;
  quiet?: boolean;
}

// Live snapshot: collect from the backend's DOM, store snapshot + locator sidecar (+ extras).
// Returns the collected raw elements too, so `snapshot --learn` never collects twice.
export async function captureLiveSnapshot(
  backend: Backend,
  options: LiveSnapshotOptions & { includeAll?: boolean } = {},
): Promise<{ snapshot: Snapshot; raw: RawElement[] }> {
  const live = await backend.collect({ includeAll: options.includeAll === true });
  const built = buildLiveSnapshot(live.raw, { url: live.url, title: live.title });
  await saveLive(built.snapshot, built.locators, built.extras, {
    agentDir: backend.agentDir,
    includeAll: options.includeAll === true,
  });
  const stored = agentPath(backend.agentDir, "snapshot.json");
  if (options.outPath !== undefined && options.outPath !== stored) {
    await ensureParentDir(options.outPath);
    await writeFile(options.outPath, JSON.stringify(built.snapshot, null, 2) + "\n", "utf8");
  }
  if (options.quiet !== true) {
    console.log(
      `snapshot ok: ${built.snapshot.elements.length.toString()} elements -> ${options.outPath ?? stored} (id ${built.snapshot.snapshotId})`,
    );
  }
  return { snapshot: built.snapshot, raw: live.raw };
}

export async function performLiveSnapshot(
  backend: Backend,
  options: LiveSnapshotOptions & { includeAll?: boolean } = {},
): Promise<Snapshot> {
  return (await captureLiveSnapshot(backend, options)).snapshot;
}

export async function performSnapshot(
  rawTree: string,
  options: SnapshotPerformOptions,
): Promise<Snapshot> {
  const snapshot = normalize(rawTree, { url: options.url, title: options.title });
  await ensureParentDir(options.outPath);
  await writeFile(options.outPath, JSON.stringify(snapshot, null, 2) + "\n", "utf8");
  // Keep the refs store in sync so click --snapshot <id> <ref> resolves.
  // save() rewrites .agent/snapshot.json plus refs/<id>.json + latest.json.
  await saveSnapshot(snapshot, options.agentDir ? { agentDir: options.agentDir } : undefined);
  if (options.quiet !== true) {
    console.log(
      `snapshot ok: ${snapshot.elements.length.toString()} elements -> ${options.outPath} (id ${snapshot.snapshotId})`,
    );
  }
  return snapshot;
}

export async function performClick(
  snapshotId: string,
  ref: string,
  options: OpOptions = {},
): Promise<string> {
  // Throws StaleRefError on unknown/superseded snapshotId or ref.
  const backend = backendOf(options);
  const result = await backend.click(snapshotId, ref, actionContext(options));
  console.log(reportLine("click", result, backend.agentDir));
  return result.snapshotId;
}

export async function performFill(
  snapshotId: string,
  ref: string,
  text: string,
  options: OpOptions = {},
): Promise<string> {
  // Throws StaleRefError on unknown/superseded snapshotId or ref.
  const backend = backendOf(options);
  const result = await backend.fill(snapshotId, ref, text, actionContext(options));
  console.log(reportLine("fill", result, backend.agentDir));
  return result.snapshotId;
}

export async function performUpload(
  snapshotId: string,
  ref: string,
  files: readonly string[],
  options: OpOptions = {},
): Promise<string> {
  const backend = backendOf(options);
  const result = await backend.upload(snapshotId, ref, files, actionContext(options));
  console.log(reportLine("upload", result, backend.agentDir));
  return result.snapshotId;
}

export function parseActOp(token: string): ActOp {
  if (token.startsWith("click:")) {
    const ref = token.slice("click:".length);
    if (ref.length === 0 || ref.includes("=") || /\s/.test(ref)) {
      throw new Error(`invalid act op: ${token} (expected click:<ref>).`);
    }
    return { kind: "click", ref };
  }
  if (token.startsWith("fill:")) {
    const remainder = token.slice("fill:".length);
    const eq = remainder.indexOf("=");
    if (eq < 0) {
      throw new Error(`invalid act op: ${token} (expected fill:<ref>=<text>).`);
    }
    const ref = remainder.slice(0, eq);
    const text = remainder.slice(eq + 1);
    if (ref.length === 0 || /\s/.test(ref) || text.length === 0) {
      throw new Error(`invalid act op: ${token} (expected fill:<ref>=<text>).`);
    }
    return { kind: "fill", ref, text };
  }
  if (token.startsWith("upload:")) {
    const remainder = token.slice("upload:".length);
    const eq = remainder.indexOf("=");
    if (eq < 0) {
      throw new Error(`invalid act op: ${token} (expected upload:<ref>=<path>).`);
    }
    const ref = remainder.slice(0, eq);
    const path = remainder.slice(eq + 1);
    if (ref.length === 0 || /\s/.test(ref) || path.length === 0) {
      throw new Error(`invalid act op: ${token} (expected upload:<ref>=<path>).`);
    }
    return { kind: "upload", ref, files: [path] };
  }
  throw new Error(`invalid act op: ${token} (expected fill:<ref>=<text>, click:<ref>, or upload:<ref>=<path>).`);
}

export async function performAct(
  snapshotId: string,
  ops: ActOp[],
  options: OpOptions = {},
): Promise<string> {
  // Offline: sequential click/fill on the evolving snapshot id. Live: one session, one new
  // snapshot at the end. First error aborts the sequence (non-zero exit via caller).
  const backend = backendOf(options);
  const act = await backend.act(snapshotId, ops, {
    ...actionContext(options),
    onResult: (op, result) => {
      console.log(reportLine(op.kind, result, backend.agentDir));
    },
  });
  if (act.results.some((r) => r.interim === true)) {
    console.log(
      `act ok: ${act.results.length.toString()} ops -> ${agentPath(backend.agentDir, "snapshot.json")} (id ${act.snapshotId})`,
    );
  }
  return act.snapshotId;
}

function formatExtractLine(element: {
  ref: string;
  role: string;
  name: string;
  value?: string;
}): string {
  if (element.name.length > 0 && element.value !== undefined && element.value.length > 0) {
    return `${element.ref} ${element.role} "${element.name}": ${element.value}`;
  }
  if (element.name.length > 0) {
    return `${element.ref} ${element.role} "${element.name}"`;
  }
  return `${element.ref} ${element.role}: ${element.value ?? ""}`;
}

export async function performExtract(
  snapshotId: string,
  mode: ExtractMode,
  options: OpOptions = {},
): Promise<string[]> {
  // Read-only: load the stored snapshot, never supersede/invalidate it.
  // Unknown snapshotId fails fast with the same stale_ref format as click/fill.
  const snapshot = await loadSnapshot(snapshotId, {
    agentDir: options.backend?.agentDir ?? ".agent",
  });
  if (snapshot === null) {
    throw new StaleRefError(snapshotId, `unknown snapshotId "${snapshotId}"`);
  }
  if (mode === "text") {
    return snapshot.elements
      .filter((element) => element.name.length > 0 || (element.value ?? "").length > 0)
      .map(formatExtractLine);
  }
  return snapshot.elements
    .filter(
      (element) =>
        (element.role === "link" || element.role === "button") && element.name.length > 0,
    )
    .map(formatExtractLine);
}

export function readPngDimensions(buffer: Buffer): { width: number; height: number } | null {
  if (
    buffer.length >= 24 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    const width = buffer.readUInt32BE(16);
    const height = buffer.readUInt32BE(20);
    return { width, height };
  }
  return null;
}

export async function performScreenshot(
  options: ScreenshotPerformOptions = {},
): Promise<{ path: string; buffer: Buffer; width?: number; height?: number }> {
  const backend = backendOf(options);
  const outPath = options.outPath ?? agentPath(backend.agentDir, "screenshot.png");
  const buffer = await backend.screenshot({
    format: options.format,
    clip: options.clip,
  });
  await ensureParentDir(outPath);
  await writeFile(outPath, buffer);
  if (options.quiet !== true) {
    console.log(`screenshot saved to ${outPath}`);
  }
  const dims = readPngDimensions(buffer);
  return {
    path: outPath,
    buffer,
    ...(dims !== null ? { width: dims.width, height: dims.height } : {}),
  };
}
