import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileInstanceRegistry } from "../instance-registry.js";
import type { PwaInstance } from "../port-allocator.js";

test("FileInstanceRegistry registers, finds, lists, and unregisters instances", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pwa-nav-registry-test-"));
  try {
    const registry = new FileInstanceRegistry({ agentDir: dir });
    const instanceA: PwaInstance = {
      appSlug: "app-a",
      url: "https://a.example.com",
      port: 9222,
      pid: 1234,
      profileDir: "/tmp/profile-a",
      startedAt: new Date().toISOString(),
    };
    const instanceB: PwaInstance = {
      appSlug: "app-b",
      url: "https://b.example.com",
      port: 9223,
      pid: 5678,
      profileDir: "/tmp/profile-b",
      startedAt: new Date().toISOString(),
    };

    await registry.register(instanceA);
    await registry.register(instanceB);

    assert.deepEqual(await registry.findByApp("app-a"), instanceA);
    assert.deepEqual(await registry.findByPort(9223), instanceB);
    assert.equal(await registry.findByApp("app-c"), null);

    const active = await registry.listActive();
    assert.equal(active.length, 2);

    await registry.unregister("app-a");
    assert.equal(await registry.findByApp("app-a"), null);
    assert.equal((await registry.listActive()).length, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("FileInstanceRegistry prunes stale instances whose ports are closed", async () => {
  const dir = await mkdtemp(join(tmpdir(), "pwa-nav-registry-prune-"));
  try {
    const mockProbe = (_host: string, port: number) => Promise.resolve(port === 9223); // only 9223 alive
    const registry = new FileInstanceRegistry({ agentDir: dir, probe: mockProbe });

    await registry.register({
      appSlug: "stale-app",
      url: "https://stale.example.com",
      port: 9222,
      profileDir: "/tmp/stale",
      startedAt: new Date().toISOString(),
    });
    await registry.register({
      appSlug: "alive-app",
      url: "https://alive.example.com",
      port: 9223,
      profileDir: "/tmp/alive",
      startedAt: new Date().toISOString(),
    });

    const pruned = await registry.prune();
    assert.equal(pruned.length, 1);
    assert.equal(pruned[0]?.appSlug, "alive-app");
    assert.equal(await registry.findByApp("stale-app"), null);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
