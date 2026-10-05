import assert from "node:assert/strict";
import { test } from "node:test";
import { PwaNavError } from "../../core/errors.js";
import type { Screen, ScreenMap, Journey } from "../screen-map.js";
import {
  interpolateTemplate,
  interpolateStepInputs,
  validateJourneyInputs,
  findJourney,
  resolveJourneyStep,
  describeJourneyPlan,
} from "../screen-journey.js";

function loc(role: string, name: string, occurrence = 0) {
  return { role, name, occurrence };
}

const homeScreen: Screen = {
  id: "home",
  route: "/",
  title: "Home",
  access: "public",
  fingerprint: `sha256:${"0".repeat(64)}`,
  observedAt: "2026-10-01T00:00:00Z",
  fields: [
    {
      id: "search-box",
      role: "searchbox",
      name: "Search products",
      nameSource: "label",
      sensitive: false,
      agentFillable: true,
      locator: loc("searchbox", "Search products"),
    },
    {
      id: "secret-code",
      role: "textbox",
      name: "Secret Code",
      nameSource: "label",
      sensitive: true,
      agentFillable: false,
      locator: loc("textbox", "Secret Code"),
    },
  ],
  actions: [
    {
      id: "search-btn",
      role: "button",
      name: "Search",
      kind: "submit",
      effect: "submit",
      locator: loc("button", "Search"),
    },
  ],
  links: [{ id: "cart-link", name: "Cart", href: "/cart", external: false, locator: loc("link", "Cart") }],
  flows: [
    {
      id: "quick-search",
      description: "Quick search",
      humanOnly: false,
      inputSchema: {
        type: "object",
        required: ["query"],
        properties: {
          query: { type: "string" },
        },
      },
      steps: [
        { op: "fill", target: "@search-box", from: "query" },
        { op: "click", target: "@search-btn" },
      ],
    },
  ],
};

const resultsScreen: Screen = {
  id: "search-results",
  route: "/search?q=:query",
  title: "Search Results",
  access: "public",
  fingerprint: `sha256:${"1".repeat(64)}`,
  observedAt: "2026-10-01T00:00:00Z",
  fields: [],
  actions: [
    {
      id: "first-item",
      role: "button",
      name: "Add First Item",
      kind: "button",
      effect: "none",
      locator: loc("button", "Add First Item"),
    },
  ],
  links: [],
  flows: [],
};

const sampleJourney: Journey = {
  id: "search-and-pick",
  description: "Search products and select first item",
  inputSchema: {
    type: "object",
    required: ["query"],
    properties: {
      query: { type: "string" },
    },
  },
  steps: [
    {
      screenId: "home",
      action: "flow:quick-search",
      inputs: { query: "${inputs.query}" },
      expectScreen: "search-results",
    },
    {
      screenId: "search-results",
      action: "click:@first-item",
    },
  ],
};

const humanJourney: Journey = {
  id: "human-checkout",
  description: "Human checkout flow",
  humanOnly: true,
  steps: [
    {
      screenId: "home",
      action: "click:@cart-link",
    },
  ],
};

const sampleMap: ScreenMap = {
  schemaVersion: "2026-03",
  app: {
    id: "shop",
    name: "Shop App",
    origin: "https://shop.example.com",
    locale: "en-US",
    learnedAt: "2026-10-01T00:00:00Z",
  },
  screens: [homeScreen, resultsScreen],
  journeys: [sampleJourney, humanJourney],
};

test("interpolateTemplate replaces variables and handles missing keys", () => {
  const result1 = interpolateTemplate("Hello ${name}, welcome to ${inputs.place}!", {
    name: "Alice",
    place: "Wonderland",
  });
  assert.equal(result1, "Hello Alice, welcome to Wonderland!");

  assert.throws(
    () => interpolateTemplate("Hello ${name} and ${other}", { name: "Bob" }),
    (err: unknown) => {
      assert(err instanceof PwaNavError);
      assert.equal(err.code, "invalid_args");
      assert.match(err.message, /missing input variable "other"/);
      return true;
    },
  );

  assert.throws(
    () => interpolateTemplate("Value is ${val}", { val: null }),
    (err: unknown) => {
      assert(err instanceof PwaNavError);
      assert.equal(err.code, "invalid_args");
      assert.match(err.message, /null or undefined/);
      return true;
    },
  );
});

test("interpolateStepInputs maps and interpolates variables", () => {
  const inputs = { query: "sneakers", page: 2 };
  const stepInputs = { term: "${query}", count: 10 };
  const result = interpolateStepInputs(stepInputs, inputs);
  assert.deepEqual(result, { term: "sneakers", count: "10" });

  const defaulted = interpolateStepInputs(undefined, inputs);
  assert.deepEqual(defaulted, { query: "sneakers", page: "2" });
});

test("validateJourneyInputs checks schemas and humanOnly gate", () => {
  const valid = validateJourneyInputs(sampleJourney, { query: "shoes" });
  assert.deepEqual(valid, { query: "shoes" });

  assert.throws(
    () => validateJourneyInputs(sampleJourney, {}),
    (err: unknown) => {
      assert(err instanceof PwaNavError);
      assert.equal(err.code, "invalid_args");
      assert.match(err.hint ?? "", /failing properties/);
      return true;
    },
  );

  assert.throws(
    () => validateJourneyInputs(humanJourney, {}),
    (err: unknown) => {
      assert(err instanceof PwaNavError);
      assert.equal(err.code, "sensitive_target");
      return true;
    },
  );
});

