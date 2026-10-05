import { join } from "node:path";
import type { Backend } from "../backend/backend.js";
import { PwaNavError } from "../core/errors.js";
import { captureLiveSnapshot } from "../ops/ops.js";
import { learnScreen, slugify } from "../screens/screen-learn.js";
import type { Screen, ScreenMap } from "../screens/screen-map.js";
import { loadExplicitMap, loadScreenMapsFromDir } from "../screens/screen-match.js";
import { learnIntoFile, renderDiff } from "../screens/screen-store.js";
import { getBackend } from "./common.js";
import { dirOf } from "./screen.js";
import { invalid, type ScreenSource, type ToolContext, type ToolOutcome } from "./types.js";

const ID_SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const LOCALE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const ACCESS = new Set(["public", "authenticated", "unknown"]);

export const LOCALE_REQUIRED =
  "a NEW screen map needs --locale <bcp47> (for example en or es-ES). The page lang attribute is not " +
  "trustworthy (measured on a real Spanish app whose <html lang> said \"en\"), so it is never inferred.";

export interface LearnArgs extends ScreenSource {
  outPath?: string;
  prune?: boolean;
  locale?: string;
  access?: string;
  appId?: string;
  appName?: string;
}

export interface LearnResult {
  path: string;
  written: boolean;
  targets: string[];
  screenId: string;
  title: string;
  diffText?: string;
}

export function validateLearnFlags(o: Pick<LearnArgs, "locale" | "access" | "appId">): void {
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

export async function executeLearn(backend: Backend, o: LearnArgs): Promise<LearnResult> {
  validateLearnFlags(o);
  const outPath = o.outPath ?? join(backend.agentDir, "snapshot.json");
  const { snapshot, raw } = await captureLiveSnapshot(backend, { outPath, skipAutoCollaborate: true });
  const page = new URL(snapshot.url);
  const origin = page.origin;
  const learned = learnScreen(
    raw,
    { url: snapshot.url, title: snapshot.title, appOrigin: origin },
    o.access === undefined ? {} : { access: o.access as Screen["access"] },
  );

  const dir = dirOf(o, backend.agentDir);
  let path: string;
  let existing: ScreenMap | undefined;
  if (o.screenMap !== undefined) {
    path = o.screenMap;
    existing = await loadExplicitMap(path).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    });
  } else {
    const hits = (await loadScreenMapsFromDir(dir, { agentDir: backend.agentDir })).filter((entry) => new URL(entry.map.app.origin).origin === origin);
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
    app = { ...existing.app };
  } else {
    if (o.locale === undefined) {
      throw new PwaNavError("invalid_args", LOCALE_REQUIRED);
    }
    const appId = o.appId ?? (slugify(`${page.hostname}${page.port === "" ? "" : `-${page.port}`}`) || "app");
    app = { id: appId, name: o.appName ?? (snapshot.title === "" ? appId : snapshot.title), origin, locale: o.locale };
    if (o.screenMap === undefined) {
      path = join(dir, `${appId}.screens.json`);
    }
  }

  const result = await learnIntoFile({ path, learned, app, ...(o.prune ? { prune: true } : {}) });
  const diffText = renderDiff(result.diff);
  console.log(diffText);
  console.log(`screen map: ${path} (${result.written ? "written" : "unchanged"})`);
  const targets = [
    ...Object.keys(learned.fields).map((id) => `@${id}`),
    ...Object.keys(learned.actions).map((id) => `@${id}`),
    ...Object.keys(learned.links).map((id) => `@${id}`),
  ];

  return {
    path,
    written: result.written,
    targets,
    screenId: learned.id,
    title: learned.title,
    diffText,
  };
}

export async function learnTool(args: LearnArgs, ctx: ToolContext): Promise<ToolOutcome> {
  if (ctx.mode === "offline") {
    throw invalid("--learn needs the live backend (--backend bidi).");
  }
  const backend = getBackend(ctx);
  const mergedArgs: LearnArgs = {
    ...args,
    screenMap: args.screenMap ?? ctx.screens.screenMap,
    screensDir: args.screensDir ?? ctx.screens.screensDir,
  };
  const result = await executeLearn(backend, mergedArgs);

  const textLines: string[] = [];
  if (result.diffText) textLines.push(result.diffText);
  textLines.push(`screen map: ${result.path} (${result.written ? "written" : "unchanged"})`);
  textLines.push(`Available targets: ${result.targets.join(", ")}`);

  return {
    text: textLines.join("\n"),
    structured: {
      learned: true,
      path: result.path,
      written: result.written,
      screenId: result.screenId,
      title: result.title,
      targets: result.targets,
    },
  };
}
