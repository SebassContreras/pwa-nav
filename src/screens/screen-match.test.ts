// Tests for src/screen-match.ts (spec 005 T004). Run with `pnpm test`.
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { PwaNavError } from "../core/errors.js";
import { ScreenMapError } from "./screen-map.js";
import type { Screen, ScreenMap } from "./screen-map.js";
import {
  assertNoAmbiguousRoutes,
  assertValidRoutePattern,
  findAmbiguousRoutes,
  findScreen,
  loadExplicitMap,
  loadScreenMapsFromDir,
  matchRoute,
  resolveScreensDir,
  routeSpecificity,
  selectMap,
} from "./screen-match.js";

const EXAMPLE = fileURLToPath(new URL("../../examples/screens/demo-app.screens.json", import.meta.url));

function screen(id: string, route: string): Screen {
  return {
    id,
    route,
    title: id,
    access: "public",
    fingerprint: "sha256:x",
    observedAt: "2026-10-01T00:00:00Z",
    fields: [],
    actions: [],
    links: [],
    flows: [],
  };
}

function mapOf(origin: string, routes: [string, string][]): ScreenMap {
  return {
    schemaVersion: "1.0.0",
    app: { id: "app", name: "App", origin, locale: "en", learnedAt: "2026-10-01T00:00:00Z" },
    screens: routes.map(([id, route]) => screen(id, route)),
  };
}

function failure(fn: () => unknown): { code: string; hint: string | undefined; message: string } {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof PwaNavError);
    return { code: error.code, hint: error.hint, message: error.message };
  }
  return assert.fail("expected a PwaNavError");
}

async function withTmp(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "pwa-nav-match-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("matchRoute", () => {
  it("matches exact, params and trailing slash", () => {
    assert.deepEqual(matchRoute("/login", "/login"), { params: {}, literalSegments: 1, paramSegments: 0 });
    assert.deepEqual(matchRoute("/a/:id", "/a/42")?.params, { id: "42" });
    assert.notEqual(matchRoute("/a/", "/a"), null);
    assert.notEqual(matchRoute("/a", "/a/"), null);
    assert.notEqual(matchRoute("/", "/"), null);
    assert.equal(matchRoute("/a", "/b"), null);
    assert.equal(matchRoute("/a", "/A"), null);
    assert.equal(matchRoute("/a/:id", "/a"), null);
    assert.equal(matchRoute("/a/:id", "/a/1/2"), null);
  });

  it("decodes segments and rejects malformed encoding", () => {
    assert.deepEqual(matchRoute("/a/:name", "/a/J%C3%BCrgen")?.params, { name: "Jürgen" });
    assert.notEqual(matchRoute("/caf%C3%A9", "/café"), null);
    assert.notEqual(matchRoute("/café", "/caf%C3%A9"), null);
    assert.equal(matchRoute("/a/:id", "/a/%E0%A4%A"), null);
    assert.equal(matchRoute("/a", "/%zz"), null);
  });
});

describe("assertValidRoutePattern", () => {
  it("rejects unsupported syntax", () => {
    for (const bad of ["/a/*", "/a/(b)", "/a?", "/a/{b}", "a/b", "/a//b", "/a/:", "/a/:x/:x"]) {
      assert.equal(failure(() => { assertValidRoutePattern(bad); }).code, "invalid_args", bad);
    }
    assert.doesNotThrow(() => { assertValidRoutePattern("/a/:id/edit"); });
    assert.equal(failure(() => matchRoute("/a/*", "/a/b")).code, "invalid_args");
  });
});

describe("specificity and ambiguity", () => {
  it("literal beats param", () => {
    const literal = matchRoute("/a/new", "/a/new");
    const param = matchRoute("/a/:id", "/a/new");
    assert.ok(literal !== null && param !== null);
    assert.ok(routeSpecificity(literal) > routeSpecificity(param));
    const map = mapOf("http://x.test", [["byId", "/a/:id"], ["create", "/a/new"]]);
    assert.equal(findScreen(map, "http://x.test/a/new").screen.id, "create");
    assert.equal(findScreen(map, "http://x.test/a/7").screen.id, "byId");
  });

  it("detects ambiguous pairs in both directions", () => {
    assert.deepEqual(findAmbiguousRoutes([screen("a", "/x/:a"), screen("b", "/x/:b")]), [["a", "b"]]);
    assert.deepEqual(findAmbiguousRoutes([screen("b", "/x/:b"), screen("a", "/x/:a")]), [["b", "a"]]);
    assert.deepEqual(findAmbiguousRoutes([screen("p", "/x/:a/new"), screen("q", "/x/new/:b")]), [["p", "q"]]);
    assert.deepEqual(findAmbiguousRoutes([screen("q", "/x/new/:b"), screen("p", "/x/:a/new")]), [["q", "p"]]);
  });

  it("does not flag non-overlapping or unequal-specificity routes", () => {
    assert.deepEqual(findAmbiguousRoutes([screen("a", "/a/:id"), screen("b", "/a/new")]), []);
    assert.deepEqual(findAmbiguousRoutes([screen("a", "/a/:id"), screen("b", "/b/:id")]), []);
    assert.deepEqual(findAmbiguousRoutes([screen("a", "/a/:id"), screen("b", "/a/:id/edit")]), []);
    assert.deepEqual(findAmbiguousRoutes([screen("a", "/x/one/:a"), screen("b", "/x/two/:b")]), []);
  });

  it("assertNoAmbiguousRoutes names both screens", () => {
    const err = failure(() => {
      assertNoAmbiguousRoutes(mapOf("http://x.test", [["a", "/x/:a"], ["b", "/x/:b"]]));
    });
    assert.equal(err.code, "invalid_args");
    assert.match(err.message, /"a".*"b"/);
    assert.doesNotThrow(() => {
      assertNoAmbiguousRoutes(mapOf("http://x.test", [["a", "/a/:id"], ["b", "/a/new"]]));
    });
  });
});

