import { DEFAULT_HOST, DEFAULT_PORT, OfflineBackend, type Backend } from "./backend.js";
import { BidiBackend } from "../browser/bidi-backend.js";
import { resolveAgentDir } from "../core/storage.js";

export { DEFAULT_HOST, DEFAULT_PORT };

export interface CreateBackendOptions {
  mode: "offline" | "bidi";
  port?: number;
  host?: string;
  contextId?: string;
  armed?: boolean;
  launch?: boolean;
  /** `--cache-dir` (env PWA_NAV_CACHE_DIR). */
  cacheDir?: string;
  env?: NodeJS.ProcessEnv;
}

export function createBackend(options: CreateBackendOptions): Backend {
  const agentDir = resolveAgentDir({ cacheDir: options.cacheDir });
  if (options.mode === "offline") {
    return new OfflineBackend({ agentDir });
  }
  return new BidiBackend({
    port: options.port ?? DEFAULT_PORT,
    host: options.host ?? DEFAULT_HOST,
    agentDir,
    ...(options.contextId === undefined ? {} : { contextId: options.contextId }),
    ...(options.armed === undefined ? {} : { armed: options.armed }),
    ...(options.launch === undefined ? {} : { launch: options.launch }),
    ...(options.env === undefined ? {} : { env: options.env }),
  });
}
