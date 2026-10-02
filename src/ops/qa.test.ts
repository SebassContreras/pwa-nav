import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { runCheck } from "./qa.js";
import { OfflineBackend } from "../backend/backend.js";

test("qa run captures screenshot on explicit screenshot step", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pwa-nav-qa-"));
  const checkFile = join(dir, "check.json");
  const treeFile = join(dir, "tree.txt");

  await writeFile(treeFile, "- button \"Click me\" [ref=e1]\n");
  await writeFile(
    checkFile,
    JSON.stringify({
      steps: [
        { op: "open", url: "https://app.test" },
        { op: "snapshot", input: treeFile, url: "https://app.test", title: "App" },
        { op: "screenshot", name: "initial" },
      ],
    }),
  );

  const backend = new OfflineBackend({ agentDir: dir });
  const result = await runCheck(checkFile, { backend });

  assert.equal(result.pass, true);
  assert.equal(result.failedStep, null);

  // Check evidence directory contains step-3-screenshot.png and step-3-screenshot-initial.png
  const step3Screenshot = join(result.evidenceDir, "step-3-screenshot.png");
  const step3Named = join(result.evidenceDir, "step-3-screenshot-initial.png");
  const png1 = await readFile(step3Screenshot);
  const png2 = await readFile(step3Named);
  assert.equal(png1.length > 0, true);
  assert.deepEqual(png1, png2);

  await rm(dir, { recursive: true, force: true });
});

test("qa run captures screenshot on step failure", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pwa-nav-qa-fail-"));
  const checkFile = join(dir, "check-fail.json");
  const treeFile = join(dir, "tree.txt");

  await writeFile(treeFile, "- button \"Click me\" [ref=e1]\n");
  await writeFile(
    checkFile,
    JSON.stringify({
      steps: [
        { op: "open", url: "https://app.test" },
        { op: "snapshot", input: treeFile, url: "https://app.test", title: "App" },
        { op: "assert-text", text: "Non-existent text" },
      ],
    }),
  );

  const backend = new OfflineBackend({ agentDir: dir });
  const result = await runCheck(checkFile, { backend });

  assert.equal(result.pass, false);
  assert.equal(result.failedStep, 3);

  // Failure evidence contains step-3-assert-text.png alongside step-3-assert-text-snapshot.json
  const failurePng = join(result.evidenceDir, "step-3-assert-text.png");
  const failureSnapshot = join(result.evidenceDir, "step-3-assert-text-snapshot.json");

  const png = await readFile(failurePng);
  assert.equal(png.length > 0, true);
  const snap = await readFile(failureSnapshot, "utf8");
  assert.match(snap, /Click me/);

  await rm(dir, { recursive: true, force: true });
});

test("qa run captures screenshot when step has screenshot: true", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pwa-nav-qa-opt-"));
  const checkFile = join(dir, "check-opt.json");
  const treeFile = join(dir, "tree.txt");

  await writeFile(treeFile, "button \"Click me\"\n");
  await writeFile(
    checkFile,
    JSON.stringify({
      steps: [
        { op: "open", url: "https://app.test", screenshot: true },
        { op: "snapshot", input: treeFile, url: "https://app.test", title: "App" },
      ],
    }),
  );

  const backend = new OfflineBackend({ agentDir: dir });
  const result = await runCheck(checkFile, { backend });

  assert.equal(result.pass, true);
  const openPng = join(result.evidenceDir, "step-1-open.png");
  const png = await readFile(openPng);
  assert.equal(png.length > 0, true);

  await rm(dir, { recursive: true, force: true });
});
