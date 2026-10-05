import assert from "node:assert/strict";
import { test } from "node:test";
import { JSDOM } from "jsdom";
import { startFakeBidiServer, type FakeBidiServer, type ReceivedCommand } from "../../bidi/fake-server.js";
import { BidiClient } from "../../bidi/protocol.js";
import { BidiTransport } from "../../bidi/transport.js";
import { PwaNavError } from "../../core/errors.js";
import { StaleRefError } from "../../core/refs.js";
import type { Snapshot } from "../../core/snapshot.js";
import type { RawElement } from "../collector.js";
import {
  buildFillKeyActions,
  checkActionable,
  clickLocator,
  describeTarget,
  fillLocator,
  prepareFill,
  QUIET_MS,
  readBackMatches,
  SETTLE_TIMEOUT_MS,
  SETTLE_WINDOW_MS,
  uploadFiles,
} from "../actions.js";

const URL_A = "https://app.test/login";
const snapshot: Snapshot = { snapshotId: "s1", url: URL_A, title: "Login", elements: [] };
const raw: RawElement[] = [
  { role: "textbox", name: "User", nameSource: "label", occurrence: 0, inputType: "text" },
  { role: "textbox", name: "Password", nameSource: "label", occurrence: 0, inputType: "password" },
  { role: "button", name: "Go", nameSource: "content", occurrence: 0 },
];

// Minimal JS -> BiDi RemoteValue encoder for scripted replies.
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

interface Script {
  url?: string;
  raw?: RawElement[];
  node?: boolean;
  check?: { ok: boolean; reason?: string };
  prepare?: Record<string, unknown>;
  readback?: boolean;
  onInput?: (server: FakeBidiServer) => void;
}

async function harness(
  script: Script,
  fn: (client: BidiClient, server: FakeBidiServer) => Promise<void>,
): Promise<void> {
  const server = await startFakeBidiServer();
  server.handle("session.subscribe", () => ({ subscription: "s" }));
  server.handle("input.performActions", () => {
    script.onInput?.(server);
    return {};
  });
  server.handle("input.releaseActions", () => ({}));
  server.handle("script.callFunction", (params) => {
    const decl = (params as { functionDeclaration: string }).functionDeclaration;
    if (decl.startsWith("(includeAll) =>")) {
      return ok({ url: script.url ?? URL_A, title: "Login", raw: script.raw ?? raw });
    }
    if (decl.startsWith("(index, role")) {
      return script.node === false
        ? { type: "success", realm: "r", result: { type: "null" } }
        : { type: "success", realm: "r", result: { type: "node", sharedId: "node-1" } };
    }
    if (decl.includes("isContentEditable")) return ok(script.prepare ?? { ok: true, kind: "text", sensitive: false });
    if (decl.includes("MutationObserver")) return ok(true);
    if (decl.includes("elementFromPoint")) return ok(script.check ?? { ok: true });
    if (decl.startsWith("() => ({ url: location.href")) return ok({ url: script.url ?? URL_A, title: "Login" });
    return ok(script.readback ?? true);
  });
  const transport = await BidiTransport.connect(server.url);
  try {
    await fn(new BidiClient(transport), server);
  } finally {
    await transport.close();
    await server.close();
  }
}

const methods = (server: FakeBidiServer): string[] => server.commands.map((c) => c.method);
const inputs = (server: FakeBidiServer): ReceivedCommand[] =>
  server.commands.filter((c) => c.method === "input.performActions");
const calls = (server: FakeBidiServer): ReceivedCommand[] =>
  server.commands.filter((c) => c.method === "script.callFunction");
const params = (c: ReceivedCommand | undefined): Record<string, unknown> => {
  assert.ok(c);
  return c.params as Record<string, unknown>;
};
const argsOf = (c: ReceivedCommand | undefined): unknown[] => params(c)["arguments"] as unknown[];
const isQuiet = (c: ReceivedCommand): boolean => JSON.stringify(c.params).includes("MutationObserver");

test("settle constants are positive and ordered", () => {
  const [quiet, window, cap]: number[] = [QUIET_MS, SETTLE_WINDOW_MS, SETTLE_TIMEOUT_MS];
  assert.ok(quiet !== undefined && window !== undefined && cap !== undefined);
  assert.ok(quiet > 0 && window > 0 && cap > quiet);
});

