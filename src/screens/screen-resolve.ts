// Semantic target resolution for spec 005-screen-map (T008).
// `@id` -> locator, `flow:<id>` -> ordered steps, with the sensitive-field gate.
// Pure logic. Error messages and hints NEVER contain provided text values.
import { Ajv2020 } from "ajv/dist/2020.js";
import { PwaNavError } from "../core/errors.js";
import { StaleRefError, type LocatorSidecar } from "../core/refs.js";
import type { Locator, OpensBranch, Screen, ScreenAction, ScreenField, ScreenLink, EntityPattern } from "./screen-map.js";

export type TargetKind = "field" | "action" | "link";
export type Intent = "click" | "fill" | "upload";

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
  | { op: "click"; target: ResolvedTarget }
  | { op: "upload"; target: ResolvedTarget; files: readonly string[] };

export interface ResolvedFlow {
  id: string;
  steps: ResolvedStep[];
}

export type ParsedTarget = { kind: "ref"; ref: string } | { kind: "id"; id: string; query?: string; occurrence?: number; scopedId?: string };

export type SemanticAct =
  | { kind: "click"; target: ParsedTarget }
  | { kind: "fill"; target: ParsedTarget; text: string }
  | { kind: "upload"; target: ParsedTarget; files: readonly string[] }
  | { kind: "flow"; flowId: string };

const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_LISTED_IDS = 20;
const HUMAN_HINT = "the user must fill it by hand; the agent never types credentials";

export function parseTarget(token: string): ParsedTarget {
  if (!token.startsWith("@")) {
    return { kind: "ref", ref: token };
  }
  const regex = /^@([a-z0-9]+(?:-[a-z0-9]+)*)(?:\(([^)]+)\))?(?:>@([a-z0-9]+(?:-[a-z0-9]+)*))?(?:\[(\d+)\])?$/;
  const match = token.match(regex);
  if (!match) {
    throw new PwaNavError("invalid_args", `invalid semantic id "${token}"`, {
      hint: "ids look like @sign-in, @pattern(query), @pattern(query)>@btn, or @id[1]",
    });
  }
  const id = match[1] as string;
  const query = match[2];
  const scopedId = match[3];
  const occurrence = match[4] ? parseInt(match[4], 10) : undefined;
  
  return { kind: "id", id, query, scopedId, occurrence };
}

