// stdio conformance on the LIVE path (spec 006, T006): spawn the compiled server (dist/mcp.js) with
// --backend bidi against the in-process fake BiDi server (explicit port, never 9222) and drive it
// with the SDK client over the real pipe. Children are always killed in `finally`.
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { startFakeBidiServer, type FakeBidiServer } from "../../bidi/fake-server.js";
import type { RawElement } from "../../browser/collector.js";
import { learnScreen } from "../../screens/screen-learn.js";
import type { ScreenMap } from "../../screens/screen-map.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..");
const MCP = existsSync(join(HERE, "..", "..", "mcp.js"))
  ? join(HERE, "..", "..", "mcp.js")
  : join(ROOT, "dist", "mcp.js");
const ORIGIN = "http://localhost:8080";

function remote(value: unknown): unknown {
  if (value === undefined) return { type: "undefined" };
  if (value === null) return { type: "null" };
  if (typeof value === "string") return { type: "string", value };
  if (typeof value === "number") return { type: "number", value };
  if (typeof value === "boolean") return { type: "boolean", value };
  if (Array.isArray(value)) return { type: "array", value: value.map(remote) };
  return { type: "object", value: Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, remote(v)]) };
}
const ok = (value: unknown): unknown => ({ type: "success", realm: "r", result: remote(value) });

const SEARCH_RAW: RawElement[] = [
  { role: "textbox", name: "Query", nameSource: "label", occurrence: 0, inputType: "text" },
  { role: "button", name: "Search", nameSource: "content", occurrence: 0, buttonType: "submit" },
];

function searchMap(): ScreenMap {
  const screen = learnScreen(SEARCH_RAW, { url: `${ORIGIN}/search`, title: "Search", appOrigin: ORIGIN }, { access: "public" });
  screen.flows = [
    {
      id: "search",
      description: "Search for a term.",
      humanOnly: false,
      inputSchema: {
        type: "object",
        required: ["q"],
        properties: { q: { type: "string", minLength: 1 } },
        additionalProperties: false,
      },
      steps: [
        { op: "fill", target: "@query", from: "q" },
        { op: "click", target: "@search" },
      ],
    },
    {
      id: "private",
      description: "Needs the user.",
      humanOnly: true,
      inputSchema: { type: "object", properties: { q: { type: "string" } } },
      steps: [{ op: "click", target: "@search" }],
    },
  ];
  return {
    schemaVersion: "1.0.0",
    app: { id: "synthetic", name: "Synthetic", origin: ORIGIN, locale: "en", learnedAt: "2026-10-01T00:00:00Z" },
    screens: [screen],
  };
}

interface Env {
  dir: string;
  agentDir: string;
  screensDir: string;
  server: FakeBidiServer;
  childEnv: Record<string, string>;
}

async function withEnv(fn: (env: Env) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "pwa-nav-mcp-bidi-"));
  const server = await startFakeBidiServer();
  const page = { url: `${ORIGIN}/search`, title: "Search" };
  server.handle("session.subscribe", () => ({ subscription: "s" }));
  server.handle("input.performActions", () => ({}));
  server.handle("input.releaseActions", () => ({}));
  server.handle("browsingContext.getTree", () => ({
    contexts: [{ context: "ctx", url: page.url, children: [], userContext: "default" }],
  }));
  server.handle("browsingContext.navigate", (params) => {
    page.url = (params as { url: string }).url;
    return { navigation: "n1", url: page.url };
  });
  server.handle("script.evaluate", () => ok(page.url));
  server.handle("script.callFunction", (params) => {
    const decl = (params as { functionDeclaration: string }).functionDeclaration;
    if (decl.startsWith("(includeAll) =>")) return ok({ url: page.url, title: page.title, raw: SEARCH_RAW });
    if (decl.startsWith("(index, role")) {
      return { type: "success", realm: "r", result: { type: "node", sharedId: "node-1" } };
    }
    if (decl.includes("isContentEditable")) return ok({ ok: true, kind: "text", sensitive: false });
    if (decl.includes("MutationObserver")) return ok(true);
    if (decl.includes("elementFromPoint")) return ok({ ok: true });
    if (decl.startsWith("() => ({ url: location.href")) return ok({ url: page.url, title: page.title });
    return ok(true);
  });
  const screensDir = join(dir, "screens");
  await mkdir(screensDir, { recursive: true });
  await writeFile(join(screensDir, "synthetic.screens.json"), JSON.stringify(searchMap()), "utf8");
  const childEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== "PWA_NAV_ARMED" && key !== "PWA_NAV_SCREENS_DIR") childEnv[key] = value;
  }
  childEnv["PWA_NAV_KILL_SWITCH"] = join(dir, "kill-file");
  childEnv["PWA_NAV_FIREFOXPWA_DIR"] = join(dir, "nopwa");
  try {
    await fn({ dir, agentDir: join(dir, ".agent"), screensDir, server, childEnv });
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
}

