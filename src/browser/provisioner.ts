import { appSlugFromUrl } from "../backend/backend.js";
import { ensureStandaloneProfile } from "./standalone-profile.js";
import {
  launchStandaloneApp,
  type StandaloneLaunchOptions,
  type StandaloneLaunchResult,
} from "./standalone-runner.js";

/**
 * Domain specification and runtime configuration for an isolated standalone PWA.
 */
export interface ProvisionedPwa {
  url: string;
  appSlug: string;
  profileDir: string;
}

/**
 * Options for provisioning a target URL as a standalone PWA.
 */
export interface ProvisionOptions {
  cacheDir?: string;
  port?: number;
  launchOptions?: Partial<StandaloneLaunchOptions>;
}

/**
 * Result of provisioning and optionally launching a standalone PWA.
 */
export interface ProvisionResult extends ProvisionedPwa {
  launchResult?: StandaloneLaunchResult;
}

/**
 * Anti-corruption service layer interface for PWA provisioning.
 * Abstracts on-the-fly registration, profile setup, and execution.
 */
export interface PwaProvisioner {
  /**
   * Resolves the app slug for a given target URL.
   */
  resolveSlug(url: string): string;

  /**
   * Prepares the isolated profile for the target URL.
   */
  provision(url: string, options?: ProvisionOptions): Promise<ProvisionedPwa>;

  /**
   * Prepares the profile and launches the standalone PWA instance.
   */
  provisionAndLaunch(url: string, options: ProvisionOptions & { port: number }): Promise<ProvisionResult>;
}

/**
 * Default implementation of PwaProvisioner.
 * Uses appSlugFromUrl, ensureStandaloneProfile, and launchStandaloneApp by composition.
 */
export class DefaultPwaProvisioner implements PwaProvisioner {
  private readonly launchFn: typeof launchStandaloneApp;

  constructor(options: { launchFn?: typeof launchStandaloneApp } = {}) {
    this.launchFn = options.launchFn ?? launchStandaloneApp;
  }

  resolveSlug(url: string): string {
    return appSlugFromUrl(url);
  }

  async provision(url: string, options: ProvisionOptions = {}): Promise<ProvisionedPwa> {
    const appSlug = this.resolveSlug(url);
    const profileDir = await ensureStandaloneProfile(appSlug, { cacheDir: options.cacheDir });
    return {
      url,
      appSlug,
      profileDir,
    };
  }

  async provisionAndLaunch(
    url: string,
    options: ProvisionOptions & { port: number },
  ): Promise<ProvisionResult> {
    const provisioned = await this.provision(url, options);
    const launchResult = await this.launchFn({
      url,
      appSlug: provisioned.appSlug,
      port: options.port,
      cacheDir: options.cacheDir,
      ...options.launchOptions,
    });
    return {
      ...provisioned,
      launchResult,
    };
  }
}
