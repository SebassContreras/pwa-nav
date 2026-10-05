import { performWait } from "../ops/ops.js";
import { getBackend } from "./common.js";
import { invalid, type ToolContext, type ToolOutcome } from "./types.js";

export interface WaitArgs {
  target?: string;
  query?: string;
  state?: "visible" | "hidden" | "enabled";
  timeoutMs?: number;
  intervalMs?: number;
}

export async function waitTool(args: WaitArgs, ctx: ToolContext): Promise<ToolOutcome> {
  const { target, query, state = "visible", timeoutMs, intervalMs } = args;
  if (target === undefined && query === undefined) {
    throw invalid("must pass either target or query to wait for.");
  }
  const backend = getBackend(ctx, { armed: false });
  const result = await performWait(target, {
    backend,
    query,
    state,
    timeoutMs,
    intervalMs,
  });

  return {
    text: `wait ok: ${state} "${target ?? query ?? ""}" (${result.elapsedMs.toString()}ms)`,
    structured: { ...result },
  };
}
