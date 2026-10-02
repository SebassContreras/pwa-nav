import assert from "node:assert/strict";
import { test } from "node:test";
import { PwaNavError } from "../core/errors.js";
import { startFakeBidiServer, type FakeBidiServer } from "./fake-server.js";
import { BidiClient, fromRemoteValue, SERIALIZATION_OPTIONS, SETTLE_EVENTS } from "./protocol.js";
import { BidiTransport } from "./transport.js";

async function withClient(fn: (client: BidiClient, server: FakeBidiServer) => Promise<void>): Promise<void> {
  const server = await startFakeBidiServer();
  const transport = await BidiTransport.connect(server.url);
  try {
    await fn(new BidiClient(transport), server);
  } finally {
    await transport.close();
    await server.close();
  }
}

function last(server: FakeBidiServer): { method: string; params: unknown } {
  const c = server.commands[server.commands.length - 1];
  assert.ok(c);
  return c;
}

test("session.new / session.end frames", async () => {
  await withClient(async (client, server) => {
    await client.sessionNew();
    assert.deepEqual(last(server), { id: 1, method: "session.new", params: { capabilities: {} } });
    assert.equal(server.sessionActive, true);
    await client.sessionEnd();
    assert.equal(last(server).method, "session.end");
    assert.equal(server.sessionActive, false);
  });
});

test("getTopLevelContexts maps getTree", async () => {
  await withClient(async (client, server) => {
    server.handle("browsingContext.getTree", () => ({
      contexts: [{ context: "c1", url: "https://a/", userContext: "default", children: [{ context: "c2" }] }],
    }));
    assert.deepEqual(await client.getTopLevelContexts(), [{ context: "c1", url: "https://a/", userContext: "default" }]);
  });
});

test("navigate sends wait (default complete) and returns navigation/url", async () => {
  await withClient(async (client, server) => {
    server.handle("browsingContext.navigate", () => ({ navigation: "n1", url: "https://x/" }));
    assert.deepEqual(await client.navigate("c1", "https://x/"), { navigation: "n1", url: "https://x/" });
    assert.deepEqual(last(server).params, { context: "c1", url: "https://x/", wait: "complete" });
    await client.navigate("c1", "https://x/", "none");
    assert.deepEqual(last(server).params, { context: "c1", url: "https://x/", wait: "none" });
  });
});

test("evaluate sends target/ownership/serialization and deserializes", async () => {
  await withClient(async (client, server) => {
    server.handle("script.evaluate", () => ({
      type: "success",
      realm: "r",
      result: { type: "array", value: [{ type: "number", value: 1 }, { type: "string", value: "a" }] },
    }));
    assert.deepEqual(await client.evaluate("c1", "1+1"), [1, "a"]);
    assert.deepEqual(last(server).params, {
      expression: "1+1",
      target: { context: "c1" },
      awaitPromise: true,
      resultOwnership: "none",
      serializationOptions: SERIALIZATION_OPTIONS,
    });
    await client.evaluate("c1", "x", false);
    assert.equal((last(server).params as { awaitPromise: boolean }).awaitPromise, false);
  });
});

test("callFunction sends arguments", async () => {
  await withClient(async (client, server) => {
    server.handle("script.callFunction", () => ({ type: "success", realm: "r", result: { type: "undefined" } }));
    assert.equal(await client.callFunction("c1", "(a) => a", [{ type: "string", value: "x" }]), undefined);
    assert.deepEqual(last(server).params, {
      functionDeclaration: "(a) => a",
      arguments: [{ type: "string", value: "x" }],
      target: { context: "c1" },
      awaitPromise: true,
      resultOwnership: "none",
      serializationOptions: SERIALIZATION_OPTIONS,
    });
  });
});

test("script exception maps to protocol with text", async () => {
  await withClient(async (client, server) => {
    server.handle("script.evaluate", () => ({
      type: "exception",
      realm: "r",
      exceptionDetails: { text: "ReferenceError: nope is not defined", exception: { type: "error" } },
    }));
    await assert.rejects(client.evaluate("c1", "nope"), (e: unknown) => {
      assert.ok(e instanceof PwaNavError);
      assert.equal(e.code, "protocol");
      assert.match(e.message, /nope is not defined/);
      return true;
    });
  });
});

test("performActions / releaseActions / subscribe frames", async () => {
  await withClient(async (client, server) => {
    server.handle("input.performActions", () => ({}));
    server.handle("input.releaseActions", () => ({}));
    server.handle("session.subscribe", () => ({ subscription: "s" }));
    await client.performActions("c1", [{ type: "none", id: "a", actions: [] }]);
    assert.deepEqual(last(server).params, { context: "c1", actions: [{ type: "none", id: "a", actions: [] }] });
    await client.releaseActions("c1");
    assert.deepEqual(last(server).params, { context: "c1" });
    await client.subscribe(["browsingContext.load"]);
    assert.deepEqual(last(server).params, { events: ["browsingContext.load"] });
    await client.subscribe(["browsingContext.load"], ["c1"]);
    assert.deepEqual(last(server).params, { events: ["browsingContext.load"], contexts: ["c1"] });
  });
});

