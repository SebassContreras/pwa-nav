// Multi-screen User Journey model and parameter interpolation for spec 007 (T002).
// Pure logic. Error messages and hints NEVER contain provided text values.
import { Ajv2020 } from "ajv/dist/2020.js";
import { PwaNavError } from "../core/errors.js";
import type { Screen, ScreenMap, Journey, JourneyStep } from "./screen-map.js";
import { resolveTarget, resolveFlow, type ResolvedStep } from "./screen-resolve.js";

export interface ResolvedJourneyStep {
  screenId: string;
  actionSummary: string;
  expectScreen?: string;
  resolvedSteps: ResolvedStep[];
}

const TEMPLATE_VAR_RE = /\$\{\s*(?:inputs\.)?([a-zA-Z0-9_-]+)\s*\}/g;
const HUMAN_HINT = "the user must perform it by hand; the agent never types credentials";

function toPrimitiveString(val: unknown): string {
  if (typeof val === "string") {
    return val;
  }
  if (typeof val === "number" || typeof val === "boolean" || typeof val === "bigint") {
    return val.toString();
  }
  return JSON.stringify(val);
}

export function interpolateTemplate(
  template: string,
  inputs: Readonly<Record<string, unknown>>,
  contextName = "journey",
): string {
  return template.replace(TEMPLATE_VAR_RE, (_match, varName: string) => {
    if (!Object.hasOwn(inputs, varName)) {
      throw new PwaNavError("invalid_args", `missing input variable "${varName}" for ${contextName}`);
    }
    const val = inputs[varName];
    if (val === undefined || val === null) {
      throw new PwaNavError("invalid_args", `input variable "${varName}" for ${contextName} is null or undefined`);
    }
    return toPrimitiveString(val);
  });
}

export function interpolateStepInputs(
  stepInputs: Record<string, unknown> | undefined,
  journeyInputs: Readonly<Record<string, unknown>>,
  contextName = "journey",
): Record<string, string> {
  const result: Record<string, string> = {};
  if (stepInputs !== undefined) {
    for (const [k, v] of Object.entries(stepInputs)) {
      if (typeof v === "string") {
        result[k] = interpolateTemplate(v, journeyInputs, contextName);
      } else if (v !== undefined && v !== null) {
        result[k] = toPrimitiveString(v);
      }
    }
  } else {
    // If stepInputs is omitted, pass through journeyInputs as default values
    for (const [k, v] of Object.entries(journeyInputs)) {
      if (v !== undefined && v !== null) {
        result[k] = toPrimitiveString(v);
      }
    }
  }
  return result;
}

export function validateJourneyInputs(
  journey: Journey,
  inputs: Readonly<Record<string, unknown>>,
): Record<string, string> {
  if (journey.humanOnly) {
    throw new PwaNavError("sensitive_target", `journey "${journey.id}" is human-only: the user must perform it by hand`, {
      hint: HUMAN_HINT,
    });
  }

  if (journey.inputSchema) {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    let validate;
    try {
      validate = ajv.compile(journey.inputSchema);
    } catch (error) {
      throw new PwaNavError("invalid_args", `journey "${journey.id}" has an invalid inputSchema`, { cause: error });
    }
    if (!validate(inputs)) {
      const paths = new Set<string>();
      for (const error of validate.errors ?? []) {
        const params = error.params as { missingProperty?: string; additionalProperty?: string };
        const child = params.missingProperty ?? params.additionalProperty;
        const path = child === undefined ? error.instancePath : `${error.instancePath}/${child}`;
        paths.add(`${path === "" ? "/" : path} (${error.keyword})`);
      }
      throw new PwaNavError("invalid_args", `invalid inputs for journey "${journey.id}"`, {
        hint: `failing properties: ${[...paths].join(", ")}`,
      });
    }
  }

  const strInputs: Record<string, string> = {};
  for (const [k, v] of Object.entries(inputs)) {
    if (v !== undefined && v !== null) {
      strInputs[k] = toPrimitiveString(v);
    }
  }
  return strInputs;
}

export function findJourney(map: ScreenMap, journeyId: string): Journey {
  const journey = map.journeys?.find((j) => j.id === journeyId);
  if (!journey) {
    const available = (map.journeys ?? []).map((j) => j.id);
    const hint =
      available.length > 0 ? `available journeys: ${available.join(", ")}` : "no journeys defined in screen map";
    throw new PwaNavError("unknown_target", `unknown journey "${journeyId}"`, { hint });
  }
  return journey;
}