test("click: locate with root ownership, then pointer move on element origin, down, up", async () => {
  await harness({}, async (client, server) => {
    const res = await clickLocator(client, "ctx", snapshot, { role: "button", name: "Go" });
    assert.deepEqual(res, { url: URL_A, title: "Login" });
    const [, locateCall, checkCall] = calls(server);
    assert.equal(params(locateCall)["resultOwnership"], "root");
    assert.deepEqual(argsOf(locateCall), [
      { type: "number", value: 2 },
      { type: "string", value: "button" },
      { type: "string", value: "Go" },
      { type: "boolean", value: false },
    ]);
    assert.deepEqual(argsOf(checkCall), [{ type: "node", sharedId: "node-1" }]);
    assert.deepEqual(params(inputs(server)[0]), {
      context: "ctx",
      actions: [
        {
          type: "pointer",
          id: "mouse",
          parameters: { pointerType: "mouse" },
          actions: [
            { type: "pointerMove", x: 0, y: 0, origin: { type: "element", element: { sharedId: "node-1" } } },
            { type: "pointerDown", button: 0 },
            { type: "pointerUp", button: 0 },
          ],
        },
      ],
    });
    const m = methods(server);
    assert.ok(m.indexOf("session.subscribe") < m.indexOf("input.performActions"));
    assert.ok(m.indexOf("input.performActions") < m.indexOf("input.releaseActions"));
  });
});

test("click: navigation during input waits for load, skips quiescence", async () => {
  await harness(
    {
      onInput: (server) => {
        server.pushEvent("browsingContext.navigationStarted", { context: "ctx", navigation: "n", url: "u" });
        setTimeout(() => {
          server.pushEvent("browsingContext.load", { context: "ctx", navigation: "n", url: "u" });
        }, 50);
      },
    },
    async (client, server) => {
      await clickLocator(client, "ctx", snapshot, { role: "button", name: "Go" });
      assert.equal(calls(server).filter(isQuiet).length, 0);
    },
  );
});

test("click: no navigation uses DOM quiescence with the named constants", async () => {
  await harness({}, async (client, server) => {
    await clickLocator(client, "ctx", snapshot, { role: "button", name: "Go" });
    assert.deepEqual(argsOf(calls(server).find(isQuiet)), [
      { type: "number", value: QUIET_MS },
      { type: "number", value: SETTLE_TIMEOUT_MS },
    ]);
  });
});

test("click: navigation events from other contexts are ignored", async () => {
  await harness(
    {
      onInput: (server) => {
        server.pushEvent("browsingContext.navigationStarted", { context: "other", navigation: "n", url: "u" });
      },
    },
    async (client, server) => {
      await clickLocator(client, "ctx", snapshot, { role: "button", name: "Go" });
      assert.equal(calls(server).filter(isQuiet).length, 1);
    },
  );
});

test("click: delayed network request waits for network idle before DOM quiescence", async () => {
  let completed = false;
  await harness(
    {
      onInput: (server) => {
        server.pushEvent("network.beforeRequestSent", {
          context: "ctx",
          request: { request: "req-1", url: "https://app.test/api/login" },
        });
        setTimeout(() => {
          completed = true;
          server.pushEvent("network.responseCompleted", {
            context: "ctx",
            request: { request: "req-1", url: "https://app.test/api/login" },
          });
        }, 50);
      },
    },
    async (client, server) => {
      await clickLocator(client, "ctx", snapshot, { role: "button", name: "Go" });
      assert.equal(completed, true, "network response must have completed before settle returns");
      assert.equal(calls(server).filter(isQuiet).length, 1);
    },
  );
});

test("click: network request ending in fetchError is completed and proceeds to quiescence", async () => {
  let completed = false;
  await harness(
    {
      onInput: (server) => {
        server.pushEvent("network.beforeRequestSent", {
          context: "ctx",
          request: { request: "req-err", url: "https://app.test/api/fail" },
        });
        setTimeout(() => {
          completed = true;
          server.pushEvent("network.fetchError", {
            context: "ctx",
            request: { request: "req-err", url: "https://app.test/api/fail" },
          });
        }, 50);
      },
    },
    async (client, server) => {
      await clickLocator(client, "ctx", snapshot, { role: "button", name: "Go" });
      assert.equal(completed, true, "fetchError must complete in-flight tracking");
      assert.equal(calls(server).filter(isQuiet).length, 1);
    },
  );
});

