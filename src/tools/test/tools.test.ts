import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  openTool,
  clickTool,
  fillTool,
  uploadTool,
  findTool,
  extractTool,
  waitTool,
  screenshotTool,
  authTool,
  qaTool,
  type ToolContext,
} from "../index.js";
import { OfflineBackend } from "../../backend/backend.js";
import { performSnapshot } from "../../ops/ops.js";

function makeOfflineContext(armed = false): ToolContext {
  const backend = new OfflineBackend({ armed });
  return {
    backendFactory: () => backend,
    backend,
    armed,
    mode: "offline",
    screens: {},
  };
}

test("openTool validates url and offline limitations", async () => {
  const ctx = makeOfflineContext();
  await assert.rejects(
    async () => openTool({ url: "" }, ctx),
    /missing <url>/,
  );
  await assert.rejects(
    async () => openTool({ url: "https://example.com", launch: true }, ctx),
    /require the live backend/,
  );
  const result = await openTool({ url: "https://example.com" }, ctx);
  assert.equal(result.structured["url"], "https://example.com");
  assert.match(result.text ?? "", /open ok: https:\/\/example\.com/);
});

test("authTool handles relay errors", async () => {
  const ctx = makeOfflineContext();
  await assert.rejects(
    async () => authTool({ action: "clean", app: "nonexistent-app-xyz" }, ctx),
    /requires the live backend/,
  );
});

test("clickTool and fillTool reject invalid target/ref combinations", async () => {
  const ctx = makeOfflineContext();
  await assert.rejects(
    async () => clickTool({}, ctx),
    /pass target/,
  );
  await assert.rejects(
    async () => clickTool({ target: "@btn", ref: "e1" }, ctx),
    /pass either target or ref, not both/,
  );
  await assert.rejects(
    async () => fillTool({ text: "abc" }, ctx),
    /pass target/,
  );
});

test("uploadTool requires non-empty files array", async () => {
  const ctx = makeOfflineContext();
  await assert.rejects(
    async () => uploadTool({ target: "@upload", files: [] }, ctx),
    /missing files to upload/,
  );
});

test("findTool and extractTool accept query with proper defaults", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tools-test-"));
  const ctx = makeOfflineContext();
  ctx.backend = new OfflineBackend({ agentDir: dir });
  await performSnapshot("- button \"Sign in\" [ref=e1]", {
    url: "http://localhost:8080/login",
    title: "Demo",
    outPath: join(dir, "snapshot.json"),
    agentDir: dir,
    quiet: true,
  });

  const findResult = await findTool({ query: "Sign" }, ctx);
  assert.equal(findResult.structured["total"], 1);

  const extractResult = await extractTool({ mode: "text" }, ctx);
  assert.equal(extractResult.structured["total"], 1);
  await rm(dir, { recursive: true, force: true });
});

test("waitTool requires either target or query", async () => {
  const ctx = makeOfflineContext();
  await assert.rejects(
    async () => waitTool({}, ctx),
    /must pass either target or query/,
  );
});

test("screenshotTool returns path on offline backend", async () => {
  const dir = await mkdtemp(join(tmpdir(), "tools-test-"));
  const ctx = makeOfflineContext();
  ctx.backend = new OfflineBackend({ agentDir: dir });
  const result = await screenshotTool({ outPath: join(dir, "screen.png") }, ctx);
  assert.ok(result.structured["path"]);
  await rm(dir, { recursive: true, force: true });
});

test("qaTool requires checkFile", async () => {
  const ctx = makeOfflineContext();
  await assert.rejects(
    async () => qaTool({ checkFile: "" }, ctx),
    /missing <check-file>/,
  );
});
