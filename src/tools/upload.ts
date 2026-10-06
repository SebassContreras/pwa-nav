import { latestSnapshotId } from "../core/refs.js";
import { performUpload } from "../ops/ops.js";
import { parseTarget, resolveTarget } from "../screens/screen-resolve.js";
import { actionOutcome, getBackend } from "./common.js";
import { executeSemantic, screenAt, type SemanticContext } from "./semantic-exec.js";
import { invalid, NO_INPUT_LINE, type ToolContext, type ToolOutcome } from "./types.js";

export interface UploadArgs {
  target?: string;
  ref?: string;
  files?: readonly string[];
  snapshotId?: string;
  dryRun?: boolean;
}

export async function uploadTool(args: UploadArgs, ctx: ToolContext): Promise<ToolOutcome> {
  const effectiveCtx: ToolContext = args.dryRun ? { ...ctx, armed: false } : ctx;
  const target = args.target;
  const ref = args.ref;
  const files = args.files ?? [];

  if (files.length === 0) {
    throw invalid("missing files to upload.");
  }

  let semanticTarget: { id: string; query?: string; occurrence?: number; scopedId?: string } | undefined;
  let rawRef: string | undefined;
  let displayTarget = "";

  if (target !== undefined) {
    if (ref !== undefined) throw invalid("pass either target or ref, not both.");
    const parsed = parseTarget(target.startsWith("@") ? target : `@${target}`);
    if (parsed.kind === "id") {
      semanticTarget = parsed;
      displayTarget = `@${parsed.id}`;
    } else {
      rawRef = parsed.ref;
    }
  } else if (ref !== undefined) {
    if (ref.startsWith("@")) {
      const parsed = parseTarget(ref);
      if (parsed.kind === "id") {
        semanticTarget = parsed;
        displayTarget = `@${parsed.id}`;
      } else {
        rawRef = parsed.ref;
      }
    } else {
      rawRef = ref;
    }
  } else {
    throw invalid("pass target (@id or visible text) or ref (eN).");
  }

  const backend = getBackend(effectiveCtx);

  if (semanticTarget !== undefined) {
    if (effectiveCtx.mode === "offline") {
      throw invalid("semantic targets need the live backend (--backend bidi).");
    }
    const semCtx: SemanticContext = {
      ...effectiveCtx.screens,
      backend,
      armed: effectiveCtx.armed,
    };
    const screen = await screenAt(semCtx);
    const resolved = resolveTarget(screen, semanticTarget, "upload");
    const exec = await executeSemantic(semCtx, [{ intent: "upload", target: resolved, files }], "single");
    return actionOutcome(effectiveCtx, backend, exec.nextSnapshotId, displayTarget);
  }

  // Raw ref execution
  if (rawRef === undefined) {
    throw invalid("pass target (@id or visible text) or ref (eN).");
  }
  const id = args.snapshotId ?? (await latestSnapshotId({ agentDir: backend.agentDir }));
  if (id === null) {
    throw invalid("missing --snapshot <id> and no stored snapshot exists.", "run: snapshot first");
  }
  const nextId = await performUpload(id, rawRef, files, { backend, armed: effectiveCtx.armed });
  if (!effectiveCtx.armed) {
    console.log(NO_INPUT_LINE);
  }
  return actionOutcome(effectiveCtx, backend, nextId, rawRef);
}
