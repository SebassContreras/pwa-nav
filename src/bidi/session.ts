// One short-lived BiDi session per command. session.end is mandatory: Firefox keeps
// the single session slot alive after a bare socket close (see design, Measured facts).
import { PwaNavError } from "../core/errors.js";
import { BidiClient } from "./protocol.js";
import { BidiTransport, type BidiTransportOptions } from "./transport.js";

export type HandledSignal = "SIGINT" | "SIGTERM";
const EXIT_CODES: Record<HandledSignal, number> = { SIGINT: 130, SIGTERM: 143 };

export interface SignalSource {
  on(signal: HandledSignal, listener: () => void): unknown;
  off(signal: HandledSignal, listener: () => void): unknown;
}

export interface SessionOptions {
  transport?: BidiTransportOptions;
  // Defaults to `process`; injectable for tests.
  signals?: SignalSource;
  // Runs after cleanup on a signal. Default: process.exit(exitCode).
  onSignal?: (signal: HandledSignal, exitCode: number) => void;
}

export interface TopLevelContextOptions extends SessionOptions {
  contextId?: string;
  contextTimeoutMs?: number;
}

export async function withSession<T>(
  endpoint: string,
  fn: (client: BidiClient) => Promise<T>,
  options: SessionOptions = {},
): Promise<T> {
  const transport = await BidiTransport.connect(endpoint, options.transport);
  const client = new BidiClient(transport);
  let maybeSession = false;
  let cleanupPromise: Promise<Error | undefined> | undefined;

  // Idempotent; always closes the socket; resolves with the session.end error, if any.
  const cleanup = (): Promise<Error | undefined> => {
    cleanupPromise ??= (async () => {
      let endError: Error | undefined;
      if (maybeSession && transport.isClosed) {
        endError = new PwaNavError("protocol", "BiDi connection lost before session.end; the session may still be active", {
          hint: "Restarting the PWA clears an orphaned session.",
        });
      } else if (maybeSession) {
        try {
          await client.sessionEnd();
        } catch (error) {
          endError = error instanceof Error ? error : new Error(String(error));
        }
      }
      await transport.close();
      return endError;
    })();
    return cleanupPromise;
  };

  const source: SignalSource = options.signals ?? process;
  const onSignal =
    options.onSignal ??
    ((_signal: HandledSignal, exitCode: number): void => {
      process.exit(exitCode);
    });
  const listeners = new Map<HandledSignal, () => void>();
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    const listener = (): void => {
      void cleanup().then(() => {
        onSignal(signal, EXIT_CODES[signal]);
      });
    };
    listeners.set(signal, listener);
    source.on(signal, listener);
  }

  let result: T;
  try {
    try {
      maybeSession = true;
      try {
        await client.sessionNew();
      } catch (error) {
        maybeSession = false; // no session to end (e.g. session_busy)
        throw error;
      }
      result = await fn(client);
    } catch (error) {
      await cleanup(); // original error wins over any session.end failure
      throw error;
    }
    const endError = await cleanup();
    if (endError !== undefined) {
      throw endError;
    }
  } finally {
    for (const [signal, listener] of listeners) {
      source.off(signal, listener);
    }
  }
  return result;
}

// Resolves the single top-level context (or the explicit contextId) in a fresh session.
export async function withTopLevelContext<T>(
  endpoint: string,
  fn: (client: BidiClient, context: string) => Promise<T>,
  options: TopLevelContextOptions = {},
): Promise<T> {
  return withSession(
    endpoint,
    async (client) => {
      let contexts = await client.getTopLevelContexts();
      const timeoutMs = options.contextTimeoutMs ?? 0;
      if (contexts.length === 0 && timeoutMs > 0) {
        const deadline = Date.now() + timeoutMs;
        while (contexts.length === 0 && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 200));
          contexts = await client.getTopLevelContexts();
        }
      }
      const { contextId } = options;
      if (contextId !== undefined) {
        if (!contexts.some((c) => c.context === contextId)) {
          throw new PwaNavError("invalid_args", `Unknown top-level context "${contextId}"`, {
            hint: `Available: ${contexts.map((c) => c.context).join(", ") || "none"}`,
          });
        }
        return fn(client, contextId);
      }
      const [only, ...rest] = contexts;
      if (only === undefined) {
        throw new PwaNavError("no_browser", "No top-level browsing context found", {
          hint: "Is the PWA window open?",
        });
      }
      if (rest.length > 0) {
        throw new PwaNavError("invalid_args", `Multiple top-level contexts open (${String(contexts.length)})`, {
          hint: `Pass --context <id>. Available: ${contexts.map((c) => c.context).join(", ")}`,
        });
      }
      return fn(client, only.context);
    },
    options,
  );
}
