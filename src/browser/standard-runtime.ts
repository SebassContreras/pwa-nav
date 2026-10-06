import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { PwaNavError } from "../core/errors.js";
import { validatePort } from "./pwa-runtime.js";
import { writeFile } from "node:fs/promises";

type Env = Readonly<Record<string, string | undefined>>;

export function findStandardFirefox(platform: string = process.platform, env: Env = process.env): string {
  if (platform === "win32") {
    const programFiles = env["ProgramFiles"] || "C:\\Program Files";
    const programFilesX86 = env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
    const localAppData = env["LOCALAPPDATA"];
    
    const candidates = [
      join(programFiles, "Mozilla Firefox", "firefox.exe"),
      join(programFilesX86, "Mozilla Firefox", "firefox.exe"),
      localAppData ? join(localAppData, "Mozilla Firefox", "firefox.exe") : "",
    ].filter(Boolean);

    for (const c of candidates) {
      if (existsSync(c)) return c;
    }
  } else if (platform === "linux") {
    const candidates = ["/usr/bin/firefox", "/snap/bin/firefox"];
    for (const c of candidates) {
      if (existsSync(c)) return c;
    }
  } else if (platform === "darwin") {
    const candidate = "/Applications/Firefox.app/Contents/MacOS/firefox";
    if (existsSync(candidate)) return candidate;
  }

  throw new PwaNavError("no_browser", `cannot locate standard Firefox on platform "${platform}"`);
}

export async function initStandardProfile(profileDir: string): Promise<void> {
  if (!existsSync(profileDir)) {
    mkdirSync(profileDir, { recursive: true });
  }
  const userJsPath = join(profileDir, "user.js");
  if (!existsSync(userJsPath)) {
    // Inject configurations to avoid annoyances
    const prefs = [
      `user_pref("browser.shell.checkDefaultBrowser", false);`,
      `user_pref("toolkit.telemetry.enabled", false);`,
      `user_pref("datareporting.healthreport.uploadEnabled", false);`,
      `user_pref("browser.startup.homepage", "about:blank");`,
      `user_pref("browser.tabs.warnOnClose", false);`,
      `user_pref("remote.active-protocols", 3);` // Enable WebDriver BiDi (3 = both CDP and BiDi)
    ].join("\n");
    await writeFile(userJsPath, prefs + "\n", "utf8");
  }
}

export interface StandardLaunchInput {
  targetUrl: string;
  port: number;
  profileDir: string;
  host?: string;
  platform?: string;
  env?: Env;
}

export async function launchStandardFirefox(input: StandardLaunchInput): Promise<ChildProcess> {
  const binary = findStandardFirefox(input.platform, input.env);
  validatePort(input.port);
  
  await initStandardProfile(input.profileDir);

  const args = [
    "--profile", input.profileDir,
    "--remote-debugging-port", String(input.port),
    "--no-default-browser-check",
    input.targetUrl
  ];

  const proc = spawn(binary, args, {
    stdio: "ignore",
    detached: true,
    env: input.env,
  });
  proc.unref();

  // Wait a moment for it to start
  await new Promise((resolve) => setTimeout(resolve, 2000));
  return proc;
}
