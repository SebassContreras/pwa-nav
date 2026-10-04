import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { PwaNavError } from "../core/errors.js";
import type { Screen, ScreenMap } from "./screen-map.js";
import {
  describeResolved,
  isSemanticToken,
  parseFlowInputs,
  parseSemanticAct,
  parseTarget,
  resolveFlow,
  resolveTarget,
} from "./screen-resolve.js";

const SECRET = "s3cr3t-Zx9!distinct";

function loc(role: string, name: string, occurrence = 0): { role: string; name: string; occurrence: number } {
  return { role, name, occurrence };
}

const search: Screen = {
  id: "search",
  route: "/search",
  title: "Search",
  access: "public",
  fingerprint: `sha256:${"0".repeat(64)}`,
  observedAt: "2026-10-01T00:00:00Z",
  fields: [
    {
      id: "q",
      role: "searchbox",
      name: "Query",
      nameSource: "label",
      sensitive: false,
      agentFillable: true,
      locator: loc("searchbox", "Query"),
    },
  ],
  actions: [
    {
      id: "go",
      role: "button",
      name: "Search",
      kind: "submit",
      effect: "submit",
      requires: ["q"],
      locator: loc("button", "Search", 1),
    },
  ],
  links: [{ id: "home", name: "Home", href: "/", external: false, locator: loc("link", "Home") }],
  flows: [
    {
      id: "find",
      description: "search",
      humanOnly: false,
      inputSchema: {
        type: "object",
        required: ["q"],
        properties: { q: { type: "string", minLength: 1 } },
        additionalProperties: false,
      },
      steps: [
        { op: "fill", target: "@q", from: "q" },
        { op: "click", target: "@go" },
      ],
    },
  ],
};

async function demoScreen(): Promise<Screen> {
  const path = fileURLToPath(new URL("../../examples/screens/demo-app.screens.json", import.meta.url));
  const map = JSON.parse(await readFile(path, "utf8")) as ScreenMap;
  const screen = map.screens[0];
  assert.ok(screen);
  return screen;
}

function thrown(fn: () => unknown): PwaNavError {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof PwaNavError);
    return error;
  }
  return assert.fail("expected PwaNavError");
}

function assertNoSecret(error: PwaNavError): void {
  assert.ok(!error.message.includes(SECRET));
  assert.ok(!(error.hint ?? "").includes(SECRET));
}

test("parseTarget: refs, ids and invalid @ tokens", () => {
  assert.deepEqual(parseTarget("e12"), { kind: "ref", ref: "e12" });
  assert.deepEqual(parseTarget("@sign-in"), { kind: "id", id: "sign-in" });
  for (const bad of ["@", "@Sign", "@a--b", "@-a", "@a b"]) {
    assert.equal(thrown(() => parseTarget(bad)).code, "invalid_args");
  }
});

test("isSemanticToken routes only the extended grammar", () => {
  assert.equal(isSemanticToken("click:@a"), true);
  assert.equal(isSemanticToken("fill:@a=x"), true);
  assert.equal(isSemanticToken("flow:find"), true);
  assert.equal(isSemanticToken("click:e1"), false);
  assert.equal(isSemanticToken("fill:e1=x"), false);
});

test("parseSemanticAct", () => {
  assert.deepEqual(parseSemanticAct("click:@go"), { kind: "click", id: "go" });
  assert.deepEqual(parseSemanticAct("fill:@q=a=b c"), { kind: "fill", id: "q", text: "a=b c" });
  assert.deepEqual(parseSemanticAct("flow:find"), { kind: "flow", flowId: "find" });
  for (const bad of ["fill:@q", "fill:@q=", "fill:@Q=x", "click:@", "flow:", "flow:Bad", "click:e1"]) {
    assert.equal(thrown(() => parseSemanticAct(bad)).code, "invalid_args");
  }
  assertNoSecret(thrown(() => parseSemanticAct(`fill:@Q=${SECRET}`)));
  assertNoSecret(thrown(() => parseSemanticAct(`fill:@q${SECRET}`)));
});

test("parseFlowInputs", () => {
  assert.deepEqual(parseFlowInputs(["a=1", "b=x=y", "c="]), { a: "1", b: "x=y", c: "" });
  assert.equal(thrown(() => parseFlowInputs(["a=1", "a=2"])).code, "invalid_args");
  assert.equal(thrown(() => parseFlowInputs(["=v"])).code, "invalid_args");
  const bare = thrown(() => parseFlowInputs([SECRET]));
  assert.equal(bare.code, "invalid_args");
  assertNoSecret(bare);
  assertNoSecret(thrown(() => parseFlowInputs([`=${SECRET}`])));
});

test("resolveTarget: field, action, link", () => {
  const field = resolveTarget(search, "q", "fill");
  assert.equal(field.kind, "field");
  assert.deepEqual(field.locator, loc("searchbox", "Query"));
  const action = resolveTarget(search, "go", "click");
  assert.equal(action.kind, "action");
  assert.equal(action.locator.occurrence, 1);
  assert.equal(action.requiresSensitive, false);
  const link = resolveTarget(search, "home", "click");
  assert.equal(link.kind, "link");
  assert.equal(link.role, "link");
});

