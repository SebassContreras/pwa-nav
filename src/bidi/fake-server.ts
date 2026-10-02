// In-process fake BiDi server for tests (imports `ws`, a devDependency).
// Only import this from *.test.ts files, never from production code.
import { WebSocketServer, type WebSocket as WsSocket } from "ws";

export class FakeBidiError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

// Returned by a handler to leave the command unanswered (timeout tests).
export const NO_REPLY: unique symbol = Symbol("no-reply");

export interface ReceivedCommand {
  id: number;
  method: string;
  params: unknown;
}

export type FakeHandler = (params: unknown, command: ReceivedCommand) => unknown;

export interface FakeBidiServer {
  readonly url: string;
  readonly port: number;
  readonly commands: ReceivedCommand[];
  readonly sessionActive: boolean;
  handle(method: string, handler: FakeHandler): void;
  pushEvent(method: string, params: unknown): void;
  sendRaw(text: string): void;
  // Drops every client socket (no session.end: session stays active, like Firefox).
  dropClients(): void;
  close(): Promise<void>;
}

export async function startFakeBidiServer(handlers: Record<string, FakeHandler> = {}): Promise<FakeBidiServer> {
  const table = new Map<string, FakeHandler>(Object.entries(handlers));
  const commands: ReceivedCommand[] = [];
  const clients = new Set<WsSocket>();
  let sessionActive = false;

  const wss = new WebSocketServer({ host: "127.0.0.1", port: 0, path: "/session" });
  await new Promise<void>((resolve) => {
    wss.once("listening", resolve);
  });
  const address = wss.address();
  if (address === null || typeof address === "string") {
    throw new Error("unexpected listen address");
  }

  function run(command: ReceivedCommand): unknown {
    if (command.method === "session.new") {
      if (sessionActive) {
        throw new FakeBidiError("session not created", "session not created: Maximum number of active sessions");
      }
      sessionActive = true;
      return { sessionId: "fake-session", capabilities: {} };
    }
    if (command.method === "session.end") {
      sessionActive = false;
      return {};
    }
    if (command.method === "input.setFiles") {
      const handler = table.get(command.method);
      if (handler !== undefined) {
        return handler(command.params, command);
      }
      return {};
    }
    const handler = table.get(command.method);
    if (handler === undefined) {
      throw new FakeBidiError("unknown command", `no handler for ${command.method}`);
    }
    return handler(command.params, command);
  }

  wss.on("connection", (socket) => {
    clients.add(socket);
    socket.on("close", () => clients.delete(socket));
    socket.on("message", (raw) => {
      let msg: { id: number; method: string; params?: unknown };
      try {
        msg = JSON.parse(Buffer.isBuffer(raw) ? raw.toString() : Buffer.concat(raw as Buffer[]).toString()) as { id: number; method: string; params?: unknown };
      } catch {
        return;
      }
      const command: ReceivedCommand = { id: msg.id, method: msg.method, params: msg.params };
      commands.push(command);
      void (async () => {
        try {
          const result = await Promise.resolve(run(command));
          if (result === NO_REPLY) {
            return;
          }
          socket.send(JSON.stringify({ type: "success", id: command.id, result: result ?? {} }));
        } catch (error) {
          const code = error instanceof FakeBidiError ? error.code : "unknown error";
          const message = error instanceof Error ? error.message : String(error);
          if (socket.readyState === socket.OPEN) {
            socket.send(JSON.stringify({ type: "error", id: command.id, error: code, message }));
          }
        }
      })();
    });
  });

  const broadcast = (text: string): void => {
    for (const client of clients) {
      client.send(text);
    }
  };

  return {
    url: `ws://127.0.0.1:${String(address.port)}/session`,
    port: address.port,
    commands,
    get sessionActive() {
      return sessionActive;
    },
    handle(method, handler) {
      table.set(method, handler);
    },
    pushEvent(method, params) {
      broadcast(JSON.stringify({ type: "event", method, params }));
    },
    sendRaw: broadcast,
    dropClients() {
      for (const client of clients) {
        client.terminate();
      }
    },
    async close() {
      for (const client of clients) {
        client.terminate();
      }
      await new Promise<void>((resolve) => {
        wss.close(() => {
          resolve();
        });
      });
    },
  };
}
