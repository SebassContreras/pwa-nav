// Screen-map CLI behavior (spec 005, T009): `snapshot --screen|--learn` and `@id` targets
// for click/fill/act. Kept out of cli.ts for readability; cli.ts owns option parsing.
// Semantic targets are resolved against the map first (sensitive/unknown refusals happen before
// any DOM collection or input), then mapped onto a FRESH snapshot's refs so the tested
// eN paths (stale check, gate, dry-run, kill-switch) do the actual work.
import { join } from "node:path";
import type { Backend } from "../backend/backend.js";
import { PwaNavError } from "../core/errors.js";
import { captureLiveSnapshot, performAct, performClick, performFill, performLiveSnapshot } from "../ops/ops.js";
import type { ActOp } from "../ops/ops.js";
import { load as loadSnapshot, loadLocators, StaleRefError } from "../core/refs.js";
import type { LocatorSidecar } from "../core/refs.js";
import type { Locator, Screen, ScreenMap } from "../screens/screen-map.js";
import { findScreen, loadExplicitMap, loadScreenMapsFromDir, resolveScreensDir, selectMap } from "../screens/screen-match.js";
import { learnScreen, slugify } from "../screens/screen-learn.js";
import { describeResolved, isSemanticToken, parseFlowInputs, parseSemanticAct, parseTarget, resolveFlow, resolveTarget } from "../screens/screen-resolve.js";
import type { Intent, ResolvedTarget } from "../screens/screen-resolve.js";
import { learnIntoFile, renderDiff } from "../screens/screen-store.js";
import { renderScreenView, renderUnmappedHint } from "../screens/screen-view.js";

export { isSemanticToken };

export const NO_INPUT_LINE = "no input sent (pass --armed to execute)";

export interface ScreenSource {
  /** `--screen-map <file>`; wins over directory selection. */
  screenMap?: string;
  /** `--screens-dir <dir>` (env PWA_NAV_SCREENS_DIR, default ./screens). */
  screensDir?: string;
}

const ID_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const LOCALE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const ACCESS = new Set(["public", "authenticated", "unknown"]);

function dirOf(source: ScreenSource): string {
  return resolveScreensDir(source.screensDir === undefined ? {} : { screensDir: source.screensDir });
}

async function currentUrlOf(backend: Backend): Promise<string> {
  const url = await backend.currentUrl();
  if (url.length === 0) {
    throw new PwaNavError("invalid_args", "no current URL", { hint: "run: open <url> first" });
  }
  return url;
}

// unmapped_screen errors carry the renderUnmappedHint text (line 1 = message, rest = hint).
function asUnmapped(error: unknown, url: string): unknown {
  if (!(error instanceof PwaNavError) || error.code !== "unmapped_screen") return error;
  const parsed = new URL(url);
  const [head = "", ...tail] = renderUnmappedHint(parsed.pathname, parsed.origin).split("\n");
  const extra = error.message.startsWith("no screen map for origin") && error.hint !== undefined ? `; ${error.hint}` : "";
  return new PwaNavError("unmapped_screen", head, { hint: tail.join(" ") + extra, cause: error });
}

async function loadMap(url: string, source: ScreenSource): Promise<ScreenMap> {
  if (source.screenMap !== undefined) return loadExplicitMap(source.screenMap);
  const dir = dirOf(source);
  return selectMap(await loadScreenMapsFromDir(dir), url, dir);
}

async function locateScreen(url: string, source: ScreenSource): Promise<{ map: ScreenMap; screen: Screen }> {
  try {
    const map = await loadMap(url, source);
    return { map, screen: findScreen(map, url).screen };
  } catch (error) {
    throw asUnmapped(error, url);
  }
}

/** `snapshot --screen`: compact view of the screen matching the current URL (no DOM collection). */
export async function runScreenView(backend: Backend, source: ScreenSource): Promise<void> {
  const url = await currentUrlOf(backend);
  const { screen } = await locateScreen(url, source);
  console.log(renderScreenView(screen));
}

// Compact view of the screen at `url`, or the unmapped hint (never fails the command).
async function printViewFor(url: string, source: ScreenSource): Promise<void> {
  try {
    const { screen } = await locateScreen(url, source);
    console.log(renderScreenView(screen));
  } catch (error) {
    if (error instanceof PwaNavError && error.code === "unmapped_screen") {
      console.log([error.message, error.hint].filter((line) => line !== undefined).join("\n"));
      return;
    }
    throw error;
  }
}

