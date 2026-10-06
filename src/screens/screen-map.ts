// Screen map for spec 005-screen-map (T001-T003).
// Types, JSON Schema validation (single source of truth: schemas/screen-map.schema.json),
// cross-reference rules the schema cannot express, and the drift fingerprint.
// Pure logic + file IO. No browser calls.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

export const SCREEN_MAP_SCHEMA_URL = new URL("../../schemas/screen-map.schema.json", import.meta.url);

export interface Locator {
  role: string;
  name: string;
  occurrence?: number;
}

export interface ScreenField {
  id: string;
  role: string;
  name: string;
  nameSource: string;
  inputType?: string;
  required?: boolean;
  sensitive: boolean;
  agentFillable: boolean;
  locator: Locator;
  dialog?: string;
  container?: string;
}

export interface OpensBranch {
  id: string;
  type: "dialog" | "subdialog" | "menu" | "view";
  title: string;
  fields?: ScreenField[];
  actions?: ScreenAction[];
  links?: ScreenLink[];
}

export function mergeOpensBranch(oldBranch: OpensBranch, liveBranch: OpensBranch): OpensBranch {
  const fieldMap = new Map<string, ScreenField>();
  for (const f of oldBranch.fields ?? []) fieldMap.set(f.id, f);
  for (const f of liveBranch.fields ?? []) fieldMap.set(f.id, f);

  const actionMap = new Map<string, ScreenAction>();
  for (const a of oldBranch.actions ?? []) actionMap.set(a.id, a);
  for (const a of liveBranch.actions ?? []) {
    const existing = actionMap.get(a.id);
    if (existing !== undefined) {
      actionMap.set(a.id, {
        ...existing,
        ...a,
        opens:
          existing.opens && a.opens
            ? mergeOpensBranch(existing.opens, a.opens)
            : (a.opens ?? existing.opens),
      });
    } else {
      actionMap.set(a.id, a);
    }
  }

  const linkMap = new Map<string, ScreenLink>();
  for (const l of oldBranch.links ?? []) linkMap.set(l.id, l);
  for (const l of liveBranch.links ?? []) linkMap.set(l.id, l);

  const fields = Array.from(fieldMap.values());
  const actions = Array.from(actionMap.values());
  const links = Array.from(linkMap.values());

  return {
    id: liveBranch.id || oldBranch.id,
    type: liveBranch.type,
    title: liveBranch.title || oldBranch.title,
    ...(fields.length > 0 ? { fields } : {}),
    ...(actions.length > 0 ? { actions } : {}),
    ...(links.length > 0 ? { links } : {}),
  };
}

export interface ScreenAction {
  id: string;
  role: string;
  name: string;
  nameSource?: string;
  kind: "submit" | "toggle" | "button";
  effect: "none" | "ui-state" | "submit";
  requires?: string[];
  locator: Locator;
  dialog?: string;
  container?: string;
  opens?: OpensBranch;
}

export interface ScreenLink {
  id: string;
  name: string;
  href: string;
  external: boolean;
  locator: Locator;
}

export interface FlowStep {
  op: "fill" | "click";
  target: string;
  from?: string;
}

export interface ScreenFlow {
  id: string;
  description: string;
  humanOnly: boolean;
  inputSchema: Record<string, unknown>;
  steps: FlowStep[];
}

export interface A11yFinding {
  code: "name-from-placeholder-only" | "missing-accessible-name" | "duplicate-name";
  target: string;
  detail: string;
  wcag?: string;
}

export interface EntityPattern {
  id: string;
  containerRole: string;
  containerName?: string;
  itemRole: string;
  actionTarget?: string;
  actions?: ScreenAction[];
  fields?: ScreenField[];
}

export interface Screen {
  id: string;
  route: string;
  title: string;
  access: "public" | "authenticated" | "unknown";
  fingerprint: string;
  observedAt: string;
  fields: ScreenField[];
  actions: ScreenAction[];
  links: ScreenLink[];
  flows: ScreenFlow[];
  patterns?: EntityPattern[];
  a11y?: A11yFinding[];
}

export interface JourneyStep {
  screenId: string;
  action: string;
  inputs?: Record<string, unknown>;
  expectScreen?: string;
}

export interface Journey {
  id: string;
  description: string;
  humanOnly?: boolean;
  inputSchema?: Record<string, unknown>;
  steps: JourneyStep[];
}

export interface ScreenMap {
  $schema?: string;
  schemaVersion: string;
  app: {
    id: string;
    name: string;
    origin: string;
    version?: string;
    locale: string;
    learnedAt: string;
  };
  screens: Screen[];
  journeys?: Journey[];
  unmapped?: {
    route?: string;
    reason: "link-only" | "requires-login" | "not-visited";
    discoveredFrom?: string;
    note?: string;
  }[];
}

