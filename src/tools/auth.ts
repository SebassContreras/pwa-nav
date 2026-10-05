import { performAuthRelay } from "../ops/ops.js";
import { type ToolOutcome } from "./types.js";

export interface AuthArgs {
  action?: "clean" | "debug";
  app?: string;
}

export async function authTool(args: AuthArgs): Promise<ToolOutcome> {
  const action = args.action === "debug" ? "debug" : "clean";
  const app = args.app;
  const result = await performAuthRelay({ appOrUrl: app, action });

  return {
    text: result.message,
    structured: {
      status: result.status,
      message: result.message,
      ...(result.command ? { command: result.command } : {}),
      ...(result.siteId ? { siteId: result.siteId } : {}),
    },
  };
}
