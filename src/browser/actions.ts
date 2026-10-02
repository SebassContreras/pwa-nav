// Live actions over BiDi (spec 004, T009): actionability checks, pointer click,
// key-input fill with readback, settle wait.
// Node handles are not valid across BiDi sessions, so every action runs in ONE session:
// collect -> match locator -> get node handle -> act. The caller wraps this in withSession.
// The in-page functions below are shipped as source text (toString) and must stay
// self-contained: no imports, no outer-scope references.
import { PwaNavError } from "../core/errors.js";
import type { BidiClient, NavigationWatch, NodeArgument } from "../bidi/protocol.js";
import { SETTLE_EVENTS } from "../bidi/protocol.js";
import { StaleRefError } from "../core/refs.js";
import type { Locator } from "../screens/screen-map.js";
import type { Snapshot } from "../core/snapshot.js";
import { COLLECT_NODES_SOURCE, COLLECTOR_SOURCE, type RawElement } from "./collector.js";
import { assertFresh } from "./locate.js";

// Settle constants, validated by the real-Firefox E2E (T012, Firefox 156.0.1 headless, Windows):
// - navigationStarted arrived 14-20 ms after a link click and load 30 ms (local page); a
//   page-initiated navigation 250 ms after the click (setTimeout) arrived at 259 ms.
// - pushState SPA clicks emit no navigationStarted (only historyUpdated), so they take the
//   DOM-quiescence path; the CLI click commands cost ~550-1100 ms end to end, ~150 ms for reads.
/** How long to wait for a navigationStarted after the input before assuming no navigation.
 * Events need <= 30 ms, but this window is also the minimum wait for async renders (a render
 * 200 ms after the click was captured; at 150 ms it would race). A later navigation is still
 * caught by the quiescence fallback in settle(). Kept at 300. */
export const SETTLE_WINDOW_MS = 300;
/** Quiet period without DOM mutations that counts as "settled". A 50 ms ticker never counted as
 * quiet (correct); 150 ms rides over typical frame/microtask bursts. Kept at 150. */
export const QUIET_MS = 150;
/** Hard cap for the settle wait (load wait and DOM quiescence). A page with perpetual
 * mutations costs exactly this per action (measured 2.2 s for a 2 s ticker). Kept at 5000. */
export const SETTLE_TIMEOUT_MS = 5000;

export interface ActionOptions {
  /** Must match the options used when the snapshot was taken. */
  includeAll?: boolean;
  /** Skip the settle wait (tests / batch callers). Default true. */
  settle?: boolean;
}

export interface PageState {
  url: string;
  title: string;
}

export interface LiveCollect extends PageState {
  raw: RawElement[];
}

interface ActionableResult {
  ok: boolean;
  reason?: string;
}

// ---------------------------------------------------------------------------
// In-page functions (self-contained)
// ---------------------------------------------------------------------------

/**
 * Actionability: visible, enabled, scrolled into view, stable across two animation
 * frames, not covered. Resolves `{ok:false, reason}` on the first failing check.
 */
export async function checkActionable(el: Element): Promise<ActionableResult> {
  const view = el.ownerDocument.defaultView;
  if (view === null) return { ok: false, reason: "element is detached from a window" };
  const visible = (): boolean => {
    const style = view.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.visibility === "collapse") return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };
  if (!el.isConnected || !visible()) return { ok: false, reason: "element is not visible" };

  let disabled = el.getAttribute("aria-disabled") === "true";
  if (!disabled) {
    try {
      disabled = el.matches(":disabled");
    } catch {
      disabled = el.hasAttribute("disabled");
    }
  }
  if (disabled) return { ok: false, reason: "element is disabled" };

  if (typeof el.scrollIntoView === "function") {
    el.scrollIntoView({ block: "center", inline: "center" });
  }

  const frame = (): Promise<void> =>
    new Promise<void>((resolve) => {
      view.requestAnimationFrame(() => {
        resolve();
      });
    });
  const sameRect = (a: DOMRect, b: DOMRect): boolean =>
    a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;
  const first = el.getBoundingClientRect();
  await frame();
  const second = el.getBoundingClientRect();
  await frame();
  const third = el.getBoundingClientRect();
  if (!sameRect(first, second) || !sameRect(second, third)) {
    return { ok: false, reason: "element is not stable (still moving)" };
  }
  if (!visible()) return { ok: false, reason: "element is not visible" };

  const cx = third.left + third.width / 2;
  const cy = third.top + third.height / 2;
  const root = el.getRootNode() as Document | ShadowRoot;
  const hit = root.elementFromPoint(cx, cy);
  if (hit === null) return { ok: false, reason: "element center is outside the viewport" };
  const label = hit.closest<HTMLLabelElement>("label");
  if (hit !== el && !el.contains(hit) && label?.control !== el) {
    return { ok: false, reason: `element is covered by <${hit.localName}>` };
  }
  return { ok: true };
}

