import { performScreenshot } from "../ops/ops.js";
import { getBackend } from "./common.js";
import { type ToolContext, type ToolOutcome } from "./types.js";

export interface ScreenshotArgs {
  outPath?: string;
  format?: "png" | "jpeg" | "webp";
}

export async function screenshotTool(args: ScreenshotArgs, ctx: ToolContext): Promise<ToolOutcome> {
  const backend = getBackend(ctx, { armed: false });
  const result = await performScreenshot({
    backend,
    ...(args.outPath !== undefined ? { outPath: args.outPath } : {}),
    ...(args.format !== undefined ? { format: args.format } : {}),
    quiet: true,
  });

  return {
    text: `screenshot saved to ${result.path}`,
    structured: {
      path: result.path,
      ...(result.width !== undefined ? { width: result.width } : {}),
      ...(result.height !== undefined ? { height: result.height } : {}),
    },
  };
}