export interface ScreenMapIssue {
  path: string;
  message: string;
}

export class ScreenMapError extends Error {
  readonly issues: readonly ScreenMapIssue[];

  constructor(issues: readonly ScreenMapIssue[]) {
    super(
      `invalid screen map (${issues.length.toString()} issue${issues.length === 1 ? "" : "s"}):\n` +
        issues.map((issue) => `  ${issue.path}: ${issue.message}`).join("\n"),
    );
    this.name = "ScreenMapError";
    this.issues = issues;
  }
}

// Compares by Unicode code point so the order is identical on every runtime and locale.
function compareCodePoints(a: string, b: string): number {
  const left = Array.from(a);
  const right = Array.from(b);
  const shared = Math.min(left.length, right.length);
  for (let index = 0; index < shared; index += 1) {
    const diff = (left[index]?.codePointAt(0) ?? 0) - (right[index]?.codePointAt(0) ?? 0);
    if (diff !== 0) {
      return diff;
    }
  }
  return left.length - right.length;
}

// sha256 over the sorted `role<TAB>name` lines, joined by LF, UTF-8.
// Same rule as the schema description; a mismatch on re-learn means the screen drifted.
export function fingerprintOf(elements: readonly { role: string; name: string }[]): string {
  const lines = elements.map((element) => `${element.role}\t${element.name}`).sort(compareCodePoints);
  return `sha256:${createHash("sha256").update(lines.join("\n"), "utf8").digest("hex")}`;
}

// Every interactive element a screen declares, in the form the fingerprint hashes.
export function screenElements(screen: Screen): { role: string; name: string }[] {
  const result: { role: string; name: string }[] = [
    ...screen.fields.map(({ role, name }) => ({ role, name })),
    ...screen.actions.map(({ role, name }) => ({ role, name })),
    ...screen.links.map(({ name }) => ({ role: "link", name })),
    ...(screen.patterns ?? []).flatMap((p) => [
      { role: p.containerRole, name: p.containerName ?? "" },
      ...(p.fields ?? []).map(({ role, name }) => ({ role, name })),
      ...(p.actions ?? []).map(({ role, name }) => ({ role, name }))
    ]),
  ];
  const collectOpens = (branch: OpensBranch): void => {
    if (branch.fields) result.push(...branch.fields.map(({ role, name }) => ({ role, name })));
    if (branch.actions) {
      result.push(...branch.actions.map(({ role, name }) => ({ role, name })));
      for (const a of branch.actions) {
        if (a.opens) collectOpens(a.opens);
      }
    }
    if (branch.links) result.push(...branch.links.map(({ name }) => ({ role: "link", name })));
  };
  for (const action of screen.actions) {
    if (action.opens) collectOpens(action.opens);
  }
  for (const pattern of screen.patterns ?? []) {
    for (const action of pattern.actions ?? []) {
      if (action.opens) collectOpens(action.opens);
    }
  }
  return result;
}

let cachedValidate: ((data: unknown) => boolean) | undefined;
let cachedErrors: () => ScreenMapIssue[] = () => [];

async function schemaValidator(): Promise<(data: unknown) => boolean> {
  if (cachedValidate !== undefined) {
    return cachedValidate;
  }
  const schema = JSON.parse(await readFile(fileURLToPath(SCREEN_MAP_SCHEMA_URL), "utf8")) as object;
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats.default(ajv);
  const validate = ajv.compile(schema);
  cachedErrors = () =>
    (validate.errors ?? []).map((error) => ({
      path: error.instancePath === "" ? "/" : error.instancePath,
      message: error.message ?? "invalid",
    }));
  cachedValidate = (data: unknown) => validate(data);
  return cachedValidate;
}

function duplicates(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const repeated = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) {
      repeated.add(value);
    }
    seen.add(value);
  }
  return [...repeated];
}

