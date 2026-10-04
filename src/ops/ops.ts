// Shared perform layer for pwa-nav (specs 001/002/003).
// Single source of truth for open/snapshot/click/fill/extract/act behavior.
// Both src/cli.ts (command handlers) and src/qa.ts (check runner) call these
// functions; no logic is duplicated between the two entry points.
// Default backend is OfflineBackend (click/fill log intent + supersede the snapshot,
// snapshot input from a caller-supplied ARIA tree); BidiBackend drives a live browser.
// extract is read-only (never supersedes) and never calls the backend.
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { normalize } from "../core/snapshot.js";
import type { ActiveDialogInfo, Snapshot, SnapshotElement } from "../core/snapshot.js";
import {
  agentPath,
  appSlugFromUrl,
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
  clearLastActiveAction,
  getLastActiveAction,
  latestSnapshotId,
  load as loadSnapshot,
  save as saveSnapshot,
  saveLive,
  StaleRefError,
} from "../core/refs.js";
import type { Screen, ScreenMap } from "../screens/screen-map.js";
import { loadExplicitMap, loadScreenMapsFromDir, resolveScreensDir } from "../screens/screen-match.js";
import { learnScreen } from "../screens/screen-learn.js";
import { learnIntoFile } from "../screens/screen-store.js";
import { collectAllTargets } from "../screens/screen-resolve.js";
import { PwaNavError } from "../core/errors.js";
import {
  cleanDebuggingPortConfigured,
  findSite,
  firefoxPwaDir,
  launchPwa,
  launchPwaClean,
  readConfig,
} from "../browser/pwa-runtime.js";

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

export type ExtractMode = "text" | "links" | "all";

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
  if (result.interim === true) return head;
  return `${head} -> ${agentPath(agentDir, "snapshot.json")} (id ${result.snapshotId})`;
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
  query?: string;
  role?: string;
}

export interface AutoCollaborateResult {
  screenMapPath: string;
  screen: Screen;
  targets: string[];
  written: boolean;
}