type FillKind = "text" | "password" | "contenteditable";
interface FillTarget {
  ok: boolean;
  reason?: string;
  kind?: FillKind;
  /** Secret-like field: typed text and values are never read back or returned. */
  sensitive?: boolean;
}

/** Validates the target is typeable, then focuses it. Returns no values. */
export function prepareFill(el: Element): FillTarget {
  const tag = el.localName;
  const typeable = new Set(["", "text", "email", "search", "tel", "url", "number", "password"]);
  let kind: FillKind;
  let sensitive = false;
  if (tag === "input") {
    const input = el as HTMLInputElement;
    const type = (el.getAttribute("type") ?? "").trim().toLowerCase();
    if (!typeable.has(type)) return { ok: false, reason: `input type "${type}" does not accept typed text` };
    if (input.readOnly) return { ok: false, reason: "input is read-only" };
    kind = type === "password" ? "password" : "text";
    sensitive = kind === "password" || /password|cc-|one-time-code/i.test(el.getAttribute("autocomplete") ?? "");
  } else if (tag === "textarea") {
    if ((el as HTMLTextAreaElement).readOnly) return { ok: false, reason: "textarea is read-only" };
    kind = "text";
    sensitive = /password|cc-|one-time-code/i.test(el.getAttribute("autocomplete") ?? "");
  } else if (tag === "select") {
    return { ok: false, reason: "select is not supported by fill" };
  } else if ((el as HTMLElement).isContentEditable) {
    kind = "contenteditable";
  } else {
    return { ok: false, reason: `<${tag}> is not an editable field` };
  }
  (el as HTMLElement).focus();
  const root = el.getRootNode() as Document | ShadowRoot;
  if (root.activeElement !== el && !el.contains(root.activeElement)) {
    return { ok: false, reason: "element did not take focus" };
  }
  if (kind === "contenteditable") {
    // E2E (Firefox 156): focus() alone leaves no caret in a contenteditable, so typed keys are
    // dropped. Put the caret at the end; select-all then selects the editing host's content.
    const view = el.ownerDocument.defaultView;
    const selection = view?.getSelection();
    if (selection !== null && selection !== undefined) {
      const range = el.ownerDocument.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }
  }
  return { ok: true, kind, sensitive };
}

/**
 * Compares the field with what was typed. `expected` is the exact text, or, for
 * sensitive fields, only its LENGTH (a number): the secret is never read out of the page.
 * Returns a boolean only.
 */
export function readBackMatches(el: Element, expected: string | number): boolean {
  const actual =
    el.localName === "input" || el.localName === "textarea"
      ? (el as HTMLInputElement).value
      : el.textContent;
  if (typeof expected === "number") return actual.length === expected;
  // E2E (Firefox 156): contenteditable turns runs of spaces into U+00A0; the user typed spaces.
  const editable = el.localName !== "input" && el.localName !== "textarea";
  const norm = (text: string): string => {
    const lf = text.replace(/\r\n/g, "\n");
    return editable ? lf.replace(/ /g, " ") : lf;
  };
  return norm(actual) === norm(expected);
}

/**
 * Lets frame-deferred page logic (rAF/timeout-driven re-renders, masks) finish before the
 * readback. Resolves after two animation frames, or after 100 ms if frames never fire
 * (throttled/hidden window).
 */
function waitFrames(): Promise<void> {
  return new Promise<void>((resolve) => {
    let done = false;
    const finish = (): void => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    requestAnimationFrame(() => {
      requestAnimationFrame(finish);
    });
    setTimeout(finish, 100);
  });
}

