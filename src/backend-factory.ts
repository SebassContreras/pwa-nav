// Backend selection for the CLI (task T011 wires flags to this).
import { DEFAULT_HOST, DEFAULT_PORT, OfflineBackend, type Backend } from "./backend.js";
import { BidiBackend } from "./browser/bidi-backend.js";

export { DEFAULT_HOST, DEFAULT_PORT };

export interface CreateBackendOptions {
  mode: "offline" | "bidi";
  port?: number;
  host?: string;
  contextId?: string;
  armed?: boolean;
  launch?: boolean;
  siteId?: string;
  agentDir?: string;
  env?: NodeJS.ProcessEnv;
}

export function createBackend(options: CreateBackendOptions): Backend {
  if (options.mode === "offline") {
    return new OfflineBackend(options.agentDir === undefined ? {} : { agentDir: options.agentDir });
  }
  return new BidiBackend({
    port: options.port ?? DEFAULT_PORT,
    host: options.host ?? DEFAULT_HOST,
    ...(options.contextId === undefined ? {} : { contextId: options.contextId }),
    ...(options.armed === undefined ? {} : { armed: options.armed }),
    ...(options.launch === undefined ? {} : { launch: options.launch }),
    ...(options.siteId === undefined ? {} : { siteId: options.siteId }),
    ...(options.agentDir === undefined ? {} : { agentDir: options.agentDir }),
    ...(options.env === undefined ? {} : { env: options.env }),
  });
}
