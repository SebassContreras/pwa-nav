// MCP tool table (spec 006, T001-T003). Thin adapter: every handler calls the shared ops layer
// (src/ops.ts, src/cli-screens.ts); no browser, gate or ref logic lives here.
// Page content is untrusted: descriptions are static strings, results echo only what ops prints.
import { resolve } from "node:path";
import type { Backend } from "../backend/backend.js";
import { agentPath } from "../backend/backend.js";
import { NO_INPUT_LINE, runLearn, runScreenView, runSemanticAct, runSemanticClick, runSemanticFill, runSemanticUpload } from "../cli/cli-screens.js";
import type { ScreenSource, SemanticContext } from "../cli/cli-screens.js";
import { PwaNavError } from "../core/errors.js";
import {
  parseActOp,
  performAct,
  performAuthRelay,
  performClick,
  performExtractDetailed,
  performFill,
  performLiveSnapshot,
  performOpen,
  performScreenshot,
  performUpload,
  performWait,
} from "../ops/ops.js";
import type { ActOp } from "../ops/ops.js";
import { latestSnapshotId, load as loadSnapshot } from "../core/refs.js";
import { isSemanticToken } from "../screens/screen-resolve.js";
import { isLoginBarrier } from "../browser/pwa-runtime.js";

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
  description: "Semantic target from the screen map, such as @sign-in. Use instead of ref.",
};
const SNAPSHOT_ID_PROP = { type: "string", description: "Optional snapshotId. Defaults to the latest snapshot." };
const REF_PROP = { type: "string", minLength: 1, description: "Element ref (eN) or visible text from the snapshot." };

// Either a target or ref (snapshotId is optional and defaults to latest snapshot).
const TARGET_ALTERNATIVES = [
  { required: ["target"], properties: { target: true } },
  { required: ["ref"], properties: { ref: true, snapshotId: true } },
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
      path: resolve(agentPath(backend.agentDir, "snapshot.json")),
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

// Either a target or ref; snapshotId is optional.
function pickTarget(args: Record<string, unknown>): { target: string } | { snapshotId?: string; ref: string } {
  const target = str(args, "target");
  const snapshotId = str(args, "snapshotId");
  const ref = str(args, "ref");
  if (target !== undefined) {
    if (ref !== undefined) {
      throw invalid("pass either target or ref, not both.");
    }
    return { target };
  }
  if (ref !== undefined) {
    return { ...(snapshotId !== undefined ? { snapshotId } : {}), ref };
  }
  throw invalid("pass target (@id or visible text) or ref (eN).");
}

const open: ToolDef = {
  name: "pwa_open",
  description:
    "Navigate the PWA window to a new URL. CRITICAL: The user's PWA is already open and loaded with their app. " +
    "Do NOT call pwa_open to perform searches or browse. To search or interact within the app, use pwa_snapshot first " +
    "to inspect the page, then use pwa_fill and pwa_click on in-page inputs.",
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
    const barrier = isLoginBarrier(session.url);
    return {
      structured: {
        url: session.url,
        path: resolve(agentPath(backend.agentDir, "session.json")),
        ...(barrier
          ? {
              loginBarrier: true,
              hint: "Login barrier detected (e.g. Google accounts login). Use pwa_auth({ action: 'clean' }) to switch to clean mode for manual user login, then pwa_auth({ action: 'debug' }) to resume automation.",
            }
          : {}),
      },
    };
  },
};