export interface LearnOptions extends ScreenSource {
  outPath: string;
  prune: boolean;
  locale?: string;
  access?: string;
  appId?: string;
  appName?: string;
}

export function validateLearnFlags(o: Pick<LearnOptions, "locale" | "access" | "appId">): void {
  if (o.locale !== undefined && !LOCALE.test(o.locale)) {
    throw new PwaNavError("invalid_args", `invalid --locale: ${o.locale} (expected a BCP 47 tag such as en or es-ES).`);
  }
  if (o.access !== undefined && !ACCESS.has(o.access)) {
    throw new PwaNavError("invalid_args", `invalid --access: ${o.access} (expected public|authenticated|unknown).`);
  }
  if (o.appId !== undefined && !ID_SLUG.test(o.appId)) {
    throw new PwaNavError("invalid_args", `invalid --app-id: ${o.appId} (expected a lowercase slug such as demo-app).`);
  }
}

const LOCALE_REQUIRED =
  "a NEW screen map needs --locale <bcp47> (for example en or es-ES). The page lang attribute is not " +
  "trustworthy (measured on a real Spanish app whose <html lang> said \"en\"), so it is never inferred.";

/** `snapshot --learn`: normal live snapshot, then learn the screen from the same collection. */
export async function runLearn(backend: Backend, o: LearnOptions): Promise<void> {
  validateLearnFlags(o);
  const { snapshot, raw } = await captureLiveSnapshot(backend, { outPath: o.outPath });
  const page = new URL(snapshot.url);
  const origin = page.origin;
  const learned = learnScreen(
    raw,
    { url: snapshot.url, title: snapshot.title, appOrigin: origin },
    o.access === undefined ? {} : { access: o.access as Screen["access"] },
  );

  // Target file: explicit, else the existing map for this origin, else a new <app-id>.screens.json.
  const dir = dirOf(o);
  let path: string;
  let existing: ScreenMap | undefined;
  if (o.screenMap !== undefined) {
    path = o.screenMap;
    existing = await loadExplicitMap(path).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    });
  } else {
    const hits = (await loadScreenMapsFromDir(dir)).filter((entry) => new URL(entry.map.app.origin).origin === origin);
    if (hits.length > 1) {
      throw new PwaNavError("invalid_args", `several screen maps cover origin ${origin}: ${hits.map((h) => h.path).join(", ")}`, {
        hint: "keep one map per origin or pass --screen-map <file>",
      });
    }
    path = hits[0]?.path ?? "";
    existing = hits[0]?.map;
  }

  let app;
  if (existing !== undefined) {
    app = { ...existing.app }; // stored app info and locale are kept
  } else {
    if (o.locale === undefined) {
      throw new PwaNavError("invalid_args", LOCALE_REQUIRED);
    }
    const appId = o.appId ?? (slugify(`${page.hostname}${page.port === "" ? "" : `-${page.port}`}`) || "app");
    app = { id: appId, name: o.appName ?? (snapshot.title === "" ? appId : snapshot.title), origin, locale: o.locale };
    if (o.screenMap === undefined) path = join(dir, `${appId}.screens.json`);
  }
  const result = await learnIntoFile({ path, learned, app, ...(o.prune ? { prune: true } : {}) });
  console.log(renderDiff(result.diff));
  console.log(`screen map: ${path} (${result.written ? "written" : "unchanged"})`);
}

// --- @id targets ---

export interface SemanticContext extends ScreenSource {
  backend: Backend;
  armed: boolean;
}

interface Planned {
  intent: Intent;
  target: ResolvedTarget;
  text?: string;
}

function refFor(sidecar: LocatorSidecar | null, locator: Locator, target: ResolvedTarget, snapshotId: string): string {
  const want = locator.occurrence ?? 0;
  for (const [ref, found] of Object.entries(sidecar?.locators ?? {})) {
    if (found.role === locator.role && found.name === locator.name && (found.occurrence ?? 0) === want) return ref;
  }
  throw new StaleRefError(
    snapshotId,
    `mapped element @${target.id} (${locator.role} "${locator.name}") was not found on the live page ` +
      "(screen drift or wrong screen); run: snapshot --learn to review the map",
  );
}

