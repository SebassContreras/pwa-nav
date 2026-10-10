#!/usr/bin/env node
// CLI surface for specs 001 (nav-snapshot), 003 (qa-loop) and 004 (firefox-bidi-backend, T011).
// Commands: `open <url>`, `snapshot`, `click`, `fill`, `extract`, `act`, `qa run <check-file>`.
// Verb surface stays at the 5 verbs + act/qa; live capability is flags (--backend, --port,
// --context, --armed, open --launch/--allow-origin, snapshot --all).
// Backend: live (`bidi`) is the default; `snapshot --input`/piped stdin and `qa run` stay offline.
// Action behavior lives in src/ops.ts (shared with the qa runner).
// Option parsing: node:util parseArgs (strict, per-command tables); every usage error
// is PwaNavError("invalid_args") -> exit 2.
import { fstatSync } from "node:fs";
import { readFile } from "node:fs/promises";
import * as readline from "node:readline";
import { join } from "node:path";
import { parseArgs, type ParseArgsOptionsConfig } from "node:util";
import { createBackend, DEFAULT_PORT } from "./backend/backend-factory.js";
import type { Backend } from "./backend/backend.js";
import { exitCodeOf, PwaNavError } from "./core/errors.js";
import { resolveAgentDir, resolveScreensDir } from "./core/storage.js";
import {

  loadSession,
  parseActOp,
  performAct,
  performAuthRelay,
  performClick,
  performExtract,
  performFill,
  performFind,
  performLiveSnapshot,
  performOpen,
  performScreenshot,
  performSnapshot,
  performUpload,
  performWait,
} from "./ops/ops.js";
import type { ActOp, ExtractMode } from "./ops/ops.js";
import { runCheck } from "./ops/qa.js";
import {
  runLearn,
  runScreenView,
  runSemanticAct,
  runSemanticClick,
  runSemanticFill,
  runSemanticUpload,
  validateLearnFlags,
  NO_INPUT_LINE,
  type ScreenSource,
} from "./cli/cli-screens.js";
import { isSemanticToken, parseFlowInputs } from "./screens/screen-resolve.js";
import { performJourney } from "./ops/journey.js";