test("fromRemoteValue handles primitives, nesting, special numbers, maps", () => {
  assert.equal(fromRemoteValue({ type: "string", value: "s" }), "s");
  assert.equal(fromRemoteValue({ type: "boolean", value: false }), false);
  assert.equal(fromRemoteValue({ type: "null" }), null);
  assert.equal(fromRemoteValue({ type: "undefined" }), undefined);
  assert.equal(fromRemoteValue({ type: "number", value: "NaN" }), NaN);
  assert.equal(fromRemoteValue({ type: "number", value: "-Infinity" }), -Infinity);
  assert.equal(fromRemoteValue({ type: "bigint", value: "12" }), 12n);
  assert.deepEqual(
    fromRemoteValue({
      type: "object",
      value: [
        ["a", { type: "number", value: 1 }],
        [{ type: "string", value: "b" }, { type: "array", value: [{ type: "object", value: [["c", { type: "null" }]] }] }],
      ],
    }),
    { a: 1, b: [{ c: null }] },
  );
  const map = fromRemoteValue({ type: "map", value: [["k", { type: "boolean", value: true }]] });
  assert.ok(map instanceof Map);
  assert.equal(map.get("k"), true);
});

test("fromRemoteValue rejects unknown and malformed values with protocol", () => {
  for (const bad of [{ type: "function" }, { type: "node", sharedId: "x" }, { type: "object" }, "str", { type: "number", value: "x" }]) {
    assert.throws(
      () => fromRemoteValue(bad),
      (e: unknown) => e instanceof PwaNavError && e.code === "protocol",
    );
  }
});

test("didNavigateWithin: true on navigationStarted, false on silence, context-filtered", async () => {
  await withClient(async (client, server) => {
    server.handle("session.subscribe", () => ({}));
    await client.subscribe(["browsingContext.navigationStarted"]);
    const hit = client.didNavigateWithin(2000, "c1");
    server.pushEvent("browsingContext.navigationStarted", { context: "c1", navigation: "n", url: "u" });
    assert.equal(await hit, true);
    const other = client.didNavigateWithin(80, "c1");
    server.pushEvent("browsingContext.navigationStarted", { context: "c2", navigation: "n", url: "u" });
    assert.equal(await other, false);
    assert.equal(await client.didNavigateWithin(30), false);
  });
});

test("waitForLoad resolves on load and times out otherwise", async () => {
  await withClient(async (client, server) => {
    const p = client.waitForLoad(2000, "c1");
    server.pushEvent("browsingContext.load", { context: "c1", navigation: "n", url: "u" });
    await p;
    await assert.rejects(
      client.waitForLoad(50),
      (e: unknown) => e instanceof PwaNavError && e.code === "timeout",
    );
  });
});

test("watchNavigation: tracks navigation and network idle with in-flight count", async () => {
  await withClient(async (client, server) => {
    const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 20));
    server.handle("session.subscribe", () => ({}));
    await client.subscribe(SETTLE_EVENTS, ["c1"]);
    const watch = client.watchNavigation("c1");
    assert.equal(watch.started, false);
    assert.equal(watch.loaded, false);
    assert.equal(watch.inFlightCount, 0);
    assert.equal(watch.requestCount, 0);

    // Request from another context is ignored
    server.pushEvent("network.beforeRequestSent", {
      context: "other",
      request: { request: "req-other", url: "https://other/" },
    });
    await tick();
    assert.equal(watch.inFlightCount, 0);
    assert.equal(watch.requestCount, 0);

    // Request in c1 starts
    server.pushEvent("network.beforeRequestSent", {
      context: "c1",
      request: { request: "req-1", url: "https://a/api" },
    });
    await tick();
    assert.equal(watch.inFlightCount, 1);
    assert.equal(watch.requestCount, 1);

    // Second request starts
    server.pushEvent("network.beforeRequestSent", {
      context: "c1",
      request: { request: "req-2", url: "https://a/api2" },
    });
    await tick();
    assert.equal(watch.inFlightCount, 2);
    assert.equal(watch.requestCount, 2);

    // waitNetworkIdle is waiting
    let idleResolved = false;
    const idleP = watch.waitNetworkIdle(1000).then((v) => {
      idleResolved = v;
    });

    // req-1 completes
    server.pushEvent("network.responseCompleted", {
      context: "c1",
      request: { request: "req-1", url: "https://a/api" },
    });
    await tick();
    assert.equal(watch.inFlightCount, 1);
    assert.equal(idleResolved, false);

    // req-2 ends with fetchError
    server.pushEvent("network.fetchError", {
      context: "c1",
      request: { request: "req-2", url: "https://a/api2" },
    });
    await tick();
    assert.equal(watch.inFlightCount, 0);

    await idleP;
    assert.equal(idleResolved, true);

    // Navigation events
    server.pushEvent("browsingContext.navigationStarted", { context: "c1", navigation: "n1", url: "u1" });
    assert.equal(await watch.waitStarted(100), true);
    assert.equal(watch.started, true);

    server.pushEvent("browsingContext.load", { context: "c1", navigation: "n1", url: "u1" });
    await watch.waitLoaded(100);
    assert.equal(watch.loaded, true);

    watch.dispose();
  });
});

test("setFiles sends context, element and files", async () => {
  await withClient(async (client, server) => {
    server.handle("input.setFiles", () => ({}));
    await client.setFiles("c1", { sharedId: "s1" }, ["/path/to/file.txt"]);
    assert.deepEqual(last(server).params, {
      context: "c1",
      element: { sharedId: "s1" },
      files: ["/path/to/file.txt"],
    });

    // Also accepts NodeArgument
    await client.setFiles("c2", { type: "node", sharedId: "s2" }, ["/a.pdf", "/b.png"]);
    assert.deepEqual(last(server).params, {
      context: "c2",
      element: { sharedId: "s2" },
      files: ["/a.pdf", "/b.png"],
    });
  });
});

