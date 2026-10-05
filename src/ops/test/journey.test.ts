import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { startFakeBidiServer, type FakeBidiServer } from "../../bidi/fake-server.js";
import { BidiBackend } from "../../browser/bidi-backend.js";
import type { RawElement } from "../../browser/collector.js";
import { PwaNavError } from "../../core/errors.js";
import { addAllowedOrigin } from "../../core/gate.js";
import type { Screen, ScreenMap } from "../../screens/screen-map.js";
import { performJourney } from "../journey.js";

function loc(role: string, name: string, occurrence = 0) {
  return { role, name, occurrence };
}

const ORIGIN = "https://app.example.com";

const homeScreen: Screen = {
  id: "home",
  route: "/",
  title: "Home",
  access: "public",
  fingerprint: `sha256:${"0".repeat(64)}`,
  observedAt: "2026-10-01T00:00:00Z",
  fields: [
    {
      id: "search-input",
      role: "searchbox",
      name: "Search",
      nameSource: "label",
      sensitive: false,
      agentFillable: true,
      locator: loc("searchbox", "Search"),
    },
  ],
  actions: [
    {
      id: "submit-search",
      role: "button",
      name: "Search",
      kind: "submit",
      effect: "submit",
      locator: loc("button", "Search"),
    },
  ],
  links: [],
  flows: [],
};

const resultsScreen: Screen = {
  id: "results",
  route: "/results",
  title: "Results",
  access: "public",
  fingerprint: `sha256:${"1".repeat(64)}`,
  observedAt: "2026-10-01T00:00:00Z",
  fields: [],
  actions: [
    {
      id: "add-item",
      role: "button",
      name: "Add item",
      kind: "button",
      effect: "none",
      locator: loc("button", "Add item"),
    },
  ],
  links: [],
  flows: [],
};

const testMap: ScreenMap = {
  schemaVersion: "2026-03",
  app: {
    id: "test-app",
    name: "Test App",
    origin: ORIGIN,
    locale: "en-US",
    learnedAt: "2026-10-01T00:00:00Z",
  },
  screens: [homeScreen, resultsScreen],
  journeys: [
    {
      id: "search-journey",
      description: "Search and add item",
      inputSchema: {
        type: "object",
        required: ["query"],
        properties: { query: { type: "string" } },
      },
      steps: [
        {
          screenId: "home",
          action: "fill:@search-input=${inputs.query}",
          expectScreen: "results",
        },
        {
          screenId: "results",
          action: "click:@add-item",
        },
      ],
    },
    {
      id: "human-journey",
      description: "Human only flow",
      humanOnly: true,
      steps: [{ screenId: "home", action: "click:@submit-search" }],
    },
  ],
};

function remote(value: unknown): unknown {
  if (value === undefined) return { type: "undefined" };
  if (value === null) return { type: "null" };
  if (typeof value === "string") return { type: "string", value };
  if (typeof value === "number") return { type: "number", value };
  if (typeof value === "boolean") return { type: "boolean", value };
  if (Array.isArray(value)) return { type: "array", value: value.map(remote) };
  return { type: "object", value: Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, remote(v)]) };
}
const ok = (value: unknown): unknown => ({ type: "success", realm: "r", result: remote(value) });

interface FakeState {
  url: string;
  raw: RawElement[];
}

async function withJourneyEnv(
  fn: (ctx: { backend: BidiBackend; server: FakeBidiServer; state: FakeState }) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "pwa-nav-journey-test-"));
  const server = await startFakeBidiServer();
  const state: FakeState = {
    url: `${ORIGIN}/`,
    raw: [
      { role: "searchbox", name: "Search", nameSource: "label", occurrence: 0, inputType: "text" },
      { role: "button", name: "Search", nameSource: "content", occurrence: 0 },
    ],
  };

  server.handle("session.subscribe", () => ({ subscription: "s" }));
  server.handle("input.performActions", () => ({}));
  server.handle("input.releaseActions", () => ({}));
  server.handle("browsingContext.getTree", () => ({
    contexts: [{ context: "ctx", url: state.url, children: [], userContext: "default" }],
  }));
  server.handle("browsingContext.navigate", (params) => {
    state.url = (params as { url: string }).url;
    return { navigation: "n1", url: state.url };
  });
  server.handle("script.evaluate", () => ok(state.url));
  server.handle("script.callFunction", (params) => {
    const decl = (params as { functionDeclaration: string }).functionDeclaration;
    if (decl.startsWith("(includeAll) =>")) return ok({ url: state.url, title: "T", raw: state.raw });
    if (decl.startsWith("(index, role")) {
      return { type: "success", realm: "r", result: { type: "node", sharedId: "node-1" } };
    }
    if (decl.includes("isContentEditable")) return ok({ ok: true, kind: "text", sensitive: false });
    if (decl.includes("MutationObserver")) return ok(true);
    if (decl.includes("elementFromPoint")) return ok({ ok: true });
    if (decl.startsWith("() => ({ url: location.href")) return ok({ url: state.url, title: "T" });
    return ok(true);
  });

  const killFile = join(dir, "kill");
  const env: NodeJS.ProcessEnv = { PWA_NAV_KILL_SWITCH: killFile };
  await addAllowedOrigin(ORIGIN, dir);

  const backend = new BidiBackend({
    port: server.port,
    agentDir: dir,
    env,
    platform: "linux",
    armed: true,
  });

  try {
    await fn({ backend, server, state });
  } finally {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  }
}

