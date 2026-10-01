// WebDriver BiDi transport over the Node global WebSocket (no runtime deps).
// Spec: https://w3c.github.io/webdriver-bidi/ (commands, responses, events).
import { PwaNavError } from "../errors.js";

export const DEFAULT_COMMAND_TIMEOUT_MS = 10_000;
export const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;
export const DEFAULT_WAIT_FOR_TIMEOUT_MS = 10_000;

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["127.0.0.1", "::1", "[::1]", "localhost"]);
const SESSION_BUSY_TEXT = "Maximum number of active sessions";

export type BidiCommandResult = Record<string, unknown>;
export type BidiEventHandler = (params: unknown) => void;

export interface BidiTransportOptions {
  commandTimeoutMs?: number;
  connectTimeoutMs?: number;
  // Receives handler exceptions and malformed frames; never throws into the read loop.
  onError?: (error: Error) => void;
}

interface Pending {
  method: string;
  timer: NodeJS.Timeout;
  resolve: (value: never) => void;
  reject: (error: Error) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

export class BidiTransport {
  readonly url: string;
  private readonly socket: WebSocket;
  private readonly commandTimeoutMs: number;
  private readonly onError: ((error: Error) => void) | undefined;
  private readonly pending = new Map<number, Pending>();
  private readonly handlers = new Map<string, Set<BidiEventHandler>>();
  private readonly closeListeners = new Set<(error: Error) => void>();
  private nextId = 1;
  private closed = false;
  private readonly closedPromise: Promise<void>;
  private resolveClosed: () => void = () => undefined;

  private constructor(url: string, socket: WebSocket, options: BidiTransportOptions) {
    this.url = url;
    this.socket = socket;
    this.commandTimeoutMs = options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
    this.onError = options.onError;
    this.closedPromise = new Promise<void>((resolve) => {
      this.resolveClosed = resolve;
    });
    socket.addEventListener("message", (event) => {
      this.handleFrame(event.data);
    });
    socket.addEventListener("close", () => {
      this.markClosed(true);
    });
    socket.addEventListener("error", () => {
      // A "close" event always follows; pending commands are rejected there.
    });
  }

