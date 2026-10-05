import { runCheck, type QaResult } from "../ops/qa.js";
import { getBackend } from "./common.js";
import { invalid, type ToolContext, type ToolOutcome } from "./types.js";

export interface QaArgs {
  checkFile: string;
}

export async function qaTool(args: QaArgs, ctx: ToolContext): Promise<ToolOutcome> {
  const { checkFile } = args;
  if (!checkFile || checkFile.length === 0) {
    throw invalid("missing <check-file> path.");
  }
  const backend = getBackend(ctx);
  const result: QaResult = await runCheck(checkFile, { backend });

  const textLines = [
    `QA check ${result.pass ? "PASSED" : "FAILED"}`,
    `Evidence directory: ${result.evidenceDir}`,
  ];
  if (result.failedStep !== null) {
    textLines.push(`Failed step index: ${result.failedStep.toString()}`);
  }

  return {
    text: textLines.join("\n"),
    structured: {
      pass: result.pass,
      failedStep: result.failedStep,
      evidenceDir: result.evidenceDir,
    },
  };
}
