// In-page collector. `collectInteractive` is shipped to the page as source text
// (BiDi `script.callFunction`), so it must stay self-contained: no imports, no
// outer-scope references, only DOM APIs present in a real browser and jsdom.
// Role/name follow an HTML-AAM / accname 1.2 subset (https://www.w3.org/TR/accname-1.2/).
// Limits: closed shadow roots are unreachable; slotting is approximated (open
// shadow content first, then light children). Layout geometry is deliberately
// ignored (jsdom has none): zero-size/covered detection belongs to the
// actionability checks in actions.ts (T009), not here.

export type NameSource =
  | "label"
  | "aria-labelledby"
  | "aria-label"
  | "content"
  | "alt"
  | "title"
  | "placeholder";

export interface RawElement {
  role: string;
  name: string;
  /** Step that produced `name`; "content" with an empty name means "no name". */
  nameSource: NameSource;
  /** Only textbox/combobox/slider, never from a password input. */
  value?: string;
  disabled?: true;
  /** Zero-based index among emitted elements with the same role+name, document order. */
  occurrence: number;
  /** `<input>` type, lowercased ("text" when absent). */
  inputType?: string;
  /** `href` attribute as written. */
  href?: string;
  /** `autocomplete` attribute as written. */
  autocomplete?: string;
  /** Native `<button>`/`<input>` buttons only: effective type (submit default inside a form, else button). */
  buttonType?: "submit" | "button" | "reset";
  /** Placeholder, data-placeholder or aria-placeholder if present. */
  placeholder?: string;
  /** Enclosing dialog/modal accessible name or title if inside one. */
  dialog?: string;
  /** Enclosing container/landmark context (e.g. "dialog: Crear una publicación"). */
  container?: string;
}

export interface CollectOptions {
  includeAll?: boolean;
}

