import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadLocators, resolveLocator, save, saveLive, StaleRefError } from "./refs.js";
import type { Snapshot } from "./snapshot.js";

const snap = (id: string): Snapshot => ({
  snapshotId: id,
  url: "https://x.test/",
  title: "t",
  elements: [
    { ref: "e1", role: "button", name: "Go" },
    { ref: "e2", role: "button", name: "Go" },
  ],
});

async function withDir(fn: (agentDir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "pwa-nav-refs-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("sidecar round trip", async () => {
  await withDir(async (agentDir) => {
    const locators = { e1: { role: "button", name: "Go", occurrence: 0 }, e2: { role: "button", name: "Go", occurrence: 5 } };
    await saveLive(snap("a1"), locators, { e1: { nameSource: "content" } }, { agentDir });
    const side = await loadLocators("a1", { agentDir });
    assert.deepEqual(side, { snapshotId: "a1", url: "https://x.test/", locators, extras: { e1: { nameSource: "content" } } });
    const r = await resolveLocator("a1", "e2", { agentDir });
    assert.deepEqual(r.locator, locators.e2);
    assert.equal(r.element.ref, "e2");
  });
});

test("fallback without sidecar uses snapshot-order occurrence", async () => {
  await withDir(async (agentDir) => {
    await save(snap("b1"), { agentDir });
    assert.equal(await loadLocators("b1", { agentDir }), null);
    const r = await resolveLocator("b1", "e2", { agentDir });
    assert.deepEqual(r.locator, { role: "button", name: "Go", occurrence: 1 });
  });
});

test("stale errors unchanged", async () => {
  await withDir(async (agentDir) => {
    await saveLive(snap("c1"), {}, undefined, { agentDir });
    await saveLive(snap("c2"), {}, undefined, { agentDir });
    await assert.rejects(resolveLocator("c1", "e1", { agentDir }), (e: unknown) => {
      assert.ok(e instanceof StaleRefError);
      assert.match(e.message, /^superseded snapshotId "c1" \(latest is "c2"\) \(code: stale_ref, snapshotId: c1\)\. Re-snapshot/);
      return true;
    });
    await assert.rejects(resolveLocator("zz", "e1", { agentDir }), /unknown snapshotId "zz"/);
    await assert.rejects(resolveLocator("c2", "e9", { agentDir }), /unknown ref "e9" for snapshotId "c2"/);
  });
});

test("sidecar records includeAll additively (absent unless provided)", async () => {
  await withDir(async (agentDir) => {
    await saveLive(snap("d1"), {}, undefined, { agentDir });
    assert.equal((await loadLocators("d1", { agentDir }))?.includeAll, undefined);
    await saveLive(snap("d2"), {}, undefined, { agentDir, includeAll: true });
    assert.equal((await loadLocators("d2", { agentDir }))?.includeAll, true);
    await saveLive(snap("d3"), {}, undefined, { agentDir, includeAll: false });
    assert.equal((await loadLocators("d3", { agentDir }))?.includeAll, false);
  });
});
