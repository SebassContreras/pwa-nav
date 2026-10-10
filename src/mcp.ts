#!/usr/bin/env node
// pwa-nav-mcp: stdio MCP server entrypoint (spec 006). stdout carries ONLY protocol frames:
// console.log/info/debug are redirected to stderr before anything else runs.
// Operator options: --port, --dry-run, --screens-dir, --screen-map,
// --cache-dir, --backend offline|bidi. Armed is never a tool argument.
import { parseArgs } from "node:util";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createBackend, DEFAULT_PORT } from "./backend/backend-factory.js";
import { exitCodeOf, PwaNavError } from "./core/errors.js";
import { loadFlowSource } from "./mcp/mcp-flows.js";
import { createMcpServer } from "./mcp/mcp-server.js";

import { resolveAgentDir, resolveScreensDir } from "./core/storage.js";

const stderrLog = (...parts: unknown[]): void => {
  console.error(...parts);
};
console.log = stderrLog;
console.info = stderrLog;
console.debug = stderrLog;

const USAGE =
  "usage: pwa-nav-mcp [--port <n>] [--dry-run] [--armed] [--screens-dir <dir>] [--screen-map <file>] [--cache-dir <dir>] [--backend offline|bidi]";

function invalid(message: string): PwaNavError {
  return new PwaNavError("invalid_args", `${message}\n${USAGE}`);
}

function parseOptions(argv: string[]) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        port: { type: "string" },
        armed: { type: "boolean" },
        "dry-run": { type: "boolean" },
        "screens-dir": { type: "string" },
        "screen-map": { type: "string" },
        "cache-dir": { type: "string" },
        backend: { type: "string" },
      },
      allowPositionals: false,
      strict: true,
    });
  } catch (error) {
    throw invalid(error instanceof Error ? error.message : String(error));
  }
  const { values } = parsed;
  const backend = values.backend ?? "bidi";
  if (backend !== "offline" && backend !== "bidi") {
    throw invalid(`invalid --backend: ${backend} (expected offline|bidi).`);
  }
  let port = DEFAULT_PORT;
  if (values.port !== undefined) {
    port = /^\d+$/.test(values.port) ? Number(values.port) : Number.NaN;
    if (!(port >= 1024 && port <= 65535)) {
      throw invalid(`invalid port: ${values.port} (expected an integer 1024-65535).`);
    }
  }
  const isDryRun = values["dry-run"] === true || process.env["PWA_NAV_DRY_RUN"] === "1";
  const armed = !isDryRun;
  const cacheDir = resolveAgentDir({ cacheDir: values["cache-dir"] });
  const rawScreensDir = values["screens-dir"] ?? process.env["PWA_NAV_SCREENS_DIR"];
  const effectiveScreensDir = resolveScreensDir({ screensDir: rawScreensDir, cacheDir });

  return {
    backend,
    port,
    armed,
    screensDir: effectiveScreensDir,
    screenMap: values["screen-map"],
    cacheDir,
  } as const;
}

async function main(): Promise<void> {
  const opts = parseOptions(process.argv.slice(2));
  const flowSource = await loadFlowSource(
    {
      screensDir: opts.screensDir,
      cacheDir: opts.cacheDir,
      ...(opts.screenMap === undefined ? {} : { screenMap: opts.screenMap }),
    },
    stderrLog,
  );
  const server = createMcpServer({
    ...(flowSource === undefined ? {} : { flowSource }),
    mode: opts.backend,
    armed: opts.armed,
    cacheDir: opts.cacheDir,
    screensDir: opts.screensDir,
    ...(opts.screenMap === undefined ? {} : { screenMap: opts.screenMap }),
    backendFactory: ({ armed, launch }) =>
      createBackend({
        mode: opts.backend,
        port: opts.port,
        armed,
        cacheDir: opts.cacheDir,
        ...(launch === true ? { launch: true } : {}),
      }),
  });
  server.onclose = () => {
    process.exit(0);
  };
  await server.connect(new StdioServerTransport());
  // The SDK transport ignores stdin end; the client closing the pipe means shut down.
  process.stdin.on("end", () => {
    void server.close();
  });
  console.error(`pwa-nav-mcp ready (backend ${opts.backend}, ${opts.armed ? "ARMED" : "dry-run"})`);
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`error: ${message}`);
  if (error instanceof PwaNavError && error.hint !== undefined) {
    console.error(`hint: ${error.hint}`);
  }
  process.exit(exitCodeOf(error));
}