/** Resolves after `quietMs` without DOM mutations, or at `capMs` regardless. */
function waitQuiet(quietMs: number, capMs: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    let quiet: ReturnType<typeof setTimeout> | undefined;
    const done = (value: boolean): void => {
      observer.disconnect();
      clearTimeout(quiet);
      clearTimeout(cap);
      resolve(value);
    };
    const observer = new MutationObserver(() => {
      clearTimeout(quiet);
      quiet = setTimeout(() => {
        done(true);
      }, quietMs);
    });
    observer.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
    quiet = setTimeout(() => {
      done(true);
    }, quietMs);
    const cap = setTimeout(() => {
      done(false);
    }, capMs);
  });
}

const PAGE_STATE_SOURCE = "() => ({ url: location.href, title: document.title })";

const COLLECT_LIVE_SOURCE =
  `(includeAll) => ({ url: location.href, title: document.title, ` +
  `raw: (${COLLECTOR_SOURCE})(document, { includeAll }) })`;

// Node handle for collected `index`; null when role/name at that index no longer match.
const LOCATE_NODE_SOURCE =
  `(index, role, name, includeAll) => { ` +
  `const options = { includeAll }; ` +
  `const items = (${COLLECTOR_SOURCE})(document, options); ` +
  `const nodes = (${COLLECT_NODES_SOURCE})(document, options); ` +
  `const item = items[index]; ` +
  `return item !== undefined && item.role === role && item.name === name ? nodes[index] : null; }`;

export const CHECK_ACTIONABLE_SOURCE = `(${checkActionable.toString()})`;
const PREPARE_FILL_SOURCE = `(${prepareFill.toString()})`;
const READ_BACK_SOURCE = `(${readBackMatches.toString()})`;
const WAIT_QUIET_SOURCE = `(${waitQuiet.toString()})`;
const WAIT_FRAMES_SOURCE = `(${waitFrames.toString()})`;

// ---------------------------------------------------------------------------
// Host side
// ---------------------------------------------------------------------------

const bool = (value: boolean): { type: "boolean"; value: boolean } => ({ type: "boolean", value });
const str = (value: string): { type: "string"; value: string } => ({ type: "string", value });
const num = (value: number): { type: "number"; value: number } => ({ type: "number", value });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function protocolError(message: string): PwaNavError {
  return new PwaNavError("protocol", message);
}

export async function collectLive(
  client: BidiClient,
  context: string,
  options: { includeAll?: boolean } = {},
): Promise<LiveCollect> {
  const res = await client.callFunction(context, COLLECT_LIVE_SOURCE, [bool(options.includeAll === true)]);
  if (!isRecord(res) || typeof res["url"] !== "string" || typeof res["title"] !== "string" || !Array.isArray(res["raw"])) {
    throw protocolError("Malformed collector result");
  }
  return { url: res["url"], title: res["title"], raw: res["raw"] as RawElement[] };
}

function sensitiveElement(element: RawElement): boolean {
  return element.inputType === "password" || /password|cc-|one-time-code/i.test(element.autocomplete ?? "");
}

/** Pure text for dry-run output. Never includes typed text of sensitive targets. */
export function describeTarget(args: {
  action: "click" | "fill";
  locator: Locator;
  element?: RawElement;
  text?: string;
}): string {
  const { action, locator, element, text } = args;
  const occurrence = locator.occurrence ?? 0;
  let out = `${action} ${locator.role} "${locator.name}" (occurrence ${String(occurrence)})`;
  if (action === "fill" && text !== undefined) {
    const redact = element !== undefined && sensitiveElement(element);
    out += redact ? ` with <redacted, ${String(text.length)} chars>` : ` with ${JSON.stringify(text)}`;
  }
  if (element !== undefined) {
    const info: string[] = [element.disabled === true ? "disabled" : "enabled", "visible"];
    if (element.inputType !== undefined) info.push(`type=${element.inputType}`);
    out += ` [${info.join(", ")}]`;
  }
  return out;
}

interface Located {
  sharedId: string;
  element: RawElement;
  index: number;
}

function notActionable(locator: Locator, reason: string, hint?: string): PwaNavError {
  return new PwaNavError(
    "not_actionable",
    `Element role "${locator.role}" name "${locator.name}" is not actionable: ${reason}`,
    { hint: hint ?? "Re-snapshot, wait for the page to settle or dismiss overlays, then retry." },
  );
}