function usage(): string {
  return [
    "pwa-nav — fluid QA CLI (specs 001-nav-snapshot, 004-firefox-bidi-backend)",
    "",
    "Usage:",
    "  pwa-nav open <url> [--launch] [--allow-origin]",
    "  pwa-nav snapshot [-i | --all] [--json] [--input <file>] [--url <url>] [--title <title>] [--out <path>]",
    "  pwa-nav snapshot --screen [--screen-map <file>] [--screens-dir <dir>]",
    "  pwa-nav snapshot --learn [--prune] [--locale <bcp47>] [--access public|authenticated|unknown]",
    "                   [--app-id <slug>] [--app-name <text>] [--screen-map <file>] [--screens-dir <dir>]",
    "  pwa-nav click --snapshot <id> [--dry-run] <ref>   |   click [--dry-run] @<id>",
    "  pwa-nav fill --snapshot <id> [--dry-run] <ref> <text>   |   fill [--dry-run] @<id> <text>",
    "  pwa-nav upload --snapshot <id> [--dry-run] <ref> <path>...   |   upload [--dry-run] @<id> <path>...",
    "  pwa-nav screenshot [--out <path>] [--format png|jpeg|webp]",
    "  pwa-nav extract --snapshot <id> --mode text|links [--query <str>] [--role <str>] [--offset <n>] [--limit <n>]",
    "  pwa-nav find [<query>] [--role <str>] [--dialog] [--offset <n>] [--limit <n>] [--snapshot <id>]",
    "  pwa-nav wait <target> [--state visible|hidden|enabled] [--timeout <ms|s>] [--interval <ms|s>]",
    "  pwa-nav wait --query <str> [--state visible|hidden|enabled] [--timeout <ms|s>] [--interval <ms|s>]",
    "  pwa-nav act --snapshot <id> [--dry-run] <op>...   |   act [--dry-run] <semantic-op>...",
    "  pwa-nav journey <name> [key=value...] [--dry-run] [--screen-map <file>] [--screens-dir <dir>]",
    "  pwa-nav auth [<app-or-url>] [--clean] [--debug] [--port <n>]",
    "  pwa-nav qa run <check-file>",
    "",
    "Global options (open, snapshot, click, fill, upload, screenshot, act, journey, wait):",
    "  --backend offline|bidi  Default bidi (live Firefox PWA); env PWA_NAV_BACKEND.",
    "  --port <n>              BiDi port 1024-65535 (default 9222); env PWA_NAV_PORT.",
    "  --context <id>          Browsing context id (required when the PWA has several top-level contexts).",
    "  --cache-dir <dir>       Cache / agent state directory (env PWA_NAV_CACHE_DIR).",

    "  -h, --help              Show this help.",
    "",
    "Commands:",
    "  open <url>      Live: navigate the PWA window. Offline: persist URL to .agent/session.json.",
    "  auth            Assisted login for login-walled PWAs (Google accounts, anti-bot walls).",
    "                  Launches clean PWA, prompts for login, then restarts in debug mode.",
    "  snapshot        Live (no --input, no piped stdin): collect the DOM, write .agent/snapshot.json.",
    "                  With --input <file> or piped stdin: normalize an ARIA tree offline.",
    "  click           Live: dry-run unless --armed. Offline: log intent, supersede snapshot.",
    "  fill            Same as click; typed text of password/sensitive fields is never printed.",
    "  upload          Live: dry-run unless --armed. Sets files on <input type=\"file\"> via input.setFiles.",
    "  screenshot      Capture a visual screenshot of the current page; saves PNG to disk.",
    "  extract         Read-only narrow extraction (text|links) from stored snapshot (never supersedes).",
    "  find            Search elements in snapshot by text, role, placeholder, or dialog context.",
    "  wait            Wait for a DOM element/condition or asynchronous background generation.",
    "  act             Run bulk ops (fill:<ref>=<text> click:<ref> upload:<ref>=<path>); live: one session, one new snapshot.",
    "  journey         Declarative multi-screen user journey; dry-run unless --armed.",
    "  qa run          Execute a JSON check file (offline backend; open/snapshot/click/fill/act/extract/",
    "                  assert-text), save evidence to .agent/evidence/<run-id>/ + result.json, exit 0/1.",
    "",
    "Open options:",
    "  --launch        Start the PWA runtime with the debugging port if nothing listens (never edits the profile).",
    "  --allow-origin  Consent to navigate to this origin: required unless it is already in .agent/allow.json.",
    "                  Added to the allow-list only after a successful navigation. Without it: origin_blocked (6),",
    "                  checked before any browser connection. An active kill-switch also blocks open (7).",
    "",
    "Snapshot options:",
    "  -i, --interactive   Interactive elements only (live default; offline input assumed pre-filtered).",
    "  --all               Live: full tree (headings, images) instead of interactive-only.",
    "  --json              Print normalized snapshot JSON to stdout (file is always written).",
    "  --input <file>      Read raw ARIA tree from file instead of the live DOM (offline).",
    "  --url <url>         Offline: override URL meta (default: .agent/session.json url).",
    "  --title <title>     Offline: override title meta (default: .agent/session.json title).",
    "  --out <path>        Snapshot output path (default: .agent/snapshot.json).",
    "",
    "Screen-map options (spec 005; live backend unless noted):",
    "  --screen            Print the compact view of the mapped screen matching the CURRENT page URL",
    "                      (reads the URL only: no DOM collection, writes no snapshot; offline: URL from",
    "                      .agent/session.json). No map/screen: unmapped_screen (13). Exclusive with",
    "                      --input, --learn, -i, --all, --json.",
    "  --learn             Live snapshot (usual `snapshot ok` line), then learn the screen from that same",
    "                      collection into a screen map; prints the diff and `screen map: <path> (written|unchanged)`.",
    "                      Map file: --screen-map, else the existing map for the page origin in the screens",
    "                      dir, else a NEW <screens-dir>/<app-id>.screens.json. Never writes field values.",
    "  --prune             With --learn: remove entries no longer on the page (default: keep and flag missing).",
    "  --locale <bcp47>    With --learn: UI language of the app. REQUIRED for a NEW map (page lang is not",
    "                      trusted); ignored for an existing map (stored locale is kept).",
    "  --access <a>        With --learn: public|authenticated|unknown (default unknown).",
    "  --app-id <slug>     With --learn, new map: app id (default: slug of host[-port], e.g. localhost-5173).",
    "  --app-name <text>   With --learn, new map: app name (default: page title).",
    "  --screen-map <file> Explicit map file (--screen, --learn, @id targets). Default: the map whose app.origin",
    "                      equals the current origin, searched in the screens dir.",
    "  --screens-dir <dir> Screens directory (default <cache-dir>/screens); env PWA_NAV_SCREENS_DIR.",
    "",
    "Action options (click, fill, upload, act):",
    "  --armed             Actually send input. Without it live actions are dry-run. Only this flag arms:",
    "                      no env var does. Kill-switch (PWA_NAV_KILL_SWITCH or .agent/kill) and the",
    "                      origin allow-list still apply.",
    "",
    "Bulk op format:",
    "  fill:<ref>=<text>   Fill ref with text (split on first =).",
    "  click:<ref>         Click ref.",
    "  upload:<ref>=<path> Set file path on ref.",
    "",
    "Semantic @id targets (click, fill, upload, act; live backend only; no --snapshot):",
    "  click @sign-in | fill @email <text> | upload @avatar <path>... | act click:@id fill:@id=<text> upload:@id=<path> flow:<id> [key=value ...]",
    "  The current URL selects the mapped screen; @id is resolved on a FRESH snapshot by role+name+occurrence",
    "  (not found live: stale_ref 3). Sensitive fields and human-only flows are refused before any input",
    "  (sensitive_target 11); unknown id/flow: unknown_target 12; no map/screen: unmapped_screen 13.",
    "  Dry-run unless --armed; an armed action prints the compact view of the resulting screen, never a",
    "  full snapshot. Do not mix semantic tokens with plain refs in one act.",
    "",
    "Check file format (JSON):",
    '  {"steps":[{"op":"open","url":"https://..."}, {"op":"snapshot","input":"tree.txt"},',
    '            {"op":"click","ref":"e5"}, {"op":"assert-text","text":"Log in"}]}',
    "  Snapshot steps take an optional input file (default: latest stored snapshot).",
    "",
    "Exit codes:",
    "  0 ok | 1 failure (qa fail, other) | 2 invalid_args | 3 stale_ref | 4 no_browser | 5 session_busy",
    "  6 origin_blocked | 7 kill_switch | 8 not_actionable | 9 timeout | 10 protocol",
    "  11 sensitive_target (sensitive field / human-only flow) | 12 unknown_target (@id or flow not in map)",
    "  13 unmapped_screen (no map for the origin, or no screen for the route)",
    "",
  ].join("\n");
}

