import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { OfflineBackend } from "../../backend/backend.js";
import { PwaNavError } from "../../core/errors.js";
import { performSnapshot, performWait } from "../ops.js";

const DEMO_TREE = `
- heading "Dashboard" [ref=e1]
- textbox "Search files" [ref=e2]: admin
- button "Submit query" [ref=e3]
- button "Delete file" [disabled] [ref=e4]
- button "Generate video" [ref=e5]
`;

test("performWait succeeds immediately when element is visible", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pwa-nav-wait-"));
  const backend = new OfflineBackend({ agentDir: dir });
  await performSnapshot(DEMO_TREE, {
    url: "https://example.com",
    title: "Example",
    outPath: join(dir, "snapshot.json"),
    agentDir: dir,
  });

  // Query search
  const res1 = await performWait("video", { backend, timeoutMs: 500, intervalMs: 50 });
  assert.equal(res1.status, "ok");
  assert.equal(res1.matchedRef, "e5");
  assert.equal(res1.matchedName, "Generate video");

  // Ref search
  const res2 = await performWait("e3", { backend, timeoutMs: 500, intervalMs: 50 });
  assert.equal(res2.status, "ok");
  assert.equal(res2.matchedRef, "e3");

  // Slug search
  const res3 = await performWait("@submit-query", { backend, timeoutMs: 500, intervalMs: 50 });
  assert.equal(res3.status, "ok");
  assert.equal(res3.matchedRef, "e3");

  await rm(dir, { recursive: true, force: true });
});

test("performWait checks enabled condition", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pwa-nav-wait-enabled-"));
  const backend = new OfflineBackend({ agentDir: dir });
  await performSnapshot(DEMO_TREE, {
    url: "https://example.com",
    title: "Example",
    outPath: join(dir, "snapshot.json"),
    agentDir: dir,
  });

  // e3 is not disabled -> passes
  const res = await performWait("e3", {
    backend,
    state: "enabled",
    timeoutMs: 500,
    intervalMs: 50,
  });
  assert.equal(res.status, "ok");

  // e4 is disabled -> times out waiting for enabled
  await assert.rejects(
    async () => {
      await performWait("e4", {
        backend,
        state: "enabled",
        timeoutMs: 150,
        intervalMs: 50,
      });
    },
    (err: unknown) => {
      assert.ok(err instanceof PwaNavError);
      assert.equal(err.code, "timeout");
      return true;
    },
  );

  await rm(dir, { recursive: true, force: true });
});

test("performWait checks hidden condition", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pwa-nav-wait-hidden-"));
  const backend = new OfflineBackend({ agentDir: dir });
  await performSnapshot(DEMO_TREE, {
    url: "https://example.com",
    title: "Example",
    outPath: join(dir, "snapshot.json"),
    agentDir: dir,
  });

  // "Loading spinner" is not in the DOM -> hidden condition is met immediately
  const res = await performWait("Loading spinner", {
    backend,
    state: "hidden",
    timeoutMs: 500,
    intervalMs: 50,
  });
  assert.equal(res.status, "ok");

  // "Generate video" is in the DOM -> times out waiting for hidden
  await assert.rejects(
    async () => {
      await performWait("Generate video", {
        backend,
        state: "hidden",
        timeoutMs: 150,
        intervalMs: 50,
      });
    },
    (err: unknown) => {
      assert.ok(err instanceof PwaNavError);
      assert.equal(err.code, "timeout");
      return true;
    },
  );

  await rm(dir, { recursive: true, force: true });
});

test("performWait throws invalid_args on missing target", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pwa-nav-wait-invalid-"));
  const backend = new OfflineBackend({ agentDir: dir });

  await assert.rejects(
    async () => {
      await performWait("", { backend });
    },
    (err: unknown) => {
      assert.ok(err instanceof PwaNavError);
      assert.equal(err.code, "invalid_args");
      return true;
    },
  );

  await rm(dir, { recursive: true, force: true });
});
