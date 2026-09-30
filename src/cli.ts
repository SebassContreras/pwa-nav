#!/usr/bin/env node
// CLI surface for spec 001-nav-snapshot (T003) + spec 003-qa-loop (T001).
// Commands: `open <url>` persists target URL to .agent/session.json;
// `snapshot [-i] [--json]` normalizes an ARIA tree (via src/snapshot.ts)
// and writes .agent/snapshot.json with a fresh snapshotId;
// `qa run <check-file>` executes a JSON check via src/qa.ts.
// MVP has no live browser engine: snapshot input comes from --input or stdin.
// The Playwright MCP backend wiring lands later; this file is the command surface.
// Action behavior lives in src/ops.ts (shared with the qa runner).
import { readFile } from "node:fs/promises";
import {
  DEFAULT_SESSION_PATH,
  DEFAULT_SNAPSHOT_PATH,
  loadSession,
  parseActOp,
  performAct,
  performClick,
  performExtract,
  performFill,
  performOpen,
  performSnapshot,
} from "./ops.js";
import type { ActOp, ExtractMode } from "./ops.js";
import { runCheck } from "./qa.js";

interface SnapshotArgs {
  interactiveOnly: boolean;
  asJson: boolean;
  inputPath: string | null;
  urlOverride: string | null;
  titleOverride: string | null;
  outPath: string;
  sessionPath: string;
}

interface ClickArgs {
  snapshotId: string;
  ref: string;
}

interface FillArgs {
  snapshotId: string;
  ref: string;
  text: string;
}

interface ActArgs {
  snapshotId: string;
  ops: ActOp[];
}

interface ExtractArgs {
  snapshotId: string;
  mode: ExtractMode;
}

function usage(): string {
  return [
    "pwa-nav — fluid QA CLI (spec 001-nav-snapshot)",
    "",
    "Usage:",
    "  pwa-nav open <url>",
    "  pwa-nav snapshot [-i] [--json] [--input <file>] [--url <url>] [--title <title>] [--out <path>]",
    "  pwa-nav click --snapshot <id> <ref>",
    "  pwa-nav fill --snapshot <id> <ref> <text>",
    "  pwa-nav extract --snapshot <id> --mode text|links",
    "  pwa-nav act --snapshot <id> <op>...",
    "  pwa-nav qa run <check-file>",
    "",
    "Commands:",
    "  open <url>      Persist target URL to .agent/session.json (no browser launch in MVP).",
    "  snapshot        Read ARIA tree from --input file or stdin, write .agent/snapshot.json.",
    "  click           Resolve snapshotId + ref, log intent, supersede snapshot (no live backend in MVP).",
    "  fill            Resolve snapshotId + ref, log text intent, supersede snapshot (no live backend in MVP).",
    "  extract         Read-only narrow extraction (text|links) from stored snapshot (never supersedes).",
    "  act             Run bulk ops sequentially (fill:<ref>=<text> click:<ref>), superseding per op.",
    "  qa run          Execute a JSON check file (open/snapshot/click/fill/act/extract/assert-text),",
    "                  save per-step snapshots to .agent/evidence/<run-id>/ + result.json, exit 0/1.",
    "",
    "Bulk op format:",
    "  fill:<ref>=<text>  Fill ref with text (split on first =).",
    "  click:<ref>        Click ref.",
    "",
    "Check file format (JSON):",
    '  {"steps":[{"op":"open","url":"https://..."}, {"op":"snapshot","input":"tree.txt"},',
    '            {"op":"click","ref":"e5"}, {"op":"assert-text","text":"Log in"}]}',
    "  Snapshot steps take an optional input file (default: latest stored snapshot).",
    "",
    "Snapshot options:",
    "  -i, --interactive   Accept interactive-only tree (input assumed pre-filtered by MCP backend).",
    "  --json              Print normalized snapshot JSON to stdout (file is always written).",
    "  --input <file>      Read raw ARIA tree from file instead of stdin.",
    "  --url <url>         Override URL meta (default: .agent/session.json url).",
    "  --title <title>     Override title meta (default: .agent/session.json title).",
    "  --out <path>        Snapshot output path (default: .agent/snapshot.json).",
    "",
  ].join("\n");
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin as AsyncIterable<string | Buffer>) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function cmdOpen(url: string | undefined): Promise<void> {
  if (url === undefined || url.length === 0) {
    throw new Error("missing <url>.\n\n" + usage());
  }
  await performOpen(url);
}