const snapshot: ToolDef = {
  name: "pwa_snapshot",
  description:
    "MANDATORY FIRST STEP & STATE INSPECTION: Inspect the active PWA window in text (DOM/accessibility tree). " +
    "DO NOT take screenshots to discover elements; use this tool instead (preserves tokens and supports text-only agents).\n" +
    "- { screen: true } -> Return compact screen-map view with semantic @id targets, flows, and journeys.\n" +
    "- { learn: true } -> Learn the current screen into screens/<app>.screens.json (generates permanent @id targets).\n" +
    "- default (no flags) -> Collect raw interactive elements into .agent/snapshot.json and return its count and snapshotId.",
  inputSchema: {
    type: "object",
    properties: {
      all: { type: "boolean", description: "Full tree (headings, images) instead of interactive elements only." },
      screen: { type: "boolean", description: "Return the compact screen-map view inline instead of collecting a snapshot." },
      learn: { type: "boolean", description: "Learn current screen into screens/<app>.screens.json (eliminates expiring eN refs)." },
      query: { type: "string", description: "Optional substring filter to return matching elements inline in the output." },
      role: { type: "string", description: "Optional role filter (e.g. 'button', 'textbox') to return matching elements." },
      locale: { type: "string", description: "BCP 47 tag (e.g. 'es' or 'en') for new map. Defaults to 'es'." },
      appId: { type: "string", description: "Optional lowercase app ID slug (e.g. 'mercadona')." },
      appName: { type: "string", description: "Optional human-readable app name." },
      access: { enum: ["public", "authenticated", "unknown"], description: "Screen access level (default: public)." },
      prune: { type: "boolean", description: "Prune missing elements from existing map (default: false)." },
    },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async handler(args, ctx) {
    const all = flag(args, "all");
    const screen = flag(args, "screen");
    const learn = flag(args, "learn");
    if ([all, screen, learn].filter(Boolean).length > 1) {
      throw invalid("screen, learn, and all are mutually exclusive.");
    }
    const backend = ctx.backendFactory({ armed: false });
    if (learn) {
      const locale = str(args, "locale") ?? "es";
      const appId = str(args, "appId");
      const appName = str(args, "appName");
      const access = str(args, "access");
      const prune = flag(args, "prune");
      const res = await runLearn(backend, {
        outPath: agentPath(backend.agentDir, "snapshot.json"),
        prune,
        locale,
        ...(appId === undefined ? {} : { appId }),
        ...(appName === undefined ? {} : { appName }),
        ...(access === undefined ? {} : { access }),
        ...ctx.screens,
      });
      const textLines = [
        `learned screen "${res.title}" with ${res.targets.length.toString()} targets: ${res.targets.join(", ")}`,
        `screen map: ${res.path} (${res.written ? "written" : "unchanged"})`,
      ];
      return {
        text: textLines.join("\n"),
        structured: {
          learned: true,
          path: resolve(agentPath(backend.agentDir, "snapshot.json")),
          mapPath: res.path,
          screenId: res.screenId,
          title: res.title,
          targets: res.targets,
        },
      };
    }
    if (screen) {
      await runScreenView(backend, ctx.screens);
      return { structured: { screen: true, path: resolve(agentPath(backend.agentDir, "snapshot.json")) } };
    }
    const query = str(args, "query");
    const role = str(args, "role");
    const taken = await performLiveSnapshot(backend, { includeAll: all, query, role });
    const barrier = isLoginBarrier(taken.url);
    const hasFilter = query !== undefined || role !== undefined;
    const matchLines = hasFilter
      ? taken.elements
          .slice(0, 50)
          .map((e) => `${e.ref} ${e.role}${e.disabled === true ? " [disabled]" : ""} "${e.name}"${e.value ? `: ${e.value}` : ""}`)
      : [];
    const textOut = hasFilter
      ? `${taken.elements.length.toString()} matches:\n${matchLines.join("\n")}${taken.elements.length > 50 ? `\n… and ${(taken.elements.length - 50).toString()} more` : ""}`
      : undefined;
    return {
      ...(textOut !== undefined ? { text: textOut } : {}),
      structured: {
        snapshotId: taken.snapshotId,
        path: resolve(agentPath(backend.agentDir, "snapshot.json")),
        elementCount: taken.elements.length,
        url: taken.url,
        ...(hasFilter ? { matches: taken.elements.slice(0, 50) } : {}),
        ...(barrier
          ? {
              loginBarrier: true,
              hint: "Login barrier detected (e.g. Google accounts login). Use pwa_auth({ action: 'clean' }) to switch to clean mode for manual user login, then pwa_auth({ action: 'debug' }) to resume automation.",
            }
          : {}),
      },
    };
  },
};

const click: ToolDef = {
  name: "pwa_click",
  description:
    "Click an element by semantic target (@id), visible text ('Sign in'), or ref (eN). " +
    "Dry-run unless the server operator armed it; the result then says no input was sent.",
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
      if (picked.target.startsWith("@")) {
        await runSemanticClick(semanticContext(ctx, backend), picked.target.slice(1));
        return actionOutcome(ctx, backend, null);
      }
      const next = await performClick(undefined, picked.target, { backend, armed: ctx.armed });
      noInputNote(ctx);
      return actionOutcome(ctx, backend, next);
    }
    const next = await performClick(picked.snapshotId, picked.ref, { backend, armed: ctx.armed });
    noInputNote(ctx);
    return actionOutcome(ctx, backend, next);
  },
};

