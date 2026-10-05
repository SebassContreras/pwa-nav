// MCP tool table (spec 006, T001-T003, spec 012). Thin adapter: every handler calls the shared tools layer
// (src/tools/); no browser, gate or ref logic lives here.
// Page content is untrusted: descriptions are static strings, results echo only what tools print.
import type { Backend } from "../backend/backend.js";
import {
  ACTION_HINTS,
  actionOutcome,
  actTool,
  authTool as runAuthTool,
  clickTool,
  extractTool,
  findTool as runFindTool,
  invalid,
  isDryRun,
  learnTool as runLearnTool,
  openTool,
  READONLY_HINTS,
  screenshotTool as runScreenshotTool,
  snapshotTool,
  uploadTool,
  waitTool as runWaitTool,
  fillTool,
  type BackendFactory,
  type ScreenSource,
  type SemanticContext,
  type ToolAnnotations,
  type ToolContext,
  type ToolOutcome,
} from "../tools/index.js";

export {
  ACTION_HINTS,
  actionOutcome,
  invalid,
  isDryRun,
  READONLY_HINTS,
  type BackendFactory,
  type ScreenSource,
  type SemanticContext,
  type ToolAnnotations,
  type ToolContext,
  type ToolOutcome,
};

export const EXTRACT_INLINE_CAP = 100;

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

const TARGET_ALTERNATIVES = [
  { required: ["target"], properties: { target: true } },
  { required: ["ref"], properties: { ref: true, snapshotId: true } },
];

export function semanticContext(ctx: ToolContext, backend: Backend): SemanticContext {
  if (ctx.mode === "offline") {
    throw invalid("semantic targets need the live backend (--backend bidi).");
  }
  return { ...ctx.screens, backend, armed: ctx.armed };
}

function str(args: Record<string, unknown>, key: string): string | undefined {
  const value = args[key];
  return typeof value === "string" ? value : undefined;
}

function flag(args: Record<string, unknown>, key: string): boolean {
  return args[key] === true;
}

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
    if (ref.startsWith("@")) {
      return { target: ref };
    }
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
    return openTool({ url, launch, allowOrigin }, ctx);
  },
};

const snapshot: ToolDef = {
  name: "pwa_snapshot",
  description:
    "MANDATORY FIRST STEP & STATE INSPECTION: Inspect the active PWA window in text (DOM/accessibility tree). " +
    "DO NOT take screenshots to discover elements; use this tool instead (preserves tokens and supports text-only agents).\n" +
    "- Automatically updates and syncs screens/<app>.screens.json on every call, nesting opened dialogs/modals directly into actions.\n" +
    "- Use mode screen: true to return the compact screen-map view with semantic @id targets inline.\n" +
    "- Optional filters: query, role. Optional modes: screen (view only), learn (force re-learn).",
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
    return snapshotTool(
      {
        all: flag(args, "all"),
        screen: flag(args, "screen"),
        learn: flag(args, "learn"),
        query: str(args, "query"),
        role: str(args, "role"),
        locale: str(args, "locale"),
        appId: str(args, "appId"),
        appName: str(args, "appName"),
        access: str(args, "access"),
        prune: flag(args, "prune"),
      },
      ctx,
    );
  },
};

const click: ToolDef = {
  name: "pwa_click",
  description:
    "Click a button, link, or tab by semantic target (@id), visible text, or ref (eN). " +
    "Sensitive buttons (such as checkout/payment) are refused. Direct live execution on the browser (armed by default).",
  inputSchema: {
    type: "object",
    properties: {
      snapshotId: SNAPSHOT_ID_PROP,
      ref: REF_PROP,
      target: TARGET_PROP,
    },
    anyOf: TARGET_ALTERNATIVES,
    additionalProperties: false,
  },
  annotations: ACTION_HINTS,
  async handler(args, ctx) {
    const picked = pickTarget(args);
    if ("target" in picked) {
      return clickTool({ target: picked.target, dryRun: isDryRun(ctx) }, ctx);
    }
    return clickTool({ ref: picked.ref, snapshotId: picked.snapshotId, dryRun: isDryRun(ctx) }, ctx);
  },
};

const fill: ToolDef = {
  name: "pwa_fill",
  description:
    "Fill a field or search box by semantic target (@id), visible text, or ref (eN). " +
    "To search on the current page, fill the search input here instead of calling pwa_open. " +
    "Sensitive fields (passwords) are refused. Direct live execution on the browser (armed by default).",
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
    if ("target" in picked) {
      return fillTool({ target: picked.target, text, dryRun: isDryRun(ctx) }, ctx);
    }
    return fillTool({ ref: picked.ref, text, snapshotId: picked.snapshotId, dryRun: isDryRun(ctx) }, ctx);
  },
};

const upload: ToolDef = {
  name: "pwa_upload",
  description:
    "Upload one or more local files to a file input (<input type=\"file\">) by semantic target (@id), visible text, or ref (eN). " +
    "Files must be inside allowed directories (workspace or .agent/). Direct live execution on the browser (armed by default).",
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
    if ("target" in picked) {
      return uploadTool({ target: picked.target, files, dryRun: isDryRun(ctx) }, ctx);
    }
    return uploadTool({ ref: picked.ref, files, snapshotId: picked.snapshotId, dryRun: isDryRun(ctx) }, ctx);
  },
};