test("findJourney locates journey or throws unknown_target with hint", () => {
  const j = findJourney(sampleMap, "search-and-pick");
  assert.equal(j.id, "search-and-pick");

  assert.throws(
    () => findJourney(sampleMap, "non-existent"),
    (err: unknown) => {
      assert(err instanceof PwaNavError);
      assert.equal(err.code, "unknown_target");
      assert.match(err.hint ?? "", /search-and-pick/);
      return true;
    },
  );
});

test("resolveJourneyStep handles flow, click, fill, and @target forms", () => {
  // flow action
  const step1 = sampleJourney.steps[0];
  assert(step1 !== undefined);
  const resolvedFlow = resolveJourneyStep(homeScreen, step1, { query: "boots" });
  assert.equal(resolvedFlow.screenId, "home");
  assert.equal(resolvedFlow.expectScreen, "search-results");
  assert.equal(resolvedFlow.actionSummary, "flow:quick-search");
  assert.equal(resolvedFlow.resolvedSteps.length, 2);
  const flowFirst = resolvedFlow.resolvedSteps[0];
  assert(flowFirst !== undefined && flowFirst.op === "fill");
  assert.equal(flowFirst.text, "boots");

  // click:@target
  const step2 = sampleJourney.steps[1];
  assert(step2 !== undefined);
  const resolvedClick = resolveJourneyStep(resultsScreen, step2, {});
  assert.equal(resolvedClick.screenId, "search-results");
  assert.equal(resolvedClick.resolvedSteps.length, 1);
  const clickFirst = resolvedClick.resolvedSteps[0];
  assert(clickFirst !== undefined && clickFirst.op === "click");
  assert.equal(clickFirst.target.id, "first-item");

  // fill:@target=value with interpolation
  const resolvedFill = resolveJourneyStep(
    homeScreen,
    { screenId: "home", action: "fill:@search-box=${inputs.term}" },
    { term: "hats" },
  );
  const fillFirst = resolvedFill.resolvedSteps[0];
  assert(fillFirst !== undefined && fillFirst.op === "fill");
  assert.equal(fillFirst.text, "hats");

  // fill:@target without = (reads from inputs)
  const resolvedFillBare = resolveJourneyStep(
    homeScreen,
    { screenId: "home", action: "fill:@search-box", inputs: { "search-box": "jackets" } },
    {},
  );
  const fillBareFirst = resolvedFillBare.resolvedSteps[0];
  assert(fillBareFirst !== undefined && fillBareFirst.op === "fill");
  assert.equal(fillBareFirst.text, "jackets");

  // bare @target for link or action (click)
  const resolvedBareClick = resolveJourneyStep(homeScreen, { screenId: "home", action: "@cart-link" }, {});
  const bareClickFirst = resolvedBareClick.resolvedSteps[0];
  assert(bareClickFirst !== undefined && bareClickFirst.op === "click");

  // bare @target for field (fill)
  const resolvedBareFill = resolveJourneyStep(
    homeScreen,
    { screenId: "home", action: "@search-box", inputs: { value: "gloves" } },
    {},
  );
  const bareFillFirst = resolvedBareFill.resolvedSteps[0];
  assert(bareFillFirst !== undefined && bareFillFirst.op === "fill");
  assert.equal(bareFillFirst.text, "gloves");

  // screen mismatch
  assert.throws(
    () => resolveJourneyStep(homeScreen, { screenId: "search-results", action: "click:@first-item" }, {}),
    (err: unknown) => {
      assert(err instanceof PwaNavError);
      assert.equal(err.code, "invalid_args");
      assert.match(err.message, /cannot resolve step for screen "search-results" against current screen "home"/);
      return true;
    },
  );

  // sensitive target fill refused
  assert.throws(
    () =>
      resolveJourneyStep(
        homeScreen,
        { screenId: "home", action: "fill:@secret-code=1234" },
        {},
      ),
    (err: unknown) => {
      assert(err instanceof PwaNavError);
      assert.equal(err.code, "sensitive_target");
      return true;
    },
  );
});

test("describeJourneyPlan formats steps without leaking secret text values", () => {
  const journey: Journey = {
    id: "test-journey",
    description: "A test journey",
    steps: [
      { screenId: "home", action: "fill:@search-box=very-private-search-term", expectScreen: "search-results" },
      { screenId: "search-results", action: "click:@first-item" },
    ],
  };

  const plan = describeJourneyPlan(sampleMap, journey, {});
  assert.equal(plan.length, 3);
  assert(plan[0] !== undefined);
  assert(plan[1] !== undefined);
  assert(plan[2] !== undefined);
  assert.match(plan[0], /journey "test-journey"/);
  assert.match(plan[1], /Step 1 \[home\]: fill @search-box \[fill @search-box\] -> expectScreen: search-results/);
  assert.doesNotMatch(plan[1], /very-private-search-term/);
  assert.match(plan[2], /Step 2 \[search-results\]: click @first-item \[click @first-item\]/);
});
