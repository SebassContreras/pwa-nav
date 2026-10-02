import assert from "node:assert/strict";
import { test } from "node:test";
import { StaleRefError } from "../core/refs.js";
import type { Snapshot } from "../core/snapshot.js";
import type { RawElement } from "./collector.js";
import { assertFresh, findByLocator, sameDocumentUrl } from "./locate.js";

const el = (role: string, name: string, occurrence = 0): RawElement => ({ role, name, nameSource: "content", occurrence });
const raw = [el("button", "Go"), el("link", "Go"), el("button", "Go", 1)];
const snapshot: Snapshot = { snapshotId: "s1", url: "https://x.test/a#top", title: "t", elements: [] };

test("findByLocator picks nth occurrence", () => {
  assert.equal(findByLocator(raw, { role: "button", name: "Go" })?.index, 0);
  assert.equal(findByLocator(raw, { role: "button", name: "Go", occurrence: 1 })?.index, 2);
  assert.equal(findByLocator(raw, { role: "button", name: "Go", occurrence: 2 }), null);
  assert.equal(findByLocator(raw, { role: "button", name: "go" }), null);
});

test("sameDocumentUrl ignores fragment, rejects invalid", () => {
  assert.equal(sameDocumentUrl("https://x.test/a#1", "https://x.test/a#2"), true);
  assert.equal(sameDocumentUrl("https://x.test/a", "https://x.test/b"), false);
  assert.equal(sameDocumentUrl("nope", "nope"), false);
});

function stale(fn: () => unknown): string {
  try {
    fn();
  } catch (e) {
    assert.ok(e instanceof StaleRefError);
    assert.match(e.message, /Re-snapshot to get a fresh snapshotId \+ ref\./);
    return e.message;
  }
  throw new Error("expected StaleRefError");
}

test("assertFresh ok and failures", () => {
  const live = { url: "https://x.test/a#other", raw };
  assert.equal(assertFresh({ snapshot, locator: { role: "link", name: "Go", occurrence: 0 }, live }).index, 1);
  assert.match(
    stale(() => assertFresh({ snapshot, locator: { role: "link", name: "Go" }, live: { ...live, url: "https://x.test/b" } })),
    /"https:\/\/x\.test\/a#top".*"https:\/\/x\.test\/b"/,
  );
  assert.match(
    stale(() => assertFresh({ snapshot, locator: { role: "tab", name: "Z" }, live })),
    /no element with role "tab" and name "Z"/,
  );
  assert.match(
    stale(() => assertFresh({ snapshot, locator: { role: "link", name: "Go", occurrence: 3 }, live })),
    /only 1 element\(s\) with role "link" and name "Go", occurrence 3 requested/,
  );
});
