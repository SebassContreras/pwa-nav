// Learn diff/merge for spec 005-screen-map (T007): existing screen + live-learned screen.
// Pure logic, no IO. Ids of existing elements never change; removal only with `prune`.
import { isDeepStrictEqual } from "node:util";
import { PwaNavError } from "./errors.js";
import { deriveIds } from "./screen-learn.js";
import { matchRoute } from "./screen-match.js";
import {
  fingerprintOf,
  screenElements,
  validateScreenMap,
  type A11yFinding,
  type Locator,
  type Screen,
  type ScreenAction,
  type ScreenField,
  type ScreenFlow,
  type ScreenLink,
  type ScreenMap,
} from "./screen-map.js";

export type DiffGroup = "field" | "action" | "link";
export type ChangeGroup = DiffGroup | "screen" | "flow";
export type ChangeValue = string | number | boolean | undefined;

export interface ElementRef {
  group: DiffGroup;
  id: string;
  role: string;
  name: string;
}

export interface RenamedEntry {
  group: DiffGroup;
  id: string;
  from: { name: string; role: string };
  to: { name: string; role: string };
}

export interface ChangedEntry {
  group: ChangeGroup;
  id: string;
  field: string;
  from: ChangeValue;
  to: ChangeValue;
}

export interface ScreenDiff {
  isNew: boolean;
  added: ElementRef[];
  missing: ElementRef[];
  renamed: RenamedEntry[];
  changed: ChangedEntry[];
  fingerprint: { stored?: string; live: string; drifted: boolean };
  a11y: { added: A11yFinding[]; resolved: A11yFinding[] };
}

export interface MergeOptions {
  prune?: boolean;
  now?: Date;
}

export interface AppInfo {
  id: string;
  name: string;
  origin: string;
  locale: string;
  version?: string;
}

type Elem = ScreenField | ScreenAction | ScreenLink;

const roleOf = (element: Elem): string => ("role" in element ? element.role : "link");
const locatorKey = (element: Elem): string => `${roleOf(element)}\t${element.name}\t${(element.locator.occurrence ?? 0).toString()}`;
const findingKey = (finding: A11yFinding): string => `${finding.code}\t${finding.target}`;
const isoSeconds = (date: Date): string => date.toISOString().replace(/\.\d{3}Z$/, "Z");
const KIND_RANK: Record<ScreenAction["kind"], number> = { button: 0, toggle: 1, submit: 2 };
const EFFECT_RANK: Record<ScreenAction["effect"], number> = { none: 0, "ui-state": 1, submit: 2 };

interface GroupMatch<T extends Elem> {
  pairs: [existing: T, learned: T][];
  missing: T[];
  added: T[];
}

// Pass 1 exact locator; pass 2 pairs leftovers only when one-to-one within a role.
function matchGroup<T extends Elem>(existing: readonly T[], learned: readonly T[]): GroupMatch<T> {
  const paired = new Map<T, T>();
  const used = new Set<T>();
  for (const old of existing) {
    const hit = learned.find((candidate) => !used.has(candidate) && locatorKey(candidate) === locatorKey(old));
    if (hit !== undefined) {
      paired.set(old, hit);
      used.add(hit);
    }
  }
  const leftOld = existing.filter((element) => !paired.has(element));
  const leftNew = learned.filter((element) => !used.has(element));
  for (const role of new Set(leftOld.map(roleOf))) {
    const olds = leftOld.filter((element) => roleOf(element) === role);
    const news = leftNew.filter((element) => roleOf(element) === role);
    const [old] = olds;
    const [fresh] = news;
    if (olds.length === 1 && news.length === 1 && old !== undefined && fresh !== undefined) {
      paired.set(old, fresh);
      used.add(fresh);
    }
  }
  return {
    pairs: existing.flatMap((old) => {
      const hit = paired.get(old);
      return hit === undefined ? [] : [[old, hit] as [T, T]];
    }),
    missing: existing.filter((element) => !paired.has(element)),
    added: learned.filter((element) => !used.has(element)),
  };
}