test("click: late navigation after network response waits for load", async () => {
  await harness(
    {
      onInput: (server) => {
        server.pushEvent("network.beforeRequestSent", {
          context: "ctx",
          request: { request: "req-nav", url: "https://app.test/api/auth" },
        });
        setTimeout(() => {
          server.pushEvent("network.responseCompleted", {
            context: "ctx",
            request: { request: "req-nav", url: "https://app.test/api/auth" },
          });
          server.pushEvent("browsingContext.navigationStarted", { context: "ctx", navigation: "n2", url: "https://app.test/dash" });
          setTimeout(() => {
            server.pushEvent("browsingContext.load", { context: "ctx", navigation: "n2", url: "https://app.test/dash" });
          }, 30);
        }, 30);
      },
    },
    async (client) => {
      const res = await clickLocator(client, "ctx", snapshot, { role: "button", name: "Go" });
      assert.equal(res.url, URL_A);
    },
  );
});

test("stale: missing locator, URL change, vanished node => StaleRefError before any input", async () => {
  await harness({}, async (client, server) => {
    await assert.rejects(clickLocator(client, "ctx", snapshot, { role: "button", name: "Nope" }), StaleRefError);
    await assert.rejects(fillLocator(client, "ctx", snapshot, { role: "tab", name: "X" }, "t"), StaleRefError);
    assert.equal(inputs(server).length, 0);
  });
  await harness({ url: "https://app.test/other" }, async (client, server) => {
    await assert.rejects(clickLocator(client, "ctx", snapshot, { role: "button", name: "Go" }), StaleRefError);
    assert.equal(inputs(server).length, 0);
  });
  await harness({ node: false }, async (client, server) => {
    await assert.rejects(clickLocator(client, "ctx", snapshot, { role: "button", name: "Go" }), StaleRefError);
    assert.equal(inputs(server).length, 0);
  });
});

test("not_actionable carries the scripted reason; no input sent", async () => {
  await harness({ check: { ok: false, reason: "element is covered by <div>" } }, async (client, server) => {
    await assert.rejects(clickLocator(client, "ctx", snapshot, { role: "button", name: "Go" }), (e: unknown) => {
      assert.ok(e instanceof PwaNavError);
      assert.equal(e.code, "not_actionable");
      assert.match(e.message, /covered by <div>/);
      assert.ok(e.hint);
      return true;
    });
    await assert.rejects(
      fillLocator(client, "ctx", snapshot, { role: "textbox", name: "User" }, "x"),
      (e: unknown) => e instanceof PwaNavError && e.code === "not_actionable",
    );
    assert.equal(inputs(server).length, 0);
  });
});

test("fill: select-all then one key pair per code point (emoji, accent), exact readback", async () => {
  await harness({}, async (client, server) => {
    const text = "é😀a";
    const res = await fillLocator(client, "ctx", snapshot, { role: "textbox", name: "User" }, text);
    assert.deepEqual(res, { url: URL_A, title: "Login" });
    const mod = process.platform === "darwin" ? "" : "";
    assert.deepEqual(params(inputs(server)[0]), {
      context: "ctx",
      actions: [
        {
          type: "key",
          id: "keyboard",
          actions: [
            { type: "keyDown", value: mod },
            { type: "keyDown", value: "a" },
            { type: "keyUp", value: "a" },
            { type: "keyUp", value: mod },
            { type: "keyDown", value: "é" },
            { type: "keyUp", value: "é" },
            { type: "keyDown", value: "😀" },
            { type: "keyUp", value: "😀" },
            { type: "keyDown", value: "a" },
            { type: "keyUp", value: "a" },
          ],
        },
      ],
    });
    const readback = calls(server).find((c) => argsOf(c).length === 2 && !isQuiet(c));
    assert.deepEqual(argsOf(readback), [
      { type: "node", sharedId: "node-1" },
      { type: "string", value: text },
    ]);
  });
});

