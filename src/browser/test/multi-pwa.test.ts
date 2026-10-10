import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { launchStandaloneApp } from "../standalone-runner.js";
import { FileInstanceRegistry } from "../instance-registry.js";
import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";

test("concurrent isolated PWA launches allocate independent ports and register properly", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pwa-nav-multi-test-"));
  try {
    const listeningPorts = new Set<number>();
    const fakeProbe = (_host: string, port: number) => Promise.resolve(listeningPorts.has(port));

    const fakeSpawn = (_bin: string, args: string[]): ChildProcess => {
      const portArgIdx = args.indexOf("--remote-debugging-port");
      if (portArgIdx !== -1) {
        const port = Number(args[portArgIdx + 1]);
        listeningPorts.add(port);
      }
      const emitter = new EventEmitter() as unknown as ChildProcess;
      (emitter as { pid?: number }).pid = Math.floor(Math.random() * 10000) + 1000;
      (emitter as { unref?: () => void }).unref = () => undefined;
      return emitter;
    };

    const registry = new FileInstanceRegistry({ agentDir: dir, probe: fakeProbe });

    // Launch App 1 (e.g. WhatsApp)
    const app1 = await launchStandaloneApp({
      url: "https://web.whatsapp.com",
      appSlug: "whatsapp",
      cacheDir: dir,
      probe: fakeProbe,
      spawnFn: fakeSpawn,
      registry,
      timeoutMs: 1000,
    });

    assert.equal(app1.appSlug, "whatsapp");
    assert.equal(app1.port, 9222);

    // Launch App 2 (e.g. LinkedIn) concurrently
    const app2 = await launchStandaloneApp({
      url: "https://www.linkedin.com",
      appSlug: "linkedin",
      cacheDir: dir,
      probe: fakeProbe,
      spawnFn: fakeSpawn,
      registry,
      timeoutMs: 1000,
    });

    assert.equal(app2.appSlug, "linkedin");
    assert.equal(app2.port, 9223);

    // Verify registry state
    const active = await registry.listActive();
    assert.equal(active.length, 2);

    const registeredApp1 = await registry.findByApp("whatsapp");
    const registeredApp2 = await registry.findByApp("linkedin");

    assert(registeredApp1 !== null);
    assert(registeredApp2 !== null);
    assert.equal(registeredApp1.port, 9222);
    assert.equal(registeredApp2.port, 9223);
    assert.notEqual(registeredApp1.profileDir, registeredApp2.profileDir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