// Fresh snapshot (quiet) + refs for every planned target, then the existing eN action paths.
async function execute(ctx: SemanticContext, planned: Planned[], mode: "single" | "batch"): Promise<void> {
  const { backend, armed } = ctx;
  const fresh = await performLiveSnapshot(backend, { quiet: true });
  const sidecar = await loadLocators(fresh.snapshotId, { agentDir: backend.agentDir });
  const ops: ActOp[] = planned.map((step) => {
    const ref = refFor(sidecar, step.target.locator, step.target, fresh.snapshotId);
    return step.intent === "click" ? { kind: "click", ref } : { kind: "fill", ref, text: step.text ?? "" };
  });
  for (const step of planned) console.log(describeResolved(step.target, step.intent));

  const [only] = planned;
  const first = ops[0];
  let nextId: string;
  if (mode === "single" && only !== undefined && first !== undefined) {
    nextId =
      first.kind === "click"
        ? await performClick(fresh.snapshotId, first.ref, { backend, armed })
        : await performFill(fresh.snapshotId, first.ref, first.text, { backend, armed });
  } else {
    nextId = await performAct(fresh.snapshotId, ops, { backend, armed });
  }
  if (!armed) console.log(NO_INPUT_LINE);
  if (armed && nextId !== fresh.snapshotId) {
    const after = await loadSnapshot(nextId, { agentDir: backend.agentDir });
    if (after !== null) await printViewFor(after.url, ctx);
  }
}

async function screenAt(ctx: SemanticContext): Promise<Screen> {
  return (await locateScreen(await currentUrlOf(ctx.backend), ctx)).screen;
}

export async function runSemanticClick(ctx: SemanticContext, id: string): Promise<void> {
  parseTarget(`@${id}`); // invalid slug => invalid_args before any browser call
  const screen = await screenAt(ctx);
  await execute(ctx, [{ intent: "click", target: resolveTarget(screen, id, "click") }], "single");
}

export async function runSemanticFill(ctx: SemanticContext, id: string, text: string): Promise<void> {
  parseTarget(`@${id}`);
  const screen = await screenAt(ctx);
  await execute(ctx, [{ intent: "fill", target: resolveTarget(screen, id, "fill"), text }], "single");
}

/** act with click:@id / fill:@id=text / flow:<id> [key=value ...]. Plain-ref tokens are rejected. */
export async function runSemanticAct(ctx: SemanticContext, tokens: readonly string[]): Promise<void> {
  const items: ({ kind: "click"; id: string } | { kind: "fill"; id: string; text: string } | { kind: "flow"; flowId: string; inputs: string[] })[] = [];
  for (const token of tokens) {
    if (isSemanticToken(token)) {
      const parsed = parseSemanticAct(token);
      items.push(parsed.kind === "flow" ? { ...parsed, inputs: [] } : parsed);
      continue;
    }
    const last = items[items.length - 1];
    if (last?.kind !== "flow") {
      throw new PwaNavError(
        "invalid_args",
        "cannot mix semantic act tokens (click:@id, fill:@id=<text>, flow:<id> key=value) with plain refs or stray arguments.",
      );
    }
    last.inputs.push(token);
  }
  const screen = await screenAt(ctx);
  // Resolve everything first: refusals and input validation precede any DOM collection.
  const planned: Planned[] = [];
  for (const item of items) {
    if (item.kind === "click") {
      planned.push({ intent: "click", target: resolveTarget(screen, item.id, "click") });
    } else if (item.kind === "fill") {
      planned.push({ intent: "fill", target: resolveTarget(screen, item.id, "fill"), text: item.text });
    } else {
      // humanOnly must win over malformed inputs: parse errors are deferred behind resolveFlow.
      let inputs: Record<string, string> = {};
      let parseError: PwaNavError | undefined;
      try {
        inputs = parseFlowInputs(item.inputs);
      } catch (error) {
        if (!(error instanceof PwaNavError)) throw error;
        parseError = error;
      }
      const flow = resolveFlow(screen, item.flowId, inputs);
      if (parseError !== undefined) throw parseError;
      for (const step of flow.steps) {
        planned.push(
          step.op === "fill"
            ? { intent: "fill", target: step.target, text: step.text }
            : { intent: "click", target: step.target },
        );
      }
    }
  }
  await execute(ctx, planned, "batch");
}