function parseSnapshotArgs(rest: string[]): SnapshotArgs {
  const args: SnapshotArgs = {
    interactiveOnly: false,
    asJson: false,
    inputPath: null,
    urlOverride: null,
    titleOverride: null,
    outPath: DEFAULT_SNAPSHOT_PATH,
    sessionPath: DEFAULT_SESSION_PATH,
  };
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i] ?? "";
    if (token === "-i" || token === "--interactive") {
      args.interactiveOnly = true;
    } else if (token === "--json") {
      args.asJson = true;
    } else if (token === "--input") {
      const value = rest[i + 1];
      if (value === undefined || value.startsWith("-")) {
        throw new Error("missing value for --input <file>.");
      }
      args.inputPath = value;
      i += 1;
    } else if (token === "--url") {
      const value = rest[i + 1];
      if (value === undefined || value.length === 0) {
        throw new Error("missing value for --url <url>.");
      }
      args.urlOverride = value;
      i += 1;
    } else if (token === "--title") {
      const value = rest[i + 1];
      if (value === undefined) {
        throw new Error("missing value for --title <title>.");
      }
      args.titleOverride = value;
      i += 1;
    } else if (token === "--out") {
      const value = rest[i + 1];
      if (value === undefined || value.length === 0) {
        throw new Error("missing value for --out <path>.");
      }
      args.outPath = value;
      i += 1;
    } else if (token === "-h" || token === "--help") {
      console.log(usage());
      process.exit(0);
    } else {
      throw new Error(`unknown snapshot option: ${token}\n\n` + usage());
    }
  }
  return args;
}

async function readRawTree(inputPath: string | null): Promise<string> {
  if (inputPath !== null) {
    return readFile(inputPath, "utf8");
  }
  if (process.stdin.isTTY) {
    throw new Error(
      "no ARIA-tree input: pipe the tree via stdin or pass --input <file>.\n" +
        "Example: pwa-nav snapshot -i --json --input tree.txt",
    );
  }
  return readStdin();
}

async function cmdSnapshot(rest: string[]): Promise<void> {
  const args = parseSnapshotArgs(rest);
  const rawTree = await readRawTree(args.inputPath);
  const session = await loadSession(args.sessionPath);
  const url = args.urlOverride ?? session?.url ?? "";
  const title = args.titleOverride ?? session?.title ?? "";
  // -i is accepted for contract compatibility: the MCP backend supplies an
  // interactive-only tree; file/stdin input is assumed pre-filtered.
  const snapshot = await performSnapshot(rawTree, {
    url,
    title,
    outPath: args.outPath,
    quiet: args.asJson,
  });
  if (args.asJson) {
    console.log(JSON.stringify(snapshot));
  }
}

function parseClickArgs(rest: string[]): ClickArgs {
  let snapshotId: string | null = null;
  const positionals: string[] = [];
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i] ?? "";
    if (token === "--snapshot") {
      const value = rest[i + 1];
      if (value === undefined || value.length === 0) {
        throw new Error("missing value for --snapshot <id>.");
      }
      snapshotId = value;
      i += 1;
    } else if (token === "-h" || token === "--help") {
      console.log(usage());
      process.exit(0);
    } else if (token.startsWith("-")) {
      throw new Error(`unknown click option: ${token}\n\n` + usage());
    } else {
      positionals.push(token);
    }
  }
  if (snapshotId === null) {
    throw new Error("missing --snapshot <id>.\n\n" + usage());
  }
  const ref = positionals[0];
  if (ref === undefined || positionals.length !== 1) {
    throw new Error("missing <ref>.\n\n" + usage());
  }
  return { snapshotId, ref };
}

async function cmdClick(rest: string[]): Promise<void> {
  const args = parseClickArgs(rest);
  await performClick(args.snapshotId, args.ref);
}

function parseFillArgs(rest: string[]): FillArgs {
  let snapshotId: string | null = null;
  const positionals: string[] = [];
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i] ?? "";
    if (token === "--snapshot") {
      const value = rest[i + 1];
      if (value === undefined || value.length === 0) {
        throw new Error("missing value for --snapshot <id>.");
      }
      snapshotId = value;
      i += 1;
    } else if (token === "-h" || token === "--help") {
      console.log(usage());
      process.exit(0);
    } else if (token.startsWith("-")) {
      throw new Error(`unknown fill option: ${token}\n\n` + usage());
    } else {
      positionals.push(token);
    }
  }
  if (snapshotId === null) {
    throw new Error("missing --snapshot <id>.\n\n" + usage());
  }
  const ref = positionals[0];
  const text = positionals[1];
  if (ref === undefined || text === undefined || positionals.length !== 2) {
    throw new Error("missing <ref> <text>.\n\n" + usage());
  }
  return { snapshotId, ref, text };
}

