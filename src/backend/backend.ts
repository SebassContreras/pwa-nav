// Backend port (spec 004, T010). ops.ts `perform*` delegate here; adapters:
// OfflineBackend (fixtures, intent log; below) and BidiBackend (src/browser/bidi-backend.ts).
import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { dirname, resolve } from "node:path";
import { PwaNavError } from "../core/errors.js";
import type { RawElement } from "../browser/collector.js";
import { load as loadSnapshot, resolve as resolveRef, save as saveSnapshot } from "../core/refs.js";
import { resolveAgentDir } from "../core/storage.js";

import { DEFAULT_AGENT_DIR } from "../core/gate.js";

export const DEFAULT_PORT = 9222;
export const DEFAULT_HOST = "127.0.0.1";
export { DEFAULT_AGENT_DIR };

export interface Session {
  url: string;
  title: string;
  openedAt: string;
}

export type ActOp =
  | { kind: "click"; ref: string }
  | { kind: "fill"; ref: string; text: string }
  | { kind: "upload"; ref: string; files: readonly string[] };

export interface ActionResult {
  kind: "dry-run" | "done";
  /** Human-readable target description. Never contains typed text of sensitive targets. */
  plan: string;
  /** Latest snapshot id (dry-run and `interim` results: the id that was passed in). */
  snapshotId: string;
  url: string;
  title: string;
  /** Set on `done` results inside a live batch: the batch's new snapshot is written at the end. */
  interim?: true;
}

export interface ActionContext {
  /** Overrides the backend default; offline ignores it. */
  armed?: boolean;
  /** Must match the collection options of the snapshot being acted on. */
  includeAll?: boolean;
  /** Called as each op of an `act` batch completes (real-time progress). */
  onResult?: (op: ActOp, result: ActionResult) => void;
}

export interface ActResult {
  snapshotId: string;
  results: ActionResult[];
}

export interface OpenOptions {
  allowOrigin?: boolean;
}

export interface ScreenshotOptions {
  format?: "png" | "jpeg" | "webp";
  clip?: {
    type: "box";
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

export interface Backend {
  /** Directory holding session.json, snapshots, refs and the gate files. */
  readonly agentDir: string;
  open(url: string, opts?: OpenOptions): Promise<Session>;
  collect(opts?: { includeAll?: boolean }): Promise<{ url: string; title: string; raw: RawElement[] }>;
  click(snapshotId: string, ref: string, ctx?: ActionContext): Promise<ActionResult>;
  fill(snapshotId: string, ref: string, text: string, ctx?: ActionContext): Promise<ActionResult>;
  upload(snapshotId: string, ref: string, files: readonly string[], ctx?: ActionContext): Promise<ActionResult>;
  act(snapshotId: string, ops: readonly ActOp[], ctx?: ActionContext): Promise<ActResult>;
  currentUrl(): Promise<string>;
  screenshot(options?: ScreenshotOptions): Promise<Buffer>;
}

export function agentPath(agentDir: string, name: string): string {
  return `${agentDir}/${name}`;
}

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

let inMemorySession: Session | null = null;

export async function loadSession(sessionPath: string): Promise<Session | null> {
  if (inMemorySession !== null) {
    return inMemorySession;
  }
  try {
    const text = await readFile(sessionPath, "utf8");
    return parseSession(JSON.parse(text) as unknown);
  } catch {
    return null;
  }
}

export function appSlugFromUrl(urlOrOrigin: string): string {
  try {
    const u = new URL(urlOrOrigin);
    return u.hostname.replace(/^www\./, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "default";
  } catch {
    return "default";
  }
}

export async function writeSession(agentDir: string, session: Session): Promise<void> {
  inMemorySession = session;
  const path = agentPath(agentDir, "session.json");
  await ensureParentDir(path);
  await writeFile(path, JSON.stringify(session, null, 2) + "\n", "utf8");
}

export interface OfflineBackendOptions {
  agentDir?: string;
}

// Fixture backend: no browser. click/fill log an intent and supersede the snapshot
// (elements copied); the snapshot tree is supplied by the caller (see performSnapshot).
export class OfflineBackend implements Backend {
  readonly agentDir: string;

  constructor(options: OfflineBackendOptions = {}) {
    this.agentDir = options.agentDir ?? resolveAgentDir();
  }

  async open(url: string): Promise<Session> {
    if (url.length === 0 || !isHttpUrl(url)) {
      throw new Error(`invalid URL (expected http/https): ${url}`);
    }
    const session: Session = { url, title: "", openedAt: new Date().toISOString() };
    await writeSession(this.agentDir, session);
    return session;
  }

  collect(): Promise<never> {
    return Promise.reject(
      new PwaNavError("invalid_args", "offline backend has no live DOM; use a bidi backend or supply an ARIA tree", {
        hint: "snapshot --input <file> works offline",
      }),
    );
  }

  async currentUrl(): Promise<string> {
    return (await loadSession(agentPath(this.agentDir, "session.json")))?.url ?? "";
  }

  screenshot(): Promise<Buffer> {
    return Promise.resolve(
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
        "base64",
      ),
    );
  }

  click(snapshotId: string, ref: string): Promise<ActionResult> {
    return this.mutate(snapshotId, ref, undefined);
  }

  fill(snapshotId: string, ref: string, text: string): Promise<ActionResult> {
    return this.mutate(snapshotId, ref, text);
  }

  upload(snapshotId: string, ref: string, files: readonly string[]): Promise<ActionResult> {
    return this.mutate(snapshotId, ref, undefined, files);
  }

  // Sequential click/fill/upload; each op supersedes, so later refs resolve against the evolving id.
  // The first StaleRefError aborts the sequence.
  async act(snapshotId: string, ops: readonly ActOp[], ctx: ActionContext = {}): Promise<ActResult> {
    let currentId = snapshotId;
    const results: ActionResult[] = [];
    for (const op of ops) {
      const result =
        op.kind === "click"
          ? await this.click(currentId, op.ref)
          : op.kind === "fill"
            ? await this.fill(currentId, op.ref, op.text)
            : await this.upload(currentId, op.ref, op.files);
      currentId = result.snapshotId;
      results.push(result);
      ctx.onResult?.(op, result);
    }
    return { snapshotId: currentId, results };
  }

  // Resolve, log intent, supersede with a fresh id. Throws StaleRefError on unknown/superseded id or ref.
  private async mutate(
    snapshotId: string,
    ref: string,
    text: string | undefined,
    files?: readonly string[],
  ): Promise<ActionResult> {
    const store = { agentDir: this.agentDir };
    const element = await resolveRef(snapshotId, ref, store);
    const snapshot = await loadSnapshot(snapshotId, store);
    const intent: Record<string, unknown> = {
      snapshotId,
      ref: element.ref,
      role: element.role,
      name: element.name,
      ...(text === undefined ? {} : { text }),
      ...(files === undefined ? {} : { files: Array.from(files) }),
      at: new Date().toISOString(),
    };
    const logPath = agentPath(this.agentDir, "actions.log");
    await ensureParentDir(logPath);
    await appendFile(logPath, JSON.stringify(intent) + "\n", "utf8");
    const current = snapshot ?? { snapshotId, url: "", title: "", elements: [element] };
    const next = {
      snapshotId: randomUUID(),
      url: current.url,
      title: current.title,
      elements: current.elements,
    };
    await saveSnapshot(next, store);
    return {
      kind: "done",
      plan: `${element.ref} (${element.role} "${element.name}")`,
      snapshotId: next.snapshotId,
      url: next.url,
      title: next.title,
    };
  }
}
