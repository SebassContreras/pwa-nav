// Multi-screen User Journey execution engine for spec 007 (T003).
// Coordinates screen matching, step execution, transition settling, and post-condition assertions.
import type { Backend, ActOp } from "../backend/backend.js";
import { OfflineBackend } from "../backend/backend.js";
import { PwaNavError } from "../core/errors.js";
import { loadLocators } from "../core/refs.js";
import type { Screen, ScreenMap, Journey } from "../screens/screen-map.js";
import {
  describeJourneyPlan,
  findJourney,
  resolveJourneyStep,
  validateJourneyInputs,
} from "../screens/screen-journey.js";
import {
  findScreen,
  loadExplicitMap,
  loadScreenMapsFromDir,
  resolveScreensDir,
  selectMap,
} from "../screens/screen-match.js";
import { refFor } from "../screens/screen-resolve.js";
import { renderScreenView } from "../screens/screen-view.js";
import { performAct, performLiveSnapshot, type OpOptions } from "./ops.js";

export interface PerformJourneyOptions extends OpOptions {
  screenMap?: string;
  screensDir?: string;
  map?: ScreenMap;
}

export interface PerformJourneyResult {
  journeyId: string;
  armed: boolean;
  completedSteps: number;
  totalSteps: number;
  finalUrl: string;
  finalScreen?: Screen;
  plan: string[];
}

export async function resolveJourneyMap(
  journeyId: string,
  backend: Backend,
  options: { screenMap?: string; screensDir?: string; map?: ScreenMap },
): Promise<{ map: ScreenMap; journey: Journey }> {
  if (options.map !== undefined) {
    const journey = findJourney(options.map, journeyId);
    return { map: options.map, journey };
  }

  if (options.screenMap !== undefined) {
    const map = await loadExplicitMap(options.screenMap);
    const journey = findJourney(map, journeyId);
    return { map, journey };
  }

  const dir = resolveScreensDir(options.screensDir === undefined ? {} : { screensDir: options.screensDir });
  const maps = await loadScreenMapsFromDir(dir);

  let currentUrl = "";
  try {
    currentUrl = await backend.currentUrl();
  } catch {
    // Backend may not have session or URL yet
  }

  if (currentUrl.length > 0) {
    try {
      const selected = selectMap(maps, currentUrl, dir);
      const journey = selected.journeys?.find((j) => j.id === journeyId);
      if (journey !== undefined) {
        return { map: selected, journey };
      }
    } catch {
      // Fall through to search maps
    }
  }

  for (const entry of maps) {
    const found = entry.map.journeys?.find((j) => j.id === journeyId);
    if (found !== undefined) {
      return { map: entry.map, journey: found };
    }
  }

  if (maps.length > 0 && maps[0] !== undefined) {
    return { map: maps[0].map, journey: findJourney(maps[0].map, journeyId) };
  }

  throw new PwaNavError("unknown_target", `no screen maps found in "${dir}" defining journey "${journeyId}"`);
}

export async function performJourney(
  journeyId: string,
  inputs: Record<string, unknown> = {},
  options: PerformJourneyOptions = {},
): Promise<PerformJourneyResult> {
  const backend = options.backend ?? new OfflineBackend();
  const { map, journey } = await resolveJourneyMap(journeyId, backend, options);

  const validatedInputs = validateJourneyInputs(journey, inputs);
  const plan = describeJourneyPlan(map, journey, validatedInputs);

  if (!options.armed) {
    for (const line of plan) {
      console.log(line);
    }
    console.log("no input sent (pass --armed to execute)");
    return {
      journeyId: journey.id,
      armed: false,
      completedSteps: 0,
      totalSteps: journey.steps.length,
      finalUrl: "",
      plan,
    };
  }

  let currentUrl = await backend.currentUrl();
  if (currentUrl.length === 0) {
    throw new PwaNavError("invalid_args", "no current URL", { hint: "run: open <url> first" });
  }

  const total = journey.steps.length;
  for (let i = 0; i < total; i++) {
    const step = journey.steps[i];
    if (step === undefined) {
      continue;
    }
    const stepNum = i + 1;

    currentUrl = await backend.currentUrl();
    let currentScreen: Screen;
    try {
      currentScreen = findScreen(map, currentUrl).screen;
    } catch (error) {
      throw new PwaNavError(
        "journey_step_failed",
        `step ${stepNum.toString()}/${total.toString()} failed: current URL "${currentUrl}" does not match any mapped screen (expected "${step.screenId}")`,
        { cause: error },
      );
    }

    if (currentScreen.id !== step.screenId) {
      throw new PwaNavError(
        "journey_step_failed",
        `step ${stepNum.toString()}/${total.toString()} failed: current screen is "${currentScreen.id}", expected "${step.screenId}"`,
        { hint: `current url: ${currentUrl}` },
      );
    }

    const resolved = resolveJourneyStep(currentScreen, step, validatedInputs);
    console.log(
      `journey step ${stepNum.toString()}/${total.toString()} [${step.screenId}]: ${resolved.actionSummary}`,
    );

    const fresh = await performLiveSnapshot(backend, { quiet: true });
    const sidecar = await loadLocators(fresh.snapshotId, { agentDir: backend.agentDir });

    const ops: ActOp[] = resolved.resolvedSteps.map((s) => {
      const ref = refFor(sidecar, s.target.locator, s.target, fresh.snapshotId);
      return s.op === "click" ? { kind: "click", ref } : { kind: "fill", ref, text: s.text };
    });

    try {
      await performAct(fresh.snapshotId, ops, { backend, armed: true });
    } catch (error) {
      throw new PwaNavError(
        "journey_step_failed",
        `step ${stepNum.toString()}/${total.toString()} failed executing action "${resolved.actionSummary}" on screen "${step.screenId}"`,
        { cause: error },
      );
    }

    if (step.expectScreen !== undefined) {
      const afterUrl = await backend.currentUrl();
      let afterScreen: Screen;
      try {
        afterScreen = findScreen(map, afterUrl).screen;
      } catch (error) {
        throw new PwaNavError(
          "journey_step_failed",
          `step ${stepNum.toString()}/${total.toString()} failed transition expectation: expected screen "${step.expectScreen}", but arrived at unmapped URL "${afterUrl}"`,
          { cause: error },
        );
      }
      if (afterScreen.id !== step.expectScreen) {
        throw new PwaNavError(
          "journey_step_failed",
          `step ${stepNum.toString()}/${total.toString()} failed transition expectation: expected screen "${step.expectScreen}", but arrived at "${afterScreen.id}" (${afterUrl})`,
          { hint: `expected: ${step.expectScreen}, actual: ${afterScreen.id}` },
        );
      }
    }
  }

  const finalUrl = await backend.currentUrl();
  const finalScreen = findScreen(map, finalUrl).screen;
  console.log(renderScreenView(finalScreen));

  return {
    journeyId: journey.id,
    armed: true,
    completedSteps: total,
    totalSteps: total,
    finalUrl,
    finalScreen,
    plan,
  };
}