type Delta = [field: string, from: ChangeValue, to: ChangeValue];

function keepLocator(old: Elem, live: Elem): Locator {
  return locatorKey(old) === locatorKey(live) ? old.locator : { ...live.locator };
}

function mergeField(old: ScreenField, live: ScreenField): { value: ScreenField; deltas: Delta[] } {
  // The stored flag is human-authoritative: a name-based guess (e.g. "Passenger") must not
  // undo a reviewer's correction. Only a hard signal, the field becoming a password input,
  // escalates an existing field automatically.
  const sensitive = old.sensitive || live.inputType === "password";
  const agentFillable = !sensitive && old.agentFillable;
  const value: ScreenField = {
    ...old,
    name: live.name,
    nameSource: live.nameSource,
    sensitive,
    agentFillable,
    locator: keepLocator(old, live),
  };
  if (live.inputType === undefined) {
    delete value.inputType;
  } else {
    value.inputType = live.inputType;
  }
  return {
    value,
    deltas: [
      ["nameSource", old.nameSource, value.nameSource],
      ["inputType", old.inputType, value.inputType],
      ["sensitive", old.sensitive, value.sensitive],
      ["agentFillable", old.agentFillable, value.agentFillable],
    ],
  };
}

function mergeAction(old: ScreenAction, live: ScreenAction): { value: ScreenAction; deltas: Delta[] } {
  const value: ScreenAction = {
    ...old,
    name: live.name,
    kind: KIND_RANK[live.kind] > KIND_RANK[old.kind] ? live.kind : old.kind,
    effect: EFFECT_RANK[live.effect] > EFFECT_RANK[old.effect] ? live.effect : old.effect,
    locator: keepLocator(old, live),
  };
  if (live.nameSource !== undefined) {
    value.nameSource = live.nameSource;
  }
  return {
    value,
    deltas: [
      ["nameSource", old.nameSource, value.nameSource],
      ["kind", old.kind, value.kind],
      ["effect", old.effect, value.effect],
    ],
  };
}

function mergeLink(old: ScreenLink, live: ScreenLink): { value: ScreenLink; deltas: Delta[] } {
  const value: ScreenLink = {
    ...old,
    name: live.name,
    href: live.href,
    external: live.external,
    locator: keepLocator(old, live),
  };
  return {
    value,
    deltas: [
      ["href", old.href, value.href],
      ["external", old.external, value.external],
    ],
  };
}

interface Analysis {
  diff: ScreenDiff;
  title: string;
  fields: ScreenField[];
  actions: ScreenAction[];
  links: ScreenLink[];
  flows: ScreenFlow[];
  a11y: A11yFinding[];
  missingIds: string[];
}

function ref(group: DiffGroup, element: Elem): ElementRef {
  return { group, id: element.id, role: roleOf(element), name: element.name };
}

