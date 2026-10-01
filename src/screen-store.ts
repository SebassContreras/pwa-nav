// File store for screen maps (spec 005, T007): validated atomic writes + `snapshot --learn` flow.
import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { mergeIntoMap, type AppInfo, type ScreenDiff } from "./screen-merge.js";
import { loadExplicitMap } from "./screen-match.js";
import { validateScreenMap, type Screen, type ScreenMap } from "./screen-map.js";

function serialize(map: ScreenMap): string {
  const { $schema, ...rest } = map;
  const ordered = $schema === undefined ? rest : { $schema, ...rest };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

/** Validates first (ScreenMapError propagates, nothing written), then writes via temp file + rename. */
export async function writeScreenMap(path: string, map: ScreenMap): Promise<void> {
  await validateScreenMap(map);
  const dir = dirname(path);
  await mkdir(dir, { recursive: true });
  const temp = join(dir, `.${basename(path)}.${randomBytes(6).toString("hex")}.tmp`);
  try {
    await writeFile(temp, serialize(map), "utf8");
    await rename(temp, path);
  } catch (error) {
    await unlink(temp).catch(() => undefined);
    throw error;
  }
}

export interface LearnIntoFileInput {
  path: string;
  learned: Screen;
  app: AppInfo;
  prune?: boolean;
  now?: Date;
}

export async function learnIntoFile(input: LearnIntoFileInput): Promise<{ map: ScreenMap; diff: ScreenDiff; written: boolean }> {
  let existing: ScreenMap | undefined;
  try {
    existing = await loadExplicitMap(input.path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
  const { map, diff } = await mergeIntoMap(existing, input.learned, input.app, {
    ...(input.prune === undefined ? {} : { prune: input.prune }),
    ...(input.now === undefined ? {} : { now: input.now }),
  });
  // Writes only when the file would actually change (a kept-missing-only diff changes nothing).
  const written = existing === undefined || !isDeepStrictEqual(map, existing);
  if (written) {
    await writeScreenMap(input.path, map);
  }
  return { map, diff, written };
}

const short = (fingerprint: string): string => fingerprint.replace(/^sha256:/, "").slice(0, 8);
const show = (value: string | number | boolean | undefined): string =>
  value === undefined ? "-" : typeof value === "string" ? JSON.stringify(value) : String(value);

/** Terse human report; "no changes" for an empty diff. */
export function renderDiff(diff: ScreenDiff): string {
  const lines: string[] = [];
  if (diff.isNew) lines.push("new screen");
  for (const e of diff.added) lines.push(`+ ${e.group} @${e.id} ${e.role} ${JSON.stringify(e.name)}`);
  for (const e of diff.missing) lines.push(`- missing @${e.id} ${e.group} ${e.role} ${JSON.stringify(e.name)}`);
  for (const e of diff.renamed) lines.push(`~ renamed @${e.id} ${JSON.stringify(e.from.name)} -> ${JSON.stringify(e.to.name)}`);
  for (const e of diff.changed) lines.push(`~ changed @${e.id} ${e.field}: ${show(e.from)} -> ${show(e.to)}`);
  if (diff.fingerprint.drifted) {
    lines.push(`fp: ${diff.fingerprint.stored === undefined ? "-" : short(diff.fingerprint.stored)} -> ${short(diff.fingerprint.live)} DRIFT`);
  }
  for (const f of diff.a11y.added) lines.push(`a11y: +${f.code} ${f.target}`);
  for (const f of diff.a11y.resolved) lines.push(`a11y: -${f.code} ${f.target}`);
  return lines.length === 0 ? "no changes" : lines.join("\n");
}
