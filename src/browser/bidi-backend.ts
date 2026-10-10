// BidiBackend (spec 004, T010): the Backend port over WebDriver BiDi.
// Every operation is ONE withTopLevelContext session (connect -> work -> session.end);
// a session is never reused (Firefox allows a single active session).
import { dirname, join } from "node:path";
import { addAllowedOrigin, assertArmedAllowed, assertFileUploadAllowed, assertNavigationAllowed } from "../core/gate.js";
import { resolveAgentDir } from "../core/storage.js";
import { withTopLevelContext, type TopLevelContextOptions } from "../bidi/session.js";
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
  type ScreenshotOptions,
  type Session,
} from "../backend/backend.js";
import { PwaNavError } from "../core/errors.js";
import { load as loadSnapshot, loadLocators, resolveLocator, saveLive } from "../core/refs.js";
import type { Locator } from "../screens/screen-map.js";
import type { Snapshot } from "../core/snapshot.js";
import { clickLocator, collectLive, describeTarget, fillLocator, uploadFiles, type LiveCollect } from "./actions.js";
import type { RawElement } from "./collector.js";
import { buildLiveSnapshot, type LiveExtras } from "./live-snapshot.js";
import { assertFresh } from "./locate.js";
import {
  firefoxPwaDir,
  launchCommandHint,
  runtimePath,
  tcpProbe,
  type PortProbe,
} from "./pwa-runtime.js";
import { appSlugFromUrl } from "../backend/backend.js";
import { buildStandaloneLaunchArgs } from "./standalone-runner.js";
import { DefaultPwaProvisioner, type PwaProvisioner } from "./provisioner.js";

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
  platform?: string;
  /** Transport/signal options passed to every session. */
  session?: TopLevelContextOptions;
  probe?: PortProbe;
  provisioner?: PwaProvisioner;
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

  private readonly provisioner: PwaProvisioner;

  constructor(options: BidiBackendOptions) {
    this.options = options;
    this.port = options.port;
    this.host = options.host ?? DEFAULT_HOST;
    this.endpoint = endpointFor(this.port, this.host);
    this.armed = options.armed === true;
    this.agentDir = options.agentDir ?? resolveAgentDir();
    this.env = options.env ?? process.env;
    this.platform = options.platform ?? process.platform;
    this.provisioner = options.provisioner ?? new DefaultPwaProvisioner();
  }

  // --- session plumbing ---

  private async run<T>(
    originUrl: string | undefined,
    fn: (client: BidiClient, context: string) => Promise<T>,
  ): Promise<T> {
    const probe = this.options.probe ?? tcpProbe;
    const maxAttempts = 3;
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await withTopLevelContext(this.endpoint, fn, {
          ...this.options.session,
          contextTimeoutMs: this.options.session?.contextTimeoutMs ?? 3000,
          ...(this.options.contextId === undefined ? {} : { contextId: this.options.contextId }),
        });
      } catch (error) {
        lastError = error;
        if (
          attempt < maxAttempts &&
          error instanceof PwaNavError &&
          (error.code === "no_browser" || error.code === "session_busy") &&
          (await probe(this.host, this.port).catch(() => false))
        ) {
          await new Promise((r) => setTimeout(r, 400));
          continue;
        }
        if (error instanceof PwaNavError && error.code === "no_browser") {
          throw this.withLaunchHint(error, originUrl);
        }
        throw error;
      }
    }
    throw lastError;
  }

  // Best effort: exact launch command for the matching site, else a generic hint.
  private withLaunchHint(error: PwaNavError, originUrl: string | undefined): PwaNavError {
    let hint = `start the PWA runtime with --remote-debugging-port ${String(this.port)} (or: open <url> --launch)`;
    try {
      if (originUrl === undefined) throw new Error("no origin");
      const dir = firefoxPwaDir(this.platform, this.env);
      const appSlug = appSlugFromUrl(originUrl);
      const profileDir = join(this.agentDir, "apps", appSlug, "profile");
      const args = buildStandaloneLaunchArgs({ profileDir, appSlug, port: this.port, url: originUrl });
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
    const target = url;
    if (target.length === 0 || !isHttpUrl(target)) {
      throw new PwaNavError("invalid_args", `invalid URL (expected http/https): ${url}`);
    }
    // Before launch/connect: nothing touches the browser unless the origin is consented or installed.
    await assertNavigationAllowed({
      url: target,
      allowOrigin: opts.allowOrigin === true,
      agentDir: this.agentDir,
      env: this.env,
    });
    const probe = this.options.probe ?? tcpProbe;
    const portOpen = await probe(this.host, this.port);
    if (!portOpen && this.options.launch === true) {
      await this.provisioner.provisionAndLaunch(target, {
        port: this.port,
        cacheDir: this.agentDir,
        launchOptions: {
          host: this.host,
          env: this.env,
          platform: this.platform,
          probe,
        },
      });
    }
    const navigated = await this.run(target, (client, context) => client.navigate(context, target, "complete"));
    if (opts.allowOrigin === true) {
      await addAllowedOrigin(new URL(target).origin, this.agentDir);
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

  async screenshot(options?: ScreenshotOptions): Promise<Buffer> {
    const b64 = await this.run(await this.sessionUrl(), async (client, context) => {
      const bidiOpts =
        options !== undefined
          ? {
              ...(options.clip !== undefined ? { clip: options.clip } : {}),
              ...(options.format !== undefined ? { format: { type: `image/${options.format}` as const } } : {}),
            }
          : undefined;
      return client.captureScreenshot(context, bidiOpts);
    });
    return Buffer.from(b64, "base64");
  }

  async click(snapshotId: string, ref: string, ctx: ActionContext = {}): Promise<ActionResult> {
    return this.single(await this.runBatch(snapshotId, [{ kind: "click", ref }], ctx));
  }

  async fill(snapshotId: string, ref: string, text: string, ctx: ActionContext = {}): Promise<ActionResult> {
    return this.single(await this.runBatch(snapshotId, [{ kind: "fill", ref, text }], ctx));
  }

  async upload(snapshotId: string, ref: string, files: readonly string[], ctx: ActionContext = {}): Promise<ActionResult> {
    return this.single(await this.runBatch(snapshotId, [{ kind: "upload", ref, files }], ctx));
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

    const safeRoots = [process.cwd(), this.agentDir, dirname(this.agentDir)];
    for (const op of ops) {
      if (op.kind === "upload") {
        for (const file of op.files) {
          assertFileUploadAllowed(file, safeRoots);
        }
      }
    }

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
            ...(op.kind === "upload" ? { files: op.files } : {}),
          });
          let result: ActionResult;
          if (!armed) {
            result = { kind: "dry-run", plan, snapshotId, url: live.url, title: live.title };
          } else {
            const state =
              op.kind === "click"
                ? await clickLocator(client, context, current, locator, { includeAll })
                : op.kind === "fill"
                  ? await fillLocator(client, context, current, locator, op.text, { includeAll })
                  : await uploadFiles(client, context, current, locator, op.files, { includeAll });
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