function invalid(message: string): PwaNavError {
  return new PwaNavError("invalid_args", message + "\n\n" + usage());
}

// Value hints for "missing value" messages (same text as the pre-parseArgs CLI).
const VALUE_HINT: Readonly<Record<string, string>> = {
  "--input": "<file>",
  "--url": "<url>",
  "--title": "<title>",
  "--out": "<path>",
  "--snapshot": "<id>",
  "--mode": "text|links",
  "--port": "<n>",
  "--context": "<id>",
  "--backend": "offline|bidi",
  "--screen-map": "<file>",
  "--screens-dir": "<dir>",
  "--cache-dir": "<dir>",

  "--locale": "<bcp47>",
  "--access": "public|authenticated|unknown",
  "--app-id": "<slug>",
  "--app-name": "<text>",
  "--format": "png|jpeg|webp",
};

function missingValue(name: string): PwaNavError {
  const hint = VALUE_HINT[name];
  return invalid(`missing value for ${name}${hint === undefined ? "" : ` ${hint}`}.`);
}

function translateParseError(command: string, error: unknown): PwaNavError {
  const text = error instanceof Error ? error.message : String(error);
  const unknown = /Unknown option '([^']+)'/.exec(text);
  if (unknown !== null) {
    return invalid(`unknown ${command} option: ${unknown[1] ?? ""}`);
  }
  const name = /Option '(?:-\w, )?(--[\w-]+)/.exec(text)?.[1] ?? "option";
  if (text.includes("does not take an argument")) {
    return invalid(`option ${name} does not take a value.`);
  }
  return missingValue(name);
}

function strictParse<const O extends ParseArgsOptionsConfig>(command: string, args: string[], options: O) {
  try {
    return parseArgs({ args, options, allowPositionals: true, strict: true });
  } catch (error) {
    throw translateParseError(command, error);
  }
}

function requireNonEmpty(name: string, value: string | undefined): string | undefined {
  if (value !== undefined && value.length === 0) {
    throw missingValue(name);
  }
  return value;
}

function printHelpAndExit(help: boolean | undefined): void {
  if (help === true) {
    console.log(usage());
    process.exit(0);
  }
}

const LIVE_OPTIONS = {
  backend: { type: "string" },
  port: { type: "string" },
  context: { type: "string" },
  "cache-dir": { type: "string" },
  help: { type: "boolean", short: "h" },
} as const satisfies ParseArgsOptionsConfig;


const SCREEN_OPTIONS = {
  "screen-map": { type: "string" },
  "screens-dir": { type: "string" },
} as const satisfies ParseArgsOptionsConfig;

const JOURNEY_OPTIONS = {
  ...LIVE_OPTIONS,
  ...SCREEN_OPTIONS,
  armed: { type: "boolean" },
  "dry-run": { type: "boolean" },
} as const satisfies ParseArgsOptionsConfig;

const SCREENSHOT_OPTIONS = {
  ...LIVE_OPTIONS,
  out: { type: "string" },
  format: { type: "string" },
} as const satisfies ParseArgsOptionsConfig;

interface LiveConfig {
  mode: "offline" | "bidi";
  port: number;
  contextId?: string;
  agentDir: string;
}

