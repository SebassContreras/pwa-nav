import type { Backend } from "../backend/backend.js";
import { PwaNavError } from "../core/errors.js";
import { load as loadSnapshot, loadLocators } from "../core/refs.js";
import { performAct, performClick, performFill, performLiveSnapshot, performUpload } from "../ops/ops.js";
import type { ActOp } from "../ops/ops.js";
import type { Screen } from "../screens/screen-map.js";
import { describeResolved, refFor } from "../screens/screen-resolve.js";
import type { Intent, ResolvedTarget } from "../screens/screen-resolve.js";
import { renderScreenView } from "../screens/screen-view.js";
import { currentUrlOf, locateScreen } from "./screen.js";
import { NO_INPUT_LINE, type ScreenSource } from "./types.js";

export interface SemanticContext extends ScreenSource {
  backend: Backend;
  armed: boolean;
}

export interface Planned {
  intent: Intent;
  target: ResolvedTarget;
  text?: string;
  files?: readonly string[];
}

export interface SemanticExecResult {
  nextSnapshotId: string;
  lines: string[];
}

export async function screenAt(ctx: SemanticContext): Promise<Screen> {
  return (await locateScreen(await currentUrlOf(ctx.backend), ctx)).screen;
}

export async function printViewFor(url: string, source: ScreenSource): Promise<string> {
  try {
    const { screen } = await locateScreen(url, source);
    const view = renderScreenView(screen);
    console.log(view);
    return view;
  } catch (error) {
    if (error instanceof PwaNavError && error.code === "unmapped_screen") {
      const msg = [error.message, error.hint].filter((line) => line !== undefined).join("\n");
      console.log(msg);
      return msg;
    }
    throw error;
  }
}

export async function executeSemantic(
  ctx: SemanticContext,
  planned: Planned[],
  mode: "single" | "batch",
): Promise<SemanticExecResult> {
  const { backend, armed } = ctx;
  const lines: string[] = [];
  const fresh = await performLiveSnapshot(backend, { quiet: true });
  const sidecar = await loadLocators(fresh.snapshotId, { agentDir: backend.agentDir });
  const ops: ActOp[] = planned.map((step) => {
    const ref = refFor(sidecar, step.target.locator, step.target, fresh.snapshotId);
    if (step.intent === "click") return { kind: "click", ref };
    if (step.intent === "fill") return { kind: "fill", ref, text: step.text ?? "" };
    return { kind: "upload", ref, files: step.files ?? [] };
  });

  for (const step of planned) {
    const desc = describeResolved(step.target, step.intent);
    lines.push(desc);
    console.log(desc);
  }

  const [only] = planned;
  const first = ops[0];
  let nextId: string;
  if (mode === "single" && only !== undefined && first !== undefined) {
    nextId =
      first.kind === "click"
        ? await performClick(fresh.snapshotId, first.ref, { backend, armed })
        : first.kind === "fill"
          ? await performFill(fresh.snapshotId, first.ref, first.text, { backend, armed })
          : await performUpload(fresh.snapshotId, first.ref, first.files, { backend, armed });
  } else {
    nextId = await performAct(fresh.snapshotId, ops, { backend, armed });
  }

  if (!armed) {
    lines.push(NO_INPUT_LINE);
    console.log(NO_INPUT_LINE);
  }

  if (armed && nextId !== fresh.snapshotId) {
    const after = await loadSnapshot(nextId, { agentDir: backend.agentDir });
    if (after !== null) {
      const view = await printViewFor(after.url, ctx);
      lines.push(view);
    }
  }

  return {
    nextSnapshotId: nextId,
    lines,
  };
}