// Single self-contained implementation (no outer-scope references). The exported
// functions and the shipped sources are thin wrappers, so `items[i]` and `nodes[i]`
// always describe the same element.
function collectImpl(root: Document, options?: CollectOptions): { items: RawElement[]; nodes: Element[] } {
  const includeAll = options?.includeAll === true;
  const view = root.defaultView;

  const INTERACTIVE = new Set([
    "link", "button", "textbox", "searchbox", "checkbox", "radio", "combobox", "listbox",
    "slider", "spinbutton", "switch", "tab", "menuitem", "menuitemcheckbox", "menuitemradio", "option",
  ]);
  const KNOWN = new Set([
    ...INTERACTIVE,
    "heading", "img", "navigation", "main", "banner", "contentinfo", "complementary", "region",
    "form", "search", "article", "dialog", "alert", "alertdialog", "status", "list", "listitem",
    "table", "row", "cell", "columnheader", "rowheader", "grid", "gridcell", "menu", "menubar",
    "tablist", "tabpanel", "toolbar", "tree", "treeitem", "group", "separator", "progressbar",
    "presentation", "none",
  ]);
  const NAME_FROM_CONTENT = new Set([
    "button", "link", "tab", "menuitem", "menuitemcheckbox", "menuitemradio", "option",
    "checkbox", "radio", "switch", "heading",
  ]);
  const TEXT_TYPES = new Set(["", "text", "email", "search", "tel", "url", "number", "password", "file"]);

  const collapse = (s: string | null | undefined): string => (s ?? "").replace(/\s+/g, " ").trim();
  const displayOf = (el: Element): string => view?.getComputedStyle(el).display ?? "inline";

  // Inheritable hiding: pruned together with the whole subtree.
  // Native file inputs are styled invisible/display:none in most modern apps,
  // so a file input leaf is not pruned by its own display:none/hidden.
  const hiddenSelf = (el: Element): boolean => {
    if (el.localName === "input" && typeOf(el) === "file") {
      return el.hasAttribute("inert") || el.getAttribute("aria-hidden") === "true";
    }
    return (
      el.hasAttribute("hidden") ||
      el.hasAttribute("inert") ||
      el.getAttribute("aria-hidden") === "true" ||
      displayOf(el) === "none"
    );
  };

  const textOf = (node: Node, skip: Element | null): string => {
    let out = "";
    for (const child of Array.from(node.childNodes)) {
      if (child.nodeType === 3) {
        out += child.nodeValue ?? "";
      } else if (child.nodeType === 1) {
        const c = child as Element;
        if (c === skip || hiddenSelf(c)) continue;
        const tag = c.localName;
        if (tag === "script" || tag === "style" || tag === "template") continue;
        let inner = "";
        if (tag === "img") inner = c.getAttribute("alt") ?? "";
        else if (tag !== "input" && tag !== "select" && tag !== "textarea") inner = textOf(c, skip);
        const d = displayOf(c);
        out += d === "inline" || d === "contents" ? inner : ` ${inner} `;
      }
    }
    return out;
  };

  const attrOf = (el: Element, name: string): string => el.getAttribute(name) ?? "";
  const typeOf = (el: Element): string => attrOf(el, "type").trim().toLowerCase();

  const isEditable = (el: Element): boolean =>
    (el as HTMLElement).isContentEditable ||
    el.getAttribute("contenteditable") === "true" ||
    el.getAttribute("contenteditable") === "";

  const roleOf = (el: Element): string | null => {
    const explicit = attrOf(el, "role").trim().split(/\s+/)[0]?.toLowerCase() ?? "";
    if (explicit !== "" && KNOWN.has(explicit)) return explicit;
    const tag = el.localName;
    if (tag === "a") return el.hasAttribute("href") ? "link" : null;
    if (tag === "button" || tag === "summary") return "button";
    if (tag === "textarea") return "textbox";
    if (/^h[1-6]$/.test(tag)) return "heading";
    if (tag === "img") return attrOf(el, "alt") === "" ? null : "img";
    if (tag === "select") {
      return el.hasAttribute("multiple") || Number(attrOf(el, "size")) > 1 ? "listbox" : "combobox";
    }
    if (tag === "input") {
      const t = typeOf(el);
      if (t === "button" || t === "submit" || t === "reset" || t === "image") return "button";
      if (t === "checkbox") return "checkbox";
      if (t === "radio") return "radio";
      if (t === "range") return "slider";
      if (TEXT_TYPES.has(t)) return "textbox";
    }
    if (isEditable(el)) {
      return "textbox";
    }
    return null;
  };

  const refText = (r: Element): string =>
    collapse(r.getAttribute("aria-label")) ||
    collapse(r.localName === "img" ? r.getAttribute("alt") : textOf(r, null));

  const nameOf = (el: Element, role: string): [string, NameSource] => {
    const tag = el.localName;
    const labelledby = collapse(el.getAttribute("aria-labelledby"));
    if (labelledby !== "") {
      const scope = el.getRootNode() as Document | ShadowRoot;
      const parts: string[] = [];
      for (const id of labelledby.split(" ")) {
        const ref = scope.getElementById(id);
        const text = ref ? refText(ref) : "";
        if (text !== "") parts.push(text);
      }
      if (parts.length > 0) return [parts.join(" "), "aria-labelledby"];
    }
    const ariaLabel = collapse(el.getAttribute("aria-label"));
    if (ariaLabel !== "") return [ariaLabel, "aria-label"];

    const labels = (el as Partial<HTMLInputElement>).labels;
    if (labels) {
      const text = collapse(Array.from(labels, (l) => textOf(l, el)).join(" "));
      if (text !== "") return [text, "label"];
    }
    const t = typeOf(el);
    if (tag === "input" && (t === "button" || t === "submit" || t === "reset")) {
      const v = collapse(el.getAttribute("value"));
      if (v !== "") return [v, "content"];
    }
    if (tag === "img" || (tag === "input" && t === "image")) {
      const alt = collapse(el.getAttribute("alt"));
      if (alt !== "") return [alt, "alt"];
    }
    if (NAME_FROM_CONTENT.has(role)) {
      const text = collapse(textOf(el, null));
      if (text !== "") return [text, "content"];
    }
    const title = collapse(el.getAttribute("title"));
    if (title !== "") return [title, "title"];
    const ph =
      collapse(el.getAttribute("placeholder")) ||
      collapse(el.getAttribute("data-placeholder")) ||
      collapse(el.getAttribute("aria-placeholder"));
    if (ph !== "" && (role === "textbox" || role === "searchbox" || tag === "input" || tag === "textarea")) {
      return [ph, "placeholder"];
    }
    return ["", "content"];
  };

  const valueOf = (el: Element, role: string): string | undefined => {
    if (role !== "textbox" && role !== "combobox" && role !== "slider") return undefined;
    // Secrets never leave the page.
    if (el.localName === "input" && typeOf(el) === "password") return undefined;
    let v: string | undefined;
    if (el.localName === "select") {
      v = Array.from((el as HTMLSelectElement).selectedOptions, (o) => collapse(o.label || o.textContent)).join(", ");
    } else if (el.localName === "input" || el.localName === "textarea") {
      v = (el as HTMLInputElement | HTMLTextAreaElement).value;
    } else if (isEditable(el)) {
      v = collapse(el.textContent);
    } else if (role === "slider") {
      v = el.getAttribute("aria-valuenow") ?? undefined;
    }
    return v === undefined || v === "" ? undefined : v;
  };

  const dialogOf = (node: Element): string | undefined => {
    try {
      const dialogEl = node.closest('dialog, [role="dialog"], [role="alertdialog"], [aria-modal="true"]');
      if (dialogEl !== null && dialogEl !== node) {
        let rawTitle = collapse(dialogEl.getAttribute("aria-label"));
        if (rawTitle === "") {
          const labelledby = collapse(dialogEl.getAttribute("aria-labelledby"));
          if (labelledby !== "") {
            const scope = dialogEl.getRootNode() as Document | ShadowRoot;
            const parts: string[] = [];
            for (const id of labelledby.split(" ")) {
              const ref = scope.getElementById(id);
              const text = ref ? refText(ref) : "";
              if (text !== "") parts.push(text);
            }
            if (parts.length > 0) rawTitle = parts.join(" ");
          }
        }
        if (rawTitle === "") {
          rawTitle =
            collapse(dialogEl.getAttribute("title")) ||
            collapse(dialogEl.querySelector("h1, h2, h3, h4, h5, h6, [role='heading']")?.textContent);
        }
        return rawTitle !== "" ? rawTitle : "dialog";
      }
    } catch {
      // closest not supported or detached
    }
    return undefined;
  };

  const isDisabled = (el: Element): boolean => {
    if (el.getAttribute("aria-disabled") === "true") return true;
    try {
      return el.matches(":disabled");
    } catch {
      return el.hasAttribute("disabled");
    }
  };

  const results: RawElement[] = [];
  const nodes: Element[] = [];
  const counts = new Map<string, number>();
  const stack: Element[] = [];
  // Push children reversed so pops come out in document order.
  const pushKids = (parent: ParentNode): void => {
    const kids = parent.children;
    for (let i = kids.length - 1; i >= 0; i--) {
      const k = kids[i];
      if (k) stack.push(k);
    }
  };
  stack.push(root.documentElement);

  while (stack.length > 0) {
    const el = stack.pop();
    if (!el) break;
    if (hiddenSelf(el)) continue;
    const tag = el.localName;
    if (tag === "script" || tag === "style" || tag === "template") continue;

    const role = tag === "input" && typeOf(el) === "hidden" ? null : roleOf(el);
    // visibility inherits and can be overridden by descendants, so it only gates this element.
    const isFile = tag === "input" && typeOf(el) === "file";
    const invisible = view !== null && ["hidden", "collapse"].includes(view.getComputedStyle(el).visibility);
    if (role !== null && (!invisible || isFile) && (includeAll || INTERACTIVE.has(role))) {
      const [name, nameSource] = nameOf(el, role);
      const key = `${role}\u0000${name}`;
      const occurrence = counts.get(key) ?? 0;
      counts.set(key, occurrence + 1);
      const item: RawElement = { role, name, nameSource, occurrence };
      const value = valueOf(el, role);
      if (value !== undefined) item.value = value;
      if (isDisabled(el)) item.disabled = true;
      if (tag === "input") item.inputType = typeOf(el) || "text";
      const href = el.getAttribute("href");
      if (role === "link" && href !== null) item.href = href;
      const ac = el.getAttribute("autocomplete");
      if (ac !== null) item.autocomplete = ac;
      if (role === "button" && (tag === "button" || tag === "input")) {
        const t = typeOf(el);
        if (t === "button" || t === "reset") item.buttonType = t;
        else if (t === "submit" || t === "image") item.buttonType = "submit";
        else item.buttonType = (el as HTMLButtonElement).form !== null ? "submit" : "button";
      }
      const phAttr =
        collapse(el.getAttribute("placeholder")) ||
        collapse(el.getAttribute("data-placeholder")) ||
        collapse(el.getAttribute("aria-placeholder"));
      if (phAttr !== "") item.placeholder = phAttr;

      const dName = dialogOf(el);
      if (dName !== undefined) {
        item.dialog = dName;
        item.container = `dialog: ${dName}`;
      }
      results.push(item);
      nodes.push(el);
    }

    // Light children first on the stack so open shadow content is visited first.
    pushKids(el);
    if (el.shadowRoot) pushKids(el.shadowRoot);
  }
  return { items: results, nodes };
}

export function collectInteractive(root: Document, options?: CollectOptions): RawElement[] {
  return collectImpl(root, options).items;
}

/** DOM elements in EXACTLY the order of `collectInteractive` (same options). */
export function collectNodes(root: Document, options?: CollectOptions): Element[] {
  return collectImpl(root, options).nodes;
}

/** Valid BiDi `functionDeclaration` text for `collectInteractive`. */
export const COLLECTOR_SOURCE: string = `(root, options) => (${collectImpl.toString()})(root, options).items`;

/** Valid BiDi `functionDeclaration` text for `collectNodes`. */
export const COLLECT_NODES_SOURCE: string = `(root, options) => (${collectImpl.toString()})(root, options).nodes`;