function resolveLive(values: {
  backend?: string;
  port?: string;
  context?: string;
  "cache-dir"?: string;
}): LiveConfig {
  const rawBackend = requireNonEmpty("--backend", values.backend) ?? process.env["PWA_NAV_BACKEND"] ?? "bidi";
  if (rawBackend !== "offline" && rawBackend !== "bidi") {
    throw invalid(`invalid --backend: ${rawBackend} (expected offline|bidi).`);
  }
  const rawPort = requireNonEmpty("--port", values.port) ?? process.env["PWA_NAV_PORT"];
  let port = DEFAULT_PORT;
  if (rawPort !== undefined) {
    port = /^\d+$/.test(rawPort) ? Number(rawPort) : Number.NaN;
    if (!(port >= 1024 && port <= 65535)) {
      throw invalid(`invalid port: ${rawPort} (expected an integer 1024-65535).`);
    }
  }
  const contextId = requireNonEmpty("--context", values.context);
  const rawCache = requireNonEmpty("--cache-dir", values["cache-dir"]) ?? process.env["PWA_NAV_CACHE_DIR"];
  const agentDir = resolveAgentDir({ cacheDir: rawCache });
  return { mode: rawBackend, port, agentDir, ...(contextId === undefined ? {} : { contextId }) };
}

function makeBackend(
  live: LiveConfig,
  extra: { armed?: boolean; launch?: boolean } = {},
): Backend {
  return createBackend({
    mode: live.mode,
    port: live.port,
    cacheDir: live.agentDir,
    ...(live.contextId === undefined ? {} : { contextId: live.contextId }),
    ...(extra.armed === undefined ? {} : { armed: extra.armed }),
    ...(extra.launch === undefined ? {} : { launch: extra.launch }),
  });
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin as AsyncIterable<string | Buffer>) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

// True only for a real pipe or redirected file (not a TTY, /dev/null or a socket).
function stdinHasPipe(): boolean {
  try {
    const stat = fstatSync(0);
    return stat.isFIFO() || stat.isFile();
  } catch {
    return false;
  }
}

async function cmdOpen(rest: string[]): Promise<void> {
  const { values, positionals } = strictParse("open", rest, {
    ...LIVE_OPTIONS,
    launch: { type: "boolean" },
    "allow-origin": { type: "boolean" },
  });
  printHelpAndExit(values.help);
  const url = positionals[0];
  if (url === undefined || url.length === 0) {
    throw invalid("missing <url>.");
  }
  if (positionals.length > 1) {
    throw invalid(`unexpected open argument: ${positionals[1] ?? ""}`);
  }
  const live = resolveLive(values);
  if (live.mode === "offline" && (values.launch === true || values["allow-origin"] === true)) {
    throw invalid("--launch and --allow-origin require --backend bidi.");
  }
  const backend = makeBackend(live, {
    ...(values.launch === true ? { launch: true } : {}),
  });
  await performOpen(url, { backend, allowOrigin: values["allow-origin"] === true });
}

