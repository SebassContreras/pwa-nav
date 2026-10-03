// stdio conformance (spec 006): spawn dist/mcp.js on the OFFLINE backend, talk over the real pipe,
// and assert stdout carries only JSON-RPC frames. Never touches a browser or port 9222.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const MCP = existsSync(join(dirname(fileURLToPath(import.meta.url)), "..", "mcp.js"))
  ? join(dirname(fileURLToPath(import.meta.url)), "..", "mcp.js")
  : join(dirname(fileURLToPath(import.meta.url)), "../../dist/mcp.js");

test("stdio: lists tools, calls an offline tool, exits cleanly on close", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pwa-nav-mcp-stdio-"));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [MCP, "--backend", "offline", "--agent-dir", join(dir, ".agent")],
    cwd: dir,
    stderr: "pipe",
  });
  const client = new Client({ name: "test", version: "0.0.0" });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.equal(tools.length, 11);
    const opened = (await client.callTool({
      name: "pwa_open",
      arguments: { url: "http://localhost:8080/login" },
    })) as { isError?: boolean; content: { text?: string }[] };
    assert.notEqual(opened.isError, true);
    assert.match(opened.content[0]?.text ?? "", /^open ok: http:\/\/localhost:8080\/login/);
    const bad = (await client.callTool({ name: "pwa_open", arguments: {} })) as { isError?: boolean };
    assert.equal(bad.isError, true);
  } finally {
    await client.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("stdio: stdout carries only protocol frames; clean exit when stdin closes", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pwa-nav-mcp-stdio-"));
  const child = spawn(process.execPath, [MCP, "--backend", "offline", "--agent-dir", join(dir, ".agent")], {
    cwd: dir,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (d: string) => (stdout += d));
  child.stderr.setEncoding("utf8").on("data", (d: string) => (stderr += d));
  const exited = new Promise<number | null>((resolve) => child.on("close", resolve));
  const send = (message: unknown): void => {
    child.stdin.write(JSON.stringify(message) + "\n");
  };
  try {
    send({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "raw", version: "0" } },
    });
    send({ jsonrpc: "2.0", method: "notifications/initialized" });
    // An op that makes the ops layer print with console.log: it must not leak onto stdout.
    send({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "pwa_open", arguments: { url: "http://localhost:8080/" } } });
    send({ jsonrpc: "2.0", id: 3, method: "tools/list" });
    const deadline = Date.now() + 15_000;
    // tools/list (id 3) answers before the mutex-serialized tools/call (id 2): wait for both.
    while (!(stdout.includes('"id":2') && stdout.includes('"id":3')) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 50));
    }
    child.stdin.end();
    let timer: NodeJS.Timeout | undefined;
    const status = await Promise.race([
      exited,
      new Promise<string>((r) => {
        timer = setTimeout(() => {
          r("timeout");
        }, 10_000);
      }),
    ]);
    clearTimeout(timer);
    assert.equal(status, 0, stderr);
    const lines = stdout.split("\n").filter((l) => l.length > 0);
    assert.ok(lines.length >= 3, stdout);
    for (const line of lines) {
      const frame = JSON.parse(line) as { jsonrpc?: string };
      assert.equal(frame.jsonrpc, "2.0", line);
    }
    assert.ok(!stdout.includes("open ok:") || stdout.includes('"content"'));
    assert.match(stderr, /pwa-nav-mcp ready/);
  } finally {
    child.kill();
    await rm(dir, { recursive: true, force: true });
  }
});