export function resolveJourneyStep(
  screen: Screen,
  step: JourneyStep,
  journeyInputs: Readonly<Record<string, unknown>>,
): ResolvedJourneyStep {
  if (screen.id !== step.screenId) {
    throw new PwaNavError(
      "invalid_args",
      `cannot resolve step for screen "${step.screenId}" against current screen "${screen.id}"`,
    );
  }

  const actionStr = interpolateTemplate(step.action, journeyInputs, `journey step (${step.screenId})`);
  const stepInputs = interpolateStepInputs(step.inputs, journeyInputs, `journey step (${step.screenId})`);

  if (actionStr.startsWith("flow:")) {
    const flowId = actionStr.slice("flow:".length);
    const resolvedFlow = resolveFlow(screen, flowId, stepInputs);
    return {
      screenId: step.screenId,
      actionSummary: `flow:${flowId}`,
      expectScreen: step.expectScreen,
      resolvedSteps: resolvedFlow.steps,
    };
  }

  if (actionStr.startsWith("click:@")) {
    const targetId = actionStr.slice("click:@".length);
    const target = resolveTarget(screen, targetId, "click");
    return {
      screenId: step.screenId,
      actionSummary: `click @${targetId}`,
      expectScreen: step.expectScreen,
      resolvedSteps: [{ op: "click", target }],
    };
  }

  if (actionStr.startsWith("fill:@")) {
    const remainder = actionStr.slice("fill:@".length);
    const eqIndex = remainder.indexOf("=");
    if (eqIndex >= 0) {
      const targetId = remainder.slice(0, eqIndex);
      const text = remainder.slice(eqIndex + 1);
      const target = resolveTarget(screen, targetId, "fill");
      return {
        screenId: step.screenId,
        actionSummary: `fill @${targetId}`,
        expectScreen: step.expectScreen,
        resolvedSteps: [{ op: "fill", target, text }],
      };
    } else {
      const targetId = remainder;
      const text = stepInputs[targetId] ?? stepInputs["text"] ?? stepInputs["value"];
      if (text === undefined) {
        throw new PwaNavError("invalid_args", `missing fill text for target @${targetId} in journey step`);
      }
      const target = resolveTarget(screen, targetId, "fill");
      return {
        screenId: step.screenId,
        actionSummary: `fill @${targetId}`,
        expectScreen: step.expectScreen,
        resolvedSteps: [{ op: "fill", target, text }],
      };
    }
  }

  if (actionStr.startsWith("@")) {
    const targetId = actionStr.slice(1);
    const field = screen.fields.find((f) => f.id === targetId);
    if (field !== undefined) {
      const text = stepInputs[targetId] ?? stepInputs["text"] ?? stepInputs["value"];
      if (text === undefined) {
        throw new PwaNavError("invalid_args", `missing fill text for target @${targetId} in journey step`);
      }
      const target = resolveTarget(screen, targetId, "fill");
      return {
        screenId: step.screenId,
        actionSummary: `fill @${targetId}`,
        expectScreen: step.expectScreen,
        resolvedSteps: [{ op: "fill", target, text }],
      };
    } else {
      const target = resolveTarget(screen, targetId, "click");
      return {
        screenId: step.screenId,
        actionSummary: `click @${targetId}`,
        expectScreen: step.expectScreen,
        resolvedSteps: [{ op: "click", target }],
      };
    }
  }

  throw new PwaNavError(
    "invalid_args",
    `unrecognized journey action "${actionStr}" (expected flow:<id>, click:@<id>, fill:@<id>, or @<id>)`,
  );
}

export function describeJourneyPlan(
  map: ScreenMap,
  journey: Journey,
  journeyInputs: Readonly<Record<string, unknown>>,
): string[] {
  const lines: string[] = [];
  lines.push(`journey "${journey.id}": ${journey.description} (${journey.steps.length.toString()} steps)`);

  const screenMap = new Map(map.screens.map((s) => [s.id, s]));
  journey.steps.forEach((step, idx) => {
    const screen = screenMap.get(step.screenId);
    const expectStr = step.expectScreen ? ` -> expectScreen: ${step.expectScreen}` : "";
    if (screen === undefined) {
      lines.push(`  Step ${(idx + 1).toString()} [${step.screenId}]: (unmapped screen)${expectStr}`);
      return;
    }
    try {
      const resolved = resolveJourneyStep(screen, step, journeyInputs);
      const stepSummary = resolved.resolvedSteps
        .map((s) => (s.op === "click" ? `click @${s.target.id}` : `fill @${s.target.id}`))
        .join(", ");
      lines.push(`  Step ${(idx + 1).toString()} [${step.screenId}]: ${resolved.actionSummary} [${stepSummary}]${expectStr}`);
    } catch {
      lines.push(`  Step ${(idx + 1).toString()} [${step.screenId}]: ${step.action}${expectStr}`);
    }
  });

  return lines;
}