async function cmdSnapshot(rest: string[]): Promise<void> {
  const { values, positionals } = strictParse("snapshot", rest, {
    ...LIVE_OPTIONS,
    interactive: { type: "boolean", short: "i" },
    all: { type: "boolean" },
    json: { type: "boolean" },
    input: { type: "string" },
    url: { type: "string" },
    title: { type: "string" },
    out: { type: "string" },
    ...SCREEN_OPTIONS,
    screen: { type: "boolean" },
    learn: { type: "boolean" },
    prune: { type: "boolean" },
    locale: { type: "string" },
    access: { type: "string" },
    "app-id": { type: "string" },
    "app-name": { type: "string" },
    query: { type: "string" },
    role: { type: "string" },
    screenshot: { type: "boolean" },
  });
  printHelpAndExit(values.help);
  if (positionals.length > 0) {
    throw invalid(`unknown snapshot option: ${positionals[0] ?? ""}`);
  }
  const live = resolveLive(values);
  const inputPath = requireNonEmpty("--input", values.input);
  const urlOverride = requireNonEmpty("--url", values.url);
  const outPath = requireNonEmpty("--out", values.out) ?? join(live.agentDir, "snapshot.json");
  if (values.interactive === true && values.all === true) {
    throw invalid("--interactive and --all are mutually exclusive.");
  }
  const asJson = values.json === true;

  if (values.learn !== true) {
    const learnOnly = [
      ["--prune", values.prune === true],
      ["--locale", values.locale !== undefined],
      ["--access", values.access !== undefined],
      ["--app-id", values["app-id"] !== undefined],
      ["--app-name", values["app-name"] !== undefined],
    ] as const;
    const stray = learnOnly.find(([, present]) => present);
    if (stray !== undefined) throw invalid(`${stray[0]} requires --learn.`);
  }
  if (values.screen === true || values.learn === true) {
    const screenSource = screenSourceOf(values, live.agentDir);
    if (values.screen === true && values.learn === true) {
      throw invalid("--screen and --learn are mutually exclusive.");
    }
    const mode = values.screen === true ? "--screen" : "--learn";
    if (inputPath !== undefined || asJson || values.all === true || (values.screen === true && values.interactive === true)) {
      throw invalid(`${mode} cannot be combined with --input, --json${values.screen === true ? ", -i" : ""} or --all.`);
    }
    if (values.screen === true) {
      await runScreenView(makeBackend(live), screenSource);
      return;
    }
    if (live.mode === "offline") {
      throw invalid("--learn needs the live backend (--backend bidi).");
    }
    const locale = requireNonEmpty("--locale", values.locale);
    const access = requireNonEmpty("--access", values.access);
    const appId = requireNonEmpty("--app-id", values["app-id"]);
    const appName = requireNonEmpty("--app-name", values["app-name"]);
    validateLearnFlags({ locale, access, appId });
    await runLearn(makeBackend(live), {
      ...screenSource,
      outPath,
      prune: values.prune === true,
      ...(locale === undefined ? {} : { locale }),
      ...(access === undefined ? {} : { access }),
      ...(appId === undefined ? {} : { appId }),
      ...(appName === undefined ? {} : { appName }),
    });
    return;
  }

  // Offline normalizer path: explicit --input, piped stdin, or --backend offline.
  let rawTree: string | null = null;
  if (inputPath !== undefined) {
    rawTree = await readFile(inputPath, "utf8");
  } else if (live.mode === "offline") {
    if (process.stdin.isTTY) {
      throw new PwaNavError(
        "invalid_args",
        "no ARIA-tree input: pipe the tree via stdin or pass --input <file>.\n" +
          "Example: pwa-nav snapshot -i --json --input tree.txt",
      );
    }
    rawTree = await readStdin();
  } else if (stdinHasPipe()) {
    const piped = await readStdin();
    rawTree = piped.trim().length > 0 ? piped : null;
  }

  if (rawTree === null) {
    const backend = makeBackend(live);
    const query = requireNonEmpty("--query", values.query);
    const role = requireNonEmpty("--role", values.role);
    const snapshot = await performLiveSnapshot(backend, {
      outPath,
      quiet: asJson,
      includeAll: values.all === true,
      ...(query !== undefined ? { query } : {}),
      ...(role !== undefined ? { role } : {}),
    });
    if (values.screenshot === true) {
      await performScreenshot({ backend });
    }
    if (asJson) {
      console.log(JSON.stringify(snapshot));
    } else if (query !== undefined || role !== undefined) {
      for (const el of snapshot.elements) {
        console.log(`${el.ref} ${el.role}${el.disabled === true ? " [disabled]" : ""} "${el.name}"${el.value ? `: ${el.value}` : ""}`);
      }
    }
    return;
  }

  const session = await loadSession(join(live.agentDir, "session.json"));
  const url = urlOverride ?? session?.url ?? "";
  const title = values.title ?? session?.title ?? "";
  // -i is accepted for contract compatibility: the MCP backend supplies an
  // interactive-only tree; file/stdin input is assumed pre-filtered.
  const snapshot = await performSnapshot(rawTree, { url, title, outPath, quiet: asJson, agentDir: live.agentDir });
  if (asJson) {
    console.log(JSON.stringify(snapshot));
  }
}

// Shared by click/fill/act. Actions are ARMED by default (active execution).
// Pass `--dry-run` (or env PWA_NAV_DRY_RUN=1) to preview mutations without executing.
const ACTION_OPTIONS = {
  ...LIVE_OPTIONS,
  ...SCREEN_OPTIONS,
  snapshot: { type: "string" },
  armed: { type: "boolean" },
  "dry-run": { type: "boolean" },
} as const satisfies ParseArgsOptionsConfig;

function isArmed(values: { armed?: boolean; "dry-run"?: boolean }): boolean {
  if (values["dry-run"] === true) {
    return false;
  }
  return values.armed === true;
}

function screenSourceOf(values: { "screen-map"?: string; "screens-dir"?: string }, agentDir?: string): ScreenSource {
  const screenMap = requireNonEmpty("--screen-map", values["screen-map"]);
  const screensDir = requireNonEmpty("--screens-dir", values["screens-dir"]);
  return {
    ...(screenMap === undefined ? {} : { screenMap }),
    screensDir: screensDir ?? (agentDir ? resolveScreensDir({ cacheDir: agentDir }) : undefined),
    ...(agentDir === undefined ? {} : { cacheDir: agentDir }),
  };
}

// Common guard for @id targets: live backend only, no --snapshot.
function semanticContext(values: {
  snapshot?: string;
  armed?: boolean;
  "dry-run"?: boolean;
  "screen-map"?: string;
  "screens-dir"?: string;
  "cache-dir"?: string;
  backend?: string;
  port?: string;
  context?: string;
}): Parameters<typeof runSemanticClick>[0] {
  if (values.snapshot !== undefined) {
    throw invalid("--snapshot is not used with @id targets (they resolve on a fresh snapshot).");
  }
  const live = resolveLive(values);
  if (live.mode === "offline") {
    throw invalid("@id targets need the live backend (--backend bidi).");
  }
  const armed = isArmed(values);
  return { ...screenSourceOf(values, live.agentDir), backend: makeBackend(live, { armed }), armed };
}