const fill: ToolDef = {
  name: "pwa_fill",
  description:
    "Fill a field or search box by semantic target (@id), visible text, or ref (eN). " +
    "To search on the current page, fill the search input here instead of calling pwa_open. " +
    "Sensitive fields (passwords) are refused. Dry-run unless the server operator armed it.",
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
      if (picked.target.startsWith("@")) {
        await runSemanticFill(semanticContext(ctx, backend), picked.target.slice(1), text);
        return actionOutcome(ctx, backend, null);
      }
      const next = await performFill(undefined, picked.target, text, { backend, armed: ctx.armed });
      noInputNote(ctx);
      return actionOutcome(ctx, backend, next);
    }
    const next = await performFill(picked.snapshotId, picked.ref, text, { backend, armed: ctx.armed });
    noInputNote(ctx);
    return actionOutcome(ctx, backend, next);
  },
};

const upload: ToolDef = {
  name: "pwa_upload",
  description:
    "Upload one or more local files to a file input (<input type=\"file\">) by semantic target (@id), visible text, or ref (eN). " +
    "Files must be inside allowed directories (workspace or .agent/). Dry-run unless the server operator armed it.",
  inputSchema: {
    type: "object",
    properties: {
      snapshotId: SNAPSHOT_ID_PROP,
      ref: REF_PROP,
      target: TARGET_PROP,
      files: {
        type: "array",
        items: { type: "string", minLength: 1 },
        minItems: 1,
        description: "Local file paths to upload.",
      },
      file: {
        type: "string",
        minLength: 1,
        description: "Single local file path to upload (convenience alias for files: [path]).",
      },
    },
    anyOf: TARGET_ALTERNATIVES,
    additionalProperties: false,
  },
  annotations: ACTION_HINTS,
  async handler(args, ctx) {
    const picked = pickTarget(args);
    const rawFiles = args["files"];
    const rawFile = args["file"];
    let files: string[] = [];
    if (Array.isArray(rawFiles) && rawFiles.length > 0) {
      files = rawFiles.filter((f): f is string => typeof f === "string" && f.length > 0);
    } else if (typeof rawFile === "string" && rawFile.length > 0) {
      files = [rawFile];
    } else {
      throw invalid("missing files (expected string array 'files' or string 'file').");
    }
    const backend = ctx.backendFactory({ armed: ctx.armed });
    if ("target" in picked) {
      if (picked.target.startsWith("@")) {
        await runSemanticUpload(semanticContext(ctx, backend), picked.target.slice(1), files);
        return actionOutcome(ctx, backend, null);
      }
      const next = await performUpload(undefined, picked.target, files, { backend, armed: ctx.armed });
      noInputNote(ctx);
      return actionOutcome(ctx, backend, next);
    }
    const next = await performUpload(picked.snapshotId, picked.ref, files, { backend, armed: ctx.armed });
    noInputNote(ctx);
    return actionOutcome(ctx, backend, next);
  },
};

