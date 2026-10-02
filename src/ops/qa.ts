// QA check runner for spec 003-qa-loop (T001).
// `qa run <check-file>` executes a JSON check step by step:
// {"steps":[{"op":"open","url":"..."}, {"op":"snapshot","input":"tree.txt"},
//           {"op":"click","ref":"e5"}, {"op":"assert-text","text":"Log in"}]}
// Step behavior reuses the shared perform layer in src/ops.ts (the same
// functions behind the open/snapshot/click/fill/extract/act CLI commands);
// assert-text uses extract-text semantics and fails the run when the text is
// absent. Each step's snapshot copy lands under .agent/evidence/<run-id>/
// plus result.json {pass, failedStep, evidenceDir}. Exit 0 on pass, 1 on fail.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { load as loadSnapshot, latestSnapshotId } from "../core/refs.js";
import {
  DEFAULT_SESSION_PATH,
  DEFAULT_SNAPSHOT_PATH,
  loadSession,
  parseActOp,
  performAct,
  performClick,
  performExtract,
  performFill,
  performOpen,
  performScreenshot,
  performSnapshot,
  type OpOptions,
} from "./ops.js";

export interface QaResult {
  pass: boolean;
  failedStep: number | null;
  evidenceDir: string;
}

export type CheckStep =
  | { op: "open"; url: string; screenshot?: boolean }
  | { op: "snapshot"; input: string | null; url: string | null; title: string | null; screenshot?: boolean }
  | { op: "click"; ref: string; screenshot?: boolean }
  | { op: "fill"; ref: string; text: string; screenshot?: boolean }
  | { op: "act"; ops: string[]; screenshot?: boolean }
  | { op: "extract"; mode: "text" | "links"; screenshot?: boolean }
  | { op: "assert-text"; text: string; screenshot?: boolean }
  | { op: "screenshot"; name?: string | null; screenshot?: boolean };

interface StepContext {
  n: number;
  evidenceDir: string;
  currentId: string | null;
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === "object" && raw !== null;
}

function requiredString(
  step: Record<string, unknown>,
  field: string,
  label: string,
): string {
  const value = step[field];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`step ${label} needs a non-empty string "${field}".`);
  }
  return value;
}

function optionalString(step: Record<string, unknown>, field: string, label: string): string | null {
  const value = step[field];
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== "string") {
    throw new Error(`step ${label} needs "${field}" to be a string.`);
  }
  return value;
}

function parseStep(raw: unknown, n: number): CheckStep {
  const label = n.toString();
  if (!isRecord(raw)) {
    throw new Error(`step ${label} must be an object like {"op":"open",...}.`);
  }
  const op = raw["op"];
  if (typeof op !== "string") {
    throw new Error(`step ${label} needs a string "op".`);
  }
  const screenshot = raw["screenshot"] === true;
  if (op === "open") {
    return { op, url: requiredString(raw, "url", label), screenshot };
  }
  if (op === "snapshot") {
    return {
      op,
      input: optionalString(raw, "input", label),
      url: optionalString(raw, "url", label),
      title: optionalString(raw, "title", label),
      screenshot,
    };
  }
  if (op === "click") {
    return { op, ref: requiredString(raw, "ref", label), screenshot };
  }
  if (op === "fill") {
    return { op, ref: requiredString(raw, "ref", label), text: requiredString(raw, "text", label), screenshot };
  }
  if (op === "act") {
    const ops = raw["ops"];
    if (!Array.isArray(ops) || ops.length === 0) {
      throw new Error(`step ${label} needs a non-empty array "ops".`);
    }
    const checked: string[] = [];
    for (const entry of ops) {
      if (typeof entry !== "string" || entry.length === 0) {
        throw new Error(`step ${label} needs "ops" to hold non-empty strings.`);
      }
      try {
        parseActOp(entry);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`step ${label}: ${message}`);
      }
      checked.push(entry);
    }
    return { op, ops: checked, screenshot };
  }
  if (op === "extract") {
    const mode = raw["mode"];
    if (mode === undefined || mode === null) {
      return { op, mode: "text", screenshot };
    }
    if (mode !== "text" && mode !== "links") {
      throw new Error(`step ${label} needs "mode" to be text|links.`);
    }
    return { op, mode, screenshot };
  }
  if (op === "assert-text") {
    return { op, text: requiredString(raw, "text", label), screenshot };
  }
  if (op === "screenshot") {
    return {
      op,
      name: optionalString(raw, "name", label),
      screenshot: true,
    };
  }
  throw new Error(
    `step ${label}: unknown op ${JSON.stringify(op)} (expected open|snapshot|click|fill|act|extract|assert-text|screenshot).`,
  );
}