function noInputNote(live: LiveConfig, armed: boolean): void {
  if (live.mode === "bidi" && !armed) {
    console.log(NO_INPUT_LINE);
  }
}

function requireSnapshotId(value: string | undefined): string {
  const snapshotId = requireNonEmpty("--snapshot", value);
  if (snapshotId === undefined) {
    throw invalid("missing --snapshot <id>.");
  }
  return snapshotId;
}

async function cmdClick(rest: string[]): Promise<void> {
  const { values, positionals } = strictParse("click", rest, ACTION_OPTIONS);
  printHelpAndExit(values.help);
  const semanticRef = positionals[0];
  if (semanticRef?.startsWith("@") === true) {
    if (positionals.length !== 1) throw invalid("missing <ref>.");
    await runSemanticClick(semanticContext(values), semanticRef.slice(1));
    return;
  }
  const snapshotId = requireSnapshotId(values.snapshot);
  const ref = positionals[0];
  if (ref === undefined || positionals.length !== 1) {
    throw invalid("missing <ref>.");
  }
  const live = resolveLive(values);
  const armed = isArmed(values);
  await performClick(snapshotId, ref, { backend: makeBackend(live, { armed }), armed });
  noInputNote(live, armed);
}

async function cmdFill(rest: string[]): Promise<void> {
  const { values, positionals } = strictParse("fill", rest, ACTION_OPTIONS);
  printHelpAndExit(values.help);
  const semanticRef = positionals[0];
  if (semanticRef?.startsWith("@") === true) {
    const semanticText = positionals[1];
    if (semanticText === undefined || positionals.length !== 2) throw invalid("missing <ref> <text>.");
    await runSemanticFill(semanticContext(values), semanticRef.slice(1), semanticText);
    return;
  }
  const snapshotId = requireSnapshotId(values.snapshot);
  const ref = positionals[0];
  const text = positionals[1];
  if (ref === undefined || text === undefined || positionals.length !== 2) {
    throw invalid("missing <ref> <text>.");
  }
  const live = resolveLive(values);
  const armed = isArmed(values);
  await performFill(snapshotId, ref, text, { backend: makeBackend(live, { armed }), armed });
  noInputNote(live, armed);
}

async function cmdUpload(rest: string[]): Promise<void> {
  const { values, positionals } = strictParse("upload", rest, ACTION_OPTIONS);
  printHelpAndExit(values.help);
  const semanticRef = positionals[0];
  if (semanticRef?.startsWith("@") === true) {
    const files = positionals.slice(1);
    if (files.length === 0) throw invalid("missing <ref> <path>.");
    await runSemanticUpload(semanticContext(values), semanticRef.slice(1), files);
    return;
  }
  const snapshotId = requireSnapshotId(values.snapshot);
  const ref = positionals[0];
  const files = positionals.slice(1);
  if (ref === undefined || files.length === 0) {
    throw invalid("missing <ref> <path>.");
  }
  const live = resolveLive(values);
  const armed = isArmed(values);
  await performUpload(snapshotId, ref, files, { backend: makeBackend(live, { armed }), armed });
  noInputNote(live, armed);
}

async function cmdAct(rest: string[]): Promise<void> {
  const { values, positionals } = strictParse("act", rest, ACTION_OPTIONS);
  printHelpAndExit(values.help);
  if (positionals.some(isSemanticToken)) {
    await runSemanticAct(semanticContext(values), positionals);
    return;
  }
  const snapshotId = requireSnapshotId(values.snapshot);
  if (positionals.length === 0) {
    throw invalid("missing <op>... (expected fill:<ref>=<text>, click:<ref>, or upload:<ref>=<path>).");
  }
  const ops: ActOp[] = positionals.map((token) => {
    try {
      return parseActOp(token);
    } catch (error) {
      throw invalid(error instanceof Error ? error.message : String(error));
    }
  });
  const live = resolveLive(values);
  const armed = isArmed(values);
  await performAct(snapshotId, ops, { backend: makeBackend(live, { armed }), armed });
  noInputNote(live, armed);
}

