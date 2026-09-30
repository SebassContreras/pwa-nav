// Shared perform layer for pwa-nav (specs 001/002/003).
// Single source of truth for open/snapshot/click/fill/extract/act behavior.
// Both src/cli.ts (command handlers) and src/qa.ts (check runner) call these
// functions; no logic is duplicated between the two entry points.
// MVP has no live browser engine: click/fill log intent + supersede the
// snapshot, snapshot input comes from a caller-supplied ARIA tree, and
// extract is read-only (never supersedes).
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { normalize } from "./snapshot.js";
import type { Snapshot } from "./snapshot.js";
import {
  load as loadSnapshot,
  resolve as resolveRef,
  save as saveSnapshot,
  StaleRefError,
} from "./refs.js";

export const DEFAULT_SESSION_PATH = ".agent/session.json";
export const DEFAULT_SNAPSHOT_PATH = ".agent/snapshot.json";
export const DEFAULT_ACTIONS_PATH = ".agent/actions.log";

export interface Session {
  url: string;
  title: string;
  openedAt: string;
}

export interface SnapshotPerformOptions {
  url: string;
  title: string;
  outPath: string;
  quiet?: boolean;
}

export type ActOp = { kind: "click"; ref: string } | { kind: "fill"; ref: string; text: string };

export type ExtractMode = "text" | "links";

export function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export async function ensureParentDir(filePath: string): Promise<void> {
  await mkdir(dirname(resolve(filePath)), { recursive: true });
}

export function parseSession(raw: unknown): Session | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  if (typeof record["url"] !== "string") {
    return null;
  }
  const title = typeof record["title"] === "string" ? record["title"] : "";
  const openedAt = typeof record["openedAt"] === "string" ? record["openedAt"] : "";
  return { url: record["url"], title, openedAt };
}

export async function loadSession(sessionPath: string): Promise<Session | null> {
  try {
    const text = await readFile(sessionPath, "utf8");
    return parseSession(JSON.parse(text) as unknown);
  } catch {
    return null;
  }
}

export async function performOpen(url: string): Promise<Session> {
  if (url.length === 0 || !isHttpUrl(url)) {
    throw new Error(`invalid URL (expected http/https): ${url}`);
  }
  const session: Session = { url, title: "", openedAt: new Date().toISOString() };
  await ensureParentDir(DEFAULT_SESSION_PATH);
  await writeFile(DEFAULT_SESSION_PATH, JSON.stringify(session, null, 2) + "\n", "utf8");
  console.log(`open ok: ${url} -> ${DEFAULT_SESSION_PATH}`);
  return session;
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
  await saveSnapshot(snapshot);
  if (options.quiet !== true) {
    console.log(
      `snapshot ok: ${snapshot.elements.length.toString()} elements -> ${options.outPath} (id ${snapshot.snapshotId})`,
    );
  }
  return snapshot;
}

export async function performClick(snapshotId: string, ref: string): Promise<string> {
  // Shared click handler: resolve, log intent, supersede, return next id.
  // Throws StaleRefError on unknown/superseded snapshotId or ref.
  const element = await resolveRef(snapshotId, ref);
  const snapshot = await loadSnapshot(snapshotId);
  // MVP has no live browser backend: record the click as an intent log.
  const intent = {
    snapshotId,
    ref: element.ref,
    role: element.role,
    name: element.name,
    at: new Date().toISOString(),
  };
  await ensureParentDir(DEFAULT_ACTIONS_PATH);
  await appendFile(DEFAULT_ACTIONS_PATH, JSON.stringify(intent) + "\n", "utf8");
  // Invalidate: supersede the old snapshot with a fresh id so its refs fail fast.
  const current = snapshot ?? {
    snapshotId,
    url: "",
    title: "",
    elements: [element],
  };
  const next = {
    snapshotId: randomUUID(),
    url: current.url,
    title: current.title,
    elements: current.elements,
  };
  await saveSnapshot(next);
  console.log(
    `click ok: ${element.ref} (${element.role} "${element.name}") -> ${DEFAULT_SNAPSHOT_PATH} (id ${next.snapshotId})`,
  );
  return next.snapshotId;
}

export async function performFill(
  snapshotId: string,
  ref: string,
  text: string,
): Promise<string> {
  // Shared fill handler: resolve, log intent, supersede, return next id.
  // Throws StaleRefError on unknown/superseded snapshotId or ref.
  const element = await resolveRef(snapshotId, ref);
  const snapshot = await loadSnapshot(snapshotId);
  // MVP has no live browser backend: record the fill as an intent log.
  const intent = {
    snapshotId,
    ref: element.ref,
    role: element.role,
    name: element.name,
    text,
    at: new Date().toISOString(),
  };
  await ensureParentDir(DEFAULT_ACTIONS_PATH);
  await appendFile(DEFAULT_ACTIONS_PATH, JSON.stringify(intent) + "\n", "utf8");
  // Invalidate: supersede the old snapshot with a fresh id so its refs fail fast.
  const current = snapshot ?? {
    snapshotId,
    url: "",
    title: "",
    elements: [element],
  };
  const next = {
    snapshotId: randomUUID(),
    url: current.url,
    title: current.title,
    elements: current.elements,
  };
  await saveSnapshot(next);
  console.log(
    `fill ok: ${element.ref} (${element.role} "${element.name}") -> ${DEFAULT_SNAPSHOT_PATH} (id ${next.snapshotId})`,
  );
  return next.snapshotId;
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
  throw new Error(`invalid act op: ${token} (expected fill:<ref>=<text> or click:<ref>).`);
}

export async function performAct(snapshotId: string, ops: ActOp[]): Promise<string> {
  // Sequential delegation to the same click/fill handlers. Each mutating op
  // supersedes, so later refs resolve against the evolving snapshotId.
  // First StaleRefError aborts the sequence (non-zero exit via caller).
  let currentId = snapshotId;
  for (const op of ops) {
    if (op.kind === "click") {
      currentId = await performClick(currentId, op.ref);
    } else {
      currentId = await performFill(currentId, op.ref, op.text);
    }
  }
  return currentId;
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
): Promise<string[]> {
  // Read-only: load the stored snapshot, never supersede/invalidate it.
  // Unknown snapshotId fails fast with the same stale_ref format as click/fill.
  const snapshot = await loadSnapshot(snapshotId);
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