test("buildFillKeyActions: darwin uses Meta, empty text deletes, newline is Enter, private use rejected", () => {
  const mac = buildFillKeyActions("", "darwin") as { value: string }[];
  assert.deepEqual(
    mac.map((a) => a.value),
    ["", "a", "a", "", "", ""],
  );
  const nl = buildFillKeyActions("a\nb", "linux") as { value: string }[];
  assert.ok(nl.some((a) => a.value === ""));
  assert.throws(
    () => buildFillKeyActions("secret", "linux"),
    (e: unknown) => e instanceof PwaNavError && e.code === "invalid_args" && !e.message.includes("secret"),
  );
});

test("fill: invalid text fails before touching the browser", async () => {
  await harness({}, async (client, server) => {
    await assert.rejects(fillLocator(client, "ctx", snapshot, { role: "textbox", name: "User" }, ""), PwaNavError);
    assert.equal(server.commands.length, 0);
  });
});

test("fill: waits for frames after typing and before the readback", async () => {
  await harness({}, async (client, server) => {
    await fillLocator(client, "ctx", snapshot, { role: "textbox", name: "User" }, "hi", { settle: false });
    const order = server.commands
      .filter((c) => c.method === "input.performActions" || c.method === "script.callFunction")
      .map((c) => {
        const text = JSON.stringify(c.params);
        if (c.method === "input.performActions") return "input";
        if (text.includes("requestAnimationFrame") && text.includes("waitFrames")) return "frames";
        return argsOf(c).length === 2 && !isQuiet(c) ? "readback" : "other";
      });
    const input = order.indexOf("input");
    assert.equal(order[input + 1], "frames");
    assert.equal(order[input + 2], "readback");
  });
});

test("fill: readback mismatch => not_actionable without echoing the text", async () => {
  await harness({ readback: false }, async (client) => {
    await assert.rejects(fillLocator(client, "ctx", snapshot, { role: "textbox", name: "User" }, "hello"), (e: unknown) => {
      assert.ok(e instanceof PwaNavError);
      assert.equal(e.code, "not_actionable");
      assert.match(e.message, /value after typing differs/);
      assert.ok(!e.message.includes("hello"));
      return true;
    });
  });
});

test("fill: unsupported target => not_actionable, nothing typed", async () => {
  await harness({ prepare: { ok: false, reason: "select is not supported by fill" } }, async (client, server) => {
    await assert.rejects(
      fillLocator(client, "ctx", snapshot, { role: "textbox", name: "User" }, "x"),
      (e: unknown) =>
        e instanceof PwaNavError && e.code === "not_actionable" && /select/.test(e.message) && e.hint !== undefined,
    );
    assert.equal(inputs(server).length, 0);
  });
});

test("fill password: readback compares length only; secret absent from script calls, results and errors", async () => {
  const secret = "S3cr3t-pässwörd";
  await harness({ prepare: { ok: true, kind: "password", sensitive: true } }, async (client, server) => {
    const res = await fillLocator(client, "ctx", snapshot, { role: "textbox", name: "Password" }, secret);
    assert.ok(!JSON.stringify(res).includes(secret));
    const readback = calls(server).find((c) => argsOf(c).length === 2 && !isQuiet(c));
    assert.deepEqual(argsOf(readback), [
      { type: "node", sharedId: "node-1" },
      { type: "number", value: secret.length },
    ]);
    // The secret only ever travels inside the key actions.
    for (const c of calls(server)) assert.ok(!JSON.stringify(c.params).includes(secret));
  });
  await harness({ prepare: { ok: true, kind: "password", sensitive: true }, readback: false }, async (client) => {
    await assert.rejects(fillLocator(client, "ctx", snapshot, { role: "textbox", name: "Password" }, secret), (e: unknown) => {
      assert.ok(e instanceof PwaNavError);
      assert.match(e.message, /length/);
      assert.ok(!JSON.stringify({ m: e.message, h: e.hint }).includes(secret));
      return true;
    });
  });
});