  static async connect(url: string, options: BidiTransportOptions = {}): Promise<BidiTransport> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch (cause) {
      throw new PwaNavError("invalid_args", `Invalid BiDi endpoint URL: ${url}`, { cause });
    }
    if (!LOOPBACK_HOSTS.has(parsed.hostname)) {
      throw new PwaNavError("invalid_args", `Refusing non-loopback BiDi host "${parsed.hostname}"`, {
        hint: "Use 127.0.0.1, ::1 or localhost.",
      });
    }
    const connectTimeoutMs = options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS;
    const hint = "Is the PWA running with a remote debugging port?";
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      const cleanup = (): void => {
        clearTimeout(timer);
        socket.removeEventListener("open", onOpen);
        socket.removeEventListener("error", onFail);
        socket.removeEventListener("close", onFail);
      };
      const onOpen = (): void => {
        cleanup();
        resolve();
      };
      const onFail = (event: Event): void => {
        cleanup();
        reject(new PwaNavError("no_browser", `Cannot connect to BiDi endpoint ${url}`, { cause: event, hint }));
      };
      const timer = setTimeout(() => {
        cleanup();
        socket.close();
        reject(new PwaNavError("no_browser", `Timed out connecting to BiDi endpoint ${url}`, { hint }));
      }, connectTimeoutMs);
      socket.addEventListener("open", onOpen);
      socket.addEventListener("error", onFail);
      socket.addEventListener("close", onFail);
    });
    return new BidiTransport(url, socket, options);
  }

  get isClosed(): boolean {
    return this.closed;
  }

  send<T = BidiCommandResult>(method: string, params: object = {}): Promise<T> {
    if (this.closed) {
      return Promise.reject(new PwaNavError("protocol", `BiDi connection closed; cannot send ${method}`));
    }
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new PwaNavError("timeout", `BiDi command ${method} timed out after ${String(this.commandTimeoutMs)}ms`),
        );
      }, this.commandTimeoutMs);
      this.pending.set(id, { method, timer, resolve, reject });
      try {
        this.socket.send(JSON.stringify({ id, method, params }));
      } catch (cause) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(new PwaNavError("protocol", `Failed to send BiDi command ${method}`, { cause }));
      }
    });
  }

  on(method: string, handler: BidiEventHandler): () => void {
    let set = this.handlers.get(method);
    if (set === undefined) {
      set = new Set();
      this.handlers.set(method, set);
    }
    set.add(handler);
    return () => {
      this.handlers.get(method)?.delete(handler);
    };
  }

  once(method: string, handler: BidiEventHandler): () => void {
    const off = this.on(method, (params) => {
      off();
      handler(params);
    });
    return off;
  }

  // Resolves with the params of the first matching event.
  waitFor(
    method: string,
    predicate: (params: unknown) => boolean = () => true,
    timeoutMs: number = DEFAULT_WAIT_FOR_TIMEOUT_MS,
  ): Promise<unknown> {
    return new Promise<unknown>((resolve, reject) => {
      if (this.closed) {
        reject(new PwaNavError("protocol", `BiDi connection closed; cannot wait for ${method}`));
        return;
      }
      const finish = (): void => {
        clearTimeout(timer);
        off();
        this.closeListeners.delete(onClose);
      };
      const onClose = (error: Error): void => {
        finish();
        reject(error);
      };
      const timer = setTimeout(() => {
        finish();
        reject(new PwaNavError("timeout", `Timed out after ${String(timeoutMs)}ms waiting for ${method}`));
      }, timeoutMs);
      const off = this.on(method, (params) => {
        let matched = false;
        try {
          matched = predicate(params);
        } catch (error) {
          finish();
          reject(toError(error));
          return;
        }
        if (matched) {
          finish();
          resolve(params);
        }
      });
      this.closeListeners.add(onClose);
    });
  }

  // Idempotent; rejects pending commands and resolves once the socket is closed.
  close(): Promise<void> {
    if (this.socket.readyState === WebSocket.CLOSED) {
      this.markClosed(true);
    } else {
      this.markClosed(false);
      if (this.socket.readyState !== WebSocket.CLOSING) {
        this.socket.close();
      }
    }
    return this.closedPromise;
  }

  private markClosed(socketDone: boolean): void {
    if (!this.closed) {
      this.closed = true;
      const error = new PwaNavError("protocol", "BiDi connection closed");
      for (const [id, entry] of this.pending) {
        clearTimeout(entry.timer);
        this.pending.delete(id);
        entry.reject(error);
      }
      for (const listener of [...this.closeListeners]) {
        listener(error);
      }
      this.closeListeners.clear();
      this.handlers.clear();
    }
    if (socketDone) {
      this.resolveClosed();
    }
  }

  private report(error: Error): void {
    try {
      this.onError?.(error);
    } catch {
      // onError must never break the read loop.
    }
  }

  private handleFrame(data: unknown): void {
    if (this.closed) {
      return;
    }
    let message: unknown;
    try {
      message = JSON.parse(typeof data === "string" ? data : String(data));
    } catch (cause) {
      this.report(new PwaNavError("protocol", "Ignored non-JSON BiDi frame", { cause }));
      return;
    }
    if (!isRecord(message)) {
      this.report(new PwaNavError("protocol", "Ignored malformed BiDi frame"));
      return;
    }
    if (message.type === "event" && typeof message.method === "string") {
      this.dispatchEvent(message.method, message.params);
      return;
    }
    if (typeof message.id === "number" && (message.type === "success" || message.type === "error")) {
      this.settle(message.id, message);
      return;
    }
    this.report(new PwaNavError("protocol", "Ignored malformed BiDi frame"));
  }

  private dispatchEvent(method: string, params: unknown): void {
    const set = this.handlers.get(method);
    if (set === undefined) {
      return;
    }
    for (const handler of [...set]) {
      try {
        handler(params);
      } catch (error) {
        this.report(toError(error));
      }
    }
  }

  private settle(id: number, message: Record<string, unknown>): void {
    const entry = this.pending.get(id);
    if (entry === undefined) {
      return;
    }
    clearTimeout(entry.timer);
    this.pending.delete(id);
    if (message.type === "success") {
      entry.resolve((isRecord(message.result) ? message.result : {}) as never);
      return;
    }
    const code = typeof message.error === "string" ? message.error : "unknown error";
    const text = typeof message.message === "string" ? message.message : "";
    const full = `BiDi ${entry.method} failed: ${code}: ${text}`;
    if (text.includes(SESSION_BUSY_TEXT)) {
      entry.reject(
        new PwaNavError("session_busy", full, {
          hint:
            "Another BiDi client (e.g. the browser-bidi skill) or an orphaned session holds the only session slot. " +
            "Restarting the PWA clears an orphaned session.",
        }),
      );
      return;
    }
    entry.reject(new PwaNavError("protocol", full));
  }
}
