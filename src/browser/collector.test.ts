import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { COLLECT_NODES_SOURCE, COLLECTOR_SOURCE, collectInteractive, collectNodes, type RawElement } from "./collector.js";

const fixture = (name: string): string =>
  readFileSync(new URL(`../../checks/fixtures/${name}`, import.meta.url), "utf8");

const collect = (html: string, includeAll = false): RawElement[] => {
  const dom = new JSDOM(html);
  return collectInteractive(dom.window.document, { includeAll });
};
const body = (inner: string, includeAll = false): RawElement[] =>
  collect(`<!doctype html><html><body>${inner}</body></html>`, includeAll);
const pick = (els: RawElement[]): string[] => els.map((e) => `${e.role}:${e.name}#${String(e.occurrence)}`);

test("golden: login fixture", () => {
  const golden: unknown = JSON.parse(fixture("login.golden.json"));
  assert.deepEqual(collect(fixture("login.html")), golden);
});

test("collector is self-contained: shipped source matches direct call", () => {
  const html = fixture("login.html");
  const direct = collect(html);
  const dom = new JSDOM(html, { runScripts: "outside-only" });
  const win = dom.window as unknown as { Function: new (body: string) => () => unknown; document: Document };
  const shipped = new win.Function(`var __name = typeof __name !== "undefined" ? __name : (fn) => fn; return ${COLLECTOR_SOURCE}`)() as (d: Document) => unknown;
  const viaSource: unknown = JSON.parse(JSON.stringify(shipped(win.document)));
  assert.deepEqual(viaSource, direct);
});

test("aria-labelledby resolves ids and joins texts", () => {
  const els = body(`<span id="a">First</span><span id="b">Second</span><input aria-labelledby="a b" aria-label="ignored">`);
  assert.equal(els[0]?.name, "First Second");
  assert.equal(els[0].nameSource, "aria-labelledby");
});

test("placeholder-only name", () => {
  const els = body(`<input placeholder="Search docs">`);
  assert.equal(els[0]?.name, "Search docs");
  assert.equal(els[0].nameSource, "placeholder");
});

test("wrapping label, alt, title and content sources", () => {
  const els = body(
    `<label>Wrapped <input type="checkbox"></label>
     <input type="image" alt="Go">
     <a href="/x" title="Tip"></a>
     <a href="/y" title="Tip">Text</a>
     <input type="submit" value="Send">`,
  );
  assert.deepEqual(
    els.map((e) => [e.role, e.name, e.nameSource]),
    [
      ["checkbox", "Wrapped", "label"],
      ["button", "Go", "alt"],
      ["link", "Tip", "title"],
      ["link", "Text", "content"],
      ["button", "Send", "content"],
    ],
  );
});

test("hidden filtering", () => {
  const els = body(
    `<button>Visible</button>
     <button hidden>H</button>
     <div hidden><button>InHidden</button></div>
     <div inert><button>Inert</button></div>
     <button aria-hidden="true">AH</button>
     <div aria-hidden="true"><a href="/a">InAH</a></div>
     <button style="display:none">DN</button>
     <div style="display:none"><button>InDN</button></div>
     <button style="visibility:hidden">VH</button>
     <input type="hidden" name="csrf" value="t">`,
  );
  assert.deepEqual(pick(els), ["button:Visible#0"]);
});

test("disabled via attribute, fieldset and aria-disabled", () => {
  const els = body(
    `<button disabled>A</button><fieldset disabled><button>B</button></fieldset>
     <div role="button" aria-disabled="true">C</div><button>D</button>`,
  );
  assert.deepEqual(
    els.map((e) => [e.name, e.disabled]),
    [["A", true], ["B", true], ["C", true], ["D", undefined]],
  );
});

test("occurrence counts duplicates in document order", () => {
  const els = body(`<button>Go</button><a href="/g">Go</a><button>Go</button><button>Go</button>`);
  assert.deepEqual(pick(els), ["button:Go#0", "link:Go#0", "button:Go#1", "button:Go#2"]);
});

test("open shadow DOM is traversed in order", () => {
  const dom = new JSDOM(`<body><button>Before</button><div id="h"></div><button>After</button></body>`);
  const doc = dom.window.document;
  const sr = doc.getElementById("h")?.attachShadow({ mode: "open" });
  assert.ok(sr);
  sr.innerHTML = `<button>Inside</button><span id="s">Lbl</span><input aria-labelledby="s">`;
  assert.deepEqual(pick(collectInteractive(doc)), [
    "button:Before#0",
    "button:Inside#0",
    "textbox:Lbl#0",
    "button:After#0",
  ]);
});