function analyze(existing: Screen, learned: Screen): Analysis {
  const fieldMatch = matchGroup(existing.fields, learned.fields);
  const actionMatch = matchGroup(existing.actions, learned.actions);
  const linkMatch = matchGroup(existing.links, learned.links);

  const taken = new Set([...existing.fields, ...existing.actions, ...existing.links].map((e) => e.id));
  const addedAll = [
    ...fieldMatch.added.map((element) => ({ group: "field" as const, element })),
    ...actionMatch.added.map((element) => ({ group: "action" as const, element })),
    ...linkMatch.added.map((element) => ({ group: "link" as const, element })),
  ];
  const freshIds = deriveIds(addedAll.map(({ element }) => ({ role: roleOf(element), name: element.name })), taken);
  // learned id -> final id, used to retarget a11y findings and `requires`.
  const idMap = new Map<string, string>();
  addedAll.forEach(({ element }, index) => idMap.set(element.id, freshIds[index] ?? element.id));

  const changed: ChangedEntry[] = [];
  const renamed: RenamedEntry[] = [];
  const record = (group: DiffGroup, old: Elem, liveId: string, merged: Elem, deltas: Delta[]): void => {
    idMap.set(liveId, old.id);
    if (old.name !== merged.name) {
      renamed.push({ group, id: old.id, from: { name: old.name, role: roleOf(old) }, to: { name: merged.name, role: roleOf(merged) } });
    } else if ((old.locator.occurrence ?? 0) !== (merged.locator.occurrence ?? 0)) {
      deltas.push(["occurrence", old.locator.occurrence ?? 0, merged.locator.occurrence ?? 0]);
    }
    for (const [field, from, to] of deltas) {
      if (from !== to) {
        changed.push({ group, id: old.id, field, from, to });
      }
    }
  };
  const fields: ScreenField[] = [];
  const mergedFieldOf = new Map<ScreenField, ScreenField>();
  for (const [old, live] of fieldMatch.pairs) {
    const { value, deltas } = mergeField(old, live);
    record("field", old, live.id, value, deltas);
    mergedFieldOf.set(old, value);
  }
  const actionOf = new Map<ScreenAction, ScreenAction>();
  for (const [old, live] of actionMatch.pairs) {
    const { value, deltas } = mergeAction(old, live);
    record("action", old, live.id, value, deltas);
    actionOf.set(old, value);
  }
  const linkOf = new Map<ScreenLink, ScreenLink>();
  for (const [old, live] of linkMatch.pairs) {
    const { value, deltas } = mergeLink(old, live);
    record("link", old, live.id, value, deltas);
    linkOf.set(old, value);
  }

  for (const old of existing.fields) fields.push(mergedFieldOf.get(old) ?? old);
  for (const element of fieldMatch.added) fields.push({ ...element, id: idMap.get(element.id) ?? element.id });
  const fieldIds = new Set(fields.map((field) => field.id));
  const actions: ScreenAction[] = existing.actions.map((old) => actionOf.get(old) ?? old);
  for (const element of actionMatch.added) {
    const added: ScreenAction = { ...element, id: idMap.get(element.id) ?? element.id };
    const requires = (element.requires ?? []).map((id) => idMap.get(id) ?? id).filter((id) => fieldIds.has(id));
    if (requires.length > 0) {
      added.requires = requires;
    } else {
      delete added.requires;
    }
    actions.push(added);
  }
  const links: ScreenLink[] = existing.links.map((old) => linkOf.get(old) ?? old);
  for (const element of linkMatch.added) links.push({ ...element, id: idMap.get(element.id) ?? element.id });

  // A field that became sensitive forces its flows to humanOnly (crossCheck rule).
  const sensitiveIds = new Set(fields.filter((field) => field.sensitive).map((field) => field.id));
  const flows = existing.flows.map((flow) => {
    if (!flow.humanOnly && flow.steps.some((step) => sensitiveIds.has(step.target.slice(1)))) {
      changed.push({ group: "flow", id: flow.id, field: "humanOnly", from: false, to: true });
      return { ...flow, humanOnly: true };
    }
    return flow;
  });

  if (existing.title !== learned.title) {
    changed.push({ group: "screen", id: existing.id, field: "title", from: existing.title, to: learned.title });
  }

  const missing = [
    ...fieldMatch.missing.map((e) => ref("field", e)),
    ...actionMatch.missing.map((e) => ref("action", e)),
    ...linkMatch.missing.map((e) => ref("link", e)),
  ];
  const missingIds = missing.map((entry) => entry.id);

  // Learned findings retargeted to final ids, plus stored findings of kept-but-missing elements.
  const retarget = (finding: A11yFinding): A11yFinding | undefined => {
    const target = idMap.get(finding.target.slice(1));
    if (target === undefined) return undefined;
    return {
      ...finding,
      target: `@${target}`,
      detail: finding.detail.replace(/(same role and name as )@(\S+)/, (_m, lead: string, id: string) => `${lead}@${idMap.get(id) ?? id}`),
    };
  };
  const a11y: A11yFinding[] = [];
  const seen = new Set<string>();
  const push = (finding: A11yFinding | undefined): void => {
    if (finding !== undefined && !seen.has(findingKey(finding))) {
      seen.add(findingKey(finding));
      a11y.push(finding);
    }
  };
  for (const finding of learned.a11y ?? []) push(retarget(finding));
  (existing.a11y ?? []).filter((finding) => missingIds.includes(finding.target.slice(1))).forEach(push);
  const oldKeys = new Set((existing.a11y ?? []).map(findingKey));

  const added: ElementRef[] = addedAll.map(({ group, element }) => ({ ...ref(group, element), id: idMap.get(element.id) ?? element.id }));
  return {
    diff: {
      isNew: false,
      added,
      missing,
      renamed,
      changed,
      fingerprint: { stored: existing.fingerprint, live: learned.fingerprint, drifted: existing.fingerprint !== learned.fingerprint },
      a11y: {
        added: a11y.filter((finding) => !oldKeys.has(findingKey(finding))),
        resolved: (existing.a11y ?? []).filter((finding) => !seen.has(findingKey(finding))),
      },
    },
    title: learned.title,
    fields,
    actions,
    links,
    flows,
    a11y,
    missingIds,
  };
}

