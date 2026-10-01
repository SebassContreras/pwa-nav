import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { RawElement } from "./browser/collector.js";
import { PwaNavError } from "./errors.js";
import { learnScreen } from "./screen-learn.js";
import { diffScreens, isEmptyDiff, mergeIntoMap, mergeScreen } from "./screen-merge.js";
import { validateScreenMap, type Screen, type ScreenMap } from "./screen-map.js";

const readJson = (rel: string): unknown => JSON.parse(readFileSync(new URL(`../${rel}`, import.meta.url), "utf8"));
const golden = readJson("checks/fixtures/login.golden.json") as RawElement[];
const demo = readJson("examples/screens/demo-app.screens.json") as ScreenMap;
const PAGE = { url: "http://localhost:8080/login", title: "Demo App", appOrigin: "http://localhost:8080" };
const APP = { id: "demo-app", name: "Demo App", origin: "http://localhost:8080", locale: "en" };
const LATER = new Date("2027-01-02T03:04:05.678Z");

const stored = (): Screen => structuredClone(demo.screens[0] as Screen);
const learn = (raw: readonly RawElement[], title = PAGE.title): Screen =>
  learnScreen(raw, { ...PAGE, title }, { now: LATER, access: "public" });
const rename = (from: string, to: string): RawElement[] => golden.map((e) => (e.name === from ? { ...e, name: to } : e));
const el = (role: string, name: string, extra: Partial<RawElement> = {}): RawElement => ({
  role,
  name,
  nameSource: "content",
  occurrence: 0,
  ...extra,
});
const ids = (s: Screen): string[] => [...s.fields, ...s.actions, ...s.links].map((e) => e.id);

test("re-learning the committed demo screen is an empty, deep-equal merge", () => {
  const existing = stored();
  const learned = learnScreen(golden, PAGE, { now: LATER, access: "public" });
  const diff = diffScreens(existing, learned);
  assert.ok(isEmptyDiff(diff), JSON.stringify(diff));
  const merged = mergeScreen(existing, learned, { now: LATER });
  assert.deepEqual(merged.screen, existing);
  assert.equal(merged.screen.observedAt, "2026-10-01T10:40:36Z");
});

test("rename keeps the id and reports old -> new fingerprint drift", () => {
  const existing = stored();
  const learned = learn(rename("Sign in", "Log in"));
  const { screen, diff } = mergeScreen(existing, learned, { now: LATER });
  assert.deepEqual(diff.renamed, [
    { group: "action", id: "sign-in", from: { name: "Sign in", role: "button" }, to: { name: "Log in", role: "button" } },
  ]);
  assert.deepEqual(diff.added, []);
  assert.deepEqual(diff.missing, []);
  assert.equal(diff.fingerprint.drifted, true);
  assert.equal(diff.fingerprint.stored, existing.fingerprint);
  assert.equal(diff.fingerprint.live, learned.fingerprint);
  const action = screen.actions.find((a) => a.id === "sign-in");
  assert.equal(action?.name, "Log in");
  assert.equal(action.locator.name, "Log in");
  assert.deepEqual(action.requires, ["email", "password"]);
  assert.deepEqual(ids(screen), ids(existing));
  assert.equal(screen.fingerprint, learned.fingerprint);
  assert.equal(screen.observedAt, "2027-01-02T03:04:05Z");
  assert.deepEqual(screen.flows, existing.flows);
});

test("two unmatched elements of one role are not paired (added + missing)", () => {
  const raw = golden.map((e) => (e.role === "link" ? { ...e, name: `${e.name}!` } : e));
  const { diff, screen } = mergeScreen(stored(), learn(raw), { now: LATER });
  assert.equal(diff.renamed.length, 0);
  assert.deepEqual(diff.missing.map((m) => m.id), ["forgot-password", "help-center"]);
  assert.equal(diff.added.length, 2);
  assert.equal(screen.links.length, 4);
});

test("added element gets a fresh id unique across groups", async () => {
  const raw = [...golden, el("link", "Email", { href: "/e" }), el("textbox", "Phone")];
  const { screen, diff } = mergeScreen(stored(), learn(raw), { now: LATER });
  assert.deepEqual(diff.added.map((a) => [a.group, a.id]), [["field", "phone"], ["link", "email-2"]]);
  assert.equal(new Set(ids(screen)).size, ids(screen).length);
  assert.equal(screen.links.at(-1)?.id, "email-2");
  assert.equal(screen.fields.at(-1)?.id, "phone");
  await validateScreenMap({ ...demo, screens: [screen] });
});

