// Typed subset of WebDriver BiDi (https://w3c.github.io/webdriver-bidi/) over BidiTransport.
// Only the commands pwa-nav needs; everything else is deliberately absent.
import { PwaNavError } from "../errors.js";
import { type BidiTransport } from "./transport.js";

export type WaitState = "none" | "interactive" | "complete";

export interface TopLevelContext {
  context: string;
  url: string;
  userContext: string;
}

export interface NavigateResult {
  navigation: string | null;
  url: string;
}

export const NAVIGATION_EVENTS = [
  "browsingContext.navigationStarted",
  "browsingContext.load",
  "browsingContext.domContentLoaded",
  "browsingContext.fragmentNavigated",
] as const;
export type NavigationEvent = (typeof NAVIGATION_EVENTS)[number];

// Never expand DOM nodes (node ids do not survive across sessions; the collector
// returns plain data). Object depth 10 covers the collector payload
// ({elements:[{locator:{...}}]}) with headroom while bounding pathological pages.
export const SERIALIZATION_OPTIONS = { maxDomDepth: 0, maxObjectDepth: 10 } as const;

interface RemoteValueBase {
  type: string;
  value?: unknown;
}
export type RemoteValue = RemoteValueBase;

/** BiDi argument referencing a node handle obtained in the SAME session. */
export interface NodeArgument {
  type: "node";
  sharedId: string;
}

export interface NavigationWatch {
  /** A navigationStarted event was seen since the watch was created. */
  readonly started: boolean;
  /** A load event was seen since the watch was created. */
  readonly loaded: boolean;
  /** Resolves true as soon as navigationStarted was seen, false after windowMs without it. */
  waitStarted(windowMs: number): Promise<boolean>;
  /** Resolves when a load was seen (possibly already); rejects with `timeout`. */
  waitLoaded(timeoutMs: number): Promise<void>;
  dispose(): void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function bad(message: string): PwaNavError {
  return new PwaNavError("protocol", message);
}

function pairs(remote: RemoteValue): [unknown, unknown][] {
  if (!Array.isArray(remote.value)) {
    throw bad(`Malformed BiDi ${remote.type} value (maybe beyond maxObjectDepth)`);
  }
  return (remote.value as unknown[]).map((entry) => {
    if (!Array.isArray(entry) || entry.length !== 2) {
      throw bad(`Malformed BiDi ${remote.type} entry`);
    }
    return [entry[0], entry[1]];
  });
}

function items(remote: RemoteValue): unknown[] {
  if (!Array.isArray(remote.value)) {
    throw bad(`Malformed BiDi ${remote.type} value (maybe beyond maxObjectDepth)`);
  }
  return remote.value as unknown[];
}

function asRemote(value: unknown): RemoteValue {
  if (!isRecord(value) || typeof value.type !== "string") {
    throw bad("Malformed BiDi RemoteValue");
  }
  return value as unknown as RemoteValue;
}

function key(raw: unknown): string | number | boolean | null | undefined {
  if (typeof raw === "string") {
    return raw;
  }
  const decoded = fromRemoteValue(raw);
  if (typeof decoded === "string" || typeof decoded === "number" || typeof decoded === "boolean" || decoded == null) {
    return decoded;
  }
  throw bad("Unsupported BiDi object key");
}

// Deserializes a BiDi RemoteValue into plain JS. Unknown/unsupported types throw `protocol`.
export function fromRemoteValue(input: unknown): unknown {
  const remote = asRemote(input);
  switch (remote.type) {
    case "undefined":
      return undefined;
    case "null":
      return null;
    case "string":
    case "boolean":
      return remote.value;
    case "number": {
      switch (remote.value) {
        case "NaN":
          return NaN;
        case "Infinity":
          return Infinity;
        case "-Infinity":
          return -Infinity;
        case "-0":
          return -0;
        default:
          if (typeof remote.value !== "number") {
            throw bad("Malformed BiDi number value");
          }
          return remote.value;
      }
    }
    case "bigint":
      if (typeof remote.value !== "string") {
        throw bad("Malformed BiDi bigint value");
      }
      return BigInt(remote.value);
    case "date":
    case "regexp":
      // Kept as the raw serialization; callers rarely need these.
      return remote.value;
    case "array":
      return items(remote).map(fromRemoteValue);
    case "set":
      return new Set(items(remote).map(fromRemoteValue));
    case "object": {
      const out: Record<string, unknown> = {};
      for (const [k, v] of pairs(remote)) {
        out[String(key(k))] = fromRemoteValue(v);
      }
      return out;
    }
    case "map": {
      const out = new Map<unknown, unknown>();
      for (const [k, v] of pairs(remote)) {
        out.set(typeof k === "string" ? k : fromRemoteValue(k), fromRemoteValue(v));
      }
      return out;
    }
    default:
      throw bad(`Unsupported BiDi RemoteValue type "${remote.type}"`);
  }
}

interface EvaluateSuccess {
  type: "success";
  result: RemoteValue;
}
interface EvaluateException {
  type: "exception";
  exceptionDetails?: { text?: string; exception?: RemoteValue };
}
type ScriptResult = EvaluateSuccess | EvaluateException;

function unwrapScript(raw: ScriptResult): unknown {
  if (raw.type === "exception") {
    const details = raw.exceptionDetails;
    let text = details?.text ?? "unknown";
    if (details?.exception?.type === "error" || details?.exception?.type === "string") {
      const v = details.exception.value;
      if (typeof v === "string") {
        text += `: ${v}`;
      }
    }
    throw bad(`Script exception: ${text}`);
  }
  return fromRemoteValue(raw.result);
}

function eventContext(params: unknown): string | undefined {
  return isRecord(params) && typeof params.context === "string" ? params.context : undefined;
}

export class BidiClient {
  private readonly transport: BidiTransport;