function newScreenDiff(learned: Screen): ScreenDiff {
  return {
    isNew: true,
    added: [
      ...learned.fields.map((e) => ref("field", e)),
      ...learned.actions.map((e) => ref("action", e)),
      ...learned.links.map((e) => ref("link", e)),
    ],
    missing: [],
    renamed: [],
    changed: [],
    fingerprint: { live: learned.fingerprint, drifted: false },
    a11y: { added: [...(learned.a11y ?? [])], resolved: [] },
  };
}

export function diffScreens(existing: Screen | undefined, learned: Screen): ScreenDiff {
  return existing === undefined ? newScreenDiff(learned) : analyze(existing, learned).diff;
}

export function isEmptyDiff(diff: ScreenDiff): boolean {
  return (
    !diff.isNew &&
    diff.added.length === 0 &&
    diff.missing.length === 0 &&
    diff.renamed.length === 0 &&
    diff.changed.length === 0 &&
    !diff.fingerprint.drifted &&
    diff.a11y.added.length === 0 &&
    diff.a11y.resolved.length === 0
  );
}

function assertPrunable(existing: Screen, missingIds: readonly string[]): void {
  const pruned = new Set(missingIds);
  const problems: string[] = [];
  for (const id of missingIds) {
    const users: string[] = [];
    for (const flow of existing.flows) {
      if (flow.steps.some((step) => step.target === `@${id}`)) users.push(`flow ${flow.id}`);
    }
    for (const action of existing.actions) {
      if (!pruned.has(action.id) && (action.requires ?? []).includes(id)) users.push(`action ${action.id} (requires)`);
    }
    if (users.length > 0) problems.push(`cannot prune @${id}: used by ${users.join(", ")}`);
  }
  if (problems.length > 0) {
    throw new PwaNavError("invalid_args", problems.join("; "), {
      hint: "edit the flow/action by hand, then re-run with --prune",
    });
  }
}

