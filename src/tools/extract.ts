import { latestSnapshotId } from "../core/refs.js";
import { performExtractDetailed } from "../ops/ops.js";
import { getBackend } from "./common.js";
import { type ToolContext, type ToolOutcome } from "./types.js";

export const EXTRACT_INLINE_CAP = 100;

export interface ExtractArgs {
  snapshotId?: string;
  mode?: "all" | "text" | "links";
  query?: string;
  role?: string;
  offset?: number;
  limit?: number;
}

export async function extractTool(args: ExtractArgs, ctx: ToolContext): Promise<ToolOutcome> {
  const mode = args.mode === "links" ? "links" : args.mode === "text" ? "text" : "all";
  const offset = typeof args.offset === "number" ? Math.max(0, args.offset) : 0;
  const limit = typeof args.limit === "number" ? Math.min(EXTRACT_INLINE_CAP, Math.max(1, args.limit)) : EXTRACT_INLINE_CAP;
  const backend = getBackend(ctx, { armed: false });
  const snapshotId = args.snapshotId ?? (await latestSnapshotId({ agentDir: backend.agentDir })) ?? undefined;

  const detailed = await performExtractDetailed(snapshotId, mode, {
    backend,
    query: args.query,
    role: args.role,
    offset,
    limit,
  });

  const omitted = detailed.total - (detailed.offset + detailed.returned);
  const text = [
    ...detailed.lines,
    ...(omitted > 0 ? [`… ${omitted.toString()} more omitted. Use pwa_find({ query: "..." }) to search or pass offset to paginate.`] : []),
  ].join("\n");

  return {
    text: text === "" ? "0 matching lines" : text,
    structured: {
      total: detailed.total,
      returned: detailed.returned,
      offset: detailed.offset,
      omitted: Math.max(0, omitted),
      ...(snapshotId !== undefined ? { snapshotId } : {}),
      lines: detailed.lines,
    },
  };
}