test("missing is kept; prune removes it", async () => {
  const raw = golden.filter((e) => e.name !== "Help center");
  const kept = mergeScreen(stored(), learn(raw), { now: LATER });
  assert.deepEqual(kept.diff.missing.map((m) => m.id), ["help-center"]);
  assert.ok(kept.screen.links.some((l) => l.id === "help-center"));
  assert.equal(kept.diff.fingerprint.drifted, true);
  assert.deepEqual(kept.screen, stored());
  const pruned = mergeScreen(stored(), learn(raw), { now: LATER, prune: true });
  assert.ok(!pruned.screen.links.some((l) => l.id === "help-center"));
  assert.equal(pruned.screen.fingerprint, learn(raw).fingerprint);
  await validateScreenMap({ ...demo, screens: [pruned.screen] });
});

test("prune is blocked by flow and requires references, changing nothing", () => {
  const existing = stored();
  const before = structuredClone(existing);
  const noEmail = golden.filter((e) => e.name !== "Email");
  assert.throws(
    () => mergeScreen(existing, learn(noEmail), { prune: true }),
    (e: unknown) =>
      e instanceof PwaNavError && e.code === "invalid_args" && /cannot prune @email: used by flow login, action sign-in/.test(e.message),
  );
  assert.deepEqual(existing, before);
  // Unreferenced by flows, still required by the action.
  const lone = stored();
  lone.flows = [];
  assert.throws(() => mergeScreen(lone, learn(noEmail), { prune: true }), /used by action sign-in/);
  assert.doesNotThrow(() => mergeScreen(existing, learn(noEmail)));
});

test("sensitive only escalates and humanOnly follows", () => {
  const existing = stored();
  const field = existing.fields[0];
  assert.ok(field);
  // Learned says not sensitive for the password: stored sensitive stays.
  const relaxed = golden.map((e) => (e.name === "Password" ? { ...e, inputType: "text", autocomplete: "off", name: "Password" } : e));
  const keep = mergeScreen(existing, learn(relaxed), { now: LATER });
  assert.equal(keep.screen.fields[1]?.sensitive, true);
  assert.equal(keep.screen.fields[1].agentFillable, false);
  // Learned says sensitive for the email: escalates; the flow already humanOnly.
  const escalated = golden.map((e) => (e.name === "Email" ? { ...e, inputType: "password" } : e));
  const up = mergeScreen(existing, learn(escalated), { now: LATER });
  assert.equal(up.screen.fields[0]?.sensitive, true);
  assert.equal(up.screen.fields[0].agentFillable, false);
  assert.ok(up.diff.changed.some((c) => c.id === "email" && c.field === "sensitive" && c.from === false && c.to === true));
  // A non-humanOnly flow touching a newly sensitive field becomes humanOnly.
  const open = stored();
  const [flow] = open.flows;
  assert.ok(flow);
  flow.humanOnly = false;
  flow.steps = [{ op: "fill", target: "@email", from: "email" }];
  const forced = mergeScreen(open, learn(escalated), { now: LATER });
  assert.equal(forced.screen.flows[0]?.humanOnly, true);
});

test("a reviewer's relaxed sensitive flag survives a name-based guess", () => {
  const existing = stored();
  const password = existing.fields[1];
  assert.ok(password);
  // Human review decided this field is not a secret (name regex alone says otherwise).
  password.sensitive = false;
  password.agentFillable = true;
  const textual = golden.map((e) => (e.name === "Password" ? { ...e, inputType: "text", autocomplete: "off" } : e));
  const kept = mergeScreen(existing, learn(textual), { now: LATER });
  assert.equal(kept.screen.fields[1]?.sensitive, false);
  assert.equal(kept.screen.fields[1].agentFillable, true);
  // A hard signal (it became a password input) still escalates.
  const hard = mergeScreen(existing, learn(golden), { now: LATER });
  assert.equal(hard.screen.fields[1]?.sensitive, true);
});

test("learned button never downgrades a stored submit", () => {
  const bare = golden.map((e) => {
    const copy = { ...e };
    delete copy.buttonType;
    return copy;
  });
  const { screen, diff } = mergeScreen(stored(), learn(bare), { now: LATER });
  const submit = screen.actions.find((a) => a.id === "sign-in");
  assert.equal(submit?.kind, "submit");
  assert.equal(submit.effect, "submit");
  assert.ok(isEmptyDiff(diff));
  assert.deepEqual(screen, stored());
});