function parseCheckFile(text: string, source: string): CheckStep[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new Error(`invalid JSON in check file: ${source}`);
  }
  if (!isRecord(parsed) || !Array.isArray(parsed["steps"]) || parsed["steps"].length === 0) {
    throw new Error(`check file ${source} needs {"steps": [...]} with at least one step.`);
  }
  const steps: CheckStep[] = [];
  for (let i = 0; i < parsed["steps"].length; i += 1) {
    const raw: unknown = parsed["steps"][i];
    steps.push(parseStep(raw, i + 1));
  }
  return steps;
}

function requireSnapshotId(currentId: string | null, op: string): string {
  // Refs are valid for one snapshot only; every mutating step returns the next
  // id, so the runner threads the evolving id through the check.
  if (currentId === null) {
    throw new Error(`${op} step needs a snapshot first (add a snapshot step before it).`);
  }
  return currentId;
}

async function runStep(step: CheckStep, ctx: StepContext, options: OpOptions = {}): Promise<string | null> {
  if (step.op === "open") {
    await performOpen(step.url, options);
    return ctx.currentId;
  }
  if (step.op === "snapshot") {
    // MVP has no live browser backend: a snapshot step either ingests a fresh
    // ARIA tree from "input" (same normalize+save as the snapshot command) or
    // observes the latest stored snapshot.
    if (step.input !== null && step.input.length > 0) {
      let rawTree: string;
      try {
        rawTree = await readFile(step.input, "utf8");
      } catch {
        throw new Error(`cannot read snapshot input file: ${step.input}`);
      }
      const agentDir = options.backend?.agentDir;
      const sessionPath = agentDir ? join(agentDir, "session.json") : DEFAULT_SESSION_PATH;
      const snapshotPath = agentDir ? join(agentDir, "snapshot.json") : DEFAULT_SNAPSHOT_PATH;
      const session = await loadSession(sessionPath);
      const snapshot = await performSnapshot(rawTree, {
        url: step.url ?? session?.url ?? "",
        title: step.title ?? session?.title ?? "",
        outPath: snapshotPath,
        agentDir,
      });
      return snapshot.snapshotId;
    }
    const store = { agentDir: options.backend?.agentDir ?? ".agent" };
    const latest = await latestSnapshotId(store);
    if (latest === null) {
      throw new Error('snapshot step needs an "input" file or a stored snapshot; none found.');
    }
    const stored = await loadSnapshot(latest, store);
    console.log(
      `snapshot ok (reuse): ${(stored?.elements.length ?? 0).toString()} elements (id ${latest})`,
    );
    return latest;
  }
  if (step.op === "click") {
    return performClick(requireSnapshotId(ctx.currentId, "click"), step.ref, options);
  }
  if (step.op === "fill") {
    return performFill(requireSnapshotId(ctx.currentId, "fill"), step.ref, step.text, options);
  }
  if (step.op === "act") {
    const ops = step.ops.map((token) => parseActOp(token));
    return performAct(requireSnapshotId(ctx.currentId, "act"), ops, options);
  }
  if (step.op === "extract") {
    const lines = await performExtract(requireSnapshotId(ctx.currentId, "extract"), step.mode, options);
    for (const line of lines) {
      console.log(line);
    }
    return ctx.currentId;
  }
  if (step.op === "screenshot") {
    console.log(`screenshot ok (step ${ctx.n.toString()})`);
    return ctx.currentId;
  }
  // assert-text: extract-text semantics; the run fails when the text is absent.
  // The failure names the missing text and the evidence snapshot that proves it.
  const lines = await performExtract(requireSnapshotId(ctx.currentId, "assert-text"), "text", options);
  const snapshotId = ctx.currentId ?? "";
  const found = lines.some((line) => line.includes(step.text));
  if (!found) {
    throw new Error(
      `assert-text failed: text ${JSON.stringify(step.text)} absent from snapshot ${snapshotId} (see ${ctx.evidenceDir}/step-${ctx.n.toString()}-assert-text-snapshot.json).`,
    );
  }
  console.log(`assert-text ok: ${JSON.stringify(step.text)} found in snapshot ${snapshotId}`);
  return ctx.currentId;
}

