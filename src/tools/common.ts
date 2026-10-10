import { join } from "node:path";
import type { Backend } from "../backend/backend.js";
import { appSlugFromUrl } from "../backend/backend.js";
import { latestSnapshotId, load as loadSnapshot } from "../core/refs.js";
import { formatExtractLine } from "../ops/ops.js";
import { isDryRun, type BackendRequest, type ToolContext, type ToolOutcome } from "./types.js";

export function getBackend(ctx: ToolContext, req: Partial<BackendRequest> = {}): Backend {
  if (ctx.backend !== undefined) {
    return ctx.backend;
  }
  return ctx.backendFactory({
    armed: req.armed ?? ctx.armed,
    launch: req.launch,
  });
}

export async function actionOutcome(
  ctx: ToolContext,
  backend: Backend,
  snapshotId: string | null,
  actionTarget?: string,
): Promise<ToolOutcome> {
  const id = snapshotId ?? (await latestSnapshotId({ agentDir: backend.agentDir }));
  const snapshot = id === null ? null : await loadSnapshot(id, { agentDir: backend.agentDir });
  let text: string | undefined;
  let openedBranch: Record<string, unknown> | undefined;

  if (snapshot?.activeDialog) {
    const dialogElements = snapshot.elements.filter((e) => e.dialog === snapshot.activeDialog?.title);
    const dialogLines = dialogElements.map(formatExtractLine);
    text = `Action ok -> opened dialog "${snapshot.activeDialog.title}" (${dialogElements.length.toString()} elements).\n` +
      `Active modal controls:\n${dialogLines.slice(0, 15).join("\n")}${dialogLines.length > 15 ? "\n… and more in modal" : ""}\n` +
      `Tip: Use fill or click directly on modal controls above.`;
    openedBranch = {
      type: "dialog",
      title: snapshot.activeDialog.title,
      ...(actionTarget !== undefined ? { trigger: actionTarget } : {}),
      elements: dialogLines,
    };
  }

  const appSlug = snapshot?.url ? appSlugFromUrl(snapshot.url) : undefined;
  const screenMap = appSlug ? join(backend.agentDir, "apps", appSlug, "screens.json") : undefined;

  return {
    ...(text !== undefined ? { text } : {}),
    structured: {
      dryRun: isDryRun(ctx),
      status: "ok",
      ...(id === null ? {} : { snapshotId: id }),
      ...(screenMap ? { screenMap } : {}),
      ...(openedBranch !== undefined ? { openedBranch } : {}),
      ...(snapshot?.activeDialog !== undefined ? { activeDialog: snapshot.activeDialog } : {}),
      ...(snapshot === null ? {} : { url: snapshot.url }),
    },
  };
}
