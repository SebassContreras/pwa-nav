// Semantic target resolution for spec 005-screen-map (T008).
// `@id` -> locator, `flow:<id>` -> ordered steps, with the sensitive-field gate.
// Pure logic. Error messages and hints NEVER contain provided text values.
import { Ajv2020 } from "ajv/dist/2020.js";
import { PwaNavError } from "./errors.js";
import type { Locator, Screen } from "./screen-map.js";

export type TargetKind = "field" | "action" | "link";
export type Intent = "click" | "fill";

export interface ResolvedTarget {
  id: string;
  kind: TargetKind;
  role: string;
  name: string;
  locator: Locator;
  sensitive: boolean;
  agentFillable: boolean;
  // Action whose `requires` list includes a sensitive field (caller may warn).
  requiresSensitive: boolean;
}

export type ResolvedStep =
  | { op: "fill"; target: ResolvedTarget; text: string }
  | { op: "click"; target: ResolvedTarget };

export interface ResolvedFlow {
  id: string;
  steps: ResolvedStep[];
}

export type ParsedTarget = { kind: "ref"; ref: string } | { kind: "id"; id: string };

export type SemanticAct =
  | { kind: "click"; id: string }
  | { kind: "fill"; id: string; text: string }
  | { kind: "flow"; flowId: string };

const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_LISTED_IDS = 20;
const HUMAN_HINT = "the user must fill it by hand; the agent never types credentials";

export function parseTarget(token: string): ParsedTarget {
  if (!token.startsWith("@")) {
    return { kind: "ref", ref: token };
  }
  const id = token.slice(1);
  if (!ID_PATTERN.test(id)) {
    throw new PwaNavError("invalid_args", `invalid semantic id "${token}"`, {
      hint: "ids look like @sign-in (lowercase letters, digits, single hyphens)",
    });
  }
  return { kind: "id", id };
}

// Routes the CLI: true for click:@id, fill:@id=..., flow:<id>.
export function isSemanticToken(token: string): boolean {
  return token.startsWith("click:@") || token.startsWith("fill:@") || token.startsWith("flow:");
}

export function parseSemanticAct(token: string): SemanticAct {
  if (token.startsWith("flow:")) {
    const flowId = token.slice("flow:".length);
    if (!ID_PATTERN.test(flowId)) {
      throw new PwaNavError("invalid_args", "invalid flow token (expected flow:<id>)");
    }
    return { kind: "flow", flowId };
  }
  if (token.startsWith("click:@")) {
    const target = parseTarget(token.slice("click:".length));
    if (target.kind !== "id") {
      throw new PwaNavError("invalid_args", "invalid click token (expected click:@<id>)");
    }
    return { kind: "click", id: target.id };
  }
  if (token.startsWith("fill:@")) {
    const remainder = token.slice("fill:".length);
    const eq = remainder.indexOf("=");
    // Never echo the token: it may carry the text after "=".
    if (eq < 0) {
      throw new PwaNavError("invalid_args", "invalid fill token (expected fill:@<id>=<text>)");
    }
    const target = parseTarget(remainder.slice(0, eq));
    const text = remainder.slice(eq + 1);
    if (target.kind !== "id" || text.length === 0) {
      throw new PwaNavError("invalid_args", "invalid fill token (expected fill:@<id>=<text>)");
    }
    return { kind: "fill", id: target.id, text };
  }
  throw new PwaNavError("invalid_args", "not a semantic act token");
}

// `key=value` argv entries following a flow token. First `=` splits.
export function parseFlowInputs(argv: readonly string[]): Record<string, string> {
  const inputs: Record<string, string> = {};
  for (const entry of argv) {
    const eq = entry.indexOf("=");
    const key = eq < 0 ? "" : entry.slice(0, eq);
    if (key.length === 0) {
      // Entry may be a bare value: never echo it.
      throw new PwaNavError("invalid_args", "invalid flow input (expected key=value with a non-empty key)");
    }
    if (Object.hasOwn(inputs, key)) {
      throw new PwaNavError("invalid_args", `duplicate flow input "${key}"`);
    }
    inputs[key] = entry.slice(eq + 1);
  }
  return inputs;
}

function availableIds(screen: Screen): string[] {
  return [...screen.fields, ...screen.actions, ...screen.links].map((entry) => `@${entry.id}`);
}

function listHint(label: string, ids: readonly string[]): string {
  if (ids.length === 0) {
    return `${label}: none on this screen`;
  }
  const shown = ids.slice(0, MAX_LISTED_IDS);
  const omitted = ids.length - shown.length;
  return `${label}: ${shown.join(", ")}${omitted > 0 ? ` (+${omitted.toString()} more omitted)` : ""}`;
}