test("performJourney in dry-run mode returns plan without calling browser", async () => {
  const result = await performJourney("search-journey", { query: "shoes" }, { map: testMap, armed: false });
  assert.equal(result.armed, false);
  assert.equal(result.completedSteps, 0);
  assert.equal(result.totalSteps, 2);
  assert.equal(result.plan.length, 3);
  assert.match(result.plan[0] ?? "", /journey "search-journey"/);
});

test("performJourney armed executes steps and verifies expectScreen", async () => {
  await withJourneyEnv(async ({ backend, state }) => {
    // Open home page
    await backend.open(`${ORIGIN}/`, { allowOrigin: true });

    // Transition hook: when performActions is called on home screen, transition state to results
    backend.act = (snapshotId, ops) => {
      // simulate navigation to /results after step 1
      state.url = `${ORIGIN}/results`;
      state.raw = [{ role: "button", name: "Add item", nameSource: "content", occurrence: 0 }];
      return Promise.resolve({
        snapshotId,
        results: ops.map(() => ({ kind: "done", plan: "done", snapshotId, url: state.url, title: "T" })),
      });
    };

    const res = await performJourney(
      "search-journey",
      { query: "boots" },
      { map: testMap, backend, armed: true },
    );

    assert.equal(res.armed, true);
    assert.equal(res.completedSteps, 2);
    assert.equal(res.finalUrl, `${ORIGIN}/results`);
    assert.equal(res.finalScreen?.id, "results");
  });
});

test("performJourney fails fast with journey_step_failed if initial screen does not match step.screenId", async () => {
  await withJourneyEnv(async ({ backend, state }) => {
    state.url = `${ORIGIN}/results`;
    await backend.open(`${ORIGIN}/results`, { allowOrigin: true });

    await assert.rejects(
      async () => {
        await performJourney("search-journey", { query: "boots" }, { map: testMap, backend, armed: true });
      },
      (err: unknown) => {
        assert(err instanceof PwaNavError);
        assert.equal(err.code, "journey_step_failed");
        assert.equal(err.exitCode, 14);
        assert.match(err.message, /step 1\/2 failed: current screen is "results", expected "home"/);
        return true;
      },
    );
  });
});

test("performJourney fails fast with journey_step_failed if expectScreen is not reached", async () => {
  await withJourneyEnv(async ({ backend, state }) => {
    state.url = `${ORIGIN}/`;
    await backend.open(`${ORIGIN}/`, { allowOrigin: true });

    // Do NOT change url to /results; stay on /
    backend.act = (snapshotId, ops) => {
      return Promise.resolve({
        snapshotId,
        results: ops.map(() => ({ kind: "done", plan: "done", snapshotId, url: state.url, title: "T" })),
      });
    };

    await assert.rejects(
      async () => {
        await performJourney("search-journey", { query: "boots" }, { map: testMap, backend, armed: true });
      },
      (err: unknown) => {
        assert(err instanceof PwaNavError);
        assert.equal(err.code, "journey_step_failed");
        assert.equal(err.exitCode, 14);
        assert.match(err.message, /failed transition expectation: expected screen "results", but arrived at "home"/);
        return true;
      },
    );
  });
});

test("performJourney rejects human-only journey with sensitive_target", async () => {
  await assert.rejects(
    async () => {
      await performJourney("human-journey", {}, { map: testMap, armed: true });
    },
    (err: unknown) => {
      assert(err instanceof PwaNavError);
      assert.equal(err.code, "sensitive_target");
      assert.equal(err.exitCode, 11);
      return true;
    },
  );
});
