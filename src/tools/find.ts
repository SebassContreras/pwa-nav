import { latestSnapshotId } from "../core/refs.js";
import { performFind } from "../ops/ops.js";
import { getBackend } from "./common.js";
import { type ToolContext, type ToolOutcome } from "./types.js";

export const FIND_INLINE_CAP = 100;

export interface FindArgs {
  snapshotId?: string;
  query?: string;
  role?: string;
  inDialog?: boolean;
  offset?: number;
  limit?: number;
}

export async function findTool(args: FindArgs, ctx: ToolContext): Promise<ToolOutcome> {
  const offset = typeof args.offset === "number" ? Math.max(0, args.offset) : 0;
  const limit = typeof args.limit === "number" ? Math.min(FIND_INLINE_CAP, Math.max(1, args.limit)) : FIND_INLINE_CAP;
  const backend = getBackend(ctx, { armed: false });
  const snapshotId = args.snapshotId ?? (await latestSnapshotId({ agentDir: backend.agentDir })) ?? undefined;

  const result = await performFind(snapshotId, {
    backend,
    query: args.query,
    role: args.role,
    inDialog: args.inDialog ?? false,
    offset,
    limit,
  });

  const omitted = result.total - (result.offset + result.returned);
  const text = [
    ...result.lines,
    ...(omitted > 0 ? [`… ${omitted.toString()} more omitted.`] : []),
  ].join("\n");

  return {
    text: text === "" ? "0 matching elements" : text,
    structured: {
      total: result.total,
      returned: result.returned,
      offset: result.offset,
      lines: result.lines,
      elements: result.elements,
    },
  };
}
