import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveAgentDir } from "../core/storage.js";

export const DEFAULT_STANDALONE_USER_PREFS: Readonly<Record<string, boolean | number | string>> = {
  // WebDriver BiDi activation
  "remote.active-protocols": 1,
  "remote.experimental-modules": 1,
  // Disable first-run / onboarding noise and telemetry
  "browser.shell.checkDefaultBrowser": false,
  "datareporting.policy.dataSubmissionEnabled": false,
  "datareporting.healthreport.uploadEnabled": false,
  "toolkit.telemetry.unified": false,
  "toolkit.telemetry.enabled": false,
  // Enable userChrome.css customizations for standalone window chrome
  "toolkit.legacyUserProfileCustomizations.stylesheets": true,
};

export const STANDALONE_USER_CHROME_CSS = `/* Hide Firefox tabs toolbar and navigation/URL bar for clean standalone app window */
#TabsToolbar {
  visibility: collapse !important;
}
#nav-bar {
  visibility: collapse !important;
}
`;

export function serializeUserJs(prefs: Readonly<Record<string, boolean | number | string>>): string {
  const lines = Object.entries(prefs).map(([key, val]) => {
    return `user_pref(${JSON.stringify(key)}, ${JSON.stringify(val)});`;
  });
  return `${lines.join("\n")}\n`;
}

export function resolveStandaloneProfileDir(appSlug: string, cacheDir?: string): string {
  const agentDir = resolveAgentDir({ cacheDir });
  return join(agentDir, "apps", appSlug, "profile");
}

export async function ensureStandaloneProfile(
  appSlug: string,
  options: {
    cacheDir?: string;
    extraPrefs?: Record<string, boolean | number | string>;
  } = {},
): Promise<string> {
  const profileDir = resolveStandaloneProfileDir(appSlug, options.cacheDir);
  const chromeDir = join(profileDir, "chrome");
  await mkdir(chromeDir, { recursive: true });

  const prefs = {
    ...DEFAULT_STANDALONE_USER_PREFS,
    ...(options.extraPrefs ?? {}),
  };
  const userJsContent = serializeUserJs(prefs);
  await writeFile(join(profileDir, "user.js"), userJsContent, "utf8");
  await writeFile(join(chromeDir, "userChrome.css"), STANDALONE_USER_CHROME_CSS, "utf8");

  return profileDir;
}
