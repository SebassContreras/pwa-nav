import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PwaNavError } from "../errors.js";
import {
  addAllowedOrigin,
  assertArmedAllowed,
  assertFileUploadAllowed,
  assertNavigationAllowed,
  decideAction,
  isKillSwitchActive,
  isPathInside,
  killSwitchPath,
  loadAllowList,
  normalizeOrigin,
} from "../gate.js";

const base = {
  armed: true,
  killSwitchActive: false,
  origin: "https://example.com/page",
  allowedOrigins: ["https://example.com"],
};

function blockedCode(d: ReturnType<typeof decideAction>): string {
  return d.kind === "blocked" ? d.error.code : `not blocked: ${d.kind}`;
}

async function tmp(): Promise<string> {
  return mkdtemp(join(tmpdir(), "pwa-nav-gate-"));
}

test("not armed => dry-run, even with kill-switch or blocked origin", () => {
  assert.equal(decideAction({ ...base, armed: false }).kind, "dry-run");
  assert.equal(decideAction({ ...base, armed: false, killSwitchActive: true }).kind, "dry-run");
  assert.equal(decideAction({ ...base, armed: false, allowedOrigins: [] }).kind, "dry-run");
});

test("armed + kill-switch => kill_switch", () => {
  assert.equal(blockedCode(decideAction({ ...base, killSwitchActive: true })), "kill_switch");
});

test("armed + origin not listed => origin_blocked with fix hint", () => {
  const d = decideAction({ ...base, allowedOrigins: ["https://other.com"] });
  assert.equal(blockedCode(d), "origin_blocked");
  if (d.kind === "blocked") {
    assert.match(d.error.hint ?? "", /--allow-origin.*https:\/\/example\.com/);
  }
});

test("armed + listed origin => armed", () => {
  assert.equal(decideAction(base).kind, "armed");
});

test("origin normalization", () => {
  assert.equal(normalizeOrigin("HTTPS://Example.COM:443/x?y"), "https://example.com");
  assert.equal(normalizeOrigin("http://example.com:80/"), "http://example.com");
  assert.equal(decideAction({ ...base, origin: "https://EXAMPLE.com:443/" }).kind, "armed");
  assert.equal(
    decideAction({ ...base, allowedOrigins: ["https://example.com/"] }).kind,
    "armed",
  );
});

test("invalid origin => origin_blocked", () => {
  assert.equal(blockedCode(decideAction({ ...base, origin: "not a url" })), "origin_blocked");
  assert.equal(blockedCode(decideAction({ ...base, origin: "about:blank" })), "origin_blocked");
});

test("kill-switch path honors env override", () => {
  assert.equal(killSwitchPath({ PWA_NAV_KILL_SWITCH: "/x/stop" }), "/x/stop");
  assert.equal(killSwitchPath({}), join(".agent", "kill"));
});