async function locate(
  client: BidiClient,
  context: string,
  snapshot: Snapshot,
  locator: Locator,
  options: ActionOptions,
): Promise<Located> {
  const live = await collectLive(client, context, options);
  const { index, element } = assertFresh({ snapshot, locator, live });
  const remote = await client.callFunctionRaw(
    context,
    LOCATE_NODE_SOURCE,
    [num(index), str(element.role), str(element.name), bool(options.includeAll === true)],
    { resultOwnership: "root" },
  );
  const sharedId = (remote as { sharedId?: unknown }).sharedId;
  if (remote.type !== "node" || typeof sharedId !== "string") {
    throw new StaleRefError(snapshot.snapshotId, "the element disappeared while locating it");
  }
  return { sharedId, element, index };
}

const nodeArg = (sharedId: string): NodeArgument => ({ type: "node", sharedId });

async function ensureActionable(client: BidiClient, context: string, located: Located, locator: Locator): Promise<void> {
  const res = await client.callFunction(context, CHECK_ACTIONABLE_SOURCE, [nodeArg(located.sharedId)]);
  if (!isRecord(res) || typeof res["ok"] !== "boolean") throw protocolError("Malformed actionability result");
  if (!res["ok"]) {
    throw notActionable(locator, typeof res["reason"] === "string" ? res["reason"] : "unknown reason");
  }
}

async function pageState(client: BidiClient, context: string): Promise<PageState> {
  const res = await client.callFunction(context, PAGE_STATE_SOURCE);
  if (!isRecord(res) || typeof res["url"] !== "string" || typeof res["title"] !== "string") {
    throw protocolError("Malformed page state");
  }
  return { url: res["url"], title: res["title"] };
}

/**
 * Waits for the page to settle after an input.
 * 1. Full navigation (started within SETTLE_WINDOW_MS) -> wait for load.
 * 2. Otherwise, wait for network idle (in-flight requests reach 0) and DOM quiescence
 *    (QUIET_MS without mutations). If a response triggers further requests or a late
 *    navigation, loops until quiet or navigation loads.
 * Hitting SETTLE_TIMEOUT_MS during quiescence/network idle returns the current page state:
 * pages with perpetual mutations or polling never go quiet, and the input already
 * happened, so failing would misreport a successful action.
 * A load that never completes after a navigation does raise `timeout`.
 * `watch` must have been created before the input; without one, it starts now.
 */
export async function settle(client: BidiClient, context: string, watch?: NavigationWatch): Promise<PageState> {
  let own: NavigationWatch | undefined;
  let w = watch;
  if (w === undefined) {
    await client.subscribe(SETTLE_EVENTS, [context]);
    own = client.watchNavigation(context);
    w = own;
  }
  const startedAt = Date.now();
  const remaining = (): number => Math.max(0, SETTLE_TIMEOUT_MS - (Date.now() - startedAt));

  try {
    if (await w.waitStarted(SETTLE_WINDOW_MS)) {
      await w.waitLoaded(remaining());
    } else {
      const navStarted = (): boolean => (w as { readonly started: boolean }).started;
      const inFlight = (): number => (w as { readonly inFlightCount: number }).inFlightCount;
      while (remaining() > 0) {
        if (navStarted()) {
          await w.waitLoaded(remaining());
          break;
        }
        if (inFlight() > 0) {
          await w.waitNetworkIdle(remaining());
          if (navStarted()) {
            await w.waitLoaded(remaining());
            break;
          }
        }
        try {
          const capMs = remaining() >= SETTLE_TIMEOUT_MS - 500 ? SETTLE_TIMEOUT_MS : remaining();
          await client.callFunction(context, WAIT_QUIET_SOURCE, [num(QUIET_MS), num(capMs)]);
        } catch (error) {
          // The document may have been replaced mid-wait by a late navigation.
          if (!navStarted()) throw error;
          await w.waitLoaded(remaining());
          break;
        }
        if (navStarted()) {
          await w.waitLoaded(remaining());
          break;
        }
        if (inFlight() === 0) {
          break;
        }
      }
    }
    return await pageState(client, context);
  } finally {
    own?.dispose();
  }
}

async function armWatch(client: BidiClient, context: string): Promise<NavigationWatch> {
  await client.subscribe(SETTLE_EVENTS, [context]);
  return client.watchNavigation(context);
}

