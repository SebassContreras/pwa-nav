import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { findProjectRoot, resolveAgentDir, resolveScreensDir } from "../storage.js";

async function withTmp(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = join(tmpdir(), `pwa-nav-storage-${randomUUID()}`);
  await mkdir(dir, { recursive: true });
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("storage and root detection", () => {
  it("finds project root by .git marker", async () => {
    await withTmp(async (root) => {
      const gitDir = join(root, ".git");
      const subDir = join(root, "a", "b", "c");
      await mkdir(gitDir, { recursive: true });
      await mkdir(subDir, { recursive: true });

      assert.equal(findProjectRoot(subDir), root);
    });
  });

  it("finds project root by package.json marker", async () => {
    await withTmp(async (root) => {
      await writeFile(join(root, "package.json"), "{}");
      const subDir = join(root, "packages", "core");
      await mkdir(subDir, { recursive: true });

      assert.equal(findProjectRoot(subDir), root);
    });
  });

  it("finds project root by .agent marker", async () => {
    await withTmp(async (root) => {
      await mkdir(join(root, ".agent"), { recursive: true });
      const subDir = join(root, "nested");
      await mkdir(subDir, { recursive: true });

      assert.equal(findProjectRoot(subDir), root);
    });
  });

  it("resolves the cache dir from an explicit cacheDir", () => {
    assert.equal(resolveAgentDir({ cacheDir: "/custom/cache" }), resolve("/custom/cache"));
  });

  it("resolves the cache dir from PWA_NAV_CACHE_DIR only", async () => {
    assert.equal(resolveAgentDir({}, { PWA_NAV_CACHE_DIR: "/env/cache" }), resolve("/env/cache"));
    // The removed PWA_NAV_AGENT_DIR alias is ignored.
    await withTmp(async (root) => {
      await writeFile(join(root, "package.json"), "{}");
      assert.equal(resolveAgentDir({}, { PWA_NAV_AGENT_DIR: "/env/agent" }, root), join(root, ".agent"));
    });
  });

  it("resolves agentDir to <projectRoot>/.agent inside a project", async () => {
    await withTmp(async (root) => {
      await writeFile(join(root, "package.json"), "{}");
      const sub = join(root, "sub");
      await mkdir(sub, { recursive: true });

      assert.equal(resolveAgentDir({}, {}, sub), join(root, ".agent"));
    });
  });

  it("resolves screensDir to absolute path with explicit options or env", () => {
    assert.equal(resolveScreensDir({ screensDir: "my-screens" }, {}), resolve(process.cwd(), "my-screens"));
    assert.equal(resolveScreensDir({}, { PWA_NAV_SCREENS_DIR: "env-screens" }), resolve(process.cwd(), "env-screens"));
  });

  it("resolves screensDir defaulting to <cache-dir>/screens", async () => {
    await withTmp(async (root) => {
      await writeFile(join(root, "package.json"), "{}");
      assert.equal(resolveScreensDir({}, {}, root), join(root, ".agent", "screens"));
      assert.equal(
        resolveScreensDir({ cacheDir: "/custom/agent" }, {}, root),
        join(resolve("/custom/agent"), "screens"),
      );
    });
  });

  it("defaults to <cache-dir>/screens even if a legacy ./screens dir exists on disk", async () => {
    await withTmp(async (root) => {
      await writeFile(join(root, "package.json"), "{}");
      const legacyScreens = join(root, "screens");
      await mkdir(legacyScreens, { recursive: true });

      assert.equal(resolveScreensDir({}, {}, root), join(root, ".agent", "screens"));
    });
  });

  it("unifies all document outputs under custom cacheDir without loose files", async () => {
    await withTmp(async (custom) => {
      const absCustom = resolve(custom);
      assert.equal(resolveAgentDir({ cacheDir: custom }), absCustom);
      assert.equal(resolveScreensDir({ cacheDir: custom }), join(absCustom, "screens"));

      // Verify that refs and snapshots unify under custom agentDir
      const { save, load, latestSnapshotId } = await import("../refs.js");
      const snapId = await save(
        { snapshotId: "snap-custom", url: "https://custom.test", title: "Custom", elements: [] },
        { agentDir: absCustom },
      );
      assert.equal(await latestSnapshotId({ agentDir: absCustom }), snapId);
      const loaded = await load(snapId, { agentDir: absCustom });
      assert.equal(loaded?.snapshotId, "snap-custom");

      // Verify session unifies under custom agentDir
      const { OfflineBackend } = await import("../../backend/backend.js");
      const backend = new OfflineBackend({ agentDir: absCustom });
      await backend.open("https://custom.test");

      const { existsSync } = await import("node:fs");
      assert.ok(existsSync(join(absCustom, "session.json")));
      assert.ok(existsSync(join(absCustom, "snapshot.json")));
      assert.ok(existsSync(join(absCustom, "refs", `${snapId}.json`)));
    });
  });
});
