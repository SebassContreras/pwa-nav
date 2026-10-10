import test from "node:test";
import assert from "node:assert/strict";
import { allocatePort } from "../port-allocator.js";

test("allocatePort returns startPort if not in reservedPorts and probe is free", async () => {
  const mockProbe = () => Promise.resolve(false);
  const port = await allocatePort([], { startPort: 9222, probe: mockProbe });
  assert.equal(port, 9222);
});

test("allocatePort skips reserved ports", async () => {
  const mockProbe = () => Promise.resolve(false);
  const port = await allocatePort([9222, 9223], { startPort: 9222, probe: mockProbe });
  assert.equal(port, 9224);
});

test("allocatePort skips open ports reported by probe", async () => {
  const mockProbe = (_host: string, port: number) => Promise.resolve(port === 9222);
  const port = await allocatePort([], { startPort: 9222, probe: mockProbe });
  assert.equal(port, 9223);
});

test("allocatePort skips both reserved and probe open ports", async () => {
  const mockProbe = (_host: string, port: number) => Promise.resolve(port === 9223);
  const port = await allocatePort([9222], { startPort: 9222, probe: mockProbe });
  assert.equal(port, 9224);
});

test("allocatePort throws when maxAttempts exceeded", async () => {
  const mockProbe = () => Promise.resolve(true);
  await assert.rejects(
    async () => {
      await allocatePort([], { startPort: 9222, maxAttempts: 3, probe: mockProbe });
    },
    /could not allocate an available debugging port between 9222 and 9224/,
  );
});