describe("findScreen", () => {
  const map = mapOf("http://x.test:8080", [["home", "/"], ["item", "/items/:id"]]);

  it("returns params and ignores query/hash", () => {
    const found = findScreen(map, "http://x.test:8080/items/9?q=1#h");
    assert.equal(found.screen.id, "item");
    assert.deepEqual(found.params, { id: "9" });
    assert.equal(findScreen(map, "http://x.test:8080/").screen.id, "home");
  });

  it("origin mismatch is unmapped_screen listing the map origin", () => {
    const err = failure(() => findScreen(map, "http://other.test/items/1"));
    assert.equal(err.code, "unmapped_screen");
    assert.match(err.hint ?? "", /http:\/\/x\.test:8080/);
  });

  it("unmapped pathname hints snapshot --learn", () => {
    const err = failure(() => findScreen(map, "http://x.test:8080/nope"));
    assert.equal(err.code, "unmapped_screen");
    assert.match(err.hint ?? "", /run: snapshot --learn/);
    assert.match(err.hint ?? "", /\/nope/);
  });

  it("rejects non-http urls", () => {
    assert.equal(failure(() => findScreen(map, "file:///etc/passwd")).code, "invalid_args");
    assert.equal(failure(() => findScreen(map, "not a url")).code, "invalid_args");
  });

  it("matches the shipped example", async () => {
    const example = await loadExplicitMap(EXAMPLE);
    assert.equal(findScreen(example, "http://localhost:8080/login").screen.id, "login");
  });
});

describe("selectMap", () => {
  const a = mapOf("http://a.test", [["s", "/"]]);
  const b = mapOf("http://b.test", [["s", "/"]]);

  it("picks the single match", () => {
    assert.equal(selectMap([a, b], "http://b.test/x"), b);
    assert.equal(selectMap([{ path: "a.screens.json", map: a }], "http://a.test/"), a);
  });

  it("zero matches lists mapped origins and dir", () => {
    const err = failure(() => selectMap([a, b], "http://c.test/", "./screens"));
    assert.equal(err.code, "unmapped_screen");
    assert.match(err.hint ?? "", /http:\/\/a\.test, http:\/\/b\.test/);
    assert.match(err.hint ?? "", /\.\/screens/);
  });

  it("several matches list the file paths", () => {
    const err = failure(() =>
      selectMap(
        [
          { path: "one.screens.json", map: a },
          { path: "two.screens.json", map: a },
        ],
        "http://a.test/",
      ),
    );
    assert.equal(err.code, "invalid_args");
    assert.match(err.message, /one\.screens\.json.*two\.screens\.json/);
  });
});

describe("screens dir", () => {
  it("resolves option, env, default", () => {
    assert.equal(resolveScreensDir({ screensDir: "o" }, { PWA_NAV_SCREENS_DIR: "e" }), "o");
    assert.equal(resolveScreensDir({}, { PWA_NAV_SCREENS_DIR: "e" }), "e");
    assert.equal(resolveScreensDir(undefined, {}), "./screens");
  });

  it("missing dir is empty", async () => {
    await withTmp(async (dir) => {
      assert.deepEqual(await loadScreenMapsFromDir(join(dir, "nope")), []);
    });
  });

  it("loads *.screens.json only and ignores other files", async () => {
    await withTmp(async (dir) => {
      const example = await loadExplicitMap(EXAMPLE);
      await writeFile(join(dir, "demo.screens.json"), JSON.stringify(example));
      await writeFile(join(dir, "notes.json"), "{ not a map");
      await writeFile(join(dir, "readme.md"), "x");
      const loaded = await loadScreenMapsFromDir(dir);
      assert.equal(loaded.length, 1);
      assert.equal(loaded[0]?.path, join(dir, "demo.screens.json"));
      const url = "http://localhost:8080/login";
      assert.equal(findScreen(selectMap(loaded, url), url).screen.id, "login");
    });
  });

  it("invalid file surfaces the ScreenMapError with the path", async () => {
    await withTmp(async (dir) => {
      const file = join(dir, "bad.screens.json");
      await writeFile(file, JSON.stringify({ schemaVersion: "1.0.0" }));
      await assert.rejects(loadScreenMapsFromDir(dir), (error: unknown) => {
        assert.ok(error instanceof ScreenMapError);
        assert.ok(error.message.includes(file));
        return true;
      });
      await writeFile(file, "{ broken");
      await assert.rejects(loadExplicitMap(file), (error: unknown) => {
        assert.ok(error instanceof PwaNavError && error.code === "invalid_args");
        return true;
      });
    });
  });
});