test("resolveTarget: targets inside action opensBranch", () => {
  const baseAction = search.actions[0];
  assert.ok(baseAction);
  const withBranch: Screen = {
    ...search,
    actions: [
      {
        ...baseAction,
        opens: {
          id: "modal",
          type: "dialog",
          title: "Search Options",
          fields: [
            {
              id: "filter-tag",
              role: "textbox",
              name: "Tag",
              nameSource: "label",
              sensitive: false,
              agentFillable: true,
              locator: loc("textbox", "Tag"),
            },
          ],
          actions: [
            {
              id: "apply-filters",
              role: "button",
              name: "Apply",
              kind: "submit",
              effect: "submit",
              locator: loc("button", "Apply"),
            },
          ],
        },
      },
    ],
  };
  const nestedField = resolveTarget(withBranch, "filter-tag", "fill");
  assert.equal(nestedField.kind, "field");
  assert.equal(nestedField.id, "filter-tag");

  const nestedAction = resolveTarget(withBranch, "apply-filters", "click");
  assert.equal(nestedAction.kind, "action");
  assert.equal(nestedAction.id, "apply-filters");
});

test("resolveTarget: error codes", () => {
  assert.equal(thrown(() => resolveTarget(search, "nope", "click")).code, "unknown_target");
  const fillAction = thrown(() => resolveTarget(search, "go", "fill"));
  assert.equal(fillAction.code, "invalid_args");
  assert.equal(fillAction.message, "cannot fill action @go");
  assert.equal(thrown(() => resolveTarget(search, "home", "fill")).code, "invalid_args");
  assert.equal(thrown(() => resolveTarget(search, "q", "click")).code, "invalid_args");
});

test("unknown_target hint lists ids and truncates", () => {
  const hint = thrown(() => resolveTarget(search, "nope", "click")).hint ?? "";
  assert.match(hint, /@q, @go, @home/);
  const many: Screen = {
    ...search,
    links: Array.from({ length: 30 }, (_, i) => ({
      id: `l${i.toString()}`,
      name: "n",
      href: "/",
      external: false,
      locator: loc("link", "n", i),
    })),
  };
  const long = thrown(() => resolveTarget(many, "nope", "click")).hint ?? "";
  assert.match(long, /12 more omitted/);
  assert.ok(!long.includes("@l29"));
});

test("demo-app: sensitive gate", async () => {
  const demo = await demoScreen();
  const refusal = thrown(() => resolveTarget(demo, "password", "fill"));
  assert.equal(refusal.code, "sensitive_target");
  assert.equal(refusal.message, "refusing to fill sensitive field @password");
  assert.equal(refusal.hint, "the user must fill it by hand; the agent never types credentials");
  assert.equal(resolveTarget(demo, "email", "fill").id, "email");
  assert.equal(resolveTarget(demo, "sign-in", "click").requiresSensitive, true);
  assert.equal(resolveTarget(demo, "show-password", "click").requiresSensitive, false);
});

test("agentFillable=false alone is refused", () => {
  const locked: Screen = {
    ...search,
    fields: search.fields.map((f) => ({ ...f, agentFillable: false })),
  };
  assert.equal(thrown(() => resolveTarget(locked, "q", "fill")).code, "sensitive_target");
});

test("resolveFlow: valid flow on non-humanOnly screen", () => {
  const flow = resolveFlow(search, "find", { q: "hello" });
  assert.equal(flow.id, "find");
  assert.equal(flow.steps.length, 2);
  const [first, second] = flow.steps;
  assert.ok(first?.op === "fill");
  assert.equal(first.text, "hello");
  assert.deepEqual(first.target.locator, loc("searchbox", "Query"));
  assert.ok(second?.op === "click");
  assert.deepEqual(second.target.locator, loc("button", "Search", 1));
});

test("resolveFlow: unknown flow; humanOnly refuses before validation", async () => {
  assert.equal(thrown(() => resolveFlow(search, "nope", {})).code, "unknown_target");
  const demo = await demoScreen();
  for (const inputs of [{ password: SECRET }, { bogus: SECRET, password: SECRET }, {}]) {
    const error = thrown(() => resolveFlow(demo, "login", inputs as Record<string, string>));
    assert.equal(error.code, "sensitive_target");
    assert.match(error.message, /human-only/);
    assertNoSecret(error);
  }
});

test("resolveFlow: invalid inputs list paths only", () => {
  const missing = thrown(() => resolveFlow(search, "find", {}));
  assert.equal(missing.code, "invalid_args");
  assert.match(missing.hint ?? "", /\/q/);
  const extra = thrown(() => resolveFlow(search, "find", { q: SECRET, other: SECRET }));
  assert.equal(extra.code, "invalid_args");
  assert.match(extra.hint ?? "", /\/other/);
  assertNoSecret(extra);
  const empty = thrown(() => resolveFlow(search, "find", { q: "" }));
  assert.match(empty.hint ?? "", /\/q/);
});

test("resolveFlow: fill step bound to a sensitive field is refused", () => {
  const bad: Screen = {
    ...search,
    fields: search.fields.map((f) => ({ ...f, sensitive: true, agentFillable: false })),
  };
  const error = thrown(() => resolveFlow(bad, "find", { q: SECRET }));
  assert.equal(error.code, "sensitive_target");
  assertNoSecret(error);
});

test("describeResolved omits values", async () => {
  const demo = await demoScreen();
  const line = describeResolved(resolveTarget(demo, "sign-in", "click"), "click");
  assert.match(line, /click @sign-in: button "Sign in"/);
  assert.match(line, /occurrence 0/);
  assert.match(line, /sensitive/);
  assert.equal(
    describeResolved(resolveTarget(search, "q", "fill"), "fill"),
    'fill @q: searchbox "Query" (field, occurrence 0)',
  );
});