const screenshotTool: ToolDef = {
  name: "pwa_screenshot",
  description:
    "DO NOT USE FOR NAVIGATION, DISCOVERY, OR STATE INSPECTION. " +
    "Capture a visual screenshot ONLY when explicitly requested by the user. " +
    "Many agents cannot process images, and screenshots waste massive amounts of tokens. " +
    "To check if an action succeeded, discover new elements, or inspect popups/dialogs, ALWAYS call pwa_snapshot instead.",
  inputSchema: {
    type: "object",
    properties: {
      outPath: {
        type: "string",
        description: "Optional destination path for the screenshot PNG (defaults to .agent/screenshot.png).",
      },
      format: {
        enum: ["png", "jpeg", "webp"],
        description: "Image format (default: png).",
      },
    },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async handler(args, ctx) {
    const outPath = str(args, "outPath");
    const rawFormat = str(args, "format");
    let format: "png" | "jpeg" | "webp" | undefined;
    if (rawFormat === "png" || rawFormat === "jpeg" || rawFormat === "webp") {
      format = rawFormat;
    }
    const backend = ctx.backendFactory({ armed: false });
    const result = await performScreenshot({
      backend,
      ...(outPath !== undefined ? { outPath } : {}),
      ...(format !== undefined ? { format } : {}),
      quiet: true,
    });
    return {
      text: `screenshot saved to ${result.path}`,
      structured: {
        path: result.path,
        ...(result.width !== undefined ? { width: result.width } : {}),
        ...(result.height !== undefined ? { height: result.height } : {}),
      },
    };
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
    "Run several ops in one session (ideal for search: fill search input + click search button, or submitting forms). " +
    "Semantic ops without snapshotId: click:@id, fill:@id=<text>, upload:@id=<path>, flow:<id> with inputs. " +
    "Plain ops with snapshotId: click:<ref>, fill:<ref>=<text>, upload:<ref>=<path>. Do not mix the two. " +
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
    const rawOps = args["ops"];
    if (!Array.isArray(rawOps) || rawOps.length === 0) {
      throw invalid("missing ops (expected non-empty array of operations, e.g. ['click:@btn'] or ['fill:@input=text']).");
    }
    const ops = (rawOps as string[]).slice();
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
    "Read-only: list text or links from a stored snapshot (at most 200 lines inline with filters, " +
    "or 100 without; the rest stays in the snapshot file). Supports query substring filter, role filter, and offset pagination. " +
    "snapshotId is optional and defaults to the latest snapshot.",
  inputSchema: {
    type: "object",
    properties: {
      snapshotId: SNAPSHOT_ID_PROP,
      mode: { enum: ["text", "links"], description: "text: named elements and values; links: links and buttons." },
      query: { type: "string", description: "Case-insensitive substring to filter element name, value, or ref." },
      role: { type: "string", description: "Filter elements by role (e.g. 'button', 'textbox', 'link')." },
      offset: { type: "integer", minimum: 0, description: "Starting element offset for pagination (default: 0)." },
      limit: { type: "integer", minimum: 1, maximum: EXTRACT_INLINE_CAP, description: `Max lines to return (default: ${EXTRACT_INLINE_CAP.toString()}).` },
    },
    required: ["mode"],
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async handler(args, ctx) {
    const rawSnapshotId = str(args, "snapshotId");
    const mode = args["mode"] === "links" ? "links" : "text";
    const query = str(args, "query");
    const role = str(args, "role");
    const offset = typeof args["offset"] === "number" ? Math.max(0, args["offset"]) : 0;
    const limit = typeof args["limit"] === "number" ? Math.min(EXTRACT_INLINE_CAP, Math.max(1, args["limit"])) : EXTRACT_INLINE_CAP;
    const backend = ctx.backendFactory({ armed: false });
    const snapshotId = rawSnapshotId ?? (await latestSnapshotId({ agentDir: backend.agentDir })) ?? undefined;
    const detailed = await performExtractDetailed(snapshotId, mode, {
      backend,
      query,
      role,
      offset,
      limit,
    });
    const omitted = detailed.total - (detailed.offset + detailed.returned);
    const text = [
      ...detailed.lines,
      ...(omitted > 0 ? [`… ${omitted.toString()} more omitted, see ${agentPath(backend.agentDir, "snapshot.json")}`] : []),
    ].join("\n");
    return {
      text: text === "" ? "0 matching lines" : text,
      structured: {
        total: detailed.total,
        returned: detailed.returned,
        offset: detailed.offset,
        omitted: Math.max(0, omitted),
        ...(snapshotId !== undefined ? { snapshotId } : {}),
      },
    };
  },
};

const learnTool: ToolDef = {
  name: "pwa_learn",
  description:
    "Learn and register/update the active page into the persistent screen map (screens/<app>.screens.json). " +
    "This generates stable semantic @id targets (e.g. @search-input, @cart-btn) and eliminates expiring eN refs. " +
    "Call this whenever you encounter an unmapped screen (exit code 13) or when page structure changes.",
  inputSchema: {
    type: "object",
    properties: {
      locale: { type: "string", description: "BCP 47 language tag (e.g. 'es' or 'en'). Defaults to 'es' for new maps." },
      appId: { type: "string", description: "Optional lowercase app slug (e.g. 'mercadona'). Defaults to hostname." },
      appName: { type: "string", description: "Optional human-readable app name." },
      access: { enum: ["public", "authenticated", "unknown"], description: "Access level (default: public)." },
      prune: { type: "boolean", description: "Prune missing elements from existing map (default: false)." },
    },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async handler(args, ctx) {
    const locale = str(args, "locale") ?? "es";
    const appId = str(args, "appId");
    const appName = str(args, "appName");
    const access = str(args, "access");
    const prune = flag(args, "prune");
    const backend = ctx.backendFactory({ armed: false });
    const res = await runLearn(backend, {
      outPath: agentPath(backend.agentDir, "snapshot.json"),
      prune,
      locale,
      ...(appId === undefined ? {} : { appId }),
      ...(appName === undefined ? {} : { appName }),
      ...(access === undefined ? {} : { access }),
      ...ctx.screens,
    });
    const textLines = [
      `learned screen "${res.title}" with ${res.targets.length.toString()} targets: ${res.targets.join(", ")}`,
      `screen map: ${res.path} (${res.written ? "written" : "unchanged"})`,
    ];
    return {
      text: textLines.join("\n"),
      structured: {
        learned: true,
        path: agentPath(backend.agentDir, "snapshot.json"),
        mapPath: res.path,
        screenId: res.screenId,
        title: res.title,
        targets: res.targets,
        written: res.written,
      },
    };
  },
};

const waitTool: ToolDef = {
  name: "pwa_wait",
  description:
    "Wait for a DOM condition or asynchronous generation to complete in the PWA window without arbitrary shell pauses. " +
    "Crucial for waiting on background AI generation, Fast Research, video/audio rendering, modal appearance, or button enabling. " +
    "Specify target (@id, eN, visible text) OR query (substring). " +
    "State can be 'visible' (default), 'hidden' (e.g. wait for 'Generando...' notice to disappear), or 'enabled'.",
  inputSchema: {
    type: "object",
    properties: {
      target: { type: "string", description: "Semantic target (@id), element ref (eN), or visible text to watch." },
      query: { type: "string", description: "Substring of text to search for on the page." },
      state: { enum: ["visible", "hidden", "enabled"], description: "Condition to wait for (default: visible)." },
      timeoutMs: { type: "integer", minimum: 250, maximum: 60000, description: "Maximum wait time in ms (default: 15000)." },
      intervalMs: { type: "integer", minimum: 50, maximum: 5000, description: "Polling interval in ms (default: 1000)." },
    },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async handler(args, ctx) {
    const target = str(args, "target");
    const query = str(args, "query");
    const state = (str(args, "state") as "visible" | "hidden" | "enabled" | undefined) ?? "visible";
    const timeoutMs = typeof args["timeoutMs"] === "number" ? args["timeoutMs"] : undefined;
    const intervalMs = typeof args["intervalMs"] === "number" ? args["intervalMs"] : undefined;
    const backend = ctx.backendFactory({ armed: false });
    const result = await performWait(target, { backend, query, state, timeoutMs, intervalMs });
    return {
      text: `wait ok: ${state} "${target ?? query ?? ""}" (${result.elapsedMs.toString()}ms)`,
      structured: { ...result },
    };
  },
};

const authTool: ToolDef = {
  name: "pwa_auth",
  description:
    "Assisted authentication workflow for login-walled PWAs (such as Google NotebookLM) where Google or anti-bot defenses block automated login. " +
    "Action 'clean' launches the PWA without debugging flags so the user can log in manually without security blocks. " +
    "Action 'debug' re-attaches the PWA with debugging port 9222 active, preserving the logged-in session.",
  inputSchema: {
    type: "object",
    properties: {
      action: {
        enum: ["clean", "debug"],
        description: "clean: launch PWA in clean mode for manual user login. debug: relaunch in debug mode after user is logged in.",
      },
      app: {
        type: "string",
        description: "App name, slug, or URL (e.g. 'notebook'). Defaults to the installed PWA.",
      },
    },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  async handler(args) {
    const action = str(args, "action") === "debug" ? "debug" : "clean";
    const app = str(args, "app");
    const result = await performAuthRelay({ appOrUrl: app, action });
    return {
      text: result.message,
      structured: {
        status: result.status,
        message: result.message,
        ...(result.command ? { command: result.command } : {}),
        ...(result.siteId ? { siteId: result.siteId } : {}),
      },
    };
  },
};

export const TOOLS: readonly ToolDef[] = [
  open,
  authTool,
  snapshot,
  click,
  fill,
  upload,
  screenshotTool,
  extract,
  act,
  learnTool,
  waitTool,
];