test("describeTarget: shape and redaction", () => {
  assert.equal(
    describeTarget({ action: "click", locator: { role: "button", name: "Go", occurrence: 1 }, element: raw[2] }),
    'click button "Go" (occurrence 1) [enabled, visible]',
  );
  assert.equal(
    describeTarget({ action: "fill", locator: { role: "textbox", name: "User" }, element: raw[0], text: "bob" }),
    'fill textbox "User" (occurrence 0) with "bob" [enabled, visible, type=text]',
  );
  const out = describeTarget({
    action: "fill",
    locator: { role: "textbox", name: "Password" },
    element: raw[1],
    text: "hunter2",
  });
  assert.ok(!out.includes("hunter2"));
  assert.match(out, /redacted, 7 chars/);
  assert.match(describeTarget({ action: "click", locator: { role: "button", name: "Go" } }), /^click button "Go"/);
});

// ---- in-page functions in jsdom ----

function page(html: string): { doc: Document; el: HTMLElement } {
  const dom = new JSDOM(`<!doctype html><body>${html}</body>`, { pretendToBeVisual: true });
  const doc = dom.window.document;
  const el = doc.querySelector("#t");
  assert.ok(el instanceof dom.window.HTMLElement);
  return { doc, el };
}
const rect = (l: number, t: number, w: number, h: number): DOMRect =>
  ({ left: l, top: t, width: w, height: h, right: l + w, bottom: t + h, x: l, y: t, toJSON: () => ({}) });

function layout(
  doc: Document,
  el: HTMLElement,
  hit: () => Element | null,
  r: () => DOMRect = () => rect(10, 10, 100, 20),
): void {
  el.getBoundingClientRect = r;
  (doc as unknown as { elementFromPoint: () => Element | null }).elementFromPoint = hit;
}

test("checkActionable: ok when visible, enabled, stable and hit-testable", async () => {
  const { doc, el } = page(`<button id="t">Go</button>`);
  layout(doc, el, () => el);
  assert.deepEqual(await checkActionable(el), { ok: true });
});

test("checkActionable: zero rect and hidden styles are not visible", async () => {
  const a = page(`<button id="t">Go</button>`);
  layout(a.doc, a.el, () => a.el, () => rect(0, 0, 0, 0));
  assert.deepEqual(await checkActionable(a.el), { ok: false, reason: "element is not visible" });
  for (const style of ["visibility:hidden", "display:none"]) {
    const b = page(`<button id="t" style="${style}">Go</button>`);
    layout(b.doc, b.el, () => b.el);
    assert.equal((await checkActionable(b.el)).reason, "element is not visible");
  }
});

test("checkActionable: disabled via attribute and aria-disabled", async () => {
  for (const attrs of ["disabled", `aria-disabled="true"`]) {
    const { doc, el } = page(`<button id="t" ${attrs}>Go</button>`);
    layout(doc, el, () => el);
    assert.deepEqual(await checkActionable(el), { ok: false, reason: "element is disabled" });
  }
});

test("checkActionable: moving element is not stable", async () => {
  const { doc, el } = page(`<button id="t">Go</button>`);
  let n = 0;
  layout(doc, el, () => el, () => rect(10 + n++, 10, 100, 20));
  assert.match((await checkActionable(el)).reason ?? "", /not stable/);
});

test("checkActionable: covered, descendant, label and outside-viewport", async () => {
  const covered = page(`<button id="t">Go</button><div id="o"></div>`);
  layout(covered.doc, covered.el, () => covered.doc.querySelector("#o"));
  assert.equal((await checkActionable(covered.el)).reason, "element is covered by <div>");

  const child = page(`<button id="t"><span id="c">Go</span></button>`);
  layout(child.doc, child.el, () => child.doc.querySelector("#c"));
  assert.deepEqual(await checkActionable(child.el), { ok: true });

  const label = page(`<label id="l" for="t">Name</label><input id="t">`);
  layout(label.doc, label.el, () => label.doc.querySelector("#l"));
  assert.deepEqual(await checkActionable(label.el), { ok: true });

  const outside = page(`<button id="t">Go</button>`);
  layout(outside.doc, outside.el, () => null);
  assert.match((await checkActionable(outside.el)).reason ?? "", /outside the viewport/);
});

test("checkActionable: scrolls into view centered", async () => {
  const { doc, el } = page(`<button id="t">Go</button>`);
  layout(doc, el, () => el);
  let arg: unknown;
  el.scrollIntoView = (a?: boolean | ScrollIntoViewOptions) => {
    arg = a;
  };
  await checkActionable(el);
  assert.deepEqual(arg, { block: "center", inline: "center" });
});