const serverArgs = (env: Env, extra: string[] = []): string[] => [
  MCP,
  "--backend",
  "bidi",
  "--port",
  String(env.server.port),
  "--agent-dir",
  env.agentDir,
  "--screens-dir",
  env.screensDir,
  ...extra,
];

interface Called {
  isError: boolean;
  text: string;
  structured: Record<string, unknown>;
}

async function call(client: Client, name: string, args: Record<string, unknown>): Promise<Called> {
  const result = (await client.callTool({ name, arguments: args })) as {
    isError?: boolean;
    content: { text?: string }[];
    structuredContent?: Record<string, unknown>;
  };
  return {
    isError: result.isError === true,
    text: result.content.map((c) => c.text ?? "").join("\n"),
    structured: result.structuredContent ?? {},
  };
}

// Runs fn with a connected client; the child is closed and, if still alive, killed.
async function withClient(env: Env, extra: string[], fn: (client: Client) => Promise<void>): Promise<void> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: serverArgs(env, extra),
    env: env.childEnv,
    cwd: env.dir,
    stderr: "pipe",
  });
  const client = new Client({ name: "test", version: "0.0.0" });
  try {
    await client.connect(transport);
    await fn(client);
  } finally {
    const pid = transport.pid;
    await client.close().catch(() => undefined);
    if (pid !== null) {
      try {
        process.kill(pid);
      } catch {
        // already gone
      }
    }
  }
}

const count = (s: FakeBidiServer, method: string): number => s.commands.filter((c) => c.method === method).length;

test("stdio+bidi: tools/resources, open blocked then allowed, snapshot, dry-run then armed", async () => {
  await withEnv(async (env) => {
    const inputFrames = (): number => count(env.server, "input.performActions");

    await withClient(env, ["--dry-run"], async (client) => {
      const { tools } = await client.listTools();
      assert.deepEqual(tools.map((t) => t.name).sort(), [
        "flow_search_search",
        "pwa_act",
        "pwa_auth",
        "pwa_click",
        "pwa_extract",
        "pwa_fill",
        "pwa_find",
        "pwa_learn",
        "pwa_open",
        "pwa_screenshot",
        "pwa_snapshot",
        "pwa_upload",
        "pwa_wait",
      ]);
      assert.match(client.getInstructions() ?? "", /private \(screen search\)/);
      const { resources } = await client.listResources();
      assert.deepEqual(resources.map((r) => r.uri).sort(), ["pwa-nav://screens/synthetic", "pwa-nav://snapshot/latest"]);

      const blocked = await call(client, "pwa_open", { url: `${ORIGIN}/search` });
      assert.equal(blocked.isError, true);
      assert.equal(blocked.structured["code"], "origin_blocked");
      assert.equal(count(env.server, "browsingContext.navigate"), 0);
      const opened = await call(client, "pwa_open", { url: `${ORIGIN}/search`, allowOrigin: true });
      assert.equal(opened.isError, false, opened.text);

      const snap = await call(client, "pwa_snapshot", {});
      assert.equal(snap.isError, false, snap.text);
      assert.equal(snap.structured["elementCount"], 2);
      const latest = await client.readResource({ uri: "pwa-nav://snapshot/latest" });
      assert.match(String((latest.contents[0] as { text?: string }).text), /"Search"/);

      const dry = await call(client, "pwa_click", { target: "@search" });
      assert.equal(dry.isError, false, dry.text);
      assert.equal(dry.structured["dryRun"], true);
      assert.match(dry.text, /no input sent/);
      const dryFlow = await call(client, "flow_search_search", { q: "hello" });
      assert.equal(dryFlow.isError, false, dryFlow.text);
      assert.equal(dryFlow.structured["dryRun"], true);
      assert.equal(inputFrames(), 0);
    });

    // Restart armed: same agent dir (allow-list persisted), operator flag on the command line only.
    await withClient(env, ["--armed"], async (client) => {
      const { tools } = await client.listTools();
      assert.ok(!JSON.stringify(tools.map((t) => t.inputSchema)).toLowerCase().includes("armed"));
      const click = await call(client, "pwa_click", { target: "@search" });
      assert.equal(click.isError, false, click.text);
      assert.equal(click.structured["dryRun"], false);
      assert.ok(inputFrames() > 0);
      const before = inputFrames();
      const flow = await call(client, "flow_search_search", { q: "hello" });
      assert.equal(flow.isError, false, flow.text);
      assert.ok(inputFrames() >= before + 2);
      assert.equal(env.server.sessionActive, false);
    });
  });
});