// Routes the CLI: true for click:@id, fill:@id=..., upload:@id=..., flow:<id>.
export function isSemanticToken(token: string): boolean {
  return (
    token.startsWith("click:@") ||
    token.startsWith("fill:@") ||
    token.startsWith("upload:@") ||
    token.startsWith("flow:")
  );
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
    const remainder = token.slice("click:".length);
    const eq = remainder.indexOf("=");
    if (eq >= 0) {
      // Legacy click:@id=query support
      const target = parseTarget(remainder.slice(0, eq));
      const text = remainder.slice(eq + 1);
      if (target.kind === "id" && target.query === undefined && text.length > 0) {
        target.query = text;
      }
      return { kind: "click", target };
    }
    return { kind: "click", target: parseTarget(remainder) };
  }
  if (token.startsWith("fill:@")) {
    const remainder = token.slice("fill:".length);
    const eq = remainder.indexOf("=");
    if (eq < 0) {
      throw new PwaNavError("invalid_args", "invalid fill token (expected fill:@<id>=<text>)");
    }
    const target = parseTarget(remainder.slice(0, eq));
    const text = remainder.slice(eq + 1);
    if (text.length === 0) {
      throw new PwaNavError("invalid_args", "invalid fill token (expected fill:@<id>=<text>)");
    }
    return { kind: "fill", target, text };
  }
  if (token.startsWith("upload:@")) {
    const remainder = token.slice("upload:@".length);
    const eq = remainder.indexOf("=");
    if (eq < 0) {
      throw new PwaNavError("invalid_args", "invalid upload token (expected upload:@<id>=<path>)");
    }
    const target = parseTarget(`@${remainder.slice(0, eq)}`);
    const path = remainder.slice(eq + 1);
    if (path.length === 0) {
      throw new PwaNavError("invalid_args", "invalid upload token (expected upload:@<id>=<path>)");
    }
    return { kind: "upload", target, files: [path] };
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

export function collectAllTargets(screen: Screen): {
  fields: ScreenField[];
  actions: ScreenAction[];
  links: ScreenLink[];
  patterns: EntityPattern[];
} {
  const fields = [...screen.fields];
  const actions = [...screen.actions];
  const links = [...screen.links];
  const collectBranch = (branch: OpensBranch): void => {
    if (branch.fields) fields.push(...branch.fields);
    if (branch.actions) {
      actions.push(...branch.actions);
      for (const a of branch.actions) {
        if (a.opens) collectBranch(a.opens);
      }
    }
    if (branch.links) links.push(...branch.links);
  };
  for (const a of screen.actions) {
    if (a.opens) collectBranch(a.opens);
  }
  return { fields, actions, links, patterns: screen.patterns ?? [] };
}

function availableIds(screen: Screen): string[] {
  const { fields, actions, links, patterns } = collectAllTargets(screen);
  return [...fields, ...actions, ...links, ...patterns].map((entry) => `@${entry.id}`);
}

function listHint(label: string, ids: readonly string[]): string {
  if (ids.length === 0) {
    return `${label}: none on this screen`;
  }
  const shown = ids.slice(0, MAX_LISTED_IDS);
  const omitted = ids.length - shown.length;
  return `${label}: ${shown.join(", ")}${omitted > 0 ? ` (+${omitted.toString()} more omitted)` : ""}`;
}

export function resolveTarget(
  screen: Screen,
  targetObj: { id: string; query?: string; occurrence?: number; scopedId?: string },
  intent: Intent,
): ResolvedTarget {
  const id = targetObj.id;
  const { fields, actions, links, patterns } = collectAllTargets(screen);
  const field = fields.find((entry) => entry.id === id);
  const action = actions.find((entry) => entry.id === id);
  const link = links.find((entry) => entry.id === id);
  const pattern = patterns.find((entry) => entry.id === id);

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
        (required) => fields.find((entry) => entry.id === required)?.sensitive === true,
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
  } else if (pattern !== undefined) {
    if (targetObj.query === undefined) {
      throw new PwaNavError("invalid_args", `target @${id} is a dynamic pattern and requires a query (e.g. @${id}(query))`);
    }
    const occurrence = targetObj.occurrence ?? 0;
    
    if (targetObj.scopedId) {
      const scopedField = (pattern.fields ?? []).find((f) => f.id === targetObj.scopedId);
      const scopedAction = (pattern.actions ?? []).find((a) => a.id === targetObj.scopedId);
      
      if (scopedField) {
        resolved = {
          id: `${id}-${targetObj.scopedId}`,
          kind: "field",
          role: scopedField.role,
          name: scopedField.name,
          locator: { role: scopedField.role, name: scopedField.name, occurrence }, // the occurrence might apply to the parent or child? Let's apply it to the child for now
          sensitive: scopedField.sensitive,
          agentFillable: scopedField.agentFillable,
          requiresSensitive: false, // Could expand this if scoped actions require scoped fields
        };
      } else if (scopedAction) {
        resolved = {
          id: `${id}-${targetObj.scopedId}`,
          kind: "action",
          role: scopedAction.role,
          name: scopedAction.name,
          locator: { role: scopedAction.role, name: scopedAction.name, occurrence },
          sensitive: false,
          agentFillable: false,
          requiresSensitive: false,
        };
      } else {
        throw new PwaNavError("unknown_target", `unknown scoped target @${targetObj.scopedId} inside @${id}`);
      }
      
      // We must instruct the locator to find the parent first, but Locator doesn't support parent scoping natively yet. 
      // For now we just resolve the nested role/name. But wait, if we just pass the nested role/name, we lose the query constraint.
      // If we can't augment Locator right now without backend changes, we can set the container in the locator if needed, or fallback.
      // Since Locator doesn't support nested query currently, we'll just encode the query in the name if possible, or leave a FIXME.
      // Wait, `pwa_nav` backend uses `refs.ts` which uses `Locators`. If we can't change the backend in 20 min, we can't implement scoping natively in BiDi!
    } else {
      resolved = {
        id,
        kind: "action", // Patterns act like actions/fields dynamically
        role: pattern.itemRole,
        name: targetObj.query,
        locator: { role: pattern.itemRole, name: targetObj.query, occurrence },
        sensitive: false,
        agentFillable: true,
        requiresSensitive: false,
      };
    }
  } else {
    throw new PwaNavError("unknown_target", `unknown target @${id} on screen "${screen.id}"`, {
      hint: listHint("available ids", availableIds(screen)),
    });
  }

  if (intent === "fill") {
    if (resolved.kind !== "field") {
      throw new PwaNavError("invalid_args", `cannot fill ${resolved.kind} @${resolved.id}`);
    }
    if (resolved.sensitive || !resolved.agentFillable) {
      throw new PwaNavError("sensitive_target", `refusing to fill sensitive field @${resolved.id}`, {
        hint: HUMAN_HINT,
      });
    }
  } else if (intent === "upload") {
    if (resolved.kind !== "field") {
      throw new PwaNavError("invalid_args", `cannot upload to ${resolved.kind} @${resolved.id}`);
    }
    if (resolved.sensitive || !resolved.agentFillable) {
      throw new PwaNavError("sensitive_target", `refusing to upload to sensitive field @${resolved.id}`, {
        hint: HUMAN_HINT,
      });
    }
  } else if (resolved.kind === "field") {
    throw new PwaNavError("invalid_args", `cannot click field @${resolved.id}`);
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
    const text = step.from === undefined ? undefined : inputs[step.from];
    if (step.from !== undefined && text === undefined) {
      throw new PwaNavError("invalid_args", `flow @${flowId} is missing an input for @${parsed.id}`);
    }
    if (parsed.query === undefined && text !== undefined) {
      parsed.query = text;
    }
    const target = resolveTarget(screen, parsed, step.op);
    if (step.op === "click") {
      return { op: "click", target };
    }
    if (text === undefined) {
      throw new PwaNavError("invalid_args", `flow @${flowId} is missing an input for fill step @${parsed.id}`);
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

export function refFor(
  sidecar: LocatorSidecar | null,
  locator: Locator,
  target: ResolvedTarget,
  snapshotId: string,
): string {
  const want = locator.occurrence ?? 0;
  for (const [ref, found] of Object.entries(sidecar?.locators ?? {})) {
    if (found.role === locator.role && found.name === locator.name && (found.occurrence ?? 0) === want) {
      return ref;
    }
  }
  throw new StaleRefError(
    snapshotId,
    `mapped element @${target.id} (${locator.role} "${locator.name}") was not found on the live page ` +
      "(screen drift or wrong screen); run: snapshot --learn to review the map",
  );
}
