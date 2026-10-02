// Screen learner for spec 005-screen-map (T006): live collector elements -> `Screen`.
// Pure functions, no IO, no globals. Merge/diff/prune against an existing map (T007) will
// live in this file as separate functions that consume `learnScreen` output.
// Flows are never invented: `flows` is always [] and flow authoring stays manual.
import type { RawElement } from "../browser/collector.js";
import {
  fingerprintOf,
  screenElements,
  type A11yFinding,
  type Locator,
  type Screen,
  type ScreenAction,
  type ScreenField,
  type ScreenLink,
} from "./screen-map.js";

export interface LearnPage {
  url: string;
  title: string;
  appOrigin: string;
}

export interface LearnOptions {
  now?: Date;
  /** Overrides the id derived from the route. */
  screenId?: string;
  access?: Screen["access"];
  /** Ids already taken (e.g. by an existing map entry); derived ids avoid them. */
  existingIds?: ReadonlySet<string>;
  /** Names of submit buttons. Overrides/complements `RawElement.buttonType`. */
  submitNames?: ReadonlySet<string>;
}

// Roles outside these three groups (heading, tab panels, menuitemcheckbox, ...) are ignored.
const FIELD_ROLES: ReadonlySet<string> = new Set([
  "textbox", "searchbox", "spinbutton", "combobox", "listbox", "slider", "checkbox", "radio", "switch",
]);
const ACTION_ROLES: ReadonlySet<string> = new Set(["button", "menuitem", "tab", "option"]);
// Toggles/choices are not required to submit a form.
const OPTIONAL_FIELD_ROLES: ReadonlySet<string> = new Set(["checkbox", "radio", "switch"]);

const SENSITIVE_AUTOCOMPLETE: ReadonlySet<string> = new Set(["current-password", "new-password", "one-time-code"]);
// Broad on purpose: a false positive only forces the user to fill by hand.
const SENSITIVE_NAME = /pass|pwd|contrase|token|otp|secret|clave/i;
const TOGGLE_NAME = /^(show|hide|toggle|mostrar|ocultar|alternar)\b/i;