test("stdio+bidi: stdout carries only JSON-RPC frames while ops print; stderr gets the diagnostics", async () => {
  await withEnv(async (env) => {
    const child: ChildProcess = spawn(process.execPath, serverArgs(env), {
      cwd: env.dir,
      env: env.childEnv,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8").on("data", (d: string) => (stdout += d));
    child.stderr?.setEncoding("utf8").on("data", (d: string) => (stderr += d));
    const exited = new Promise<number | null>((resolve) => child.on("close", resolve));
    const send = (message: unknown): void => {
      child.stdin?.write(JSON.stringify(message) + "\n");
    };
    try {
      send({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "raw", version: "0" } },
      });
      send({ jsonrpc: "2.0", method: "notifications/initialized" });
      send({ jsonrpc: "2.0", id: 2, method: "tools/list" });
      send({ jsonrpc: "2.0", id: 3, method: "resources/list" });
      send({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "pwa_snapshot", arguments: {} } });
      send({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "pwa_open", arguments: { url: `${ORIGIN}/x` } } });
      send({ jsonrpc: "2.0", id: 6, method: "resources/read", params: { uri: "pwa-nav://screens/synthetic" } });
      const deadline = Date.now() + 20_000;
      while (stdout.split("\n").filter((l) => l.length > 0).length < 6 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 50));
      }
      child.stdin?.end();
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
      assert.equal(lines.length, 6, stdout);
      const ids = new Set<number>();
      for (const line of lines) {
        const frame = JSON.parse(line) as { jsonrpc?: string; id?: number; result?: unknown; error?: unknown };
        assert.equal(frame.jsonrpc, "2.0", line);
        assert.ok(frame.result !== undefined || frame.error !== undefined, line);
        if (frame.id !== undefined) ids.add(frame.id);
      }
      assert.deepEqual([...ids].sort(), [1, 2, 3, 4, 5, 6]);
      assert.ok(!stdout.includes("snapshot ok:") || stdout.includes('"content"'));
      assert.match(stderr, /pwa-nav-mcp ready \(backend bidi, ARMED\)/);
    } finally {
      child.kill();
    }
  });
});

test("stdio+bidi: ambiguous screens dir logs one stderr line and starts without flow tools", async () => {
  await withEnv(async (env) => {
    const second = searchMap();
    second.app = { ...second.app, id: "other", origin: "http://localhost:9090" };
    await writeFile(join(env.screensDir, "other.screens.json"), JSON.stringify(second), "utf8");
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: serverArgs(env),
      env: env.childEnv,
      cwd: env.dir,
      stderr: "pipe",
    });
    let stderr = "";
    (transport.stderr as NodeJS.ReadableStream | null)?.on("data", (d: Buffer) => (stderr += d.toString("utf8")));
    const client = new Client({ name: "test", version: "0.0.0" });
    try {
      await client.connect(transport);
      const { tools } = await client.listTools();
      assert.equal(tools.length, 12);
      assert.deepEqual((await client.listResources()).resources.map((r) => r.uri), ["pwa-nav://snapshot/latest"]);
      assert.match(stderr, /2 screen maps/);
    } finally {
      const pid = transport.pid;
      await client.close().catch(() => undefined);
      if (pid !== null) {
        try {
          process.kill(pid);
        } catch {
          // already gone
        }
      }
    }
  });
});
