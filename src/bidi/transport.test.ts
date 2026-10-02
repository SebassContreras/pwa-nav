import assert from "node:assert/strict";
import { test } from "node:test";
import { PwaNavError } from "../core/errors.js";
import { FakeBidiError, NO_REPLY, startFakeBidiServer, type FakeBidiServer } from "./fake-server.js";
import { BidiTransport } from "./transport.js";

async function withServer(fn: (server: FakeBidiServer) => Promise<void>): Promise<void> {
  const server = await startFakeBidiServer();
  try {
    await fn(server);
  } finally {
    await server.close();
  }
}

test("send resolves with the result of the matching command", async () => {
  await withServer(async (server) => {
    server.handle("echo", (params) => ({ got: params }));
    const t = await BidiTransport.connect(server.url);
    const [a, b] = await Promise.all([t.send("echo", { n: 1 }), t.send("echo", { n: 2 })]);
    assert.deepEqual(a, { got: { n: 1 } });
    assert.deepEqual(b, { got: { n: 2 } });
    assert.deepEqual(
      server.commands.map((c) => c.id),
      [1, 2],
    );
    await t.close();
  });
});

test("error response rejects with protocol including code and message", async () => {
  await withServer(async (server) => {
    server.handle("boom", () => {
      throw new FakeBidiError("no such node", "gone");
    });
    const t = await BidiTransport.connect(server.url);
    await assert.rejects(t.send("boom", {}), (e: unknown) => {
      assert.ok(e instanceof PwaNavError);
      assert.equal(e.code, "protocol");
      assert.match(e.message, /no such node.*gone/);
      return true;
    });
    await t.close();
  });
});

test("session busy error maps to session_busy with hint", async () => {
  await withServer(async (server) => {
    const t = await BidiTransport.connect(server.url);
    await t.send("session.new", {});
    await assert.rejects(t.send("session.new", {}), (e: unknown) => {
      assert.ok(e instanceof PwaNavError);
      assert.equal(e.code, "session_busy");
      assert.match(e.hint ?? "", /browser-bidi/);
      assert.match(e.hint ?? "", /Restarting the PWA/);
      return true;
    });
    await t.close();
  });
});

test("timeout rejects and leaves no pending timers", async () => {
  await withServer(async (server) => {
    server.handle("slow", () => NO_REPLY);
    const t = await BidiTransport.connect(server.url, { commandTimeoutMs: 30 });
    await assert.rejects(t.send("slow", {}), { code: "timeout" });
    await t.close();
  });
});

test("events fan out; unsubscribe and once work", async () => {
  await withServer(async (server) => {
    server.handle("ping", () => ({ ok: true }));
    const t = await BidiTransport.connect(server.url);
    const seen: unknown[] = [];
    const once: unknown[] = [];
    const off = t.on("ev", (p) => seen.push(p));
    t.once("ev", (p) => once.push(p));
    const waited = t.waitFor("ev", (p) => (p as { n: number }).n === 2, 1000);
    server.pushEvent("ev", { n: 1 });
    server.pushEvent("ev", { n: 2 });
    assert.deepEqual(await waited, { n: 2 });
    off();
    server.pushEvent("ev", { n: 3 });
    await t.send("ping", {}); // round trip to flush
    assert.deepEqual(seen, [{ n: 1 }, { n: 2 }]);
    assert.deepEqual(once, [{ n: 1 }]);
    await t.close();
  });
});

test("waitFor times out", async () => {
  await withServer(async (server) => {
    const t = await BidiTransport.connect(server.url);
    await assert.rejects(
      t.waitFor("never", () => true, 20),
      { code: "timeout" },
    );
    await t.close();
  });
});

test("handler exceptions go to onError and do not break the loop", async () => {
  await withServer(async (server) => {
    const errors: Error[] = [];
    const t = await BidiTransport.connect(server.url, { onError: (e) => errors.push(e) });
    server.handle("ping", () => ({ ok: true }));
    t.on("ev", () => {
      throw new Error("handler failed");
    });
    server.pushEvent("ev", {});
    assert.deepEqual(await t.send("ping", {}), { ok: true });
    assert.equal(errors.length, 1);
    assert.match(errors[0]?.message ?? "", /handler failed/);
    await t.close();
  });
});

test("server closing mid-command rejects pending with protocol", async () => {
  await withServer(async (server) => {
    server.handle("hang", () => {
      server.dropClients();
      return NO_REPLY;
    });
    const t = await BidiTransport.connect(server.url);
    const waiting = t.waitFor("never", () => true, 5000);
    await assert.rejects(t.send("hang", {}), { code: "protocol" });
    await assert.rejects(waiting, { code: "protocol" });
    await assert.rejects(t.send("ping", {}), { code: "protocol" });
    await t.close();
  });
});

test("close is idempotent and rejects pending commands", async () => {
  await withServer(async (server) => {
    server.handle("slow", () => NO_REPLY);
    const t = await BidiTransport.connect(server.url);
    const pending = t.send("slow", {});
    const first = t.close();
    const second = t.close();
    await assert.rejects(pending, { code: "protocol" });
    await Promise.all([first, second]);
    await t.close();
    assert.equal(t.isClosed, true);
  });
});

test("non-loopback host is rejected before opening a socket", async () => {
  const original = globalThis.WebSocket;
  let opened = 0;
  globalThis.WebSocket = class {
    readonly stub = true;
    constructor() {
      opened++;
    }
  } as unknown as typeof WebSocket;
  try {
    await assert.rejects(BidiTransport.connect("ws://example.com:9222/session"), { code: "invalid_args" });
    await assert.rejects(BidiTransport.connect("ws://192.168.1.5:9222/session"), { code: "invalid_args" });
    assert.equal(opened, 0);
  } finally {
    globalThis.WebSocket = original;
  }
});

test("connection refused maps to no_browser with URL and cause", async () => {
  const server = await startFakeBidiServer();
  const url = server.url;
  await server.close();
  await assert.rejects(BidiTransport.connect(url), (e: unknown) => {
    assert.ok(e instanceof PwaNavError);
    assert.equal(e.code, "no_browser");
    assert.ok(e.message.includes(url));
    assert.notEqual(e.cause, undefined);
    return true;
  });
});

test("malformed frames are ignored and reported", async () => {
  await withServer(async (server) => {
    const errors: Error[] = [];
    const t = await BidiTransport.connect(server.url, { onError: (e) => errors.push(e) });
    server.handle("ping", () => ({ ok: true }));
    server.sendRaw("not json");
    server.sendRaw(JSON.stringify({ hello: "world" }));
    server.sendRaw(JSON.stringify([1]));
    assert.deepEqual(await t.send("ping", {}), { ok: true });
    assert.equal(errors.length, 3);
    await t.close();
  });
});
