import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PwaNavError } from "../../core/errors.js";
import {
  buildStandaloneLaunchArgs,
  launchStandaloneApp,
} from "../standalone-runner.js";

function fakeChild(pid = 9999): ChildProcess {
  const emitter = new EventEmitter() as unknown as ChildProcess;
  (emitter as unknown as { pid: number }).pid = pid;
  (emitter as unknown as { unref: () => void }).unref = () => undefined;
  return emitter;
}

test("buildStandaloneLaunchArgs formats standalone flags with profile, pwa, debugging port and target url", () => {
  const args = buildStandaloneLaunchArgs({
    profileDir: "C:\\profiles\\linkedin",
    appSlug: "linkedin",
    port: 9222,
    url: "https://www.linkedin.com",
    headless: true,
  });

  assert.deepEqual(args, [
    "--profile",
    "C:\\profiles\\linkedin",
    "--pwa",
    "linkedin",
    "--remote-debugging-port",
    "9222",
    "--headless",
    "https://www.linkedin.com",
  ]);
});

test("launchStandaloneApp rejects if port is already listening", async () => {
  await assert.rejects(
    async () => {
      await launchStandaloneApp({
        url: "https://example.com",
        appSlug: "example-com",
        port: 9222,
        probe: () => Promise.resolve(true),
      });
    },
    (err: unknown) => {
      assert.ok(err instanceof PwaNavError);
      assert.equal(err.code, "invalid_args");
      assert.match(err.message, /port 9222 is already listening/);
      return true;
    },
  );
});

test("launchStandaloneApp initializes isolated profile and spawns runtime without extension messaging", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "pwa-nav-standalone-test-"));
  const fakePwaDir = join(tempDir, "pwa-home");
  const runtimeDir = join(fakePwaDir, "runtime");
  await mkdir(runtimeDir, { recursive: true });

  const dummyExe = join(runtimeDir, process.platform === "win32" ? "firefox.exe" : "firefox");
  await writeFile(dummyExe, "dummy", "utf8");

  let spawnedBinary = "";
  let spawnedArgs: string[] = [];
  let probeCalls = 0;

  const probe = () => {
    probeCalls++;
    return Promise.resolve(probeCalls >= 2);
  };

  const spawnFn = (binary: string, args: string[]) => {
    spawnedBinary = binary;
    spawnedArgs = args;
    return fakeChild(4242);
  };

  try {
    const result = await launchStandaloneApp({
      url: "https://www.linkedin.com",
      appSlug: "linkedin",
      port: 9222,
      platform: process.platform,
      env: { PWA_NAV_FIREFOXPWA_DIR: fakePwaDir },
      cacheDir: tempDir,
      probe,
      intervalMs: 10,
      timeoutMs: 1000,
      spawnFn,
    });

    assert.equal(result.appSlug, "linkedin");
    assert.equal(result.url, "https://www.linkedin.com");
    assert.equal(result.port, 9222);
    assert.equal(result.pid, 4242);
    assert.equal(spawnedBinary, dummyExe);
    assert.ok(spawnedArgs.includes("--pwa"));
    assert.ok(spawnedArgs.includes("linkedin"));
    assert.ok(spawnedArgs.includes("--remote-debugging-port"));
    assert.ok(spawnedArgs.includes("9222"));
    assert.ok(spawnedArgs.includes("https://www.linkedin.com"));
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("BiDi connection attaches cleanly to the standalone LinkedIn instance endpoint", async () => {
  const { startFakeBidiServer } = await import("../../bidi/fake-server.js");
  const { withTopLevelContext } = await import("../../bidi/session.js");

  const server = await startFakeBidiServer({
    "browsingContext.getTree": () => ({
      contexts: [
        {
          context: "ctx-linkedin",
          url: "https://www.linkedin.com/feed/",
          children: [],
          parent: null,
        },
      ],
    }),
  });

  try {
    const contextId = await withTopLevelContext(
      server.url,
      (_client, id) => {
        assert.equal(id, "ctx-linkedin");
        return Promise.resolve(id);
      },
    );
    assert.equal(contextId, "ctx-linkedin");
    assert.equal(server.sessionActive, false);
  } finally {
    await server.close();
  }
});

