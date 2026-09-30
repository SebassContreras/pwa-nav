// Snapshot contract for spec 001-nav-snapshot (T002).
// Pure normalizer: Playwright ARIA-tree text -> Snapshot. No browser calls.
import { randomUUID } from "node:crypto";

export interface SnapshotElement {
  ref: string;
  role: string;
  name: string;
  value?: string;
  disabled?: boolean;
}

export interface Snapshot {
  snapshotId: string;
  url: string;
  title: string;
  elements: SnapshotElement[];
}

export interface SnapshotMeta {
  url: string;
  title: string;
}

export interface NormalizeOptions {
  snapshotId?: string;
}

const REF_PATTERN = /\[ref=([^\]]+)\]/;
const DISABLED_PATTERN = /\[disabled\]/;
const QUOTED_NAME_PATTERN = /"((?:[^"\\]|\\.)*)"/;

function unescapeName(raw: string): string {
  return raw.replace(/\\(.)/g, "$1");
}

function parseLine(line: string): SnapshotElement | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("- ")) {
    return null;
  }
  const body = trimmed.slice(2).trim();
  if (body.length === 0) {
    return null;
  }

  const refMatch = REF_PATTERN.exec(body);
  if (refMatch === null || refMatch[1] === undefined) {
    return null;
  }
  const ref = refMatch[1].trim();
  if (ref.length === 0) {
    return null;
  }

  // Remove only the first [ref=...] occurrence; keep the rest for value parsing.
  let rest = body.replace(REF_PATTERN, "").trim();

  let disabled = false;
  if (DISABLED_PATTERN.test(rest)) {
    disabled = true;
    rest = rest.replace(DISABLED_PATTERN, "").trim();
  }

  // Role is the first token before a space, quote, bracket, or colon.
  const roleMatch = /^[^\s"[:]+/.exec(rest);
  const role = roleMatch === null ? "" : roleMatch[0].trim();
  if (role.length === 0) {
    return null;
  }

  const nameMatch = QUOTED_NAME_PATTERN.exec(rest);
  const name = nameMatch?.[1] === undefined ? "" : unescapeName(nameMatch[1]);

  // Value is the text after the first top-level colon (e.g. `: user@x.com`).
  // A trailing bare colon (container nodes like `generic:`) means no value.
  // The colon search starts after the quoted name so a ":" inside the name
  // is never mistaken for the value separator.
  let value: string | undefined;
  const valueSearchFrom =
    nameMatch === null ? role.length : nameMatch.index + nameMatch[0].length;
  const colonIndex = rest.indexOf(":", valueSearchFrom);
  if (colonIndex >= 0) {
    const after = rest.slice(colonIndex + 1).trim();
    if (after.length > 0) {
      value = after;
    }
  }

  const element: SnapshotElement = { ref, role, name };
  if (value !== undefined) {
    element.value = value;
  }
  if (disabled) {
    element.disabled = true;
  }
  return element;
}

export function normalize(
  rawTree: string,
  meta: SnapshotMeta,
  options: NormalizeOptions = {},
): Snapshot {
  const elements: SnapshotElement[] = [];
  for (const line of rawTree.split("\n")) {
    const element = parseLine(line);
    if (element !== null) {
      elements.push(element);
    }
  }
  return {
    snapshotId: options.snapshotId ?? randomUUID(),
    url: meta.url,
    title: meta.title,
    elements,
  };
}
