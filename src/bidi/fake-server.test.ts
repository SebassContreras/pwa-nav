import assert from "node:assert/strict";
import { test } from "node:test";
import { startFakeBidiServer } from "./fake-server.js";
import { BidiTransport } from "./transport.js";

test("fake server: one active session, session.end frees it, bare close does not", async () => {
  const server = await startFakeBidiServer();
  try {
    const a = await BidiTransport.connect(server.url);
    await a.send("session.new", { capabilities: {} });
    assert.equal(server.sessionActive, true);
    await a.close();
    assert.equal(server.sessionActive, true);

    const b = await BidiTransport.connect(server.url);
    await assert.rejects(b.send("session.new", { capabilities: {} }), { code: "session_busy" });
    await b.send("session.end", {});
    assert.equal(server.sessionActive, false);
    await b.send("session.new", { capabilities: {} });
    await b.send("session.end", {});
    await b.close();
  } finally {
    await server.close();
  }
});
