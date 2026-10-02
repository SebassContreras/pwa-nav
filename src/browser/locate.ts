// Pure live matching of a stored Locator against a fresh collector run (spec 004, T008).
import { StaleRefError } from "../core/refs.js";
import type { Locator } from "../screens/screen-map.js";
import type { Snapshot } from "../core/snapshot.js";
import type { RawElement } from "./collector.js";

export function findByLocator(
  raw: readonly RawElement[],
  locator: Locator,
): { index: number; element: RawElement } | null {
  const want = locator.occurrence ?? 0;
  let seen = 0;
  for (let index = 0; index < raw.length; index++) {
    const element = raw[index];
    if (element?.role === locator.role && element.name === locator.name) {
      if (seen === want) return { index, element };
      seen++;
    }
  }
  return null;
}

function stripFragment(url: string): string | null {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.href;
  } catch {
    return null;
  }
}

/** Equal ignoring the #fragment; invalid URLs never match. */
export function sameDocumentUrl(a: string, b: string): boolean {
  const left = stripFragment(a);
  const right = stripFragment(b);
  return left !== null && right !== null && left === right;
}

export function assertFresh(args: {
  snapshot: Snapshot;
  locator: Locator;
  live: { url: string; raw: readonly RawElement[] };
}): { index: number; element: RawElement } {
  const { snapshot, locator, live } = args;
  const id = snapshot.snapshotId;
  if (!sameDocumentUrl(snapshot.url, live.url)) {
    throw new StaleRefError(id, `page URL changed: snapshot was "${snapshot.url}", live page is "${live.url}"`);
  }
  const target = `role "${locator.role}" and name "${locator.name}"`;
  const count = live.raw.filter((e) => e.role === locator.role && e.name === locator.name).length;
  if (count === 0) {
    throw new StaleRefError(id, `no element with ${target}`);
  }
  // Contract is URL + existence of role/name/occurrence. A different total count than the
  // snapshot recorded is allowed: strictness would make dynamic lists unusable.
  const found = findByLocator(live.raw, locator);
  if (found === null) {
    const want = locator.occurrence ?? 0;
    throw new StaleRefError(
      id,
      `only ${String(count)} element(s) with ${target}, occurrence ${String(want)} requested`,
    );
  }
  return found;
}