// Rules JSON Schema cannot express: unique ids, resolvable references,
// sensitive-field safety, and fingerprint integrity.
export function crossCheck(map: ScreenMap): ScreenMapIssue[] {
  const issues: ScreenMapIssue[] = [];
  for (const repeated of duplicates(map.screens.map((screen) => screen.id))) {
    issues.push({ path: "/screens", message: `duplicate screen id "${repeated}"` });
  }
  for (const repeated of duplicates(map.screens.map((screen) => screen.route))) {
    issues.push({ path: "/screens", message: `duplicate route "${repeated}"` });
  }

  map.screens.forEach((screen, index) => {
    const base = `/screens/${index.toString()}`;
    const fields = new Map(screen.fields.map((field) => [field.id, field]));
    const targets = new Map<string, "field" | "action" | "link">();
    const register = (ids: readonly string[], kind: "field" | "action" | "link"): void => {
      for (const id of ids) {
        if (targets.has(id)) {
          issues.push({ path: base, message: `id "${id}" is used by more than one target` });
        }
        targets.set(id, kind);
      }
    };
    register(screen.fields.map((entry) => entry.id), "field");
    register(screen.actions.map((entry) => entry.id), "action");
    register(screen.links.map((entry) => entry.id), "link");

    const registerOpens = (branch: OpensBranch): void => {
      if (branch.fields) {
        for (const f of branch.fields) fields.set(f.id, f);
        register(branch.fields.map((f) => f.id), "field");
      }
      if (branch.actions) {
        register(branch.actions.map((a) => a.id), "action");
        for (const a of branch.actions) {
          if (a.opens) registerOpens(a.opens);
        }
      }
      if (branch.links) {
        register(branch.links.map((l) => l.id), "link");
      }
    };
    for (const action of screen.actions) {
      if (action.opens) registerOpens(action.opens);
    }

    for (const link of screen.links) {
      if (link.external && !/^https?:\/\/[^/\s?#]+$/.test(link.href)) {
        issues.push({
          path: `${base}/links/${link.id}`,
          message: "external href must be an origin only (no path, query or fragment)",
        });
      }
    }
    for (const field of screen.fields) {
      if (field.sensitive && field.agentFillable) {
        issues.push({
          path: `${base}/fields/${field.id}`,
          message: "sensitive field must have agentFillable=false",
        });
      }
    }
    for (const action of screen.actions) {
      for (const required of action.requires ?? []) {
        if (!fields.has(required)) {
          issues.push({
            path: `${base}/actions/${action.id}`,
            message: `requires unknown field "${required}"`,
          });
        }
      }
    }
    for (const flow of screen.flows) {
      let touchesSensitive = false;
      for (const step of flow.steps) {
        const id = step.target.slice(1);
        const kind = targets.get(id);
        if (kind === undefined) {
          issues.push({
            path: `${base}/flows/${flow.id}`,
            message: `step target "${step.target}" does not exist on this screen`,
          });
          continue;
        }
        if (step.op === "fill" && kind !== "field") {
          issues.push({ path: `${base}/flows/${flow.id}`, message: `cannot fill ${kind} "${step.target}"` });
        }
        if (step.op === "click" && kind === "field") {
          issues.push({ path: `${base}/flows/${flow.id}`, message: `cannot click field "${step.target}"` });
        }
        if (fields.get(id)?.sensitive === true) {
          touchesSensitive = true;
        }
        if (step.op === "fill" && step.from === undefined) {
          issues.push({
            path: `${base}/flows/${flow.id}`,
            message: `fill step "${step.target}" needs a "from" input`,
          });
        }
      }
      if (touchesSensitive && !flow.humanOnly) {
        issues.push({
          path: `${base}/flows/${flow.id}`,
          message: "flow touches a sensitive field and must be humanOnly",
        });
      }
    }
    for (const finding of screen.a11y ?? []) {
      if (!targets.has(finding.target.slice(1))) {
        issues.push({ path: `${base}/a11y`, message: `finding target "${finding.target}" does not exist` });
      }
    }
    const expected = fingerprintOf(screenElements(screen));
    if (screen.fingerprint !== expected) {
      issues.push({
        path: `${base}/fingerprint`,
        message: `does not match the declared elements (expected ${expected})`,
      });
    }
  });

  if (map.journeys) {
    for (const repeated of duplicates(map.journeys.map((j) => j.id))) {
      issues.push({ path: "/journeys", message: `duplicate journey id "${repeated}"` });
    }
    const screenMap = new Map(map.screens.map((s) => [s.id, s]));
    map.journeys.forEach((journey, jIndex) => {
      const jBase = `/journeys/${jIndex.toString()}`;
      journey.steps.forEach((step, sIndex) => {
        const sBase = `${jBase}/steps/${sIndex.toString()}`;
        const screen = screenMap.get(step.screenId);
        if (!screen) {
          issues.push({ path: sBase, message: `screenId "${step.screenId}" does not exist in screens` });
        }
        if (step.expectScreen && !screenMap.has(step.expectScreen)) {
          issues.push({ path: sBase, message: `expectScreen "${step.expectScreen}" does not exist in screens` });
        }
      });
    });
  }

  return issues;
}

// Validates raw JSON against the schema, then the cross-reference rules.
// Throws ScreenMapError listing every issue; returns the typed map otherwise.
export async function validateScreenMap(raw: unknown): Promise<ScreenMap> {
  const validate = await schemaValidator();
  if (!validate(raw)) {
    throw new ScreenMapError(cachedErrors());
  }
  const map = raw as ScreenMap;
  const issues = crossCheck(map);
  if (issues.length > 0) {
    throw new ScreenMapError(issues);
  }
  return map;
}

export async function loadScreenMap(path: string): Promise<ScreenMap> {
  return validateScreenMap(JSON.parse(await readFile(path, "utf8")) as unknown);
}
