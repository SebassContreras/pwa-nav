import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadScreenMap, type Screen, type ScreenMap } from "../screen-map.js";
import { renderMapSummary, renderScreenView, renderUnmappedHint } from "../screen-view.js";

const demoMapPath = fileURLToPath(new URL("../../../examples/screens/demo-app.screens.json", import.meta.url));
// Compiled to dist/, so the fixtures resolve from the repo root.
const viewsDir = new URL("../../../checks/fixtures/views/", import.meta.url);

async function demo(): Promise<{ map: ScreenMap; login: Screen }> {
  const map = await loadScreenMap(demoMapPath);
  const login = map.screens.find((s) => s.id === "login");
  assert.ok(login);
  return { map, login };
}

function locator(role: string, name: string): { role: string; name: string; occurrence: number } {
  return { role, name, occurrence: 0 };
}

function base(overrides: Partial<Screen> = {}): Screen {
  return {
    id: "s",
    route: "/s",
    title: "S",
    access: "public",
    fingerprint: "sha256:0123456789abcdef",
    observedAt: "2026-10-01T00:00:00Z",
    fields: [],
    actions: [],
    links: [],
    flows: [],
    ...overrides,
  };
}

function field(id: string, name: string, sensitive = false, agentFillable = true): Screen["fields"][number] {
  return {
    id,
    role: "textbox",
    name,
    nameSource: "label",
    sensitive,
    agentFillable,
    locator: locator("textbox", name),
  };
}

test("demo login view matches the golden file", async () => {
  const { login } = await demo();
  const golden = (await readFile(new URL("demo-login.view.txt", viewsDir), "utf8"))
    .replace(/\r\n/g, "\n")
    .replace(/\n$/, "");
  assert.equal(renderScreenView(login), golden);
});

test("demo login view is shorter than its JSON entry", async () => {
  const { login } = await demo();
  assert.ok(renderScreenView(login).length < JSON.stringify(login, null, 2).length);
});

test("sensitive and non-fillable fields get the marker", () => {
  const out = renderScreenView(
    base({ fields: [field("a", "a", true, false), field("b", "b", false, false), field("c", "c")] }),
  );
  assert.equal(
    out.split("\n")[1],
    'fields: @a textbox "a" SENSITIVE(human) | @b textbox "b" SENSITIVE(human) | @c textbox "c"',
  );
});

test("needs() and submit marker", () => {
  const action = (
    id: string,
    effect: "none" | "ui-state" | "submit",
    requires?: string[],
  ): Screen["actions"][number] => ({
    id,
    role: "button",
    name: id,
    kind: "button",
    effect,
    ...(requires === undefined ? {} : { requires }),
    locator: locator("button", id),
  });
  const out = renderScreenView(
    base({ actions: [action("go", "submit", ["x", "y"]), action("t", "ui-state"), action("n", "none", [])] }),
  );
  assert.equal(
    out.split("\n")[1],
    'actions: @go button "go" needs(@x,@y) submit | @t button "t" | @n button "n"',
  );
});

test("links: internal href, external host only", () => {
  const link = (id: string, href: string, external: boolean): Screen["links"][number] => ({
    id,
    name: id,
    href,
    external,
    locator: locator("link", id),
  });
  const out = renderScreenView(
    base({ links: [link("in", "/a/b", false), link("out", "https://help.example.com:8443", true)] }),
  );
  assert.equal(out.split("\n")[1], "links: @in -> /a/b | @out -> external help.example.com:8443");
});

test("flows: humanOnly vs inputs", () => {
  const flow = (id: string, humanOnly: boolean, required: string[]): Screen["flows"][number] => ({
    id,
    description: "d",
    humanOnly,
    inputSchema: { type: "object", required },
    steps: [],
  });
  const out = renderScreenView(
    base({ flows: [flow("h", true, ["p"]), flow("r", false, ["q", "w"]), flow("e", false, [])] }),
  );
  assert.equal(out.split("\n")[1], "flows: h HUMAN-ONLY | r inputs(q,w) | e inputs()");
});

test("a11y line", () => {
  const out = renderScreenView(
    base({
      a11y: [
        { code: "name-from-placeholder-only", target: "@p", detail: "x" },
        { code: "duplicate-name", target: "@q", detail: "y" },
      ],
    }),
  );
  assert.equal(out.split("\n")[1], "a11y: @p name-from-placeholder-only | @q duplicate-name");
});

test("empty groups are omitted", () => {
  assert.equal(renderScreenView(base()), "s /s public fp:01234567");
});

test("hostile names are escaped and truncated", () => {
  const hostile = renderScreenView(base({ fields: [field("f", 'say "hi"\nnow\u0007\\')] }));
  assert.equal(hostile.split("\n")[1], 'fields: @f textbox "say \\"hi\\"\\nnow\\u0007\\\\"');
  const long = renderScreenView(base({ fields: [field("f", "x".repeat(200))] }));
  assert.equal(long.split("\n").length, 2);
  assert.equal(long.split("\n")[1], `fields: @f textbox "${"x".repeat(59)}…"`);
  const short = renderScreenView(base({ fields: [field("f", "abcdef")] }), { maxNameLength: 4 });
  assert.equal(short.split("\n")[1], 'fields: @f textbox "abc…"');
});

test("render does not mutate input and has no trailing newline", async () => {
  const { login } = await demo();
  const before = JSON.stringify(login);
  const out = renderScreenView(login);
  assert.equal(JSON.stringify(login), before);
  assert.ok(!out.endsWith("\n"));
});

test("unmapped hint points to snapshot --learn", () => {
  const hint = renderUnmappedHint("/x", "http://localhost:8080");
  assert.match(hint, /snapshot --learn/);
  assert.ok(hint.split("\n").length <= 2);
});

test("map summary lists screens and unmapped entries", async () => {
  const { map } = await demo();
  const lines = renderMapSummary(map).split("\n");
  assert.equal(lines[0], 'app: demo-app "Demo App" http://localhost:8080 locale:en');
  assert.match(lines[1] ?? "", /^login \/login public fp:[0-9a-f]{8}$/);
  assert.equal(lines[2], "unmapped: /forgot-password link-only | * requires-login");
});