test("checkActionable: file inputs bypass visibility and zero rect", async () => {
  const { el } = page(`<input id="t" type="file" style="display:none">`);
  assert.deepEqual(await checkActionable(el), { ok: true });

  const disabled = page(`<input id="t" type="file" disabled>`);
  assert.deepEqual(await checkActionable(disabled.el), { ok: false, reason: "element is disabled" });
});


test("prepareFill: kinds, unsupported targets, focus", () => {
  const text = page(`<input id="t" type="text">`);
  assert.deepEqual(prepareFill(text.el), { ok: true, kind: "text", sensitive: false });
  assert.equal(text.doc.activeElement, text.el);
  assert.deepEqual(prepareFill(page(`<input id="t" type="password">`).el), {
    ok: true,
    kind: "password",
    sensitive: true,
  });
  assert.equal(prepareFill(page(`<input id="t" type="text" autocomplete="cc-number">`).el).sensitive, true);
  assert.deepEqual(prepareFill(page(`<textarea id="t"></textarea>`).el), { ok: true, kind: "text", sensitive: false });
  assert.match(prepareFill(page(`<select id="t"><option>a</option></select>`).el).reason ?? "", /select/);
  assert.match(prepareFill(page(`<input id="t" type="file">`).el).reason ?? "", /"file"/);
  assert.match(prepareFill(page(`<input id="t" readonly>`).el).reason ?? "", /read-only/);
  assert.match(prepareFill(page(`<div id="t">x</div>`).el).reason ?? "", /not an editable/);
});

test("readBackMatches: exact, newline normalisation, password length, contenteditable text", () => {
  const input = page(`<input id="t" value="abc">`).el;
  assert.equal(readBackMatches(input, "abc"), true);
  assert.equal(readBackMatches(input, "abd"), false);
  assert.equal(readBackMatches(input, 3), true);
  assert.equal(readBackMatches(input, 4), false);
  const area = page(`<textarea id="t">a\nb</textarea>`).el;
  assert.equal(readBackMatches(area, "a\r\nb"), true);
  const ce = page(`<div id="t">hello</div>`).el;
  assert.equal(readBackMatches(ce, "hello"), true);
  assert.equal(readBackMatches(ce, "hell"), false);
});

test("readBackMatches: contenteditable NBSP counts as the typed space; inputs stay exact", () => {
  const ce = page(`<div id="t" contenteditable="true">a  b</div>`).el;
  assert.equal(readBackMatches(ce, "a  b"), true);
  const input = page(`<input id="t">`).el as HTMLInputElement;
  input.value = "a b";
  assert.equal(readBackMatches(input, "a b"), false);
});

test("prepareFill: contenteditable gets a caret inside the host (focus alone types nothing in Firefox)", () => {
  const { doc, el } = page(`<div id="t" contenteditable="true">x</div>`);
  Object.defineProperty(el, "isContentEditable", { value: true });
  assert.equal(prepareFill(el).kind, "contenteditable");
  const selection = doc.defaultView?.getSelection();
  assert.ok(selection && selection.rangeCount === 1);
  assert.ok(el.contains(selection.anchorNode));
  assert.equal(selection.isCollapsed, true);
});

test("uploadFiles: sets files via input.setFiles on located element with settle", async () => {
  const rawWithFile: RawElement[] = [
    { role: "textbox", name: "Avatar", nameSource: "label", occurrence: 0, inputType: "file" },
  ];
  await harness({ raw: rawWithFile }, async (client, server) => {
    const snap: Snapshot = { snapshotId: "s1", url: URL_A, title: "Upload", elements: [] };
    const res = await uploadFiles(client, "ctx", snap, { role: "textbox", name: "Avatar" }, ["/path/to/img.png"]);
    assert.deepEqual(res, { url: URL_A, title: "Login" });
    const setFilesCmd = server.commands.find((c) => c.method === "input.setFiles");
    assert.ok(setFilesCmd);
    assert.deepEqual(setFilesCmd.params, {
      context: "ctx",
      element: { sharedId: "node-1" },
      files: ["/path/to/img.png"],
    });
  });
});

