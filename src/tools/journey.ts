import { performJourney } from "../ops/journey.js";
import { getBackend } from "./common.js";
import { invalid, type ToolContext, type ToolOutcome } from "./types.js";

export interface JourneyArgs {
  journey: string;
  inputs?: Record<string, string>;
  dryRun?: boolean;
  screenMap?: string;
  screensDir?: string;
}

export async function journeyTool(args: JourneyArgs, ctx: ToolContext): Promise<ToolOutcome> {
  const { journey: journeyId, inputs = {}, dryRun = false } = args;
  if (!journeyId || journeyId.length === 0) {
    throw invalid("missing journey name/id.");
  }

  const armed = dryRun ? false : ctx.armed;
  const backend = getBackend(ctx, { armed });

  const result = await performJourney(journeyId, inputs, {
    backend,
    armed,
    screensDir: args.screensDir ?? ctx.screens.screensDir,
    screenMap: args.screenMap ?? ctx.screens.screenMap,
  });

  const lines: string[] = [
    `Journey ${result.journeyId}: ${result.completedSteps.toString()}/${result.totalSteps.toString()} steps (${result.armed ? "armed" : "dry-run"})`,
    `Final URL: ${result.finalUrl}`,
  ];
  if (result.finalScreen) {
    lines.push(`Final Screen: ${result.finalScreen.title} (${result.finalScreen.id})`);
  }
  if (!result.armed) {
    lines.push("no input sent (pass --armed to execute)");
  }

  return {
    text: lines.join("\n"),
    structured: {
      journeyId: result.journeyId,
      armed: result.armed,
      completedSteps: result.completedSteps,
      totalSteps: result.totalSteps,
      finalUrl: result.finalUrl,
      finalScreenId: result.finalScreen?.id,
      plan: result.plan,
    },
  };
}
