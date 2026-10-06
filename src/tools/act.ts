import { parseActOp, performAct } from "../ops/ops.js";
import type { ActOp } from "../ops/ops.js";
import { isSemanticToken, parseFlowInputs, parseSemanticAct, resolveFlow, resolveTarget, type ParsedTarget } from "../screens/screen-resolve.js";
import { actionOutcome, getBackend } from "./common.js";
import { executeSemantic, screenAt, type Planned, type SemanticContext } from "./semantic-exec.js";
import { invalid, NO_INPUT_LINE, type ToolContext, type ToolOutcome } from "./types.js";
import { PwaNavError } from "../core/errors.js";

export interface ActArgs {
  ops: readonly string[];
  inputs?: Record<string, string>;
  snapshotId?: string;
  dryRun?: boolean;
}

export function actTokens(ops: readonly string[], inputs: Record<string, string> | undefined): string[] {
  const pairs = Object.entries(inputs ?? {}).map(([key, value]) => `${key}=${value}`);
  if (pairs.length === 0) return [...ops];
  const flows = ops.filter((op) => op.startsWith("flow:"));
  if (flows.length !== 1) {
    throw invalid("inputs requires exactly one flow:<id> op.");
  }
  return ops.flatMap((op) => (op.startsWith("flow:") ? [op, ...pairs] : [op]));
}

export async function actTool(args: ActArgs, ctx: ToolContext): Promise<ToolOutcome> {
  const effectiveCtx: ToolContext = args.dryRun ? { ...ctx, armed: false } : ctx;
  const rawOps = args.ops;
  if (!Array.isArray(rawOps) || rawOps.length === 0) {
    throw invalid("missing ops (expected non-empty array of operations, e.g. ['click:@btn'] or ['fill:@input=text']).");
  }

  const ops = actTokens(rawOps, args.inputs);
  const snapshotId = args.snapshotId;
  const backend = getBackend(effectiveCtx);

  if (ops.some(isSemanticToken)) {
    if (snapshotId !== undefined) {
      throw invalid("snapshotId is not used with semantic ops (they resolve on a fresh snapshot).");
    }
    if (effectiveCtx.mode === "offline") {
      throw invalid("semantic targets need the live backend (--backend bidi).");
    }

    const semCtx: SemanticContext = {
      ...effectiveCtx.screens,
      backend,
      armed: effectiveCtx.armed,
    };

    const items: (
      | { kind: "click"; target: ParsedTarget }
      | { kind: "fill"; target: ParsedTarget; text: string }
      | { kind: "upload"; target: ParsedTarget; files: readonly string[] }
      | { kind: "flow"; flowId: string; inputs: string[] }
    )[] = [];

    for (const token of ops) {
      if (isSemanticToken(token)) {
        const parsed = parseSemanticAct(token);
        items.push(parsed.kind === "flow" ? { ...parsed, inputs: [] } : parsed);
        continue;
      }
      const last = items[items.length - 1];
      if (last?.kind !== "flow") {
        throw new PwaNavError(
          "invalid_args",
          "cannot mix semantic act tokens (click:@id, fill:@id=<text>, upload:@id=<path>, flow:<id> key=value) with plain refs or stray arguments.",
        );
      }
      last.inputs.push(token);
    }

    const screen = await screenAt(semCtx);
    const planned: Planned[] = [];

    for (const item of items) {
      if (item.kind === "click") {
        if (item.target.kind !== "id") throw invalid("expected id target");
        planned.push({ intent: "click", target: resolveTarget(screen, item.target, "click") });
      } else if (item.kind === "fill") {
        if (item.target.kind !== "id") throw invalid("expected id target");
        planned.push({ intent: "fill", target: resolveTarget(screen, item.target, "fill"), text: item.text });
      } else if (item.kind === "upload") {
        if (item.target.kind !== "id") throw invalid("expected id target");
        planned.push({ intent: "upload", target: resolveTarget(screen, item.target, "upload"), files: item.files });
      } else {
        let flowInputs: Record<string, string> = {};
        let parseError: PwaNavError | undefined;
        try {
          flowInputs = parseFlowInputs(item.inputs);
        } catch (error) {
          if (!(error instanceof PwaNavError)) throw error;
          parseError = error;
        }
        const flow = resolveFlow(screen, item.flowId, flowInputs);
        if (parseError !== undefined) throw parseError;
        for (const step of flow.steps) {
          planned.push(
            step.op === "fill"
              ? { intent: "fill", target: step.target, text: step.text }
              : step.op === "upload"
                ? { intent: "upload", target: step.target, files: step.files }
                : { intent: "click", target: step.target },
          );
        }
      }
    }

    const exec = await executeSemantic(semCtx, planned, "batch");
    return actionOutcome(effectiveCtx, backend, exec.nextSnapshotId, ops.join(", "));
  }

  // Plain refs execution
  if (snapshotId === undefined) throw invalid("missing snapshotId (plain ops need one).");
  if (args.inputs !== undefined && Object.keys(args.inputs).length > 0) {
    throw invalid("inputs only applies to flow:<id> ops.");
  }

  const parsed: ActOp[] = ops.map((token, index) => {
    try {
      return parseActOp(token);
    } catch {
      throw invalid(`invalid op at ops[${index.toString()}] (expected click:<ref> or fill:<ref>=<text>).`);
    }
  });

  const next = await performAct(snapshotId, parsed, { backend, armed: effectiveCtx.armed });
  if (!effectiveCtx.armed) console.log(NO_INPUT_LINE);
  return actionOutcome(effectiveCtx, backend, next, ops.join(", "));
}