test("includeAll adds headings and images with alt", () => {
  const html = `<h1>Title</h1><img alt="Logo"><img alt=""><button>B</button>`;
  assert.deepEqual(pick(body(html)), ["button:B#0"]);
  assert.deepEqual(pick(body(html, true)), ["heading:Title#0", "img:Logo#0", "button:B#0"]);
});

test("password value is never leaked", () => {
  const dom = new JSDOM(`<body><input type="password" aria-label="pw"><input type="text" aria-label="u"></body>`);
  const doc = dom.window.document;
  for (const input of Array.from(doc.querySelectorAll("input"))) input.value = "s3cret";
  const els = collectInteractive(doc);
  assert.equal(els[0]?.value, undefined);
  assert.equal(els[1]?.value, "s3cret");
  assert.ok(!JSON.stringify(els[0]).includes("s3cret"));
  assert.equal(els[0]?.inputType, "password");
});

test("roles: explicit wins, select kinds, slider, summary", () => {
  const els = body(
    `<div role="tab">T</div><a role="button" href="/z">Z</a><a>nohref</a>
     <select aria-label="s1"><option selected>One</option></select>
     <select aria-label="s2" multiple><option>A</option></select>
     <input type="range" aria-label="r" value="3"><details><summary>More</summary></details>`,
  );
  assert.deepEqual(
    els.map((e) => [e.role, e.name]),
    [["tab", "T"], ["button", "Z"], ["combobox", "s1"], ["listbox", "s2"], ["slider", "r"], ["button", "More"]],
  );
  assert.equal(els[2]?.value, "One");
});

test("collectNodes returns the same elements in the same order as collectInteractive", () => {
  const html = fixture("login.html");
  const dom = new JSDOM(html);
  const doc = dom.window.document;
  for (const includeAll of [false, true]) {
    const items = collectInteractive(doc, { includeAll });
    const nodes = collectNodes(doc, { includeAll });
    assert.equal(nodes.length, items.length);
    assert.ok(nodes.length > 0);
    nodes.forEach((n, i) => {
      if (n.localName === "input") assert.ok(items[i]?.inputType !== undefined);
    });
  }
  const shadow = new JSDOM(`<body><button>Before</button><div id="h"></div><button>After</button></body>`);
  const sdoc = shadow.window.document;
  const sr = sdoc.getElementById("h")?.attachShadow({ mode: "open" });
  assert.ok(sr);
  sr.innerHTML = `<button>Inside</button>`;
  assert.deepEqual(
    collectNodes(sdoc).map((n) => n.textContent),
    ["Before", "Inside", "After"],
  );
});

test("COLLECT_NODES_SOURCE is self-contained and matches direct call", () => {
  const dom = new JSDOM(fixture("login.html"), { runScripts: "outside-only" });
  const win = dom.window as unknown as { Function: new (body: string) => () => unknown; document: Document };
  const shipped = new win.Function(`var __name = typeof __name !== "undefined" ? __name : (fn) => fn; return ${COLLECT_NODES_SOURCE}`)() as (d: Document) => Element[];
  const nodes = shipped(win.document);
  assert.equal(nodes.length, collectInteractive(win.document).length);
  assert.deepEqual(
    Array.from(nodes, (n) => n.localName),
    collectNodes(win.document).map((n) => n.localName),
  );
});

test("buttonType: native buttons only, submit default inside a form", () => {
  const els = body(
    `<button>Free</button><div role="button">Div</div>
     <form><button>Implicit</button><button type="button">Plain</button><button type="reset">Rst</button>
     <input type="submit" value="Send"><input type="image" alt="Img"></form>`,
  );
  assert.deepEqual(
    els.map((e) => [e.name, e.buttonType]),
    [["Free", "button"], ["Div", undefined], ["Implicit", "submit"], ["Plain", "button"], ["Rst", "reset"], ["Send", "submit"], ["Img", "submit"]],
  );
});

test("collector tags input type file with role textbox and inputType file even if styled display:none", () => {
  const els = body(
    `<label for="up">Upload photo</label>
     <input id="up" type="file" style="display:none">
     <input type="file" aria-label="Attach CV">`,
  );
  assert.deepEqual(
    els.map((e) => [e.role, e.name, e.inputType]),
    [
      ["textbox", "Upload photo", "file"],
      ["textbox", "Attach CV", "file"],
    ],
  );
});

