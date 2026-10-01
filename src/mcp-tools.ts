// MCP tool table (spec 006, T001-T003). Thin adapter: every handler calls the shared ops layer
// (src/ops.ts, src/cli-screens.ts); no browser, gate or ref logic lives here.
// Page content is untrusted: descriptions are static strings, results echo only what ops prints.
import type { Backend } from "./backend.js";
import { agentPath } from "./backend.js";
import { NO_INPUT_LINE, runScreenView, runSemanticAct, runSemanticClick, runSemanticFill } from "./cli-screens.js";
import type { ScreenSource, SemanticContext } from "./cli-screens.js";
import { PwaNavError } from "./errors.js";
import {
  parseActOp,
  performAct,
  performClick,
  performExtract,
  performFill,
  performLiveSnapshot,
  performOpen,
} from "./ops.js";
import type { ActOp } from "./ops.js";
import { latestSnapshotId, load as loadSnapshot } from "./refs.js";
import { isSemanticToken } from "./screen-resolve.js";

/** Max extract lines returned inline; the rest stays in the snapshot file. */
export const EXTRACT_INLINE_CAP = 100;

export interface BackendRequest {
  armed: boolean;
  launch?: boolean;
}
export type BackendFactory = (request: BackendRequest) => Backend;

export interface ToolContext {
  backendFactory: BackendFactory;
  /** Operator-level (CLI flag / env). Never a tool argument. */
  armed: boolean;
  mode: "offline" | "bidi";
  screens: ScreenSource;
}

export interface ToolOutcome {
  /** Overrides the captured ops output (console.log lines) when set. */
  text?: string;
  structured: Record<string, unknown>;
}

export interface ToolAnnotations {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  openWorldHint: boolean;
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: ToolAnnotations;
  handler: (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolOutcome>;
}

const TARGET_PATTERN = "^@[a-z0-9]+(-[a-z0-9]+)*$";

const TARGET_PROP = {
  type: "string",
  pattern: TARGET_PATTERN,
  description: "Semantic target from the screen map, such as @sign-in. Use instead of snapshotId + ref.",
};
const SNAPSHOT_ID_PROP = { type: "string", minLength: 1, description: "snapshotId of the snapshot the ref belongs to." };
const REF_PROP = { type: "string", minLength: 1, description: "Element ref (eN) from that snapshot." };

// Either a semantic target or snapshotId + ref (exclusivity is enforced by the handler).
// Properties are repeated as `true` so Ajv strictRequired accepts the subschemas.
const TARGET_ALTERNATIVES = [
  { required: ["target"], properties: { target: true } },
  { required: ["snapshotId", "ref"], properties: { snapshotId: true, ref: true } },
];

export const ACTION_HINTS: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: true,
  idempotentHint: false,
  openWorldHint: true,
};

export function invalid(message: string): PwaNavError {
  return new PwaNavError("invalid_args", message);
}

function isDryRun(ctx: ToolContext): boolean {
  return ctx.mode === "bidi" && !ctx.armed;
}

export function semanticContext(ctx: ToolContext, backend: Backend): SemanticContext {
  if (ctx.mode === "offline") {
    throw invalid("semantic targets need the live backend (--backend bidi).");
  }
  return { ...ctx.screens, backend, armed: ctx.armed };
}

// Structured result of an action: the newest snapshot id plus the shared machine fields.
export async function actionOutcome(ctx: ToolContext, backend: Backend, snapshotId: string | null): Promise<ToolOutcome> {
  const id = snapshotId ?? (await latestSnapshotId({ agentDir: backend.agentDir }));
  const snapshot = id === null ? null : await loadSnapshot(id, { agentDir: backend.agentDir });
  return {
    structured: {
      dryRun: isDryRun(ctx),
      ...(id === null ? {} : { snapshotId: id }),
      path: agentPath(backend.agentDir, "snapshot.json"),
      ...(snapshot === null ? {} : { url: snapshot.url }),
    },
  };
}

function str(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" ? value : undefined;
}

function flag(args: Record<string, unknown>, key: string): boolean {
  return args[key] === true;
}

function noInputNote(ctx: ToolContext): void {
  if (isDryRun(ctx)) console.log(NO_INPUT_LINE);
}

// Either a semantic target or snapshotId + ref; never both, never neither.
function pickTarget(args: Record<string, unknown>): { target: string } | { snapshotId: string; ref: string } {
  const target = str(args, "target");
  const snapshotId = str(args, "snapshotId");
  const ref = str(args, "ref");
  if (target !== undefined) {
    if (snapshotId !== undefined || ref !== undefined) {
      throw invalid("pass either target or snapshotId + ref, not both.");
    }
    return { target };
  }
  if (snapshotId === undefined || ref === undefined) {
    throw invalid("pass target (@id) or both snapshotId and ref.");
  }
  return { snapshotId, ref };
}