export async function clickLocator(
  client: BidiClient,
  context: string,
  snapshot: Snapshot,
  locator: Locator,
  options: ActionOptions = {},
): Promise<PageState> {
  const located = await locate(client, context, snapshot, locator, options);
  await ensureActionable(client, context, located, locator);
  const watch = await armWatch(client, context);
  try {
    await client.performActions(context, [
      {
        type: "pointer",
        id: "mouse",
        parameters: { pointerType: "mouse" },
        actions: [
          { type: "pointerMove", x: 0, y: 0, origin: { type: "element", element: { sharedId: located.sharedId } } },
          { type: "pointerDown", button: 0 },
          { type: "pointerUp", button: 0 },
        ],
      },
    ]);
    await client.releaseActions(context);
    return options.settle === false ? await pageState(client, context) : await settle(client, context, watch);
  } finally {
    watch.dispose();
  }
}

// WebDriver special key codepoints (https://w3c.github.io/webdriver/#keyboard-actions).
const KEY_CONTROL = "";
const KEY_META = "";
const KEY_BACKSPACE = "";
const KEY_ENTER = "";

const keyPair = (value: string): unknown[] => [
  { type: "keyDown", value },
  { type: "keyUp", value },
];

/**
 * Key actions: select-all, then one keyDown/keyUp pair per Unicode code point
 * (empty text -> Backspace to delete the selection). "\n" is sent as Enter.
 * Code points in the private-use block U+E000-U+F8FF are WebDriver special keys and are rejected.
 */
export function buildFillKeyActions(text: string, platform: string = process.platform): unknown[] {
  const modifier = platform === "darwin" ? KEY_META : KEY_CONTROL;
  const actions: unknown[] = [
    { type: "keyDown", value: modifier },
    ...keyPair("a"),
    { type: "keyUp", value: modifier },
  ];
  if (text === "") {
    actions.push(...keyPair(KEY_BACKSPACE));
    return actions;
  }
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp >= 0xe000 && cp <= 0xf8ff) {
      throw new PwaNavError("invalid_args", "Text contains a private-use code point (reserved for special keys)");
    }
    actions.push(...keyPair(ch === "\n" ? KEY_ENTER : ch));
  }
  return actions;
}

/**
 * Types `text` into the located field and verifies it. Non-sensitive fields: exact
 * comparison done in-page (only a boolean comes back). Sensitive fields (password,
 * cc-*, one-time-code): only the LENGTH is compared; the value is never read or returned.
 * Typed text is never placed in errors or results.
 */
export async function fillLocator(
  client: BidiClient,
  context: string,
  snapshot: Snapshot,
  locator: Locator,
  text: string,
  options: ActionOptions = {},
): Promise<PageState> {
  const keys = buildFillKeyActions(text); // validates before any browser interaction
  const located = await locate(client, context, snapshot, locator, options);
  await ensureActionable(client, context, located, locator);
  const watch = await armWatch(client, context);
  try {
    const prep = await client.callFunction(context, PREPARE_FILL_SOURCE, [nodeArg(located.sharedId)]);
    if (!isRecord(prep) || typeof prep["ok"] !== "boolean") throw protocolError("Malformed fill preparation result");
    if (!prep["ok"]) {
      throw notActionable(
        locator,
        typeof prep["reason"] === "string" ? prep["reason"] : "unsupported target",
        "fill supports text inputs, textareas and contenteditable; use click for other controls.",
      );
    }
    const sensitive = prep["sensitive"] === true;

    await client.performActions(context, [{ type: "key", id: "keyboard", actions: keys }]);
    await client.releaseActions(context);

    // E2E (Firefox 156): a page that rewrites the value in requestAnimationFrame is only
    // visible ~1 frame after the keys; an immediate readback would pass a value that changes next.
    await client.callFunction(context, WAIT_FRAMES_SOURCE);
    const expected = sensitive ? num(text.length) : str(text);
    const match = await client.callFunction(context, READ_BACK_SOURCE, [nodeArg(located.sharedId), expected]);
    if (match !== true) {
      throw notActionable(
        locator,
        sensitive ? "value length after typing differs" : "value after typing differs",
        "The page may rewrite or reject input (masks, controlled inputs); inspect the field manually.",
      );
    }
    return options.settle === false ? await pageState(client, context) : await settle(client, context, watch);
  } finally {
    watch.dispose();
  }
}