async function cmdScreenshot(rest: string[]): Promise<void> {
  const { values, positionals } = strictParse("screenshot", rest, SCREENSHOT_OPTIONS);
  printHelpAndExit(values.help);
  if (positionals.length > 0) {
    throw invalid(`unexpected screenshot argument: ${positionals[0] ?? ""}`);
  }
  const outPath = requireNonEmpty("--out", values.out);
  const rawFormat = requireNonEmpty("--format", values.format);
  let format: "png" | "jpeg" | "webp" | undefined;
  if (rawFormat !== undefined) {
    if (rawFormat !== "png" && rawFormat !== "jpeg" && rawFormat !== "webp") {
      throw invalid(`invalid --format: ${rawFormat} (expected png|jpeg|webp).`);
    }
    format = rawFormat;
  }
  const live = resolveLive(values);
  const backend = makeBackend(live);
  await performScreenshot({
    backend,
    ...(outPath !== undefined ? { outPath } : {}),
    ...(format !== undefined ? { format } : {}),
  });
}

async function cmdExtract(rest: string[]): Promise<void> {
  const { values, positionals } = strictParse("extract", rest, {
    snapshot: { type: "string" },
    mode: { type: "string" },
    query: { type: "string" },
    role: { type: "string" },
    offset: { type: "string" },
    limit: { type: "string" },
    help: { type: "boolean", short: "h" },
  });
  printHelpAndExit(values.help);
  const snapshotId = requireSnapshotId(values.snapshot);
  let mode: string | null = requireNonEmpty("--mode", values.mode) ?? null;
  if (mode === null) {
    if (positionals.length === 1) {
      mode = positionals[0] ?? null;
    }
  } else if (positionals.length > 0) {
    throw invalid(`unexpected extract argument: ${positionals[0] ?? ""}`);
  }
  if (mode !== "text" && mode !== "links") {
    throw invalid("missing --mode text|links.");
  }
  const query = requireNonEmpty("--query", values.query);
  const role = requireNonEmpty("--role", values.role);
  const offsetStr = requireNonEmpty("--offset", values.offset);
  const limitStr = requireNonEmpty("--limit", values.limit);
  const offset = offsetStr !== undefined ? parseInt(offsetStr, 10) : undefined;
  if (offset !== undefined && (isNaN(offset) || offset < 0)) {
    throw invalid(`invalid --offset: ${offsetStr ?? ""} (expected non-negative integer).`);
  }
  const limit = limitStr !== undefined ? parseInt(limitStr, 10) : undefined;
  if (limit !== undefined && (isNaN(limit) || limit < 1)) {
    throw invalid(`invalid --limit: ${limitStr ?? ""} (expected positive integer).`);
  }
  const lines = await performExtract(snapshotId, mode satisfies ExtractMode, {
    query,
    role,
    offset,
    limit,
  });
  for (const line of lines) {
    console.log(line);
  }
}

async function cmdFind(rest: string[]): Promise<void> {
  const { values, positionals } = strictParse("find", rest, {
    snapshot: { type: "string" },
    role: { type: "string" },
    dialog: { type: "boolean" },
    offset: { type: "string" },
    limit: { type: "string" },
    ...LIVE_OPTIONS,
  });
  printHelpAndExit(values.help);
  const live = resolveLive(values);
  const backend = makeBackend(live);
  const snapshotId = requireNonEmpty("--snapshot", values.snapshot);
  const query = positionals[0];
  const role = requireNonEmpty("--role", values.role);
  const inDialog = values.dialog === true;
  const offsetStr = requireNonEmpty("--offset", values.offset);
  const limitStr = requireNonEmpty("--limit", values.limit);
  const offset = offsetStr !== undefined ? parseInt(offsetStr, 10) : undefined;
  if (offset !== undefined && (isNaN(offset) || offset < 0)) {
    throw invalid(`invalid --offset: ${offsetStr ?? ""} (expected non-negative integer).`);
  }
  const limit = limitStr !== undefined ? parseInt(limitStr, 10) : undefined;
  if (limit !== undefined && (isNaN(limit) || limit < 1)) {
    throw invalid(`invalid --limit: ${limitStr ?? ""} (expected positive integer).`);
  }
  const result = await performFind(snapshotId, {
    backend,
    query,
    role,
    inDialog,
    offset,
    limit,
  });
  if (result.activeDialog) {
    console.log(`[active modal: "${result.activeDialog.title}" (${result.activeDialog.elementCount.toString()} elements)]`);
  }
  for (const line of result.lines) {
    console.log(line);
  }
  if (result.lines.length === 0) {
    console.log("0 matching elements.");
  }
}