export function resolveTarget(screen: Screen, id: string, intent: Intent): ResolvedTarget {
  const field = screen.fields.find((entry) => entry.id === id);
  const action = screen.actions.find((entry) => entry.id === id);
  const link = screen.links.find((entry) => entry.id === id);

  let resolved: ResolvedTarget;
  if (field !== undefined) {
    resolved = {
      id,
      kind: "field",
      role: field.role,
      name: field.name,
      locator: field.locator,
      sensitive: field.sensitive,
      agentFillable: field.agentFillable,
      requiresSensitive: false,
    };
  } else if (action !== undefined) {
    resolved = {
      id,
      kind: "action",
      role: action.role,
      name: action.name,
      locator: action.locator,
      sensitive: false,
      agentFillable: false,
      requiresSensitive: (action.requires ?? []).some(
        (required) => screen.fields.find((entry) => entry.id === required)?.sensitive === true,
      ),
    };
  } else if (link !== undefined) {
    resolved = {
      id,
      kind: "link",
      role: "link",
      name: link.name,
      locator: link.locator,
      sensitive: false,
      agentFillable: false,
      requiresSensitive: false,
    };
  } else {
    throw new PwaNavError("unknown_target", `unknown target @${id} on screen "${screen.id}"`, {
      hint: listHint("available ids", availableIds(screen)),
    });
  }

  if (intent === "fill") {
    if (resolved.kind !== "field") {
      throw new PwaNavError("invalid_args", `cannot fill ${resolved.kind} @${id}`);
    }
    if (resolved.sensitive || !resolved.agentFillable) {
      throw new PwaNavError("sensitive_target", `refusing to fill sensitive field @${id}`, {
        hint: HUMAN_HINT,
      });
    }
  } else if (resolved.kind === "field") {
    throw new PwaNavError("invalid_args", `cannot click field @${id}`);
  }
  return resolved;
}

// Validates inputs against the flow's inputSchema; reports property paths only, never values.
function validateInputs(flowId: string, schema: Record<string, unknown>, inputs: Record<string, string>): void {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  let validate;
  try {
    validate = ajv.compile(schema);
  } catch (error) {
    throw new PwaNavError("invalid_args", `flow @${flowId} has an invalid inputSchema`, { cause: error });
  }
  if (validate(inputs)) {
    return;
  }
  const paths = new Set<string>();
  for (const error of validate.errors ?? []) {
    const params = error.params as { missingProperty?: string; additionalProperty?: string };
    const child = params.missingProperty ?? params.additionalProperty;
    const path = child === undefined ? error.instancePath : `${error.instancePath}/${child}`;
    paths.add(`${path === "" ? "/" : path} (${error.keyword})`);
  }
  throw new PwaNavError("invalid_args", `invalid inputs for flow @${flowId}`, {
    hint: `failing properties: ${[...paths].join(", ")}`,
  });
}

export function resolveFlow(screen: Screen, flowId: string, inputs: Record<string, string>): ResolvedFlow {
  const flow = screen.flows.find((entry) => entry.id === flowId);
  if (flow === undefined) {
    throw new PwaNavError("unknown_target", `unknown flow "${flowId}" on screen "${screen.id}"`, {
      hint: listHint(
        "available flows",
        screen.flows.map((entry) => entry.id),
      ),
    });
  }
  // Human-only gate comes first: inputs are never read or validated.
  if (flow.humanOnly) {
    throw new PwaNavError("sensitive_target", `flow @${flowId} is human-only: the user must perform it by hand`, {
      hint: HUMAN_HINT,
    });
  }
  validateInputs(flowId, flow.inputSchema, inputs);

  const steps = flow.steps.map((step): ResolvedStep => {
    const parsed = parseTarget(step.target);
    if (parsed.kind !== "id") {
      throw new PwaNavError("invalid_args", `flow @${flowId} has a non-semantic step target`);
    }
    const target = resolveTarget(screen, parsed.id, step.op);
    if (step.op === "click") {
      return { op: "click", target };
    }
    const text = step.from === undefined ? undefined : inputs[step.from];
    if (text === undefined) {
      throw new PwaNavError("invalid_args", `flow @${flowId} is missing an input for @${parsed.id}`);
    }
    return { op: "fill", target, text };
  });
  return { id: flowId, steps };
}

// Dry-run line: never includes a text value.
export function describeResolved(target: ResolvedTarget, intent: Intent): string {
  const occurrence = target.locator.occurrence ?? 0;
  const warn = target.requiresSensitive ? " [submits sensitive fields]" : "";
  return `${intent} @${target.id}: ${target.role} "${target.name}" (${target.kind}, occurrence ${occurrence.toString()})${warn}`;
}
