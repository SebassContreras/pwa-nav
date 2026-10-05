import assert from "node:assert/strict";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../mcp-server.js";
import { performSnapshot } from "../../ops/ops.js";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { OfflineBackend } from "../../backend/backend.js";

const DEMO_TREE = `
- heading "Dashboard" [ref=e1]
- textbox "Search files" [ref=e2]: admin
- button "Submit query" [ref=e3]
- button "Delete file" [disabled] [ref=e4]
- button "Generate video" [ref=e5]
`;

async function call(client: Client, name: string, args: Record<string, unknown>) {
  const result = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content: { type: string; text?: string }[];
    structuredContent?: Record<string, unknown>;
  };
  return {
    isError: result.isError === true,
    text: result.content.map((c) => c.text ?? "").join("\n"),
    structured: result.structuredContent ?? {},
  };
}

test("pwa_wait via MCP detects visible element immediately", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pwa-nav-mcp-wait-"));
  const backend = new OfflineBackend({ agentDir: dir });
  await performSnapshot(DEMO_TREE, {
    url: "https://example.com",
    title: "Example",
    outPath: join(dir, "snapshot.json"),
    agentDir: dir,
  });

  const server = createMcpServer({ backendFactory: () => backend, mode: "offline" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });
  await client.connect(clientTransport);

  const res = await call(client, "pwa_wait", {
    query: "video",
    state: "visible",
    timeoutMs: 500,
    intervalMs: 50,
  });

  assert.equal(res.isError, false);
  assert.equal(res.structured["status"], "ok");
  assert.equal(res.structured["matchedRef"], "e5");

  await client.close();
  await server.close();
  await rm(dir, { recursive: true, force: true });
});

test("pwa_extract via MCP filters by query and role", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pwa-nav-mcp-extract-"));
  const backend = new OfflineBackend({ agentDir: dir });
  const snap = await performSnapshot(DEMO_TREE, {
    url: "https://example.com",
    title: "Example",
    outPath: join(dir, "snapshot.json"),
    agentDir: dir,
  });

  const server = createMcpServer({ backendFactory: () => backend, mode: "offline" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test-client", version: "1.0.0" }, { capabilities: {} });
  await client.connect(clientTransport);

  // query filter
  const resQuery = await call(client, "pwa_extract", {
    snapshotId: snap.snapshotId,
    mode: "text",
    query: "video",
  });
  assert.equal(resQuery.isError, false);
  assert.ok(resQuery.text.includes("Generate video"));

  // role filter
  const resRole = await call(client, "pwa_extract", {
    snapshotId: snap.snapshotId,
    mode: "text",
    role: "textbox",
  });
  assert.equal(resRole.isError, false);
  assert.ok(resRole.text.includes("Search files"));
  assert.ok(!resRole.text.includes("Generate video"));

  await client.close();
  await server.close();
  await rm(dir, { recursive: true, force: true });
});