const open: ToolDef = {
  name: "pwa_open",
  description:
    "Navigate the PWA window to a URL. The origin must be on the allow-list, or pass allowOrigin: true to consent to it.",
  inputSchema: {
    type: "object",
    properties: {
      url: { type: "string", minLength: 1, description: "http(s) URL to open." },
      launch: { type: "boolean", description: "Start the PWA runtime with the debugging port if nothing listens." },
      allowOrigin: { type: "boolean", description: "Add this URL's origin to the allow-list after a successful navigation." },
    },
    required: ["url"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  async handler(args, ctx) {
    const url = str(args, "url") ?? "";
    const launch = flag(args, "launch");
    const allowOrigin = flag(args, "allowOrigin");
    if (ctx.mode === "offline" && (launch || allowOrigin)) {
      throw invalid("launch and allowOrigin require the live backend (--backend bidi).");
    }
    const backend = ctx.backendFactory({ armed: false, ...(launch ? { launch: true } : {}) });
    const session = await performOpen(url, { backend, allowOrigin });
    return { structured: { url: session.url, path: agentPath(backend.agentDir, "session.json") } };
  },
};

const snapshot: ToolDef = {
  name: "pwa_snapshot",
  description:
    "Collect the page's interactive elements into the snapshot file and return its path and element count (never the elements). " +
    "With screen: true, return the compact view of the mapped screen for the current URL instead.",
  inputSchema: {
    type: "object",
    properties: {
      all: { type: "boolean", description: "Full tree (headings, images) instead of interactive elements only." },
      screen: { type: "boolean", description: "Return the compact screen-map view inline instead of collecting a snapshot." },
    },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async handler(args, ctx) {
    const all = flag(args, "all");
    const screen = flag(args, "screen");
    if (all && screen) throw invalid("screen and all are mutually exclusive.");
    const backend = ctx.backendFactory({ armed: false });
    if (screen) {
      await runScreenView(backend, ctx.screens);
      return { structured: { screen: true } };
    }
    const taken = await performLiveSnapshot(backend, { includeAll: all });
    return {
      structured: {
        snapshotId: taken.snapshotId,
        path: agentPath(backend.agentDir, "snapshot.json"),
        elementCount: taken.elements.length,
        url: taken.url,
      },
    };
  },
};

const click: ToolDef = {
  name: "pwa_click",
  description:
    "Click an element by snapshotId + ref, or by semantic target (@id). Dry-run unless the server operator armed it; " +
    "the result then says no input was sent.",
  inputSchema: {
    type: "object",
    properties: { snapshotId: SNAPSHOT_ID_PROP, ref: REF_PROP, target: TARGET_PROP },
    anyOf: TARGET_ALTERNATIVES,
    additionalProperties: false,
  },
  annotations: ACTION_HINTS,
  async handler(args, ctx) {
    const picked = pickTarget(args);
    const backend = ctx.backendFactory({ armed: ctx.armed });
    if ("target" in picked) {
      await runSemanticClick(semanticContext(ctx, backend), picked.target.slice(1));
      return actionOutcome(ctx, backend, null);
    }
    const next = await performClick(picked.snapshotId, picked.ref, { backend, armed: ctx.armed });
    noInputNote(ctx);
    return actionOutcome(ctx, backend, next);
  },
};

const fill: ToolDef = {
  name: "pwa_fill",
  description:
    "Fill a field by snapshotId + ref, or by semantic target (@id). Sensitive fields (passwords) are refused. " +
    "Dry-run unless the server operator armed it.",
  inputSchema: {
    type: "object",
    properties: {
      snapshotId: SNAPSHOT_ID_PROP,
      ref: REF_PROP,
      target: TARGET_PROP,
      text: { type: "string", description: "Text to type." },
    },
    required: ["text"],
    anyOf: TARGET_ALTERNATIVES,
    additionalProperties: false,
  },
  annotations: ACTION_HINTS,
  async handler(args, ctx) {
    const picked = pickTarget(args);
    const text = str(args, "text") ?? "";
    const backend = ctx.backendFactory({ armed: ctx.armed });
    if ("target" in picked) {
      await runSemanticFill(semanticContext(ctx, backend), picked.target.slice(1), text);
      return actionOutcome(ctx, backend, null);
    }
    const next = await performFill(picked.snapshotId, picked.ref, text, { backend, armed: ctx.armed });
    noInputNote(ctx);
    return actionOutcome(ctx, backend, next);
  },
};

// ops + inputs -> the CLI token list (flow inputs follow their flow token as key=value).
function actTokens(ops: readonly string[], inputs: Record<string, string> | undefined): string[] {
  const pairs = Object.entries(inputs ?? {}).map(([key, value]) => `${key}=${value}`);
  if (pairs.length === 0) return [...ops];
  const flows = ops.filter((op) => op.startsWith("flow:"));
  if (flows.length !== 1) {
    throw invalid("inputs requires exactly one flow:<id> op.");
  }
  return ops.flatMap((op) => (op.startsWith("flow:") ? [op, ...pairs] : [op]));
}

const act: ToolDef = {
  name: "pwa_act",
  description:
    "Run several ops in one session. Plain ops with snapshotId: click:<ref>, fill:<ref>=<text>. " +
    "Semantic ops without snapshotId: click:@id, fill:@id=<text>, flow:<id> with inputs. Do not mix the two. " +
    "Dry-run unless the server operator armed it; human-only flows are refused.",
  inputSchema: {
    type: "object",
    properties: {
      snapshotId: SNAPSHOT_ID_PROP,
      ops: { type: "array", minItems: 1, items: { type: "string", minLength: 1 }, description: "Ops in order." },
      inputs: {
        type: "object",
        additionalProperties: { type: "string" },
        description: "Flow inputs (key: value) for the single flow:<id> op.",
      },
    },
    required: ["ops"],
    additionalProperties: false,
  },
  annotations: ACTION_HINTS,
  async handler(args, ctx) {
    const ops = (args["ops"] as string[]).slice();
    const inputs = args["inputs"] as Record<string, string> | undefined;
    const snapshotId = str(args, "snapshotId");
    const backend = ctx.backendFactory({ armed: ctx.armed });
    if (ops.some(isSemanticToken)) {
      if (snapshotId !== undefined) {
        throw invalid("snapshotId is not used with semantic ops (they resolve on a fresh snapshot).");
      }
      await runSemanticAct(semanticContext(ctx, backend), actTokens(ops, inputs));
      return actionOutcome(ctx, backend, null);
    }
    if (snapshotId === undefined) throw invalid("missing snapshotId (plain ops need one).");
    if (inputs !== undefined && Object.keys(inputs).length > 0) throw invalid("inputs only applies to flow:<id> ops.");
    const parsed: ActOp[] = ops.map((token, index) => {
      try {
        return parseActOp(token);
      } catch {
        // The token may carry typed text: report its position only.
        throw invalid(`invalid op at ops[${index.toString()}] (expected click:<ref> or fill:<ref>=<text>).`);
      }
    });
    const next = await performAct(snapshotId, parsed, { backend, armed: ctx.armed });
    noInputNote(ctx);
    return actionOutcome(ctx, backend, next);
  },
};

const extract: ToolDef = {
  name: "pwa_extract",
  description:
    `Read-only: list text or links from a stored snapshot (at most ${EXTRACT_INLINE_CAP.toString()} lines inline; ` +
    "the rest stays in the snapshot file). Never changes the snapshot.",
  inputSchema: {
    type: "object",
    properties: {
      snapshotId: SNAPSHOT_ID_PROP,
      mode: { enum: ["text", "links"], description: "text: named elements and values; links: links and buttons." },
      limit: { type: "integer", minimum: 1, maximum: EXTRACT_INLINE_CAP, description: "Max lines to return." },
    },
    required: ["snapshotId", "mode"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async handler(args, ctx) {
    const snapshotId = str(args, "snapshotId") ?? "";
    const mode = args["mode"] === "links" ? "links" : "text";
    const limit = typeof args["limit"] === "number" ? args["limit"] : EXTRACT_INLINE_CAP;
    const backend = ctx.backendFactory({ armed: false });
    const lines = await performExtract(snapshotId, mode, { backend });
    const shown = lines.slice(0, limit);
    const omitted = lines.length - shown.length;
    const text = [
      ...shown,
      ...(omitted > 0 ? [`… ${omitted.toString()} more omitted, see ${agentPath(backend.agentDir, "snapshot.json")}`] : []),
    ].join("\n");
    return { text: text === "" ? "0 lines" : text, structured: { total: lines.length, returned: shown.length, omitted } };
  },
};

export const TOOLS: readonly ToolDef[] = [open, snapshot, click, fill, extract, act];