test("isKillSwitchActive reflects file existence", async () => {
  const dir = await tmp();
  try {
    const file = join(dir, "kill");
    assert.equal(await isKillSwitchActive(file), false);
    await writeFile(file, "");
    assert.equal(await isKillSwitchActive(file), true);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("allow-list: missing => empty; round trip, idempotent, sorted, normalized", async () => {
  const dir = await tmp();
  try {
    assert.deepEqual(await loadAllowList(dir), []);
    await addAllowedOrigin("https://zeta.com/path", dir);
    await addAllowedOrigin("HTTP://Alpha.com:80", dir);
    const list = await addAllowedOrigin("https://zeta.com", dir);
    assert.deepEqual(list, ["http://alpha.com", "https://zeta.com"]);
    assert.deepEqual(await loadAllowList(dir), list);
    const raw = JSON.parse(await readFile(join(dir, "allow.json"), "utf8")) as unknown;
    assert.deepEqual(raw, { origins: list });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("addAllowedOrigin rejects non-http(s) and garbage", async () => {
  const dir = await tmp();
  try {
    for (const bad of ["ftp://x.com", "nope", "about:blank"]) {
      await assert.rejects(addAllowedOrigin(bad, dir), (e: unknown) => {
        return e instanceof PwaNavError && e.code === "invalid_args";
      });
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("malformed allow.json => invalid_args naming the file", async () => {
  const dir = await tmp();
  try {
    await writeFile(join(dir, "allow.json"), "{oops");
    await assert.rejects(loadAllowList(dir), (e: unknown) => {
      return e instanceof PwaNavError && e.code === "invalid_args" && e.message.includes("allow.json");
    });
    await writeFile(join(dir, "allow.json"), JSON.stringify({ origins: [1] }));
    await assert.rejects(loadAllowList(dir), (e: unknown) => {
      return e instanceof PwaNavError && e.code === "invalid_args" && e.message.includes("allow.json");
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("assertArmedAllowed: dry-run, allowed, then kill-switch created mid-batch", async () => {
  const dir = await tmp();
  try {
    const kill = join(dir, "kill");
    const env = { PWA_NAV_KILL_SWITCH: kill };
    const origin = "https://example.com/a";
    await addAllowedOrigin(origin, dir);
    const opts = { armed: true, origin, agentDir: dir, env };
    assert.equal((await assertArmedAllowed({ ...opts, armed: false })).kind, "dry-run");
    assert.equal((await assertArmedAllowed(opts)).kind, "armed");
    await writeFile(kill, "");
    const stopped = await assertArmedAllowed(opts);
    assert.equal(blockedCode(stopped), "kill_switch");
    await unlink(kill);
    const unlisted = await assertArmedAllowed({ ...opts, origin: "https://nope.com" });
    assert.equal(blockedCode(unlisted), "origin_blocked");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("assertNavigationAllowed: allow-list or flag, kill-switch, invalid URL", async () => {
  const dir = await tmp();
  try {
    const kill = join(dir, "kill");
    const env = { PWA_NAV_KILL_SWITCH: kill };
    const url = "https://example.com/a?x=1";
    const opts = { url, allowOrigin: false, agentDir: dir, env };
    const code = async (o: typeof opts): Promise<string> => {
      try {
        await assertNavigationAllowed(o);
        return "ok";
      } catch (e) {
        assert.ok(e instanceof PwaNavError);
        return e.code;
      }
    };
    assert.equal(await code(opts), "origin_blocked");
    await assert.rejects(assertNavigationAllowed(opts), (e: unknown) => {
      return (
        e instanceof PwaNavError &&
        e.message === "origin not allow-listed: https://example.com" &&
        e.hint === "re-run: open <url> --allow-origin to allow this origin"
      );
    });
    assert.equal(await code({ ...opts, allowOrigin: true }), "ok");
    // The flag does not write: only the backend adds the origin after navigating.
    assert.deepEqual(await loadAllowList(dir), []);
    await addAllowedOrigin("https://example.com", dir);
    assert.equal(await code(opts), "ok");
    assert.equal(await code({ ...opts, url: "https://other.com/" }), "origin_blocked");
    assert.equal(await code({ ...opts, url: "not a url", allowOrigin: true }), "invalid_args");
    await writeFile(kill, "");
    assert.equal(await code(opts), "kill_switch");
    assert.equal(await code({ ...opts, allowOrigin: true }), "kill_switch");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("assertFileUploadAllowed: allows files inside safe roots, rejects outside and sensitive files", async () => {
  const dir = await tmp();
  try {
    const inside = join(dir, "uploads", "receipt.pdf");
    const safeRoots = [dir];

    // Allowed inside root
    assert.doesNotThrow(() => {
      assertFileUploadAllowed(inside, safeRoots);
    });
    assert.equal(isPathInside(inside, dir), true);

    // Traversal outside root is blocked
    const outside = join(dir, "..", "secret.txt");
    assert.equal(isPathInside(outside, dir), false);
    assert.throws(
      () => {
        assertFileUploadAllowed(outside, safeRoots);
      },
      (e: unknown) => e instanceof PwaNavError && e.code === "file_upload_blocked",
    );

    const traversal = join(dir, "uploads", "..", "..", "outside.png");
    assert.throws(
      () => {
        assertFileUploadAllowed(traversal, safeRoots);
      },
      (e: unknown) => e instanceof PwaNavError && e.code === "file_upload_blocked",
    );

    // Sensitive files are blocked even if inside root
    const envFile = join(dir, ".env");
    assert.throws(
      () => {
        assertFileUploadAllowed(envFile, safeRoots);
      },
      (e: unknown) =>
        e instanceof PwaNavError &&
        e.code === "file_upload_blocked" &&
        e.message.includes("sensitive"),
    );

    const envLocal = join(dir, ".env.production");
    assert.throws(
      () => {
        assertFileUploadAllowed(envLocal, safeRoots);
      },
      (e: unknown) => e instanceof PwaNavError && e.code === "file_upload_blocked",
    );

    const keyFile = join(dir, "id_rsa");
    assert.throws(
      () => {
        assertFileUploadAllowed(keyFile, safeRoots);
      },
      (e: unknown) => e instanceof PwaNavError && e.code === "file_upload_blocked",
    );

    // Default roots allow files in cwd
    assert.doesNotThrow(() => {
      assertFileUploadAllowed("package.json");
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

