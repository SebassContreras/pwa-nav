// BidiBackend (spec 004, T010): the Backend port over WebDriver BiDi.
// Every operation is ONE withTopLevelContext session (connect -> work -> session.end);
// a session is never reused (Firefox allows a single active session).
import { addAllowedOrigin, assertArmedAllowed, assertNavigationAllowed, DEFAULT_AGENT_DIR } from "../core/gate.js";
import { withTopLevelContext, type SessionOptions } from "../bidi/session.js";
import type { BidiClient } from "../bidi/protocol.js";
import {
  DEFAULT_HOST,
  agentPath,
  isHttpUrl,
  loadSession,
  writeSession,
  type ActOp,
  type ActResult,
  type ActionContext,
  type ActionResult,
  type Backend,
  type OpenOptions,
  type Session,
} from "../backend/backend.js";
import { PwaNavError } from "../core/errors.js";
import { load as loadSnapshot, loadLocators, resolveLocator, saveLive } from "../core/refs.js";
import type { Locator } from "../screens/screen-map.js";
import type { Snapshot } from "../core/snapshot.js";
import { clickLocator, collectLive, describeTarget, fillLocator, type LiveCollect } from "./actions.js";
import type { RawElement } from "./collector.js";
import { buildLiveSnapshot, type LiveExtras } from "./live-snapshot.js";
import { assertFresh } from "./locate.js";
import {
  buildLaunchArgs,
  findSite,
  firefoxPwaDir,
  launchCommandHint,
  launchPwa,
  profileDirOf,
  readConfig,
  runtimePath,
  tcpProbe,
  type PortProbe,
} from "./pwa-runtime.js";

export function endpointFor(port: number, host: string = DEFAULT_HOST): string {
  const shown = host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
  return `ws://${shown}:${String(port)}/session`;
}

export interface BidiBackendOptions {
  port: number;
  host?: string;
  contextId?: string;
  /** Default armed flag; `ctx.armed` overrides per call. Unarmed = dry-run. */
  armed?: boolean;
  agentDir?: string;
  env?: NodeJS.ProcessEnv;
  /** `open` starts the PWA runtime first (never writes to the profile). */
  launch?: boolean;
  /** Disambiguates several firefoxpwa sites on one origin (launch and hints). */
  siteId?: string;
  platform?: string;
  /** Transport/signal options passed to every session. */
  session?: SessionOptions;
  probe?: PortProbe;
  launchFn?: typeof launchPwa;
  /** Test hook: runs after each completed armed op of a batch (index is zero-based). */
  onOpDone?: (index: number) => void | Promise<void>;
}

interface Target {
  op: ActOp;
  locator: Locator;
}

// Treat a stored password type as sensitive even if the live element lost it.
function withExtras(live: RawElement, extras: LiveExtras | undefined): RawElement {
  if (extras === undefined) return live;
  return {
    ...live,
    ...(live.inputType === undefined && extras.inputType !== undefined ? { inputType: extras.inputType } : {}),
    ...(live.autocomplete === undefined && extras.autocomplete !== undefined
      ? { autocomplete: extras.autocomplete }
      : {}),
  };
}

export class BidiBackend implements Backend {
  readonly agentDir: string;
  private readonly port: number;
  private readonly host: string;
  private readonly endpoint: string;
  private readonly armed: boolean;
  private readonly env: NodeJS.ProcessEnv;
  private readonly platform: string;
  private readonly options: BidiBackendOptions;

  constructor(options: BidiBackendOptions) {
    this.options = options;
    this.port = options.port;
    this.host = options.host ?? DEFAULT_HOST;
    this.endpoint = endpointFor(this.port, this.host);
    this.armed = options.armed === true;
    this.agentDir = options.agentDir ?? DEFAULT_AGENT_DIR;
    this.env = options.env ?? process.env;
    this.platform = options.platform ?? process.platform;
  }

  // --- session plumbing ---

