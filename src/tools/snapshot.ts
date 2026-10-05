import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { appSlugFromUrl } from "../backend/backend.js";
import { DEFAULT_SNAPSHOT_PATH, formatExtractLine, performLiveSnapshot, performScreenshot, performSnapshot } from "../ops/ops.js";
import { getBackend } from "./common.js";
import { learnTool } from "./learn.js";
import { screenTool } from "./screen.js";
import { invalid, type ToolContext, type ToolOutcome } from "./types.js";

export interface SnapshotArgs {
  interactive?: boolean;
  all?: boolean;
  json?: boolean;
  input?: string;
  url?: string;
  title?: string;
  out?: string;
  query?: string;
  role?: string;
  screen?: boolean;
  learn?: boolean;
  prune?: boolean;
  locale?: string;
  access?: string;
  appId?: string;
  appName?: string;
  screenshot?: boolean;
  rawTree?: string;
}

export async function snapshotTool(args: SnapshotArgs, ctx: ToolContext): Promise<ToolOutcome> {
  const {
    interactive = false,
    all = false,
    json = false,
    input,
    url,
    title,
    out,
    query,
    role,
    screen = false,
    learn = false,
    prune = false,
    locale,
    access,
    appId,
    appName,
    screenshot = false,
    rawTree: passedRawTree,
  } = args;

  if (interactive && all) {
    throw invalid("--interactive and --all are mutually exclusive.");
  }
  if (screen && learn) {
    throw invalid("--screen and --learn are mutually exclusive.");
  }

  if (screen) {
    if (input !== undefined || json || all || interactive) {
      throw invalid("--screen cannot be combined with --input, --json, -i or --all.");
    }
    return screenTool({ screenMap: ctx.screens.screenMap, screensDir: ctx.screens.screensDir }, ctx);
  }

  if (learn) {
    if (input !== undefined || json || all) {
      throw invalid("--learn cannot be combined with --input, --json or --all.");
    }
    return learnTool(
      {
        outPath: out,
        prune,
        locale,
        access,
        appId,
        appName,
        screenMap: ctx.screens.screenMap,
        screensDir: ctx.screens.screensDir,
      },
      ctx,
    );
  }

  const outPath = out ?? (ctx.backend ? join(ctx.backend.agentDir, "snapshot.json") : DEFAULT_SNAPSHOT_PATH);

  // Offline ARIA tree normalizer path
  let rawTree: string | null = passedRawTree ?? null;
  if (input !== undefined) {
    rawTree = await readFile(input, "utf8");
  }

  if (rawTree !== null || ctx.mode === "offline") {
    if (rawTree === null) {
      throw invalid("no ARIA-tree input provided for offline snapshot.");
    }
    const snap = await performSnapshot(rawTree, {
      outPath,
      url: url ?? "",
      title: title ?? "",
      agentDir: ctx.agentDir,
      quiet: json,
    });
    return {
      text: json ? JSON.stringify(snap, null, 2) : `snapshot ok: ${snap.elements.length.toString()} elements -> ${outPath} (id ${snap.snapshotId})`,
      structured: {
        snapshotId: snap.snapshotId,
        elementCount: snap.elements.length,
        path: outPath,
        snapshot: snap,
      },
    };
  }

  const backend = getBackend(ctx);
  const snap = await performLiveSnapshot(backend, {
    outPath,
    quiet: json,
    includeAll: all,
    ...(query !== undefined ? { query } : {}),
    ...(role !== undefined ? { role } : {}),
  });

  if (screenshot) {
    const pngPath = outPath.replace(/\.json$/i, ".png");
    await performScreenshot({ backend, outPath: pngPath, format: "png" });
  }

  const slug = appSlugFromUrl(snap.url);
  const screenMapPath = join(backend.agentDir, "apps", slug, "screens.json");

  let summaryText = "";
  if (snap.activeDialog) {
    const dialogElements = snap.elements.filter((e) => e.dialog === snap.activeDialog?.title);
    const dialogLines = dialogElements.map(formatExtractLine);
    summaryText += `ACTIVE MODAL: "${snap.activeDialog.title}" (${dialogElements.length.toString()} controls)\n` +
      `${dialogLines.slice(0, 10).join("\n")}\n\n`;
  }

  return {
    text: json ? JSON.stringify(snap, null, 2) : (summaryText || `snapshot ok: ${snap.elements.length.toString()} elements -> ${outPath} (id ${snap.snapshotId})`),
    structured: {
      snapshotId: snap.snapshotId,
      url: snap.url,
      title: snap.title,
      elementCount: snap.elements.length,
      path: outPath,
      screenMap: screenMapPath,
      ...(snap.activeDialog ? { activeDialog: snap.activeDialog } : {}),
    },
  };
}
