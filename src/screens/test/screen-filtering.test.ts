// Spec 001-screen-map-filtering: user content stays out of screens.json, live snapshots keep it.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { collectInteractive, type RawElement } from "../../browser/collector.js";
import { buildLiveSnapshot } from "../../browser/live-snapshot.js";
import { findByLocator } from "../../browser/locate.js";
import { learnScreen } from "../screen-learn.js";
import { mergeScreen } from "../screen-merge.js";
import type { Screen } from "../screen-map.js";

const html = readFileSync(new URL("../../../checks/fixtures/chat.html", import.meta.url), "utf8");
const raw: RawElement[] = collectInteractive(new JSDOM(html).window.document);
const PAGE = { url: "http://localhost:8080/chat", title: "Chat", appOrigin: "http://localhost:8080" };
const NOW = new Date("2026-10-08T10:00:00Z");
const learned = learnScreen(raw, PAGE, { now: NOW });

const persistedNames = (screen: Screen): string[] =>
  [...screen.fields, ...screen.actions, ...screen.links].map((e) => e.name);

const CONTENT = [
  "Hey, are we still meeting tomorrow at noon?",
  "Reaction 👍 1",
  "View reactions",
  "Quoted message: are we still meeting",
  "Yes, see you at the usual place!",
  "Fede",
  "Thanks, that works perfectly for me.",
  "Reacción ❤️",
];

test("chat fixture persists only patterns for message content (R1, R2, R3, R5)", () => {
  const names = persistedNames(learned);
  for (const name of CONTENT) assert.ok(!names.includes(name), `persisted: ${name}`);
  const patterns = learned.patterns ?? [];
  assert.deepEqual(
    patterns.map((p) => [p.containerRole, p.itemRole, p.dynamicChildren]),
    [["log", "button", true], ["log", "link", true]],
  );
  for (const p of patterns) assert.equal(p.containerName, "Conversation with Fede");
});

test("live snapshot still lists and resolves every excluded element (R4, D5)", () => {
  const { snapshot, locators } = buildLiveSnapshot(raw, { url: PAGE.url, title: PAGE.title }, { snapshotId: "s1" });
  for (const name of CONTENT) {
    const element = snapshot.elements.find((e) => e.name === name);
    assert.ok(element, `missing from snapshot: ${name}`);
    const locator = locators[element.ref];
    assert.ok(locator);
    assert.equal(findByLocator(raw, locator)?.element.name, name);
  }
});

test("chrome controls are persisted exactly as without the content (R6)", () => {
  const chromeOnly = raw.filter((e) => !CONTENT.includes(e.name));
  const baseline = learnScreen(chromeOnly, PAGE, { now: NOW });
  assert.deepEqual(learned.fields, baseline.fields);
  assert.deepEqual(learned.actions, baseline.actions);
  assert.deepEqual(learned.links, baseline.links);
  assert.deepEqual(learned.links.map((l) => l.id), ["sign-in"]);
  assert.deepEqual(learned.fields.map((f) => f.id), ["search", "message"]);
  assert.deepEqual(learned.actions.map((a) => a.id), ["attach-file", "send"]);
});

test("re-learning a polluted screen keeps junk without prune, removes it with prune (R5, R7)", () => {
  const junk = { id: "view-reactions", role: "button", name: "View reactions", nameSource: "content" as const, kind: "button" as const, effect: "none" as const, locator: { role: "button", name: "View reactions", occurrence: 0 } };
  const polluted: Screen = { ...learned, actions: [...learned.actions, junk] };
  delete polluted.patterns;

  const kept = mergeScreen(polluted, learned, { now: NOW }).screen;
  assert.ok(kept.actions.some((a) => a.id === "view-reactions"));
  assert.deepEqual(kept.patterns, learned.patterns);

  const pruned = mergeScreen(polluted, learned, { now: NOW, prune: true }).screen;
  assert.ok(!pruned.actions.some((a) => a.id === "view-reactions"));
  assert.deepEqual(pruned.patterns, learned.patterns);
  assert.deepEqual(pruned.actions.map((a) => a.id), learned.actions.map((a) => a.id));
});
