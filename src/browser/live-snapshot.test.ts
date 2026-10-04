import assert from "node:assert/strict";
import { test } from "node:test";
import type { RawElement } from "./collector.js";
import { buildLiveSnapshot } from "./live-snapshot.js";

const raw: RawElement[] = [
  { role: "textbox", name: "Email", nameSource: "label", value: "a@b.c", occurrence: 0, inputType: "email", autocomplete: "email" },
  { role: "button", name: "Go", nameSource: "content", disabled: true, occurrence: 0 },
  { role: "link", name: "Go", nameSource: "content", occurrence: 0, href: "/x" },
  { role: "button", name: "Go", nameSource: "content", occurrence: 1 },
];

test("refs, optional fields and exact public keys", () => {
  const { snapshot } = buildLiveSnapshot(raw, { url: "https://x.test/", title: "T" }, { snapshotId: "s1" });
  assert.deepEqual(Object.keys(snapshot), ["snapshotId", "url", "title", "elements"]);
  assert.equal(snapshot.snapshotId, "s1");
  assert.deepEqual(snapshot.elements.map((e) => e.ref), ["e1", "e2", "e3", "e4"]);
  assert.deepEqual(snapshot.elements[0], { ref: "e1", role: "textbox", name: "Email", value: "a@b.c" });
  assert.deepEqual(snapshot.elements[1], { ref: "e2", role: "button", name: "Go", disabled: true });
  assert.deepEqual(snapshot.elements[2], { ref: "e3", role: "link", name: "Go" });
});

test("locators carry occurrence; extras kept apart", () => {
  const { locators, extras } = buildLiveSnapshot(raw, { url: "u", title: "t" });
  assert.deepEqual(locators["e4"], { role: "button", name: "Go", occurrence: 1 });
  assert.deepEqual(extras["e1"], { nameSource: "label", inputType: "email", autocomplete: "email" });
  assert.deepEqual(extras["e3"], { nameSource: "content", href: "/x" });
  assert.deepEqual(extras["e2"], { nameSource: "content" });
});

test("snapshotId defaults to a uuid", () => {
  const { snapshot } = buildLiveSnapshot([], { url: "u", title: "t" });
  assert.match(snapshot.snapshotId, /^[0-9a-f-]{36}$/);
});

test("activeDialog and element context are populated when dialogs are present", () => {
  const dialogRaw: RawElement[] = [
    { role: "textbox", name: "Text", nameSource: "placeholder", occurrence: 0, placeholder: "¿De qué quieres hablar?", dialog: "Crear publicación", container: "dialog: Crear publicación" },
    { role: "button", name: "Publicar", nameSource: "content", occurrence: 0, dialog: "Crear publicación", container: "dialog: Crear publicación" },
    { role: "button", name: "Fuera", nameSource: "content", occurrence: 0 },
  ];
  const { snapshot } = buildLiveSnapshot(dialogRaw, { url: "u", title: "t" });
  assert.deepEqual(snapshot.activeDialog, {
    title: "Crear publicación",
    elementCount: 2,
    refs: ["e1", "e2"],
  });
  const first = snapshot.elements[0];
  assert.ok(first);
  assert.equal(first.placeholder, "¿De qué quieres hablar?");
  assert.equal(first.dialog, "Crear publicación");
  assert.equal(first.container, "dialog: Crear publicación");
});