  constructor(transport: BidiTransport) {
    this.transport = transport;
  }

  async sessionNew(): Promise<void> {
    await this.transport.send("session.new", { capabilities: {} });
  }

  async sessionEnd(): Promise<void> {
    await this.transport.send("session.end", {});
  }

  // Top-level contexts only (getTree without root; children are ignored).
  async getTopLevelContexts(): Promise<TopLevelContext[]> {
    const res = await this.transport.send<{ contexts?: Record<string, unknown>[] }>("browsingContext.getTree", {});
    if (!Array.isArray(res.contexts)) {
      throw bad("Malformed browsingContext.getTree result");
    }
    return res.contexts.map((c) => ({
      context: String(c.context),
      url: typeof c.url === "string" ? c.url : "",
      userContext: typeof c.userContext === "string" ? c.userContext : "default",
    }));
  }

  async navigate(context: string, url: string, wait: WaitState = "complete"): Promise<NavigateResult> {
    const res = await this.transport.send<{ navigation?: string | null; url?: string }>("browsingContext.navigate", {
      context,
      url,
      wait,
    });
    return { navigation: res.navigation ?? null, url: res.url ?? url };
  }

  // Returns the deserialized plain value; throws `protocol` on a script exception.
  async evaluate(context: string, expression: string, awaitPromise = true): Promise<unknown> {
    const raw = await this.transport.send<ScriptResult>("script.evaluate", {
      expression,
      target: { context },
      awaitPromise,
      resultOwnership: "none",
      serializationOptions: SERIALIZATION_OPTIONS,
    });
    return unwrapScript(raw);
  }

  // `args` are BiDi LocalValues (e.g. {type:"string", value:"x"}).
  async callFunction(
    context: string,
    functionDeclaration: string,
    args: readonly unknown[] = [],
    awaitPromise = true,
  ): Promise<unknown> {
    const raw = await this.transport.send<ScriptResult>("script.callFunction", {
      functionDeclaration,
      arguments: args,
      target: { context },
      awaitPromise,
      resultOwnership: "none",
      serializationOptions: SERIALIZATION_OPTIONS,
    });
    return unwrapScript(raw);
  }