export function mergeScreen(
  existing: Screen | undefined,
  learned: Screen,
  options: MergeOptions = {},
): { screen: Screen; diff: ScreenDiff } {
  if (existing === undefined) {
    return { screen: learned, diff: newScreenDiff(learned) };
  }
  const analysis = analyze(existing, learned);
  const prune = options.prune === true && analysis.missingIds.length > 0;
  if (prune) {
    assertPrunable(existing, analysis.missingIds);
  }
  const drop = new Set(prune ? analysis.missingIds : []);
  const fields = analysis.fields.filter((e) => !drop.has(e.id));
  const actions = analysis.actions.filter((e) => !drop.has(e.id));
  const links = analysis.links.filter((e) => !drop.has(e.id));
  const a11y = analysis.a11y.filter((finding) => !drop.has(finding.target.slice(1)));

  const screen: Screen = {
    ...existing,
    title: analysis.title,
    fields,
    actions,
    links,
    flows: analysis.flows,
  };
  if (a11y.length > 0 || existing.a11y !== undefined) {
    screen.a11y = a11y;
  }
  screen.fingerprint = fingerprintOf(screenElements(screen));

  const { diff } = analysis;
  const contentChanged =
    diff.added.length > 0 ||
    diff.renamed.length > 0 ||
    diff.changed.length > 0 ||
    diff.a11y.added.length > 0 ||
    diff.a11y.resolved.length > 0 ||
    drop.size > 0 ||
    screen.fingerprint !== existing.fingerprint;
  if (!contentChanged) {
    return { screen: existing, diff };
  }
  screen.observedAt = options.now === undefined ? learned.observedAt : isoSeconds(options.now);
  return { screen, diff };
}

function routeOfHref(href: string, screen: Screen, origin: string): string | undefined {
  try {
    return new URL(href, new URL(screen.route, origin)).pathname;
  } catch {
    return undefined;
  }
}

function sameOrigin(a: string, b: string): boolean {
  try {
    return new URL(a).origin === new URL(b).origin;
  } catch {
    return a === b;
  }
}

function routeCovers(pattern: string, route: string): boolean {
  if (pattern === route) return true;
  try {
    return matchRoute(pattern, route) !== null;
  } catch {
    return false;
  }
}

/** Merges one learned screen into a map (or creates it). Result always passes `validateScreenMap`. */
export async function mergeIntoMap(
  map: ScreenMap | undefined,
  learned: Screen,
  app: AppInfo,
  options: MergeOptions = {},
): Promise<{ map: ScreenMap; diff: ScreenDiff }> {
  const stamp = options.now === undefined ? learned.observedAt : isoSeconds(options.now);
  if (map !== undefined && !sameOrigin(map.app.origin, app.origin)) {
    throw new PwaNavError("invalid_args", `app origin ${app.origin} differs from the map origin ${map.app.origin}`);
  }
  const index =
    map === undefined
      ? -1
      : (() => {
          const byRoute = map.screens.findIndex((screen) => screen.route === learned.route);
          return byRoute >= 0 ? byRoute : map.screens.findIndex((screen) => screen.id === learned.id);
        })();
  const current = map?.screens[index];
  const { screen, diff } = mergeScreen(current, learned, options);

  const screens = map === undefined ? [screen] : [...map.screens];
  if (index >= 0) screens[index] = screen;
  else if (map !== undefined) screens.push(screen);

  // Unmapped bookkeeping: drop link-only entries that became screens, add new internal link targets.
  const unmapped = (map?.unmapped ?? []).filter(
    (entry) => !(entry.reason === "link-only" && entry.route !== undefined && routeCovers(screen.route, entry.route)),
  );
  for (const link of screen.links) {
    if (link.external) continue;
    const route = routeOfHref(link.href, screen, app.origin);
    if (route === undefined) continue;
    const known = screens.some((candidate) => routeCovers(candidate.route, route)) || unmapped.some((entry) => entry.route === route);
    if (!known) {
      unmapped.push({ route, reason: "link-only", discoveredFrom: screen.id });
    }
  }

  const next: ScreenMap = {
    ...(map?.$schema === undefined ? {} : { $schema: map.$schema }),
    schemaVersion: map?.schemaVersion ?? "1.0.0",
    app: {
      ...(map?.app ?? { id: app.id, name: app.name, origin: app.origin, locale: app.locale }),
      learnedAt: map?.app.learnedAt ?? stamp,
    },
    screens,
    ...(unmapped.length > 0 || map?.unmapped !== undefined ? { unmapped } : {}),
  };
  if (app.version !== undefined) {
    next.app.version = app.version;
  }
  if (map === undefined || !isDeepStrictEqual(next, map)) {
    next.app.learnedAt = stamp;
  }
  await validateScreenMap(next);
  return { map: next, diff };
}
