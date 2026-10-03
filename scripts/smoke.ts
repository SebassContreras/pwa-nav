// Smoke check for spec 001-nav-snapshot (T005).
// Runs `open` + `snapshot` end-to-end offline: no network, no live browser.
// Uses a small inline ARIA-tree sample, asserts .agent/snapshot.json holds
// snapshotId/url/elements, and asserts a second run yields a fresh snapshotId.
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const DEFAULT_DEMO_URL = "https://example.com";
const DEFAULT_SNAPSHOT_PATH = ".agent/snapshot.json";

const SAMPLE_TREE = [
  "- generic [ref=e1]:",
  '  - navigation [ref=e2] "Main nav":',
  '  - link "Home" [ref=e3]',
  '  - link "Docs" [ref=e4]',
  '  - button "Log in" [ref=e5]',
  "",
].join("\n");

interface SmokeTarget {
  label: string;
  url: string;
}

interface SnapshotFile {
  snapshotId: unknown;
  url: unknown;
  elements: unknown;
}

function fail(message: string): never {
  throw new Error(`smoke failed: ${message}`);
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function cliPath(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../dist/cli.js");
}

function parseArgs(argv: string[]): { demoUrl: string; ownUrl: string } {
  let demoUrl = process.env["PWA_NAV_DEMO_URL"] ?? DEFAULT_DEMO_URL;
  let ownUrl =
    process.env["PWA_NAV_OWN_URL"] ?? process.env["OWN_WEB_URL"] ?? "";
  let positional: string | null = null;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i] ?? "";
    if (token === "--demo" || token === "--demo-url") {
      const value = argv[i + 1];
      if (value === undefined || value.length === 0) {
        fail("missing value for --demo <url>.");
      }
      demoUrl = value;
      i += 1;
    } else if (token === "--own" || token === "--own-url") {
      const value = argv[i + 1];
      if (value === undefined || value.length === 0) {
        fail("missing value for --own <url>.");
      }
      ownUrl = value;
      i += 1;
    } else if (token.startsWith("--demo=")) {
      demoUrl = token.slice("--demo=".length);
    } else if (token.startsWith("--own=")) {
      ownUrl = token.slice("--own=".length);
    } else if (!token.startsWith("-")) {
      positional = token;
    } else {
      fail(`unknown option: ${token}`);
    }
  }

  if (ownUrl.length === 0) {
    ownUrl = positional ?? DEFAULT_DEMO_URL;
  }
  return { demoUrl, ownUrl };
}

async function runCli(args: string[]): Promise<string> {
  try {
    const { stdout } = await execFileAsync(process.execPath, [cliPath(), ...args], {
      cwd: resolve("."),
      // Smoke is fixture-driven: live (bidi) is the CLI default, so pin offline.
      env: { ...process.env, PWA_NAV_BACKEND: "offline" },
    });
    return stdout;
  } catch (error) {
    if (error instanceof Error) {
      fail(`pwa-nav ${args.join(" ")} exited with error: ${error.message}`);
    }
    fail(`pwa-nav ${args.join(" ")} exited with unknown error.`);
  }
}

async function readSnapshot(snapshotPath: string): Promise<SnapshotFile> {
  let text: string;
  try {
    text = await readFile(snapshotPath, "utf8");
  } catch {
    fail(`expected snapshot file at ${snapshotPath} was not written.`);
  }
  try {
    return JSON.parse(text) as SnapshotFile;
  } catch {
    fail(`snapshot file at ${snapshotPath} is not valid JSON.`);
  }
}

function assertSnapshotShape(snapshot: SnapshotFile, expectedUrl: string): string {
  if (typeof snapshot.snapshotId !== "string" || snapshot.snapshotId.length === 0) {
    fail("snapshot.json has no non-empty snapshotId.");
  }
  if (snapshot.url !== expectedUrl) {
    fail(`snapshot.json url mismatch: expected ${expectedUrl}, got ${String(snapshot.url)}.`);
  }
  if (!Array.isArray(snapshot.elements) || snapshot.elements.length === 0) {
    fail("snapshot.json has no elements; expected login button / nav controls.");
  }
  return snapshot.snapshotId;
}

async function checkTarget(target: SmokeTarget, samplePath: string): Promise<void> {
  if (!isHttpUrl(target.url)) {
    fail(`invalid URL for ${target.label}: ${target.url}`);
  }
  console.log(`smoke: open + snapshot on ${target.label} (${target.url})`);
  await runCli(["open", target.url]);
  await runCli(["snapshot", "-i", "--json", "--input", samplePath]);
  const first = assertSnapshotShape(
    await readSnapshot(DEFAULT_SNAPSHOT_PATH),
    target.url,
  );
  await runCli(["snapshot", "-i", "--json", "--input", samplePath]);
  const second = assertSnapshotShape(
    await readSnapshot(DEFAULT_SNAPSHOT_PATH),
    target.url,
  );
  if (first === second) {
    fail(`second snapshot run reused snapshotId ${first}; expected a fresh id.`);
  }
  console.log(`smoke ok: ${target.label} snapshotId ${first} -> ${second}`);
}

async function main(): Promise<void> {
  const { demoUrl, ownUrl } = parseArgs(process.argv.slice(2));
  const targets: SmokeTarget[] = [
    { label: "demo page", url: demoUrl },
    { label: "own web URL", url: ownUrl },
  ];
  const workDir = await mkdtemp(join(tmpdir(), "pwa-nav-smoke-"));
  const samplePath = join(workDir, "tree.txt");
  try {
    await writeFile(samplePath, SAMPLE_TREE, "utf8");
    for (const target of targets) {
      await checkTarget(target, samplePath);
    }
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
  console.log("smoke passed: open + snapshot verified (demo + own URL).");
}

try {
  await main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
}
