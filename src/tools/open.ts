import { join } from "node:path";
import { appSlugFromUrl } from "../backend/backend.js";
import { isLoginBarrier } from "../browser/pwa-runtime.js";
import { performOpen } from "../ops/ops.js";
import { getBackend } from "./common.js";
import { invalid, type ToolContext, type ToolOutcome } from "./types.js";

export interface OpenArgs {
  url: string;
  launch?: boolean;
  siteId?: string;
  allowOrigin?: boolean;
}

export async function openTool(args: OpenArgs, ctx: ToolContext): Promise<ToolOutcome> {
  const { url, launch = false, siteId, allowOrigin = false } = args;
  if (!url || url.length === 0) {
    throw invalid("missing <url>.");
  }
  if (ctx.mode === "offline" && (launch || siteId !== undefined || allowOrigin)) {
    throw invalid("--launch, --site and --allow-origin require the live backend (--backend bidi).");
  }

  const backend = getBackend(ctx, { armed: false, launch, siteId });
  const session = await performOpen(url, { backend, allowOrigin });
  const slug = appSlugFromUrl(session.url);
  const barrier = isLoginBarrier(session.url);

  const sessionPath = join(backend.agentDir, "session.json");
  const textLines = [`open ok: ${session.url} -> ${sessionPath}`];
  if (barrier) {
    textLines.push(
      "Login barrier detected (e.g. Google accounts login). Use auth clean to switch to clean mode for manual user login, then auth debug to resume automation.",
    );
  }

  return {
    text: textLines.join("\n"),
    structured: {
      url: session.url,
      screenMap: join(backend.agentDir, "apps", slug, "screens.json"),
      ...(barrier
        ? {
            loginBarrier: true,
            hint: "Login barrier detected (e.g. Google accounts login). Use auth clean to switch to clean mode for manual user login, then auth debug to resume automation.",
          }
        : {}),
    },
  };
}
