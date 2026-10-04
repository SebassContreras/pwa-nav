// Tests for src/screen-map.ts (spec 005 T001-T003). Run with `pnpm test`.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { fingerprintOf, loadScreenMap, ScreenMapError, validateScreenMap } from "./screen-map.js";
import type { ScreenMap } from "./screen-map.js";

const EXAMPLE = fileURLToPath(new URL("../../examples/screens/demo-app.screens.json", import.meta.url));

async function example(): Promise<ScreenMap> {
  return JSON.parse(await readFile(EXAMPLE, "utf8")) as ScreenMap;
}

function clone(map: ScreenMap): ScreenMap {
  return JSON.parse(JSON.stringify(map)) as ScreenMap;
}

async function issuesOf(map: unknown): Promise<string> {
  try {
    await validateScreenMap(map);
  } catch (error) {
    assert.ok(error instanceof ScreenMapError);
    return error.issues.map((issue) => `${issue.path}: ${issue.message}`).join("\n");
  }
  return "";
}

describe("screen map", () => {
  it("accepts the committed example map", async () => {
    const map = await loadScreenMap(EXAMPLE);
    assert.equal(map.app.id, "demo-app");
    assert.equal(map.screens[0]?.id, "login");
  });

  it("accepts every *.screens.json under examples/ and screens/", async () => {
    let checked = 0;
    for (const folder of ["../../examples/screens/", "../../screens/"]) {
      const dir = fileURLToPath(new URL(folder, import.meta.url));
      const names = await readdir(dir).catch(() => [] as string[]);
      for (const name of names.filter((entry) => entry.endsWith(".screens.json"))) {
        await loadScreenMap(`${dir}${name}`);
        checked += 1;
      }
    }
    assert.ok(checked > 0);
  });

  it("rejects a schema violation with its path", async () => {
    const map = await example();
    (map.app as { origin: string }).origin = "localhost:5173";
    assert.match(await issuesOf(map), /\/app\/origin/);
  });

  it("rejects an external link that keeps a path, query or fragment", async () => {
    const map = clone(await example());
    const help = map.screens[0]?.links.find((link) => link.id === "help-center");
    assert.ok(help);
    help.href = "https://help.example.com/articles/42?ref=login";
    assert.match(await issuesOf(map), /external href must be an origin only/);
  });

  it("rejects unknown properties", async () => {
    const map = await example();
    (map as unknown as Record<string, unknown>)["extra"] = true;
    assert.match(await issuesOf(map), /additional properties/);
  });

  it("rejects a sensitive field the agent may fill", async () => {
    const map = clone(await example());
    const password = map.screens[0]?.fields.find((field) => field.id === "password");
    assert.ok(password);
    password.agentFillable = true;
    assert.match(await issuesOf(map), /sensitive field must have agentFillable=false/);
  });

  it("rejects a flow that touches a sensitive field without humanOnly", async () => {
    const map = clone(await example());
    const flow = map.screens[0]?.flows[0];
    assert.ok(flow);
    flow.humanOnly = false;
    assert.match(await issuesOf(map), /must be humanOnly/);
  });

  it("rejects a flow step whose target does not exist", async () => {
    const map = clone(await example());
    map.screens[0]?.flows[0]?.steps.push({ op: "click", target: "@missing" });
    assert.match(await issuesOf(map), /"@missing" does not exist/);
  });

  it("rejects clicking a field and filling an action", async () => {
    const map = clone(await example());
    map.screens[0]?.flows[0]?.steps.push(
      { op: "click", target: "@email" },
      { op: "fill", target: "@sign-in", from: "email" },
    );
    const issues = await issuesOf(map);
    assert.match(issues, /cannot click field "@email"/);
    assert.match(issues, /cannot fill action "@sign-in"/);
  });

  it("rejects an action that requires an unknown field", async () => {
    const map = clone(await example());
    const submit = map.screens[0]?.actions.find((action) => action.id === "sign-in");
    assert.ok(submit);
    submit.requires = ["nope"];
    assert.match(await issuesOf(map), /requires unknown field "nope"/);
  });

  it("rejects an id shared by two targets on one screen", async () => {
    const map = clone(await example());
    const link = map.screens[0]?.links[0];
    assert.ok(link);
    link.id = "sign-in";
    assert.match(await issuesOf(map), /id "sign-in" is used by more than one target/);
  });

  it("detects drift: fingerprint no longer matches the declared elements", async () => {
    const map = clone(await example());
    const submit = map.screens[0]?.actions.find((action) => action.id === "sign-in");
    assert.ok(submit);
    submit.name = "Log in";
    assert.match(await issuesOf(map), /fingerprint: does not match/);
  });

  it("accepts a valid journey", async () => {
    const map = clone(await example());
    map.journeys = [
      {
        id: "login-journey",
        description: "Test login flow",
        steps: [
          {
            screenId: "login",
            action: "@sign-in",
          },
        ],
      },
    ];
    assert.equal(await issuesOf(map), "");
  });

  it("rejects duplicate journey ids", async () => {
    const map = clone(await example());
    map.journeys = [
      { id: "j1", description: "First", steps: [{ screenId: "login", action: "@sign-in" }] },
      { id: "j1", description: "Duplicate", steps: [{ screenId: "login", action: "@sign-in" }] },
    ];
    assert.match(await issuesOf(map), /duplicate journey id "j1"/);
  });

  it("rejects journey steps with unknown screenId or expectScreen", async () => {
    const map = clone(await example());
    map.journeys = [
      {
        id: "j-bad",
        description: "Bad journey",
        steps: [
          {
            screenId: "nonexistent-screen",
            action: "@click-me",
            expectScreen: "also-missing",
          },
        ],
      },
    ];
    const issues = await issuesOf(map);
    assert.match(issues, /screenId "nonexistent-screen" does not exist in screens/);
    assert.match(issues, /expectScreen "also-missing" does not exist in screens/);
  });

  it("accepts an action with an opensBranch and includes nested elements", async () => {
    const map = clone(await example());
    const action = map.screens[0]?.actions[0];
    assert.ok(action);
    action.opens = {
      id: "post-modal",
      type: "dialog",
      title: "Crear publicación",
      fields: [
        {
          id: "editor-post",
          role: "textbox",
          name: "¿De qué quieres hablar?",
          nameSource: "placeholder",
          sensitive: false,
          agentFillable: true,
          locator: { role: "textbox", name: "¿De qué quieres hablar?" },
        },
      ],
      actions: [
        {
          id: "btn-publicar",
          role: "button",
          name: "Publicar",
          kind: "submit",
          effect: "submit",
          locator: { role: "button", name: "Publicar" },
        },
      ],
    };
    const firstScreen = map.screens[0];
    assert.ok(firstScreen);
    // Recompute fingerprint to verify that screenElements includes the nested branch
    firstScreen.fingerprint = fingerprintOf(
      (await import("./screen-map.js")).screenElements(firstScreen),
    );
    assert.equal(await issuesOf(map), "");
  });

  it("rejects duplicate ids inside opensBranch", async () => {
    const map = clone(await example());
    const action = map.screens[0]?.actions[0];
    assert.ok(action);
    action.opens = {
      id: "dup-modal",
      type: "dialog",
      title: "Modal",
      fields: [
        {
          id: action.id, // Reusing existing action id
          role: "textbox",
          name: "Conflict",
          nameSource: "label",
          sensitive: false,
          agentFillable: true,
          locator: { role: "textbox", name: "Conflict" },
        },
      ],
    };
    const issues = await issuesOf(map);
    assert.match(issues, new RegExp(`id "${action.id}" is used by more than one target`));
  });
});

describe("fingerprintOf", () => {
  it("ignores element order", () => {
    const a = [
      { role: "button", name: "Ok" },
      { role: "link", name: "Help" },
    ];
    assert.equal(fingerprintOf(a), fingerprintOf([...a].reverse()));
  });

  it("changes when a name changes", () => {
    assert.notEqual(
      fingerprintOf([{ role: "button", name: "Ok" }]),
      fingerprintOf([{ role: "button", name: "OK" }]),
    );
  });

  it("orders by code point, not locale", () => {
    // "é" (U+00E9) sorts after "z" (U+007A) by code point; localeCompare would put it before.
    const actual = fingerprintOf([
      { role: "button", name: "é" },
      { role: "button", name: "z" },
    ]);
    const expected = `sha256:${createHash("sha256").update("button\tz\nbutton\té", "utf8").digest("hex")}`;
    assert.equal(actual, expected);
  });
});