  private async run<T>(
    originUrl: string | undefined,
    fn: (client: BidiClient, context: string) => Promise<T>,
  ): Promise<T> {
    try {
      return await withTopLevelContext(this.endpoint, fn, {
        ...this.options.session,
        ...(this.options.contextId === undefined ? {} : { contextId: this.options.contextId }),
      });
    } catch (error) {
      if (error instanceof PwaNavError && error.code === "no_browser") {
        throw await this.withLaunchHint(error, originUrl);
      }
      throw error;
    }
  }

  // Best effort: exact launch command for the matching site, else a generic hint.
  private async withLaunchHint(error: PwaNavError, originUrl: string | undefined): Promise<PwaNavError> {
    let hint = `start the PWA runtime with --remote-debugging-port ${String(this.port)} (or: open <url> --launch)`;
    try {
      if (originUrl === undefined) throw new Error("no origin");
      const dir = firefoxPwaDir(this.platform, this.env);
      const site = findSite(await readConfig(dir), new URL(originUrl).origin, this.options.siteId);
      const args = buildLaunchArgs({ profileDir: profileDirOf(dir, site), siteId: site.ulid, port: this.port });
      hint = `launch the PWA: ${launchCommandHint(runtimePath(dir, this.platform), args, this.platform)}`;
    } catch {
      // keep the generic hint
    }
    return new PwaNavError("no_browser", error.message, { hint, cause: error });
  }

  private async sessionUrl(): Promise<string | undefined> {
    return (await loadSession(agentPath(this.agentDir, "session.json")))?.url;
  }

  private async assertGate(armed: boolean, ...urls: string[]): Promise<void> {
    for (const origin of urls) {
      const decision = await assertArmedAllowed({ armed, origin, agentDir: this.agentDir, env: this.env });
      if (decision.kind === "blocked") throw decision.error;
    }
  }

  // --- Backend ---

  async open(url: string, opts: OpenOptions = {}): Promise<Session> {
    if (url.length === 0 || !isHttpUrl(url)) {
      throw new PwaNavError("invalid_args", `invalid URL (expected http/https): ${url}`);
    }
    // Before launch/connect: nothing touches the browser unless the origin is consented.
    await assertNavigationAllowed({
      url,
      allowOrigin: opts.allowOrigin === true,
      agentDir: this.agentDir,
      env: this.env,
    });
    if (this.options.launch === true) {
      const probe = this.options.probe ?? tcpProbe;
      if (!(await probe(this.host, this.port))) {
        await (this.options.launchFn ?? launchPwa)({
          origin: new URL(url).origin,
          port: this.port,
          host: this.host,
          env: this.env,
          platform: this.platform,
          ...(this.options.siteId === undefined ? {} : { siteId: this.options.siteId }),
          ...(this.options.probe === undefined ? {} : { probe: this.options.probe }),
        });
      }
    }
    const navigated = await this.run(url, (client, context) => client.navigate(context, url, "complete"));
    if (opts.allowOrigin === true) {
      await addAllowedOrigin(new URL(url).origin, this.agentDir);
    }
    const session: Session = { url: navigated.url, title: "", openedAt: new Date().toISOString() };
    await writeSession(this.agentDir, session);
    return session;
  }

  async collect(opts: { includeAll?: boolean } = {}): Promise<LiveCollect> {
    return this.run(await this.sessionUrl(), (client, context) =>
      collectLive(client, context, { includeAll: opts.includeAll === true }),
    );
  }

  async currentUrl(): Promise<string> {
    return this.run(await this.sessionUrl(), async (client, context) => {
      const href = await client.evaluate(context, "location.href");
      if (typeof href !== "string") throw new PwaNavError("protocol", "location.href is not a string");
      return href;
    });
  }

  async click(snapshotId: string, ref: string, ctx: ActionContext = {}): Promise<ActionResult> {
    return this.single(await this.runBatch(snapshotId, [{ kind: "click", ref }], ctx));
  }