/** NFD-fold to ASCII, lowercase, non-alphanumeric runs -> `-`, trimmed. May return "". */
export function slugify(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Screen id from the literal pathname: `/login` -> `login`, `/` -> `home`. Params are NOT inferred. */
export function screenIdFromRoute(route: string): string {
  const slug = slugify(route);
  if (slug !== "") {
    return slug;
  }
  return route === "/" ? "home" : "screen";
}

/** sensitive = password input, secret autocomplete token, or a secret-looking name. */
export function detectSensitive(raw: Pick<RawElement, "name" | "inputType" | "autocomplete">): boolean {
  if (raw.inputType === "password") {
    return true;
  }
  const tokens = (raw.autocomplete ?? "").toLowerCase().split(/\s+/);
  if (tokens.some((token) => SENSITIVE_AUTOCOMPLETE.has(token))) {
    return true;
  }
  return SENSITIVE_NAME.test(raw.name);
}

/**
 * One id per element, in document order, in a single id space.
 * Empty slug -> `<role>-<n>` (n counts nameless elements of that role); collisions -> `-2`, `-3`, ...
 */
export function deriveIds(
  items: readonly { role: string; name: string }[],
  existingIds: ReadonlySet<string> = new Set(),
): string[] {
  const taken = new Set(existingIds);
  const namelessByRole = new Map<string, number>();
  return items.map(({ role, name }) => {
    let base = slugify(name);
    if (base === "") {
      const n = (namelessByRole.get(role) ?? 0) + 1;
      namelessByRole.set(role, n);
      base = `${slugify(role) || "element"}-${n.toString()}`;
    }
    let id = base;
    for (let suffix = 2; taken.has(id); suffix += 1) {
      id = `${base}-${suffix.toString()}`;
    }
    taken.add(id);
    return id;
  });
}

type Kind = "field" | "action" | "link";

function kindOf(role: string): Kind | undefined {
  if (FIELD_ROLES.has(role)) return "field";
  if (ACTION_ROLES.has(role)) return "action";
  if (role === "link") return "link";
  return undefined;
}

// Internal -> href as written. External -> origin only. Non-http(s) or unparsable -> undefined (skipped).
function classifyHref(href: string, pageUrl: string, appOrigin: string): { href: string; external: boolean } | undefined {
  let resolved: URL;
  try {
    resolved = new URL(href, pageUrl);
  } catch {
    return undefined;
  }
  if (resolved.protocol !== "http:" && resolved.protocol !== "https:") {
    return undefined;
  }
  if (resolved.origin === new URL(appOrigin).origin) {
    return { href, external: false };
  }
  return { href: resolved.origin, external: true };
}

function locatorOf(raw: RawElement): Locator {
  return { role: raw.role, name: raw.name, occurrence: raw.occurrence };
}

export function learnScreen(raw: readonly RawElement[], page: LearnPage, options: LearnOptions = {}): Screen {
  const route = new URL(page.url).pathname;
  const submitNames = options.submitNames ?? new Set<string>();

  // Classify first (dropping ignored roles and hrefless links) so ids are assigned over survivors only.
  const entries: { raw: RawElement; kind: Kind; link?: { href: string; external: boolean } }[] = [];
  for (const element of raw) {
    const kind = kindOf(element.role);
    if (kind === undefined) {
      continue;
    }
    if (kind === "link") {
      const link = element.href === undefined ? undefined : classifyHref(element.href, page.url, page.appOrigin);
      if (link !== undefined) {
        entries.push({ raw: element, kind, link });
      }
      continue;
    }
    entries.push({ raw: element, kind });
  }

  const ids = deriveIds(entries.map((entry) => entry.raw), options.existingIds);
  const fields: ScreenField[] = [];
  const actions: ScreenAction[] = [];
  const links: ScreenLink[] = [];
  const findings: A11yFinding[] = [];
  const firstWithKey = new Map<string, string>();
  const submitIndexes: number[] = [];

  entries.forEach((entry, index) => {
    const element = entry.raw;
    const id = ids[index] ?? "";
    if (entry.kind === "field") {
      const sensitive = detectSensitive(element);
      fields.push({
        id,
        role: element.role,
        name: element.name,
        nameSource: element.nameSource,
        ...(element.inputType === undefined ? {} : { inputType: element.inputType }),
        required: false, // collector does not report `required`
        sensitive,
        agentFillable: !sensitive,
        locator: locatorOf(element),
      });
    } else if (entry.kind === "action") {
      const submit = element.buttonType === "submit" || submitNames.has(element.name);
      const toggle = !submit && TOGGLE_NAME.test(element.name);
      if (submit) submitIndexes.push(actions.length);
      actions.push({
        id,
        role: element.role,
        name: element.name,
        nameSource: element.nameSource,
        kind: submit ? "submit" : toggle ? "toggle" : "button",
        effect: submit ? "submit" : toggle ? "ui-state" : "none",
        locator: locatorOf(element),
      });
    } else if (entry.link !== undefined) {
      links.push({ id, name: element.name, href: entry.link.href, external: entry.link.external, locator: locatorOf(element) });
    }

    if (entry.kind === "field" && element.nameSource === "placeholder") {
      findings.push({
        code: "name-from-placeholder-only",
        target: `@${id}`,
        detail: `"${element.name}" comes from the placeholder only; add a label`,
        wcag: "3.3.2",
      });
    }
    if (element.name === "") {
      findings.push({ code: "missing-accessible-name", target: `@${id}`, detail: `${element.role} has no accessible name`, wcag: "4.1.2" });
    } else {
      const key = `${element.role}\t${element.name}`;
      const first = firstWithKey.get(key);
      if (first === undefined) {
        firstWithKey.set(key, id);
      } else {
        findings.push({ code: "duplicate-name", target: `@${id}`, detail: `same role and name as @${first}` });
      }
    }
  });

  const requires = fields.filter((field) => !OPTIONAL_FIELD_ROLES.has(field.role)).map((field) => field.id);
  for (const index of submitIndexes) {
    const action = actions[index];
    if (action !== undefined && requires.length > 0) {
      action.requires = [...requires];
    }
  }

  const screen: Screen = {
    id: options.screenId ?? screenIdFromRoute(route),
    route,
    title: page.title,
    access: options.access ?? "unknown",
    fingerprint: "",
    observedAt: (options.now ?? new Date()).toISOString().replace(/\.\d{3}Z$/, "Z"),
    fields,
    actions,
    links,
    flows: [],
    ...(findings.length > 0 ? { a11y: findings } : {}),
  };
  screen.fingerprint = fingerprintOf(screenElements(screen));
  return screen;
}