async function cmdFill(rest: string[]): Promise<void> {
  const args = parseFillArgs(rest);
  await performFill(args.snapshotId, args.ref, args.text);
}

function parseActArgs(rest: string[]): ActArgs {
  let snapshotId: string | null = null;
  const positionals: string[] = [];
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i] ?? "";
    if (token === "--snapshot") {
      const value = rest[i + 1];
      if (value === undefined || value.length === 0) {
        throw new Error("missing value for --snapshot <id>.");
      }
      snapshotId = value;
      i += 1;
    } else if (token === "-h" || token === "--help") {
      console.log(usage());
      process.exit(0);
    } else if (token.startsWith("-")) {
      throw new Error(`unknown act option: ${token}\n\n` + usage());
    } else {
      positionals.push(token);
    }
  }
  if (snapshotId === null) {
    throw new Error("missing --snapshot <id>.\n\n" + usage());
  }
  if (positionals.length === 0) {
    throw new Error("missing <op>... (expected fill:<ref>=<text> or click:<ref>).\n\n" + usage());
  }
  const ops = positionals.map((token) => {
    try {
      return parseActOp(token);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(message + "\n\n" + usage());
    }
  });
  return { snapshotId, ops };
}

async function cmdAct(rest: string[]): Promise<void> {
  const args = parseActArgs(rest);
  await performAct(args.snapshotId, args.ops);
}

function parseExtractArgs(rest: string[]): ExtractArgs {
  let snapshotId: string | null = null;
  let mode: string | null = null;
  const positionals: string[] = [];
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i] ?? "";
    if (token === "--snapshot") {
      const value = rest[i + 1];
      if (value === undefined || value.length === 0) {
        throw new Error("missing value for --snapshot <id>.");
      }
      snapshotId = value;
      i += 1;
    } else if (token === "--mode") {
      const value = rest[i + 1];
      if (value === undefined || value.length === 0) {
        throw new Error("missing value for --mode text|links.");
      }
      mode = value;
      i += 1;
    } else if (token === "-h" || token === "--help") {
      console.log(usage());
      process.exit(0);
    } else if (token.startsWith("-")) {
      throw new Error(`unknown extract option: ${token}\n\n` + usage());
    } else {
      positionals.push(token);
    }
  }
  if (snapshotId === null) {
    throw new Error("missing --snapshot <id>.\n\n" + usage());
  }
  if (mode === null) {
    if (positionals.length === 1) {
      mode = positionals[0] ?? null;
    }
  } else if (positionals.length > 0) {
    throw new Error(`unexpected extract argument: ${positionals[0] ?? ""}\n\n` + usage());
  }
  if (mode !== "text" && mode !== "links") {
    throw new Error("missing --mode text|links.\n\n" + usage());
  }
  return { snapshotId, mode };
}

async function cmdExtract(rest: string[]): Promise<void> {
  const args = parseExtractArgs(rest);
  const lines = await performExtract(args.snapshotId, args.mode);
  for (const line of lines) {
    console.log(line);
  }
}

async function cmdQa(rest: string[]): Promise<void> {
  const [subcommand, checkFile, extra] = rest;
  if (subcommand === "-h" || subcommand === "--help") {
    console.log(usage());
    return;
  }
  if (subcommand !== "run" || checkFile === undefined || extra !== undefined) {
    throw new Error("missing <check-file>.\n\n" + usage());
  }
  const result = await runCheck(checkFile);
  if (!result.pass) {
    throw new Error(
      `qa failed at step ${result.failedStep?.toString() ?? "?"} (evidence: ${result.evidenceDir})`,
    );
  }
}

async function main(): Promise<void> {
  const [, , command, ...rest] = process.argv;
  if (command === undefined || command === "-h" || command === "--help") {
    console.log(usage());
    return;
  }
  if (command === "open") {
    await cmdOpen(rest[0]);
    return;
  }
  if (command === "snapshot") {
    await cmdSnapshot(rest);
    return;
  }
  if (command === "click") {
    await cmdClick(rest);
    return;
  }
  if (command === "fill") {
    await cmdFill(rest);
    return;
  }
  if (command === "extract") {
    await cmdExtract(rest);
    return;
  }
  if (command === "act") {
    await cmdAct(rest);
    return;
  }
  if (command === "qa") {
    await cmdQa(rest);
    return;
  }
  throw new Error(`unknown command: ${command}\n\n` + usage());
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`error: ${message}`);
  process.exit(1);
}