export async function autoCollaborateScreen(
  backend: Backend,
  raw: RawElement[],
  snapshot: Snapshot,
  options?: { locale?: string; access?: Screen["access"]; screensDir?: string; screenMapPath?: string },
): Promise<AutoCollaborateResult | null> {
  try {
    const pageUrl = snapshot.url;
    if (!pageUrl || !isHttpUrl(pageUrl)) {
      return null;
    }
    const page = new URL(pageUrl);
    const origin = page.origin;
    const appSlug = appSlugFromUrl(pageUrl);
    const dir = options?.screensDir ?? resolveScreensDir({});
    let screenMapPath = options?.screenMapPath;
    let existingMap: ScreenMap | undefined;

    if (!screenMapPath) {
      try {
        const loaded = await loadScreenMapsFromDir(dir);
        const match = loaded.find((item) => item.map.app.origin === origin);
        if (match) {
          screenMapPath = match.path;
          existingMap = match.map;
        }
      } catch {
        // ignore
      }
    }
    if (!screenMapPath) {
      screenMapPath = join(dir, `${appSlug}.screens.json`);
    }

    if (existingMap === undefined) {
      try {
        existingMap = await loadExplicitMap(screenMapPath);
      } catch {
        existingMap = undefined;
      }
    }

    const lastAction = getLastActiveAction();
    const learned = learnScreen(
      raw,
      { url: pageUrl, title: snapshot.title, appOrigin: origin },
      {
        ...(lastAction ? { lastAction: { ...(lastAction.id ? { id: lastAction.id } : {}), ...(lastAction.name ? { name: lastAction.name } : {}) } } : {}),
        ...(options?.access ? { access: options.access } : {}),
      },
    );

    const app = existingMap !== undefined ? { ...existingMap.app } : {
      id: appSlug,
      name: snapshot.title && snapshot.title.trim().length > 0 ? snapshot.title : appSlug,
      origin,
      locale: options?.locale ?? "es",
    };

    const res = await learnIntoFile({
      path: screenMapPath,
      learned,
      app,
    });

    clearLastActiveAction();

    const currentScreen = res.map.screens.find((s) => s.id === learned.id) ?? learned;
    const { fields, actions, links } = collectAllTargets(currentScreen);
    const targets = [
      ...fields.map((f) => `@${f.id}`),
      ...actions.map((a) => `@${a.id}`),
      ...links.map((l) => `@${l.id}`),
    ];

    return {
      screenMapPath,
      screen: currentScreen,
      targets,
      written: res.written,
    };
  } catch {
    return null;
  }
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
  const { snapshot } = await captureLiveSnapshot(backend, options);
  if (options.query === undefined && options.role === undefined) {
    return snapshot;
  }
  let elements = snapshot.elements;
  if (options.role !== undefined && options.role.trim().length > 0) {
    const r = options.role.trim().toLowerCase();
    elements = elements.filter((el) => el.role.toLowerCase() === r);
  }
  if (options.query !== undefined && options.query.trim().length > 0) {
    const q = options.query.trim().toLowerCase();
    elements = elements.filter(
      (el) =>
        el.name.toLowerCase().includes(q) ||
        (el.value ?? "").toLowerCase().includes(q) ||
        el.ref.toLowerCase() === q,
    );
  }
  return { ...snapshot, elements };
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

export async function resolveSnapshotId(backend: Backend, snapshotId?: string): Promise<string> {
  if (snapshotId !== undefined && snapshotId.length > 0) {
    return snapshotId;
  }
  const latest = await latestSnapshotId({ agentDir: backend.agentDir });
  if (latest !== null) {
    return latest;
  }
  const live = await captureLiveSnapshot(backend);
  return live.snapshot.snapshotId;
}

export async function resolveRef(backend: Backend, snapshotId: string, refOrTarget: string): Promise<string> {
  if (/^e\d+$/i.test(refOrTarget)) {
    return refOrTarget;
  }
  try {
    const snap = await loadSnapshot(snapshotId, { agentDir: backend.agentDir });
    if (snap !== null) {
      const norm = refOrTarget.trim().toLowerCase();
      const exact = snap.elements.find((el) => el.name.toLowerCase() === norm);
      if (exact !== undefined) return exact.ref;
      const partial = snap.elements.find((el) => el.name.toLowerCase().includes(norm));
      if (partial !== undefined) return partial.ref;
    }
  } catch {
    // fallback to original ref
  }
  return refOrTarget;
}

export async function performClick(
  snapshotId: string | undefined,
  ref: string,
  options: OpOptions = {},
): Promise<string> {
  const backend = backendOf(options);
  const resolvedSnapshotId = await resolveSnapshotId(backend, snapshotId);
  const resolvedRef = await resolveRef(backend, resolvedSnapshotId, ref);
  const result = await backend.click(resolvedSnapshotId, resolvedRef, actionContext(options));
  console.log(reportLine("click", result, backend.agentDir));
  return result.snapshotId;
}

export async function performFill(
  snapshotId: string | undefined,
  ref: string,
  text: string,
  options: OpOptions = {},
): Promise<string> {
  const backend = backendOf(options);
  const resolvedSnapshotId = await resolveSnapshotId(backend, snapshotId);
  const resolvedRef = await resolveRef(backend, resolvedSnapshotId, ref);
  const result = await backend.fill(resolvedSnapshotId, resolvedRef, text, actionContext(options));
  console.log(reportLine("fill", result, backend.agentDir));
  return result.snapshotId;
}

export async function performUpload(
  snapshotId: string | undefined,
  ref: string,
  files: readonly string[],
  options: OpOptions = {},
): Promise<string> {
  const backend = backendOf(options);
  const resolvedSnapshotId = await resolveSnapshotId(backend, snapshotId);
  const resolvedRef = await resolveRef(backend, resolvedSnapshotId, ref);
  const result = await backend.upload(resolvedSnapshotId, resolvedRef, files, actionContext(options));
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
  snapshotId: string | undefined,
  ops: ActOp[],
  options: OpOptions = {},
): Promise<string> {
  const backend = backendOf(options);
  const resolvedSnapshotId = await resolveSnapshotId(backend, snapshotId);
  const resolvedOps = await Promise.all(
    ops.map(async (op) => {
      const resolvedRef = await resolveRef(backend, resolvedSnapshotId, op.ref);
      return { ...op, ref: resolvedRef };
    }),
  );
  const act = await backend.act(resolvedSnapshotId, resolvedOps, {
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

export function formatExtractLine(element: {
  ref: string;
  role: string;
  name: string;
  value?: string;
  disabled?: boolean;
  placeholder?: string;
  dialog?: string;
  container?: string;
}): string {
  const disabledTag = element.disabled === true ? " [disabled]" : "";
  const dialogTag = element.dialog ? ` [dialog: "${element.dialog}"]` : "";
  const placeholderTag =
    element.placeholder && element.placeholder !== element.name
      ? ` (placeholder: "${element.placeholder}")`
      : "";
  if (element.name.length > 0 && element.value !== undefined && element.value.length > 0) {
    return `${element.ref} ${element.role}${disabledTag}${dialogTag} "${element.name}"${placeholderTag}: ${element.value}`;
  }
  if (element.name.length > 0) {
    return `${element.ref} ${element.role}${disabledTag}${dialogTag} "${element.name}"${placeholderTag}`;
  }
  return `${element.ref} ${element.role}${disabledTag}${dialogTag}${placeholderTag}: ${element.value ?? ""}`;
}

export interface ExtractOptions extends OpOptions {
  query?: string;
  role?: string;
  offset?: number;
  limit?: number;
}

export interface ExtractDetailedResult {
  lines: string[];
  total: number;
  offset: number;
  returned: number;
}

export async function performExtractDetailed(
  snapshotId: string | undefined,
  mode: ExtractMode,
  options: ExtractOptions = {},
): Promise<ExtractDetailedResult> {
  const backend = backendOf(options);
  const resolvedSnapshotId = await resolveSnapshotId(backend, snapshotId);
  const snapshot = await loadSnapshot(resolvedSnapshotId, {
    agentDir: backend.agentDir,
  });
  if (snapshot === null) {
    throw new StaleRefError(resolvedSnapshotId, `unknown snapshotId "${resolvedSnapshotId}"`);
  }
  let baseElements = snapshot.elements;
  if (mode === "text") {
    baseElements = baseElements.filter(
      (el) => el.name.length > 0 || (el.value ?? "").length > 0 || el.placeholder !== undefined || el.role === "textbox",
    );
  } else if (mode === "links") {
    baseElements = baseElements.filter(
      (el) => (el.role === "link" || el.role === "button") && el.name.length > 0,
    );
  }

  if (options.role !== undefined && options.role.trim().length > 0) {
    const r = options.role.trim().toLowerCase();
    baseElements = baseElements.filter((el) => el.role.toLowerCase() === r);
  }

  if (options.query !== undefined && options.query.trim().length > 0) {
    const q = options.query.trim().toLowerCase();
    baseElements = baseElements.filter(
      (el) =>
        el.name.toLowerCase().includes(q) ||
        (el.value ?? "").toLowerCase().includes(q) ||
        (el.placeholder ?? "").toLowerCase().includes(q) ||
        (el.dialog ?? "").toLowerCase().includes(q) ||
        (el.container ?? "").toLowerCase().includes(q) ||
        el.ref.toLowerCase() === q,
    );
  }

  const total = baseElements.length;
  const offset = Math.max(0, options.offset ?? 0);
  const sliced =
    options.limit !== undefined
      ? baseElements.slice(offset, offset + Math.max(1, options.limit))
      : offset > 0
        ? baseElements.slice(offset)
        : baseElements;

  const lines = sliced.map(formatExtractLine);
  return { lines, total, offset, returned: lines.length };
}

export async function performExtract(
  snapshotId: string | undefined,
  mode: ExtractMode,
  options: ExtractOptions = {},
): Promise<string[]> {
  const result = await performExtractDetailed(snapshotId, mode, options);
  return result.lines;
}

export interface FindOptions extends OpOptions {
  query?: string;
  role?: string;
  inDialog?: boolean;
  offset?: number;
  limit?: number;
}

export interface FindResult {
  snapshotId: string;
  total: number;
  returned: number;
  offset: number;
  lines: string[];
  elements: SnapshotElement[];
  activeDialog?: ActiveDialogInfo;
}

export async function performFind(
  snapshotId: string | undefined,
  options: FindOptions = {},
): Promise<FindResult> {
  const backend = backendOf(options);
  const resolvedSnapshotId = await resolveSnapshotId(backend, snapshotId);
  const snapshot = await loadSnapshot(resolvedSnapshotId, {
    agentDir: backend.agentDir,
  });
  if (snapshot === null) {
    throw new StaleRefError(resolvedSnapshotId, `unknown snapshotId "${resolvedSnapshotId}"`);
  }

  let matches = snapshot.elements;
  if (options.inDialog === true) {
    matches = matches.filter((el) => el.dialog !== undefined);
  }

  if (options.role !== undefined && options.role.trim().length > 0) {
    const r = options.role.trim().toLowerCase();
    matches = matches.filter((el) => el.role.toLowerCase() === r);
  }

  if (options.query !== undefined && options.query.trim().length > 0) {
    const q = options.query.trim().toLowerCase();
    matches = matches.filter(
      (el) =>
        el.name.toLowerCase().includes(q) ||
        (el.value ?? "").toLowerCase().includes(q) ||
        (el.placeholder ?? "").toLowerCase().includes(q) ||
        (el.dialog ?? "").toLowerCase().includes(q) ||
        (el.container ?? "").toLowerCase().includes(q) ||
        el.role.toLowerCase().includes(q) ||
        el.ref.toLowerCase() === q,
    );
  }

  const total = matches.length;
  const offset = Math.max(0, options.offset ?? 0);
  const limit = options.limit !== undefined ? Math.max(1, options.limit) : 50;
  const sliced = matches.slice(offset, offset + limit);
  const lines = sliced.map(formatExtractLine);

  return {
    snapshotId: resolvedSnapshotId,
    total,
    returned: sliced.length,
    offset,
    lines,
    elements: sliced,
    ...(snapshot.activeDialog !== undefined ? { activeDialog: snapshot.activeDialog } : {}),
  };
}

export interface WaitOptions extends OpOptions {
  target?: string;
  query?: string;
  state?: "visible" | "hidden" | "enabled";
  timeoutMs?: number;
  intervalMs?: number;
  quiet?: boolean;
}

export interface WaitResult {
  status: "ok";
  elapsedMs: number;
  matchedRef?: string;
  matchedName?: string;
  matchedRole?: string;
}

function findWaitMatch(
  snapshot: Snapshot,
  token: string,
  isQuery: boolean,
): { ref: string; name: string; role: string; disabled?: boolean } | undefined {
  if (isQuery) {
    const q = token.trim().toLowerCase();
    return snapshot.elements.find(
      (el) =>
        el.name.toLowerCase().includes(q) ||
        (el.value ?? "").toLowerCase().includes(q) ||
        el.ref.toLowerCase() === q,
    );
  }
  const raw = token.trim();
  if (/^e\d+$/i.test(raw)) {
    return snapshot.elements.find((el) => el.ref.toLowerCase() === raw.toLowerCase());
  }
  if (raw.startsWith("@")) {
    const slug = raw.slice(1).toLowerCase();
    const exactSlug = snapshot.elements.find(
      (el) => el.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") === slug,
    );
    if (exactSlug) return exactSlug;
  }
  const norm = raw.toLowerCase();
  const exact = snapshot.elements.find((el) => el.name.toLowerCase() === norm);
  if (exact) return exact;
  return snapshot.elements.find((el) => el.name.toLowerCase().includes(norm));
}

async function getWaitSnapshot(backend: Backend): Promise<Snapshot | null> {
  if (backend instanceof OfflineBackend) {
    const id = await latestSnapshotId({ agentDir: backend.agentDir });
    return id !== null ? await loadSnapshot(id, { agentDir: backend.agentDir }) : null;
  }
  try {
    const { snapshot } = await captureLiveSnapshot(backend, { quiet: true });
    return snapshot;
  } catch (err) {
    const id = await latestSnapshotId({ agentDir: backend.agentDir });
    if (id !== null) {
      return await loadSnapshot(id, { agentDir: backend.agentDir });
    }
    throw err;
  }
}

export async function performWait(
  targetOrQuery: string | undefined,
  options: WaitOptions = {},
): Promise<WaitResult> {
  const backend = backendOf(options);
  const rawItem = targetOrQuery ?? options.target ?? options.query;
  if (!rawItem || rawItem.trim().length === 0) {
    throw new PwaNavError("invalid_args", "wait requires a target or query to wait for");
  }
  const isQuery = options.query !== undefined && targetOrQuery === undefined;
  const state = options.state ?? "visible";
  const timeoutMs = Math.min(60000, Math.max(50, options.timeoutMs ?? 15000));
  const intervalMs = Math.min(5000, Math.max(25, options.intervalMs ?? 1000));

  const startTime = Date.now();
  for (;;) {
    const snap = await getWaitSnapshot(backend);
    if (snap !== null) {
      const match = findWaitMatch(snap, rawItem, isQuery);
      let conditionMet = false;
      if (state === "visible" && match !== undefined) {
        conditionMet = true;
      } else if (state === "hidden" && match === undefined) {
        conditionMet = true;
      } else if (state === "enabled" && match !== undefined && match.disabled !== true) {
        conditionMet = true;
      }

      if (conditionMet) {
        const elapsedMs = Date.now() - startTime;
        if (options.quiet !== true) {
          console.log(`wait ok: ${state} "${rawItem}" (${elapsedMs.toString()}ms)`);
        }
        return {
          status: "ok",
          elapsedMs,
          ...(match !== undefined
            ? { matchedRef: match.ref, matchedName: match.name, matchedRole: match.role }
            : {}),
        };
      }
    }

    const elapsed = Date.now() - startTime;
    if (elapsed >= timeoutMs) {
      throw new PwaNavError(
        "timeout",
        `wait timed out after ${elapsed.toString()}ms waiting for condition "${state}" on "${rawItem}"`,
      );
    }
    const sleepDuration = Math.min(intervalMs, timeoutMs - elapsed);
    await new Promise((resolve) => setTimeout(resolve, sleepDuration));
  }
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

export interface AuthRelayOptions {
  appOrUrl?: string;
  action: "clean" | "debug";
  port?: number;
  quiet?: boolean;
}

export interface AuthRelayResult {
  status: "clean_started" | "debug_resumed";
  message: string;
  command?: string;
  siteId?: string;
}

export async function performAuthRelay(options: AuthRelayOptions): Promise<AuthRelayResult> {
  const pwaDir = firefoxPwaDir(process.platform, process.env);
  const cfg = await readConfig(pwaDir);
  const target = options.appOrUrl ?? (cfg.sites[0]?.name || cfg.sites[0]?.origin);
  if (!target) {
    throw new PwaNavError("no_browser", "no installed Firefox PWA found to authenticate");
  }
  const site = findSite(cfg, target);

  if (options.action === "clean") {
    await cleanDebuggingPortConfigured();
    const res = await launchPwaClean({ origin: site.origin, siteId: site.ulid });
    const msg = `PWA '${site.name ?? site.origin}' launched in clean mode (no debugging port). Please sign in manually in the browser window. When finished, re-run with '--debug' or call pwa_auth({ action: 'debug' }) to resume automation.`;
    if (options.quiet !== true) {
      console.log(msg);
    }
    return {
      status: "clean_started",
      message: msg,
      command: res.command,
      siteId: site.ulid,
    };
  }

  // action === "debug"
  const port = options.port ?? 9222;
  const res = await launchPwa({ origin: site.origin, siteId: site.ulid, port });
  const msg = `PWA '${site.name ?? site.origin}' restarted in debug mode on port ${String(res.port)}. Session preserved from clean login. Ready for automation.`;
  if (options.quiet !== true) {
    console.log(msg);
  }
  return {
    status: "debug_resumed",
    message: msg,
    command: res.command,
    siteId: site.ulid,
  };
}