async function cmdWait(rest: string[]): Promise<void> {
  const { values, positionals } = strictParse("wait", rest, {
    ...LIVE_OPTIONS,
    target: { type: "string" },
    query: { type: "string" },
    state: { type: "string" },
    timeout: { type: "string" },
    interval: { type: "string" },
    help: { type: "boolean", short: "h" },
  });
  printHelpAndExit(values.help);
  const positionalTarget = positionals[0];
  const target = requireNonEmpty("--target", values.target) ?? positionalTarget;
  const query = requireNonEmpty("--query", values.query);
  if (target === undefined && query === undefined) {
    throw invalid("missing <target> or --query.");
  }
  const rawState = requireNonEmpty("--state", values.state);
  let state: "visible" | "hidden" | "enabled" | undefined;
  if (rawState !== undefined) {
    if (rawState !== "visible" && rawState !== "hidden" && rawState !== "enabled") {
      throw invalid(`invalid --state: ${rawState} (expected visible|hidden|enabled).`);
    }
    state = rawState;
  }
  const timeoutStr = requireNonEmpty("--timeout", values.timeout);
  let timeoutMs: number | undefined;
  if (timeoutStr !== undefined) {
    timeoutMs = parseInt(timeoutStr.replace(/ms$/i, "").replace(/s$/i, "000"), 10);
    if (isNaN(timeoutMs) || timeoutMs < 50) {
      throw invalid(`invalid --timeout: ${timeoutStr} (expected positive duration in ms or seconds).`);
    }
  }
  const intervalStr = requireNonEmpty("--interval", values.interval);
  let intervalMs: number | undefined;
  if (intervalStr !== undefined) {
    intervalMs = parseInt(intervalStr.replace(/ms$/i, "").replace(/s$/i, "000"), 10);
    if (isNaN(intervalMs) || intervalMs < 25) {
      throw invalid(`invalid --interval: ${intervalStr} (expected positive duration in ms or seconds).`);
    }
  }
  const live = resolveLive(values);
  const backend = makeBackend(live);
  await performWait(target, {
    backend,
    query,
    state,
    timeoutMs,
    intervalMs,
  });
}

async function cmdJourney(rest: string[]): Promise<void> {
  const { values, positionals } = strictParse("journey", rest, JOURNEY_OPTIONS);
  printHelpAndExit(values.help);
  const [journeyName, ...inputEntries] = positionals;
  if (journeyName === undefined || journeyName.length === 0) {
    throw invalid("missing <name>.");
  }
  let inputs: Record<string, string> = {};
  if (inputEntries.length > 0) {
    inputs = parseFlowInputs(inputEntries);
  }
  const live = resolveLive(values);
  const armed = isArmed(values);
  const backend = makeBackend(live, { armed });
  await performJourney(journeyName, inputs, {
    backend,
    armed,
    screenMap: values["screen-map"],
    screensDir: values["screens-dir"] ?? resolveScreensDir({ cacheDir: backend.agentDir }),
  });
}

async function cmdQa(rest: string[]): Promise<void> {
  const { values, positionals } = strictParse("qa", rest, {
    help: { type: "boolean", short: "h" },
  });
  printHelpAndExit(values.help);
  const [subcommand, checkFile, extra] = positionals;
  if (subcommand !== "run" || checkFile === undefined || extra !== undefined) {
    throw invalid("missing <check-file>.");
  }
  // Explicit: checks are fixture-driven and always run on the offline backend.
  const result = await runCheck(checkFile);
  if (!result.pass) {
    throw new Error(
      `qa failed at step ${result.failedStep?.toString() ?? "?"} (evidence: ${result.evidenceDir})`,
    );
  }
}

async function cmdAuth(rest: string[]): Promise<void> {
  const { values, positionals } = strictParse("auth", rest, {
    clean: { type: "boolean" },
    debug: { type: "boolean" },
    port: { type: "string" },
    help: { type: "boolean", short: "h" },
  });
  printHelpAndExit(values.help);
  const target = positionals[0];
  const port = values.port !== undefined ? Number(values.port) : undefined;

  if (values.clean) {
    await performAuthRelay({ appOrUrl: target, action: "clean", port });
    return;
  }
  if (values.debug) {
    await performAuthRelay({ appOrUrl: target, action: "debug", port });
    return;
  }

  await performAuthRelay({ appOrUrl: target, action: "clean", port });
  console.log("\nPress [Enter] after completing sign-in in the browser window to re-attach in debug mode...");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  await new Promise((resolve) => rl.once("line", resolve));
  rl.close();
  await performAuthRelay({ appOrUrl: target, action: "debug", port });
}

async function main(): Promise<void> {
  const [, , command, ...rest] = process.argv;
  if (command === undefined || command === "-h" || command === "--help") {
    console.log(usage());
    return;
  }
  switch (command) {
    case "open":
      return cmdOpen(rest);
    case "auth":
      return cmdAuth(rest);
    case "snapshot":
      return cmdSnapshot(rest);
    case "click":
      return cmdClick(rest);
    case "fill":
      return cmdFill(rest);
    case "upload":
      return cmdUpload(rest);
    case "screenshot":
      return cmdScreenshot(rest);
    case "extract":
      return cmdExtract(rest);
    case "find":
      return cmdFind(rest);
    case "wait":
      return cmdWait(rest);
    case "act":
      return cmdAct(rest);
    case "journey":
      return cmdJourney(rest);
    case "qa":
      return cmdQa(rest);
    default:
      throw invalid(`unknown command: ${command}`);
  }
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