const screenshotToolDef: ToolDef = {
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
      path: {
        type: "string",
        description: "Optional destination path for the screenshot PNG (alias for outPath).",
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
    const outPath = str(args, "outPath") ?? str(args, "path");
    const rawFormat = str(args, "format");
    let format: "png" | "jpeg" | "webp" | undefined;
    if (rawFormat === "png" || rawFormat === "jpeg" || rawFormat === "webp") {
      format = rawFormat;
    }
    return runScreenshotTool({ outPath, format }, ctx);
  },
};

const extract: ToolDef = {
  name: "pwa_extract",
  description:
    "Read-only: dump formatted element list or page links from a snapshot for reading. " +
    "DO NOT USE TO FIND BUTTONS OR INPUTS TO CLICK/FILL: use 'pwa_find' instead. " +
    "Supports offset pagination. snapshotId is optional and defaults to the latest snapshot.",
  inputSchema: {
    type: "object",
    properties: {
      snapshotId: SNAPSHOT_ID_PROP,
      mode: { enum: ["all", "text", "links"], description: "all: all matching elements; text: named elements and values; links: links and buttons." },
      query: { type: "string", description: "Case-insensitive substring to filter element name, value, or ref." },
      role: { type: "string", description: "Filter elements by role (e.g. 'button', 'textbox', 'link')." },
      offset: { type: "integer", minimum: 0, description: "Starting element offset for pagination (default: 0)." },
      limit: { type: "integer", minimum: 1, maximum: EXTRACT_INLINE_CAP, description: `Max lines to return (default: ${EXTRACT_INLINE_CAP.toString()}).` },
    },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async handler(args, ctx) {
    const snapshotId = str(args, "snapshotId");
    const rawMode = args["mode"];
    const mode = rawMode === "links" ? "links" : rawMode === "text" ? "text" : "all";
    const query = str(args, "query");
    const role = str(args, "role");
    const offset = typeof args["offset"] === "number" ? Math.max(0, args["offset"]) : 0;
    const limit = typeof args["limit"] === "number" ? Math.min(EXTRACT_INLINE_CAP, Math.max(1, args["limit"])) : EXTRACT_INLINE_CAP;
    return extractTool({ snapshotId, mode, query, role, offset, limit }, ctx);
  },
};

const findToolDef: ToolDef = {
  name: "pwa_find",
  description:
    "PRIMARY ELEMENT LOCATOR: Find buttons, textboxes, placeholders, links, or modal controls in the page snapshot. " +
    "Searches across element name, value, placeholder (including rich contenteditable editors), dialog, and container. " +
    "Pass inDialog: true to target the active modal/popup. Always use this instead of pwa_extract when looking for elements to interact with.",
  inputSchema: {
    type: "object",
    properties: {
      snapshotId: SNAPSHOT_ID_PROP,
      query: { type: "string", description: "Case-insensitive search term (matches name, placeholder, value, dialog title, ref)." },
      role: { type: "string", description: "Filter elements by role (e.g. 'textbox', 'button', 'link')." },
      inDialog: { type: "boolean", description: "When true, returns only elements inside the active modal/dialog." },
      offset: { type: "integer", minimum: 0, description: "Starting offset for pagination (default: 0)." },
      limit: { type: "integer", minimum: 1, maximum: EXTRACT_INLINE_CAP, description: `Max lines to return (default: ${EXTRACT_INLINE_CAP.toString()}).` },
    },
    additionalProperties: false,
  },
  annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  async handler(args, ctx) {
    const snapshotId = str(args, "snapshotId");
    const query = str(args, "query");
    const role = str(args, "role");
    const inDialog = args["inDialog"] === true;
    const offset = typeof args["offset"] === "number" ? Math.max(0, args["offset"]) : 0;
    const limit = typeof args["limit"] === "number" ? Math.min(EXTRACT_INLINE_CAP, Math.max(1, args["limit"])) : EXTRACT_INLINE_CAP;
    return runFindTool({ snapshotId, query, role, inDialog, offset, limit }, ctx);
  },
};

const act: ToolDef = {
  name: "pwa_act",
  description:
    "Run several ops in one session (ideal for search: fill search input + click search button, or submitting forms). " +
    "Semantic ops without snapshotId: click:@id, fill:@id=<text>, upload:@id=<path>, flow:<id> with inputs. " +
    "Plain ops with snapshotId: click:<ref>, fill:<ref>=<text>, upload:<ref>=<path>. Do not mix the two. " +
    "Direct live execution on the browser (armed by default); human-only flows are refused.",
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
    return actTool({ ops, inputs, snapshotId, dryRun: isDryRun(ctx) }, ctx);
  },
};

const learnToolDef: ToolDef = {
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
    return runLearnTool({ locale, appId, appName, access, prune }, ctx);
  },
};

const waitToolDef: ToolDef = {
  name: "pwa_wait",
  description:
    "Wait for a specific UI element, state change, or background async process (e.g. AI answer, fast research, audio generation) to complete. " +
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
    return runWaitTool({ target, query, state, timeoutMs, intervalMs }, ctx);
  },
};

const authToolDef: ToolDef = {
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
    return runAuthTool({ action, app });
  },
};



export const TOOLS: readonly ToolDef[] = [
  open,
  authToolDef,
  snapshot,
  click,
  fill,
  upload,
  screenshotToolDef,
  extract,
  findToolDef,
  act,
  learnToolDef,
  waitToolDef,
];
