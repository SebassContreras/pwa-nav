import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { OfflineBackend } from "../backend/backend.js";
import { performExtract, performExtractDetailed, performFind, performSnapshot } from "./ops.js";

const DEMO_TREE = `
- heading "Dashboard" [ref=e1]
- textbox "Search files" [ref=e2]: admin
- button "Submit query" [ref=e3]
- button "Delete file" [disabled] [ref=e4]
- link "Documentation" [ref=e5]
- link "Settings" [ref=e6]
- button "Generate video" [ref=e7]
`;

test("performExtract filters by mode text and links", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pwa-nav-extract-"));
  const backend = new OfflineBackend({ agentDir: dir });
  const snapshot = await performSnapshot(DEMO_TREE, {
    url: "https://example.com",
    title: "Example",
    outPath: join(dir, "snapshot.json"),
    agentDir: dir,
  });

  const textLines = await performExtract(snapshot.snapshotId, "text", { backend });
  assert.equal(textLines.length, 7);

  const linkLines = await performExtract(snapshot.snapshotId, "links", { backend });
  assert.equal(linkLines.length, 5); // 3 buttons + 2 links

  await rm(dir, { recursive: true, force: true });
});

test("performExtractDetailed filters by query and role", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pwa-nav-extract-filter-"));
  const backend = new OfflineBackend({ agentDir: dir });
  const snapshot = await performSnapshot(DEMO_TREE, {
    url: "https://example.com",
    title: "Example",
    outPath: join(dir, "snapshot.json"),
    agentDir: dir,
  });

  // Query filter
  const videoSearch = await performExtractDetailed(snapshot.snapshotId, "text", {
    backend,
    query: "video",
  });
  assert.equal(videoSearch.total, 1);
  assert.equal(videoSearch.lines[0], 'e7 button "Generate video"');

  // Role filter
  const buttonsOnly = await performExtractDetailed(snapshot.snapshotId, "text", {
    backend,
    role: "button",
  });
  assert.equal(buttonsOnly.total, 3);
  assert.ok(buttonsOnly.lines.some((l) => l.includes("[disabled]")));

  // Combined query and role
  const combined = await performExtractDetailed(snapshot.snapshotId, "text", {
    backend,
    role: "textbox",
    query: "search",
  });
  assert.equal(combined.total, 1);
  assert.equal(combined.lines[0], 'e2 textbox "Search files": admin');

  await rm(dir, { recursive: true, force: true });
});

test("performExtractDetailed handles offset and limit pagination", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pwa-nav-extract-page-"));
  const backend = new OfflineBackend({ agentDir: dir });
  const snapshot = await performSnapshot(DEMO_TREE, {
    url: "https://example.com",
    title: "Example",
    outPath: join(dir, "snapshot.json"),
    agentDir: dir,
  });

  const page1 = await performExtractDetailed(snapshot.snapshotId, "text", {
    backend,
    offset: 0,
    limit: 2,
  });
  assert.equal(page1.total, 7);
  assert.equal(page1.returned, 2);
  assert.equal(page1.lines.length, 2);

  const page2 = await performExtractDetailed(snapshot.snapshotId, "text", {
    backend,
    offset: 2,
    limit: 2,
  });
  assert.equal(page2.total, 7);
  assert.equal(page2.returned, 2);
  assert.notDeepEqual(page1.lines, page2.lines);

  await rm(dir, { recursive: true, force: true });
});

test("performFind searches across role, name, and attributes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pwa-nav-find-"));
  const backend = new OfflineBackend({ agentDir: dir });
  const snapshot = await performSnapshot(DEMO_TREE, {
    url: "https://example.com",
    title: "Example",
    outPath: join(dir, "snapshot.json"),
    agentDir: dir,
  });

  const found = await performFind(snapshot.snapshotId, {
    backend,
    query: "delete",
  });
  assert.equal(found.total, 1);
  assert.equal(found.elements[0]?.ref, "e4");
  assert.ok(found.lines[0]?.includes("Delete file"));

  const foundRole = await performFind(snapshot.snapshotId, {
    backend,
    role: "button",
  });
  assert.equal(foundRole.total, 3);

  await rm(dir, { recursive: true, force: true });
});

