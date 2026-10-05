// RefMap store for spec 002-nav-actions (T001).
// Persists snapshots + refMaps to .agent/ and resolves snapshotId + ref.
// Pure logic + file IO, no browser calls. Reuses the Snapshot contract.
import { mkdir, readdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { join, resolve as resolvePath } from "node:path";
import { PwaNavError } from "./errors.js";
import type { LiveExtras } from "../browser/live-snapshot.js";
import type { Locator } from "../screens/screen-map.js";
import type { Snapshot, SnapshotElement } from "./snapshot.js";

export const STALE_REF_CODE = "stale_ref" as const;

const SNAPSHOT_FILE = "snapshot.json";
const REFS_DIR = "refs";
const LATEST_FILE = "latest.json";

const SNAPSHOT_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export interface RefStoreOptions {
  agentDir?: string;
}

export class StaleRefError extends PwaNavError {
  declare readonly code: typeof STALE_REF_CODE;
  readonly snapshotId: string;

  constructor(snapshotId: string, detail: string) {
    super(
      STALE_REF_CODE,
      `${detail} (code: ${STALE_REF_CODE}, snapshotId: ${snapshotId}). Re-snapshot to get a fresh snapshotId + ref.`,
    );
    this.name = "StaleRefError";
    this.snapshotId = snapshotId;
  }
}

export function isStaleRefError(error: unknown): error is StaleRefError {
  return error instanceof StaleRefError;
}

export interface ActiveAction {
  id?: string;
  name?: string;
  role?: string;
  timestamp: number;
}

const memSnapshots = new Map<string, Snapshot>();
const memSidecars = new Map<string, LocatorSidecar>();
let memLatestSnapshotId: string | null = null;
let memLastActiveAction: ActiveAction | null = null;
async function pruneOldRefFiles(agentDir: string, maxSnapshots = 20): Promise<void> {
  try {
    const dir = resolvePath(join(agentDir, REFS_DIR));
    const entries = await readdir(dir);
    const snapshotIds = entries
      .filter((e) => e !== LATEST_FILE && !e.endsWith(".locators.json") && e.endsWith(".json"))
      .map((e) => e.replace(/\.json$/, ""));
    if (snapshotIds.length <= maxSnapshots) {
      return;
    }
    const withMtime = await Promise.all(
      snapshotIds.map(async (id) => {
        const fileStats = await stat(join(dir, `${id}.json`)).catch(() => null);
        return { id, mtime: fileStats?.mtimeMs ?? 0 };
      }),
    );
    withMtime.sort((a, b) => b.mtime - a.mtime);
    for (const item of withMtime.slice(maxSnapshots)) {
      await unlink(join(dir, `${item.id}.json`)).catch(() => undefined);
      await unlink(join(dir, `${item.id}.locators.json`)).catch(() => undefined);
    }
  } catch {
    // ignore
  }
}

export function setLastActiveAction(action: { id?: string; name?: string; role?: string } | null): void {
  if (action === null) {
    memLastActiveAction = null;
  } else {
    memLastActiveAction = {
      ...(action.id !== undefined ? { id: action.id } : {}),
      ...(action.name !== undefined ? { name: action.name } : {}),
      ...(action.role !== undefined ? { role: action.role } : {}),
      timestamp: Date.now(),
    };
  }
}

export function getLastActiveAction(): ActiveAction | null {
  return memLastActiveAction;
}

export function clearLastActiveAction(): void {
  memLastActiveAction = null;
}


function agentDirOf(options: RefStoreOptions = {}): string {
  return options.agentDir ?? ".agent";
}

function snapshotPath(agentDir: string): string {
  return resolvePath(join(agentDir, SNAPSHOT_FILE));
}

function refPath(agentDir: string, snapshotId: string): string {
  return resolvePath(join(agentDir, REFS_DIR, `${snapshotId}.json`));
}

function latestPath(agentDir: string): string {
  return resolvePath(join(agentDir, REFS_DIR, LATEST_FILE));
}

function isValidSnapshotId(value: string): boolean {
  return value.length > 0 && SNAPSHOT_ID_PATTERN.test(value);
}

function isSnapshotElement(raw: unknown): raw is SnapshotElement {
  if (typeof raw !== "object" || raw === null) {
    return false;
  }
  const record = raw as Record<string, unknown>;
  return (
    typeof record["ref"] === "string" &&
    typeof record["role"] === "string" &&
    typeof record["name"] === "string" &&
    (record["value"] === undefined || typeof record["value"] === "string") &&
    (record["disabled"] === undefined || typeof record["disabled"] === "boolean")
  );
}

function isSnapshot(raw: unknown): raw is Snapshot {
  if (typeof raw !== "object" || raw === null) {
    return false;
  }
  const record = raw as Record<string, unknown>;
  return (
    typeof record["snapshotId"] === "string" &&
    typeof record["url"] === "string" &&
    typeof record["title"] === "string" &&
    Array.isArray(record["elements"]) &&
    record["elements"].every(isSnapshotElement)
  );
}

async function readJsonFile(path: string): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return null;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

// Latest snapshotId: prefer in-memory, then refs/latest.json, fall back to snapshot.json.
export async function latestSnapshotId(options: RefStoreOptions = {}): Promise<string | null> {
  if (memLatestSnapshotId !== null) {
    return memLatestSnapshotId;
  }
  const agentDir = agentDirOf(options);
  const latestRaw = await readJsonFile(latestPath(agentDir));
  if (typeof latestRaw === "object" && latestRaw !== null) {
    const id = (latestRaw as Record<string, unknown>)["snapshotId"];
    if (typeof id === "string" && isValidSnapshotId(id)) {
      return id;
    }
  }
  const snapshotRaw = await readJsonFile(snapshotPath(agentDir));
  if (isSnapshot(snapshotRaw)) {
    return snapshotRaw.snapshotId;
  }
  return null;
}

// Persist snapshot + refMap. Supersedes any previous snapshotId.
export async function save(snapshot: Snapshot, options: RefStoreOptions = {}): Promise<string> {
  if (!isValidSnapshotId(snapshot.snapshotId)) {
    throw new Error(`invalid snapshotId: ${snapshot.snapshotId}`);
  }
  memSnapshots.set(snapshot.snapshotId, snapshot);
  memLatestSnapshotId = snapshot.snapshotId;

  const agentDir = agentDirOf(options);
  const body = JSON.stringify(snapshot, null, 2) + "\n";
  await mkdir(resolvePath(join(agentDir, REFS_DIR)), { recursive: true });
  await writeFile(refPath(agentDir, snapshot.snapshotId), body, "utf8");
  await writeFile(snapshotPath(agentDir), body, "utf8");
  await writeFile(
    latestPath(agentDir),
    JSON.stringify({ snapshotId: snapshot.snapshotId }, null, 2) + "\n",
    "utf8",
  );
  await pruneOldRefFiles(agentDir, 20);
  return snapshot.snapshotId;
}

// Retrieve a persisted snapshot by id. Null when unknown.
export async function load(snapshotId: string, options: RefStoreOptions = {}): Promise<Snapshot | null> {
  if (!isValidSnapshotId(snapshotId)) {
    return null;
  }
  const mem = memSnapshots.get(snapshotId);
  if (mem !== undefined) {
    return mem;
  }
  const agentDir = agentDirOf(options);
  const perId = await readJsonFile(refPath(agentDir, snapshotId));
  if (isSnapshot(perId) && perId.snapshotId === snapshotId) {
    return perId;
  }
  const current = await readJsonFile(snapshotPath(agentDir));
  if (isSnapshot(current) && current.snapshotId === snapshotId) {
    return current;
  }
  return null;
}

// Resolve snapshotId + ref to an element. Throws StaleRefError when the
// snapshotId is unknown/superseded or the ref is absent.
export async function resolve(
  snapshotId: string,
  ref: string,
  options: RefStoreOptions = {},
): Promise<SnapshotElement> {
  const snapshot = await load(snapshotId, options);
  if (snapshot === null) {
    throw new StaleRefError(snapshotId, `unknown snapshotId "${snapshotId}"`);
  }
  const latest = await latestSnapshotId(options);
  if (latest !== null && snapshotId !== latest) {
    throw new StaleRefError(
      snapshotId,
      `superseded snapshotId "${snapshotId}" (latest is "${latest}")`,
    );
  }
  const element = snapshot.elements.find((entry) => entry.ref === ref);
  if (element === undefined) {
    throw new StaleRefError(snapshotId, `unknown ref "${ref}" for snapshotId "${snapshotId}"`);
  }
  return element;
}

// --- Live locators (spec 004, T008): sidecar `refs/<snapshotId>.locators.json`. ---

export interface LocatorSidecar {
  snapshotId: string;
  url: string;
  locators: Record<string, Locator>;
  extras?: Record<string, LiveExtras>;
  /** Collection mode of this snapshot; actions must re-collect the same way. Absent = false. */
  includeAll?: boolean;
}

function locatorsPath(agentDir: string, snapshotId: string): string {
  return resolvePath(join(agentDir, REFS_DIR, `${snapshotId}.locators.json`));
}

export async function saveLive(
  snapshot: Snapshot,
  locators: Record<string, Locator>,
  extras?: Record<string, LiveExtras>,
  options: RefStoreOptions & { includeAll?: boolean } = {},
): Promise<string> {
  await save(snapshot, options);
  const sidecar: LocatorSidecar = { snapshotId: snapshot.snapshotId, url: snapshot.url, locators };
  if (extras !== undefined) sidecar.extras = extras;
  if (options.includeAll !== undefined) sidecar.includeAll = options.includeAll;
  memSidecars.set(snapshot.snapshotId, sidecar);

  const agentDir = agentDirOf(options);
  await writeFile(
    locatorsPath(agentDir, snapshot.snapshotId),
    JSON.stringify(sidecar, null, 2) + "\n",
    "utf8",
  );
  await pruneOldRefFiles(agentDir, 20);
  return snapshot.snapshotId;
}

function isLocatorSidecar(raw: unknown, snapshotId: string): raw is LocatorSidecar {
  if (typeof raw !== "object" || raw === null) return false;
  const r = raw as Record<string, unknown>;
  return (
    r["snapshotId"] === snapshotId &&
    typeof r["url"] === "string" &&
    typeof r["locators"] === "object" &&
    r["locators"] !== null
  );
}

// Sidecar for a snapshot; null for offline MVP snapshots (no sidecar).
export async function loadLocators(
  snapshotId: string,
  options: RefStoreOptions = {},
): Promise<LocatorSidecar | null> {
  if (!isValidSnapshotId(snapshotId)) return null;
  const mem = memSidecars.get(snapshotId);
  if (mem !== undefined) return mem;
  const raw = await readJsonFile(locatorsPath(agentDirOf(options), snapshotId));
  return isLocatorSidecar(raw, snapshotId) ? raw : null;
}

// Same stale checks as resolve(), plus the element's locator.
export async function resolveLocator(
  snapshotId: string,
  ref: string,
  options: RefStoreOptions = {},
): Promise<{ element: SnapshotElement; locator: Locator }> {
  const element = await resolve(snapshotId, ref, options);
  const sidecar = await loadLocators(snapshotId, options);
  const stored = sidecar !== null && Object.hasOwn(sidecar.locators, ref) ? sidecar.locators[ref] : undefined;
  if (stored !== undefined) return { element, locator: stored };
  // Fallback: occurrence among same role+name in snapshot order.
  const snapshot = await load(snapshotId, options);
  let occurrence = 0;
  for (const entry of snapshot?.elements ?? []) {
    if (entry.ref === ref) break;
    if (entry.role === element.role && entry.name === element.name) occurrence++;
  }
  return { element, locator: { role: element.role, name: element.name, occurrence } };
}