test("changed attributes are reported and applied", () => {
  const raw = golden.map((e) => (e.name === "Forgot password?" ? { ...e, href: "/reset" } : e));
  const { screen, diff } = mergeScreen(stored(), learn(raw), { now: LATER });
  assert.deepEqual(diff.changed, [{ group: "link", id: "forgot-password", field: "href", from: "/forgot-password", to: "/reset" }]);
  assert.equal(screen.links[0]?.href, "/reset");
  assert.equal(screen.fingerprint, stored().fingerprint);
});

test("title change is reported and applied; route and access are kept", () => {
  const { screen, diff } = mergeScreen(stored(), learn(golden, "New title"), { now: LATER });
  assert.deepEqual(diff.changed, [{ group: "screen", id: "login", field: "title", from: "Demo App", to: "New title" }]);
  assert.equal(screen.title, "New title");
  assert.equal(screen.route, "/login");
});

test("a11y findings are retargeted and diffed", () => {
  const raw = golden.map((e) => (e.name === "Password" ? { ...e, nameSource: "placeholder" as const } : e));
  const { screen, diff } = mergeScreen(stored(), learn(raw), { now: LATER });
  assert.deepEqual(diff.a11y.added.map((f) => [f.code, f.target]), [["name-from-placeholder-only", "@password"]]);
  assert.deepEqual(screen.a11y?.map((f) => f.target), ["@password"]);
  const fixed = mergeScreen(screen, learn(golden), { now: LATER });
  assert.deepEqual(fixed.diff.a11y.resolved.map((f) => f.target), ["@password"]);
  assert.deepEqual(fixed.screen.a11y, []);
});

test("no existing screen returns the learned one as new", () => {
  const learned = learn(golden);
  const { screen, diff } = mergeScreen(undefined, learned);
  assert.equal(screen, learned);
  assert.equal(diff.isNew, true);
  assert.equal(diff.added.length, 6);
  assert.equal(isEmptyDiff(diff), false);
});

test("mergeIntoMap: unchanged map is deep-equal, learnedAt untouched", async () => {
  const learned = learnScreen(golden, PAGE, { now: LATER, access: "public" });
  const { map, diff } = await mergeIntoMap(structuredClone(demo), learned, APP, { now: LATER });
  assert.ok(isEmptyDiff(diff));
  assert.deepEqual(map, demo);
});

test("mergeIntoMap: new map, learnedAt, unmapped link-only bookkeeping", async () => {
  const learned = learn([...golden, el("link", "Home", { href: "/home?x=1" })]);
  const created = await mergeIntoMap(undefined, learned, { ...APP, version: "1.2.3" }, { now: LATER });
  assert.equal(created.map.app.learnedAt, "2027-01-02T03:04:05Z");
  assert.equal(created.map.app.version, "1.2.3");
  assert.deepEqual(created.map.unmapped, [
    { route: "/forgot-password", reason: "link-only", discoveredFrom: "login" },
    { route: "/home", reason: "link-only", discoveredFrom: "login" },
  ]);

  // Learning /forgot-password removes its link-only entry and adds nothing duplicate.
  const second = learnScreen(
    [el("textbox", "Email", { nameSource: "label", inputType: "text" }), el("link", "Back", { href: "/login" })],
    { url: "http://localhost:8080/forgot-password", title: "Reset", appOrigin: PAGE.appOrigin },
    { now: LATER },
  );
  const merged = await mergeIntoMap(created.map, second, APP, { now: new Date("2028-01-01T00:00:00Z") });
  assert.deepEqual(merged.map.unmapped?.map((u) => u.route), ["/home"]);
  assert.deepEqual(merged.map.screens.map((s) => s.id), ["login", "forgot-password"]);
  assert.equal(merged.map.app.learnedAt, "2028-01-01T00:00:00Z");
  await validateScreenMap(merged.map);
});

test("mergeIntoMap: keeps requires-login entries, matches by route, preserves flows", async () => {
  const learned = learn(rename("Sign in", "Log in"));
  const { map } = await mergeIntoMap(structuredClone(demo), { ...learned, id: "other-id" }, APP, { now: LATER });
  assert.equal(map.screens.length, 1);
  assert.equal(map.screens[0]?.id, "login");
  assert.deepEqual(map.screens[0].flows, demo.screens[0]?.flows);
  assert.ok(map.unmapped?.some((u) => u.reason === "requires-login"));
  assert.equal(map.app.learnedAt, "2027-01-02T03:04:05Z");
  await validateScreenMap(map);
});

test("mergeIntoMap rejects a different origin", async () => {
  await assert.rejects(
    mergeIntoMap(structuredClone(demo), learn(golden), { ...APP, origin: "http://other.test" }),
    (e: unknown) => e instanceof PwaNavError && e.code === "invalid_args",
  );
});
