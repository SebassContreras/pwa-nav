import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  ensureStandaloneProfile,
  serializeUserJs,
} from "../standalone-profile.js";

test("serializeUserJs formats preferences as valid user_pref lines", () => {
  const content = serializeUserJs({
    "remote.active-protocols": 1,
    "browser.test": true,
    "custom.str": "value",
  });
  assert.match(content, /user_pref\("remote\.active-protocols", 1\);/);
  assert.match(content, /user_pref\("browser\.test", true\);/);
  assert.match(content, /user_pref\("custom\.str", "value"\);/);
});

test("ensureStandaloneProfile creates profile directory with seeded user.js containing BiDi flags", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "pwa-nav-standalone-profile-"));
  try {
    const profileDir = await ensureStandaloneProfile("linkedin", { cacheDir: tempDir });
    assert.equal(profileDir, join(tempDir, "apps", "linkedin", "profile"));

    const userJs = await readFile(join(profileDir, "user.js"), "utf8");
    assert.match(userJs, /user_pref\("remote\.active-protocols", 1\);/);
    assert.match(userJs, /user_pref\("remote\.experimental-modules", 1\);/);
    assert.match(userJs, /user_pref\("browser\.shell\.checkDefaultBrowser", false\);/);
    assert.match(userJs, /user_pref\("toolkit\.legacyUserProfileCustomizations\.stylesheets", true\);/);

    const userChrome = await readFile(join(profileDir, "chrome", "userChrome.css"), "utf8");
    assert.match(userChrome, /#TabsToolbar/);
    assert.match(userChrome, /#nav-bar/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("ensureStandaloneProfile supports extraPrefs overrides without mutating defaults", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "pwa-nav-standalone-extra-"));
  try {
    const profileDir = await ensureStandaloneProfile("linkedin", {
      cacheDir: tempDir,
      extraPrefs: { "custom.flag": 42 },
    });
    const userJs = await readFile(join(profileDir, "user.js"), "utf8");
    assert.match(userJs, /user_pref\("custom\.flag", 42\);/);
    assert.match(userJs, /user_pref\("remote\.active-protocols", 1\);/);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});
