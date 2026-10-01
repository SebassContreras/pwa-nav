import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { RawElement } from "./browser/collector.js";
import { learnScreen } from "./screen-learn.js";
import { ScreenMapError, type ScreenMap } from "./screen-map.js";
import { diffScreens as diffFor, isEmptyDiff } from "./screen-merge.js";
import { learnIntoFile, renderDiff, writeScreenMap } from "./screen-store.js";
import { readFileSync } from "node:fs";

const readJson = (rel: string): unknown => JSON.parse(readFileSync(new URL(`../${rel}`, import.meta.url), "utf8"));
const golden = readJson("checks/fixtures/login.golden.json") as RawElement[];
const demo = readJson("examples/screens/demo-app.screens.json") as ScreenMap;
const PAGE = { url: "http://localhost:8080/login", title: "Demo App", appOrigin: "http://localhost:8080" };
const APP = { id: "demo-app", name: "Demo App", origin: "http://localhost:8080", locale: "en" };
const NOW = new Date("2027-01-02T03:04:05Z");
const learn = (raw: readonly RawElement[]) => learnScreen(raw, PAGE, { now: NOW, access: "public" });

async function withDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "screen-store-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("writeScreenMap writes stable JSON with $schema first and no temp files", async () => {
  await withDir(async (dir) => {
    const path = join(dir, "demo.screens.json");
    await writeScreenMap(path, demo);
    const text = await readFile(path, "utf8");
    assert.ok(text.startsWith('{\n  "$schema"'));
    assert.ok(text.endsWith("}\n"));
    assert.deepEqual(JSON.parse(text), demo);
    assert.deepEqual(await readdir(dir), ["demo.screens.json"]);
  });
});

test("writeScreenMap validation failure writes nothing and keeps the old file", async () => {
  await withDir(async (dir) => {
    const path = join(dir, "demo.screens.json");
    await writeScreenMap(path, demo);
    const before = await readFile(path, "utf8");
    const bad = structuredClone(demo);
    const [screen] = bad.screens;
    assert.ok(screen);
    screen.fingerprint = "sha256:" + "0".repeat(64);
    await assert.rejects(writeScreenMap(path, bad), ScreenMapError);
    assert.equal(await readFile(path, "utf8"), before);
    assert.deepEqual(await readdir(dir), ["demo.screens.json"]);
    await assert.rejects(writeScreenMap(join(dir, "new.screens.json"), bad), ScreenMapError);
    assert.deepEqual(await readdir(dir), ["demo.screens.json"]);
  });
});

test("learnIntoFile: new file, unchanged, changed", async () => {
  await withDir(async (dir) => {
    const path = join(dir, "sub", "demo.screens.json");
    const created = await learnIntoFile({ path, learned: learn(golden), app: APP, now: NOW });
    assert.equal(created.written, true);
    assert.equal(created.diff.isNew, true);
    assert.equal((await readdir(join(dir, "sub"))).length, 1);

    const old = new Date("2020-01-01T00:00:00Z");
    await utimes(path, old, old);
    const same = await learnIntoFile({ path, learned: learn(golden), app: APP, now: new Date("2030-01-01T00:00:00Z") });
    assert.equal(same.written, false);
    assert.ok(isEmptyDiff(same.diff));
    assert.equal((await stat(path)).mtimeMs, old.getTime());

    const renamed = golden.map((e) => (e.name === "Sign in" ? { ...e, name: "Log in" } : e));
    const changed = await learnIntoFile({ path, learned: learn(renamed), app: APP, now: NOW });
    assert.equal(changed.written, true);
    assert.equal(changed.diff.renamed.length, 1);
    const onDisk = JSON.parse(await readFile(path, "utf8")) as ScreenMap;
    assert.equal(onDisk.screens[0]?.actions[1]?.id, "sign-in");
    assert.equal(onDisk.screens[0].actions[1].name, "Log in");

    // Kept-missing only: reported, but the file stays untouched.
    const fewer = renamed.filter((e) => e.name !== "Help center");
    const kept = await learnIntoFile({ path, learned: learn(fewer), app: APP, now: NOW });
    assert.equal(kept.diff.missing.length, 1);
    assert.equal(kept.written, false);
    const pruned = await learnIntoFile({ path, learned: learn(fewer), app: APP, now: NOW, prune: true });
    assert.equal(pruned.written, true);
    assert.ok(!pruned.map.screens[0]?.links.some((l) => l.id === "help-center"));
  });
});

test("learnIntoFile surfaces an invalid existing file", async () => {
  await withDir(async (dir) => {
    const path = join(dir, "bad.screens.json");
    await writeFile(path, "{}", "utf8");
    await assert.rejects(learnIntoFile({ path, learned: learn(golden), app: APP }), ScreenMapError);
  });
});

test("renderDiff", () => {
  const renamed = golden.map((e) => (e.name === "Sign in" ? { ...e, name: "Log in" } : e));
  const raw = [...renamed, { role: "textbox", name: "Phone", nameSource: "placeholder", occurrence: 0 } as RawElement];
  const existing = demo.screens[0];
  assert.ok(existing);
  const diff = diffFor(existing, learn(raw));
  const text = renderDiff(diff);
  assert.match(text, /^\+ field @phone textbox "Phone"$/m);
  assert.match(text, /^~ renamed @sign-in "Sign in" -> "Log in"$/m);
  assert.match(text, /^fp: 40288a29 -> [0-9a-f]{8} DRIFT$/m);
  assert.match(text, /^a11y: \+name-from-placeholder-only @phone$/m);
  assert.equal(renderDiff(diffFor(existing, learn(golden))), "no changes");
});

