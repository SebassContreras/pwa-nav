// Screen-map CLI behavior (spec 005, T009, spec 012): thin adapter delegating to src/tools/.
// CLI option parsing stays in src/cli.ts; domain & execution logic lives in src/tools/.
import type { Backend } from "../backend/backend.js";
import {
  clickTool,
  executeLearn,
  fillTool,
  renderScreenViewForBackend,
  uploadTool,
  actTool,
  type LearnArgs,
  type ScreenSource,
  type SemanticContext,
} from "../tools/index.js";

export { isSemanticToken } from "../screens/screen-resolve.js";
export {
  NO_INPUT_LINE,
  type ScreenSource,
  type LearnArgs as LearnOptions,
  type LearnResult,
  type SemanticContext,
  validateLearnFlags,
} from "../tools/index.js";

export async function runScreenView(backend: Backend, source: ScreenSource): Promise<void> {
  const text = await renderScreenViewForBackend(backend, source);
  console.log(text);
}

export async function runLearn(backend: Backend, o: LearnArgs): Promise<import("../tools/index.js").LearnResult> {
  return executeLearn(backend, o);
}

export async function runSemanticClick(ctx: SemanticContext, id: string): Promise<void> {
  await clickTool(
    { target: `@${id}`, dryRun: !ctx.armed },
    {
      backendFactory: () => ctx.backend,
      backend: ctx.backend,
      armed: ctx.armed,
      mode: "bidi",
      screens: ctx,
    },
  );
}

export async function runSemanticFill(ctx: SemanticContext, id: string, text: string): Promise<void> {
  await fillTool(
    { target: `@${id}`, text, dryRun: !ctx.armed },
    {
      backendFactory: () => ctx.backend,
      backend: ctx.backend,
      armed: ctx.armed,
      mode: "bidi",
      screens: ctx,
    },
  );
}

export async function runSemanticUpload(ctx: SemanticContext, id: string, files: readonly string[]): Promise<void> {
  await uploadTool(
    { target: `@${id}`, files, dryRun: !ctx.armed },
    {
      backendFactory: () => ctx.backend,
      backend: ctx.backend,
      armed: ctx.armed,
      mode: "bidi",
      screens: ctx,
    },
  );
}

export async function runSemanticAct(ctx: SemanticContext, tokens: readonly string[]): Promise<void> {
  await actTool(
    { ops: tokens, dryRun: !ctx.armed },
    {
      backendFactory: () => ctx.backend,
      backend: ctx.backend,
      armed: ctx.armed,
      mode: "bidi",
      screens: ctx,
    },
  );
}
