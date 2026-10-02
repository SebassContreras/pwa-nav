// RawElement[] -> public Snapshot + per-ref locators (spec 004, T008). Pure.
// Node handles do not survive BiDi sessions, so each ref keeps a role+name+occurrence locator.
import { randomUUID } from "node:crypto";
import type { Locator } from "../screens/screen-map.js";
import type { Snapshot, SnapshotElement } from "../core/snapshot.js";
import type { NameSource, RawElement } from "./collector.js";

export interface LiveExtras {
  nameSource: NameSource;
  inputType?: string;
  href?: string;
  autocomplete?: string;
}

export interface LiveSnapshot {
  snapshot: Snapshot;
  locators: Record<string, Locator>;
  /** For spec 005; never written into snapshot.json. */
  extras: Record<string, LiveExtras>;
}

export function buildLiveSnapshot(
  raw: readonly RawElement[],
  meta: { url: string; title: string },
  options: { snapshotId?: string } = {},
): LiveSnapshot {
  const elements: SnapshotElement[] = [];
  const locators: Record<string, Locator> = {};
  const extras: Record<string, LiveExtras> = {};
  raw.forEach((item, i) => {
    const ref = `e${String(i + 1)}`;
    const element: SnapshotElement = { ref, role: item.role, name: item.name };
    if (item.value !== undefined) element.value = item.value;
    if (item.disabled === true) element.disabled = true;
    elements.push(element);
    locators[ref] = { role: item.role, name: item.name, occurrence: item.occurrence };
    const extra: LiveExtras = { nameSource: item.nameSource };
    if (item.inputType !== undefined) extra.inputType = item.inputType;
    if (item.href !== undefined) extra.href = item.href;
    if (item.autocomplete !== undefined) extra.autocomplete = item.autocomplete;
    extras[ref] = extra;
  });
  return {
    snapshot: { snapshotId: options.snapshotId ?? randomUUID(), url: meta.url, title: meta.title, elements },
    locators,
    extras,
  };
}
