import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ensureParentDir } from "../backend/backend.js";
import { resolveAgentDir } from "../core/storage.js";
import { tcpProbe, type PortProbe } from "./pwa-runtime.js";
import type { PwaInstance, PwaInstanceRegistry } from "./port-allocator.js";

export interface FileInstanceRegistryOptions {
  agentDir?: string;
  cacheDir?: string;
  probe?: PortProbe;
  host?: string;
}

export class FileInstanceRegistry implements PwaInstanceRegistry {
  readonly registryPath: string;
  private readonly probe: PortProbe;
  private readonly host: string;

  constructor(options: FileInstanceRegistryOptions = {}) {
    const agentDir = options.agentDir ?? resolveAgentDir({ cacheDir: options.cacheDir });
    this.registryPath = join(agentDir, "instances.json");
    this.probe = options.probe ?? tcpProbe;
    this.host = options.host ?? "127.0.0.1";
  }

  private async readAll(): Promise<Record<string, PwaInstance>> {
    try {
      const text = await readFile(this.registryPath, "utf8");
      const parsed = JSON.parse(text) as unknown;
      if (typeof parsed === "object" && parsed !== null) {
        return parsed as Record<string, PwaInstance>;
      }
      return {};
    } catch {
      return {};
    }
  }

  private async writeAll(data: Record<string, PwaInstance>): Promise<void> {
    await ensureParentDir(this.registryPath);
    await writeFile(this.registryPath, JSON.stringify(data, null, 2) + "\n", "utf8");
  }

  async register(instance: PwaInstance): Promise<void> {
    const all = await this.readAll();
    all[instance.appSlug] = instance;
    await this.writeAll(all);
  }

  async unregister(appSlug: string): Promise<void> {
    const all = await this.readAll();
    if (Object.prototype.hasOwnProperty.call(all, appSlug)) {
      const remaining: Record<string, PwaInstance> = {};
      for (const [k, v] of Object.entries(all)) {
        if (k !== appSlug) {
          remaining[k] = v;
        }
      }
      await this.writeAll(remaining);
    }
  }

  async findByApp(appSlug: string): Promise<PwaInstance | null> {
    const all = await this.readAll();
    return all[appSlug] ?? null;
  }

  async findByPort(port: number): Promise<PwaInstance | null> {
    const all = await this.readAll();
    for (const inst of Object.values(all)) {
      if (inst.port === port) {
        return inst;
      }
    }
    return null;
  }

  async listActive(): Promise<PwaInstance[]> {
    const all = await this.readAll();
    return Object.values(all);
  }

  /**
   * Health checks each registered instance port via probe.
   * If a port is not responding, removes the instance from the registry.
   * Returns remaining active instances.
   */
  async prune(): Promise<PwaInstance[]> {
    const all = await this.readAll();
    let modified = false;
    const remaining: Record<string, PwaInstance> = {};

    for (const [slug, inst] of Object.entries(all)) {
      const isListening = await this.probe(this.host, inst.port);
      if (isListening) {
        remaining[slug] = inst;
      } else {
        modified = true;
      }
    }

    if (modified) {
      await this.writeAll(remaining);
    }

    return Object.values(remaining);
  }
}