async function saveStepEvidence(
  evidenceAbs: string,
  n: number,
  step: CheckStep,
  currentId: string | null,
  options: OpOptions = {},
  forceScreenshot: boolean = false,
): Promise<void> {
  const store = { agentDir: options.backend?.agentDir ?? ".agent" };
  const op = step.op;
  if (currentId !== null) {
    const snapshot = await loadSnapshot(currentId, store);
    if (snapshot !== null) {
      await writeFile(
        join(evidenceAbs, `step-${n.toString()}-${op}-snapshot.json`),
        JSON.stringify(snapshot, null, 2) + "\n",
        "utf8",
      );
    }
  } else {
    // No snapshot context (e.g. open before any snapshot): keep the session state.
    try {
      const sessionRaw = await readFile(DEFAULT_SESSION_PATH, "utf8");
      await writeFile(join(evidenceAbs, `step-${n.toString()}-${op}-session.json`), sessionRaw, "utf8");
    } catch {
      // No session either (e.g. a failing first step): nothing to copy.
    }
  }

  const takeScreenshot = forceScreenshot || step.op === "screenshot" || step.screenshot === true;
  if (takeScreenshot) {
    const outPath = join(evidenceAbs, `step-${n.toString()}-${op}.png`);
    try {
      await performScreenshot({ ...options, outPath, quiet: true });
      if (step.op === "screenshot" && step.name) {
        const namedPath = join(evidenceAbs, `step-${n.toString()}-${op}-${step.name}.png`);
        try {
          await writeFile(namedPath, await readFile(outPath));
        } catch {
          // ignore
        }
      }
    } catch {
      // Non-fatal if offline/unsupported
    }
  }
}

async function writeResult(evidenceAbs: string, result: QaResult): Promise<void> {
  await writeFile(join(evidenceAbs, "result.json"), JSON.stringify(result, null, 2) + "\n", "utf8");
}

export async function runCheck(checkPath: string, options: OpOptions = {}): Promise<QaResult> {
  let text: string;
  try {
    text = await readFile(checkPath, "utf8");
  } catch {
    throw new Error(`cannot read check file: ${checkPath}`);
  }
  const steps = parseCheckFile(text, checkPath);
  const runId = randomUUID();
  const evidenceDir = options.backend?.agentDir
    ? join(options.backend.agentDir, "evidence", runId)
    : join(".agent", "evidence", runId);
  const evidenceAbs = resolve(evidenceDir);
  await mkdir(evidenceAbs, { recursive: true });
  let currentId: string | null = null;
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];
    const n = i + 1;
    if (step === undefined) {
      continue;
    }
    try {
      currentId = await runStep(step, { n, evidenceDir, currentId }, options);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await saveStepEvidence(evidenceAbs, n, step, currentId, options, true);
      const result: QaResult = { pass: false, failedStep: n, evidenceDir };
      await writeResult(evidenceAbs, result);
      console.error(`qa step ${n.toString()} (${step.op}) failed: ${message}`);
      console.error(`qa fail: step ${n.toString()}, evidence ${evidenceDir}`);
      return result;
    }
    await saveStepEvidence(evidenceAbs, n, step, currentId, options, false);
  }
  const result: QaResult = { pass: true, failedStep: null, evidenceDir };
  await writeResult(evidenceAbs, result);
  console.log(`qa pass: ${steps.length.toString()} steps, evidence ${evidenceDir}`);
  return result;
}
