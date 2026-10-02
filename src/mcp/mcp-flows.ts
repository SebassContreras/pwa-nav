// Flow tools + screen-map resources for the MCP server (spec 006, T005).
// One `flow_<screen>_<flow>` tool per non-humanOnly flow of the single loaded map. humanOnly flows are
// never callable: only their (slug) names are surfaced in server instructions and the resource note.
// Descriptions use only slugs plus a capped, control-stripped flow.description (map data, human-authored).
// Handlers reuse the `act flow:<id>` code path of the CLI (runSemanticAct); they never navigate.
import { createHash } from "node:crypto";
import { PwaNavError } from "../core/errors.js";
import { runSemanticAct } from "../cli/cli-screens.js";
import type { ScreenSource } from "../cli/cli-screens.js";
import { ACTION_HINTS, actionOutcome, invalid, semanticContext } from "./mcp-tools.js";
import type { ToolDef } from "./mcp-tools.js";
import { isSemanticToken } from "../screens/screen-resolve.js";
import { findScreen, loadExplicitMap, loadScreenMapsFromDir, resolveScreensDir } from "../screens/screen-match.js";
import type { ScreenMap } from "../screens/screen-map.js";

export const MAX_TOOL_NAME = 64;
export const MAX_FLOW_DESCRIPTION = 200;
const NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
// Control characters, C1 controls, and line/paragraph separators.
const CONTROL_CHARS = /[\p{Cc}\p{Zl}\p{Zp}]+/gu;

export type Log = (line: string) => void;

export interface FlowRef {
  screenId: string;
  flowId: string;
}

export interface FlowTools {
  tools: ToolDef[];
  humanOnly: FlowRef[];
}

/** Map source rule: --screen-map wins; else the screens dir must hold exactly one map. Never throws. */
export async function loadFlowSource(source: ScreenSource, log: Log): Promise<ScreenMap | undefined> {
  try {
    if (source.screenMap !== undefined) return await loadExplicitMap(source.screenMap);
    const dir = resolveScreensDir(source.screensDir === undefined ? {} : { screensDir: source.screensDir });
    const maps = await loadScreenMapsFromDir(dir);
    if (maps.length === 1 && maps[0] !== undefined) return maps[0].map;
    log(
      `pwa-nav-mcp: no flow tools or map resources: ${maps.length.toString()} screen maps in ${dir} (need exactly one; ` +
        "or pass --screen-map <file>)",
    );
  } catch (error) {
    const first = (error instanceof Error ? error.message : String(error)).split("\n")[0] ?? "";
    log(`pwa-nav-mcp: screen map ignored (no flow tools or map resources): ${first}`);
  }
  return undefined;
}

// Human-authored text: strip control characters, collapse whitespace, cap the length.
export function sanitizeDescription(text: string): string {
  const clean = text.replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim();
  return clean.length > MAX_FLOW_DESCRIPTION ? `${clean.slice(0, MAX_FLOW_DESCRIPTION - 1)}…` : clean;
}

const snake = (id: string): string => id.replaceAll("-", "_");
const hashOf = (ref: FlowRef): string =>
  createHash("sha256").update(`${ref.screenId}/${ref.flowId}`).digest("hex").slice(0, 8);

/** `flow_<screen>_<flow>` (kebab -> snake); colliding or over-long names get a stable `_<hash8>` suffix. */
export function flowToolNames<T extends FlowRef>(refs: readonly T[], log: Log): Map<T, string> {
  const base = refs.map((ref) => `flow_${snake(ref.screenId)}_${snake(ref.flowId)}`);
  const uses = new Map<string, number>();
  for (const name of base) uses.set(name, (uses.get(name) ?? 0) + 1);
  const out = new Map<T, string>();
  const taken = new Set<string>();
  refs.forEach((ref, index) => {
    let name = base[index] ?? "";
    if ((uses.get(name) ?? 0) > 1 || name.length > MAX_TOOL_NAME) {
      const suffix = `_${hashOf(ref)}`;
      name = `${name.slice(0, MAX_TOOL_NAME - suffix.length)}${suffix}`;
      log(`pwa-nav-mcp: flow ${ref.screenId}/${ref.flowId} registered as ${name} (name collision or length)`);
    }
    if (!NAME_PATTERN.test(name) || taken.has(name)) {
      log(`pwa-nav-mcp: flow ${ref.screenId}/${ref.flowId} skipped: no valid unique tool name`);
      return;
    }
    taken.add(name);
    out.set(ref, name);
  });
  return out;
}

function flowInputTokens(args: Record<string, unknown>): string[] {
  return Object.entries(args).map(([key, value]) => {
    if (key.length === 0 || key.includes("=") || isSemanticToken(`${key}=`)) {
      throw invalid("invalid flow input name.");
    }
    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
      throw invalid(`flow input "${key}" must be a string, number or boolean.`);
    }
    return `${key}=${String(value)}`;
  });
}

function isObjectSchema(schema: unknown): schema is Record<string, unknown> {
  return typeof schema === "object" && schema !== null && (schema as { type?: unknown }).type === "object";
}

interface Candidate extends FlowRef {
  description: string;
  schema: Record<string, unknown>;
}

/** Builds the callable flow tools (humanOnly excluded). Schema validity under Ajv is checked by the caller. */
export function buildFlowTools(map: ScreenMap, log: Log): FlowTools {
  const candidates: Candidate[] = [];
  const humanOnly: FlowRef[] = [];
  for (const screen of map.screens) {
    for (const flow of screen.flows) {
      if (flow.humanOnly) {
        humanOnly.push({ screenId: screen.id, flowId: flow.id });
      } else if (isObjectSchema(flow.inputSchema)) {
        candidates.push({ screenId: screen.id, flowId: flow.id, description: flow.description, schema: flow.inputSchema });
      } else {
        log(`pwa-nav-mcp: flow ${screen.id}/${flow.id} skipped: inputSchema is not an object schema`);
      }
    }
  }
  const names = flowToolNames(candidates, log);
  const tools: ToolDef[] = [];
  for (const candidate of candidates) {
    const name = names.get(candidate);
    if (name === undefined) continue;
    const { screenId, flowId } = candidate;
    const note = sanitizeDescription(candidate.description);
    tools.push({
      name,
      description:
        `Run flow "${flowId}" on screen "${screenId}" of app "${map.app.id}"; the current page must already be on that screen. ` +
        `${note === "" ? "" : `Map note: ${note} `}Dry-run unless the server operator armed it.`,
      inputSchema: candidate.schema,
      annotations: ACTION_HINTS,
      async handler(args, ctx) {
        const backend = ctx.backendFactory({ armed: ctx.armed });
        const sctx = semanticContext(ctx, backend);
        const tokens = [`flow:${flowId}`, ...flowInputTokens(args)];
        const url = await backend.currentUrl();
        if (url !== "" && findScreen(map, url).screen.id !== screenId) {
          throw new PwaNavError("unmapped_screen", `the current page is not screen "${screenId}"`, {
            hint: `open the "${screenId}" screen first; flow tools never navigate`,
          });
        }
        await runSemanticAct(sctx, tokens);
        return actionOutcome(ctx, backend, null);
      },
    });
  }
  return { tools, humanOnly };
}

export function humanOnlyNote(humanOnly: readonly FlowRef[]): string {
  if (humanOnly.length === 0) return "";
  return `Human-only flows exist and must be performed by the user, never by the agent: ${humanOnly
    .map((h) => `${h.flowId} (screen ${h.screenId})`)
    .join(", ")}.`;
}