  async fill(snapshotId: string, ref: string, text: string, ctx: ActionContext = {}): Promise<ActionResult> {
    return this.single(await this.runBatch(snapshotId, [{ kind: "fill", ref, text }], ctx));
  }

  act(snapshotId: string, ops: readonly ActOp[], ctx: ActionContext = {}): Promise<ActResult> {
    return this.runBatch(snapshotId, ops, ctx);
  }

  private single(batch: ActResult): ActionResult {
    const [first] = batch.results;
    if (first === undefined) throw new PwaNavError("protocol", "empty action result");
    return {
      kind: first.kind,
      plan: first.plan,
      snapshotId: batch.snapshotId,
      url: first.url,
      title: first.title,
    };
  }

  // One session for the whole batch. Refs are resolved from the INITIAL snapshot up front
  // (a stale ref aborts before anything happens); each op is re-validated against the live DOM.
  private async runBatch(snapshotId: string, ops: readonly ActOp[], ctx: ActionContext): Promise<ActResult> {
    const armed = ctx.armed ?? this.armed;
    const store = { agentDir: this.agentDir };

    const targets: Target[] = [];
    for (const op of ops) {
      targets.push({ op, locator: (await resolveLocator(snapshotId, op.ref, store)).locator });
    }
    const initial = await loadSnapshot(snapshotId, store);
    if (initial === null || targets.length === 0) return { snapshotId, results: [] };
    const sidecar = await loadLocators(snapshotId, store);
    const extras = sidecar?.extras ?? {};
    // Collection mode comes from the snapshot being acted on, so occurrence indexes match.
    const includeAll = sidecar?.includeAll ?? ctx.includeAll === true;

    // Cheap pre-check: nothing touches the browser when the gate already blocks.
    await this.assertGate(armed, initial.url);

    return this.run(initial.url, async (client, context) => {
      let current: Snapshot = initial;
      const results: ActionResult[] = [];
      let executed = 0;
      try {
        for (const [index, { op, locator }] of targets.entries()) {
          const live = await collectLive(client, context, { includeAll });
          // Gate before freshness: a cross-origin page must read as origin_blocked, not stale.
          await this.assertGate(armed, current.url, live.url);
          const { element } = assertFresh({ snapshot: current, locator, live });
          const plan = describeTarget({
            action: op.kind,
            locator,
            element: withExtras(element, Object.hasOwn(extras, op.ref) ? extras[op.ref] : undefined),
            ...(op.kind === "fill" ? { text: op.text } : {}),
          });
          let result: ActionResult;
          if (!armed) {
            result = { kind: "dry-run", plan, snapshotId, url: live.url, title: live.title };
          } else {
            const state =
              op.kind === "click"
                ? await clickLocator(client, context, current, locator, { includeAll })
                : await fillLocator(client, context, current, locator, op.text, { includeAll });
            executed++;
            current = { ...current, url: state.url };
            result = { kind: "done", plan, snapshotId, url: state.url, title: state.title, interim: true };
          }
          results.push(result);
          ctx.onResult?.(op, result);
          if (armed) await this.options.onOpDone?.(index);
        }
        if (executed === 0) return { snapshotId, results };
        return { snapshotId: await this.persist(client, context, includeAll), results };
      } catch (error) {
        // Input already happened: supersede the old snapshot so its refs fail fast.
        if (executed > 0) {
          await this.persist(client, context, includeAll).catch(() => undefined);
        }
        throw error;
      }
    });
  }

  // Re-collect the live DOM and store it as the new latest snapshot (+ locator sidecar).
  private async persist(client: BidiClient, context: string, includeAll: boolean): Promise<string> {
    const live = await collectLive(client, context, { includeAll });
    const built = buildLiveSnapshot(live.raw, { url: live.url, title: live.title });
    await saveLive(built.snapshot, built.locators, built.extras, { agentDir: this.agentDir, includeAll });
    return built.snapshot.snapshotId;
  }
}
