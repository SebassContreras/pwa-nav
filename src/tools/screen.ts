import type { Backend } from "../backend/backend.js";
import { PwaNavError } from "../core/errors.js";
import type { Screen, ScreenMap } from "../screens/screen-map.js";
import { findScreen, loadExplicitMap, loadScreenMapsFromDir, resolveScreensDir, selectMap } from "../screens/screen-match.js";
import { renderScreenView, renderUnmappedHint } from "../screens/screen-view.js";
import { getBackend } from "./common.js";
import { type ScreenSource, type ToolContext, type ToolOutcome } from "./types.js";

export function dirOf(source: ScreenSource): string {
  return resolveScreensDir(source.screensDir === undefined ? {} : { screensDir: source.screensDir });
}

export async function currentUrlOf(backend: Backend): Promise<string> {
  const url = await backend.currentUrl();
  if (url.length === 0) {
    throw new PwaNavError("invalid_args", "no current URL", { hint: "run: open <url> first" });
  }
  return url;
}

export function asUnmapped(error: unknown, url: string): unknown {
  if (!(error instanceof PwaNavError) || error.code !== "unmapped_screen") return error;
  const parsed = new URL(url);
  const [head = "", ...tail] = renderUnmappedHint(parsed.pathname, parsed.origin).split("\n");
  const extra = error.message.startsWith("no screen map for origin") && error.hint !== undefined ? `; ${error.hint}` : "";
  return new PwaNavError("unmapped_screen", head, { hint: tail.join(" ") + extra, cause: error });
}

export async function loadMap(url: string, source: ScreenSource): Promise<ScreenMap> {
  if (source.screenMap !== undefined) return loadExplicitMap(source.screenMap);
  const dir = dirOf(source);
  return selectMap(await loadScreenMapsFromDir(dir), url, dir);
}

export async function locateScreen(url: string, source: ScreenSource): Promise<{ map: ScreenMap; screen: Screen }> {
  try {
    const map = await loadMap(url, source);
    return { map, screen: findScreen(map, url).screen };
  } catch (error) {
    throw asUnmapped(error, url);
  }
}

export async function renderScreenViewForBackend(backend: Backend, source: ScreenSource): Promise<string> {
  const url = await currentUrlOf(backend);
  const { screen } = await locateScreen(url, source);
  return renderScreenView(screen);
}

export interface ScreenArgs {
  screenMap?: string;
  screensDir?: string;
}

export async function screenTool(args: ScreenArgs, ctx: ToolContext): Promise<ToolOutcome> {
  const screens = {
    screenMap: args.screenMap ?? ctx.screens.screenMap,
    screensDir: args.screensDir ?? ctx.screens.screensDir,
  };
  const backend = getBackend(ctx);
  const url = await currentUrlOf(backend);
  const { screen, map } = await locateScreen(url, screens);
  const text = renderScreenView(screen);
  return {
    text,
    structured: {
      screenId: screen.id,
      title: screen.title,
      route: screen.route,
      appId: map.app.id,
      view: text,
    },
  };
}