  // Like callFunction but returns the RAW RemoteValue (needed to read a node `sharedId`).
  // Pass resultOwnership "root" to keep the returned node handle usable in this session.
  // Arguments may include `{type:"node", sharedId}` (NodeArgument).
  async callFunctionRaw(
    context: string,
    functionDeclaration: string,
    args: readonly unknown[] = [],
    options: { awaitPromise?: boolean; resultOwnership?: "root" | "none" } = {},
  ): Promise<RemoteValue> {
    const raw = await this.transport.send<ScriptResult>("script.callFunction", {
      functionDeclaration,
      arguments: args,
      target: { context },
      awaitPromise: options.awaitPromise ?? true,
      resultOwnership: options.resultOwnership ?? "none",
      serializationOptions: SERIALIZATION_OPTIONS,
    });
    if (raw.type === "exception") {
      unwrapScript(raw);
    }
    return asRemote((raw as EvaluateSuccess).result);
  }

  // Starts listening NOW for navigation events in `context`, so events fired while an
  // input command is still in flight are not missed (transport.waitFor does not buffer).
  // Requires a prior subscribe to navigationStarted and load. Call dispose() when done.
  watchNavigation(context?: string): NavigationWatch {
    let started = false;
    let loaded = false;
    const waiters = new Set<() => void>();
    const wake = (): void => {
      for (const w of waiters) w();
    };
    const offs = [
      this.transport.on("browsingContext.navigationStarted", (params) => {
        if (context === undefined || eventContext(params) === context) {
          started = true;
          wake();
        }
      }),
      this.transport.on("browsingContext.load", (params) => {
        if (context === undefined || eventContext(params) === context) {
          loaded = true;
          wake();
        }
      }),
    ];
    const until = (flag: () => boolean, ms: number): Promise<boolean> =>
      new Promise<boolean>((resolve) => {
        if (flag()) {
          resolve(true);
          return;
        }
        const done = (): void => {
          clearTimeout(timer);
          waiters.delete(check);
          resolve(flag());
        };
        const check = (): void => {
          if (flag()) done();
        };
        const timer = setTimeout(done, ms);
        waiters.add(check);
      });
    return {
      get started() {
        return started;
      },
      get loaded() {
        return loaded;
      },
      waitStarted: (windowMs) => until(() => started, windowMs),
      async waitLoaded(timeoutMs) {
        if (!(await until(() => loaded, timeoutMs))) {
          throw new PwaNavError("timeout", `Timed out after ${String(timeoutMs)}ms waiting for browsingContext.load`);
        }
      },
      dispose() {
        for (const off of offs) off();
        waiters.clear();
      },
    };
  }

  async performActions(context: string, actions: readonly unknown[]): Promise<void> {
    await this.transport.send("input.performActions", { context, actions });
  }

  async releaseActions(context: string): Promise<void> {
    await this.transport.send("input.releaseActions", { context });
  }

  async subscribe(events: readonly string[], contexts?: readonly string[]): Promise<void> {
    await this.transport.send("session.subscribe", contexts === undefined ? { events } : { events, contexts });
  }

  // Requires a prior subscribe(["browsingContext.load"]).
  async waitForLoad(timeoutMs?: number, context?: string): Promise<void> {
    await this.transport.waitFor(
      "browsingContext.load",
      (params) => context === undefined || eventContext(params) === context,
      timeoutMs,
    );
  }

  // True if a navigationStarted event arrives within windowMs. Requires a prior
  // subscribe(["browsingContext.navigationStarted"]) and must be called before the
  // triggering action completes its settle window (feeds T009 settle logic).
  async didNavigateWithin(windowMs: number, context?: string): Promise<boolean> {
    try {
      await this.transport.waitFor(
        "browsingContext.navigationStarted",
        (params) => context === undefined || eventContext(params) === context,
        windowMs,
      );
      return true;
    } catch (error) {
      if (error instanceof PwaNavError && error.code === "timeout") {
        return false;
      }
      throw error;
    }
  }
}
