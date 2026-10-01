// Screen lookup for spec 005 (T004): map by origin, route match, ambiguity.
// Pure logic + directory IO. No browser calls.
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { PwaNavError } from "./errors.js";
import { loadScreenMap, ScreenMapError } from "./screen-map.js";
import type { Screen, ScreenMap } from "./screen-map.js";

export interface RouteMatch {
  params: Record<string, string>;
  literalSegments: number;
  paramSegments: number;
}

export interface LoadedMap {
  path: string;
  map: ScreenMap;
}

const FORBIDDEN_PATTERN_CHARS = /[*(){}?]/;
const PARAM_NAME = /^:[A-Za-z_][A-Za-z0-9_]*$/;

// "/a/b/" -> ["a","b"]; "/" -> []. Empty interior segments are kept (they never match params).
function segmentsOf(path: string): string[] {
  const body = path.startsWith("/") ? path.slice(1) : path;
  const trimmed = body.endsWith("/") ? body.slice(0, -1) : body;
  return trimmed === "" ? [] : trimmed.split("/");
}

// Documented subset only: literal segments and `:name` segments.
export function assertValidRoutePattern(pattern: string): void {
  if (!pattern.startsWith("/")) {
    throw new PwaNavError("invalid_args", `route "${pattern}" must start with "/"`);
  }
  if (FORBIDDEN_PATTERN_CHARS.test(pattern)) {
    throw new PwaNavError("invalid_args", `route "${pattern}" uses unsupported syntax (wildcards, groups, optionals)`, {
      hint: "only literal segments and :name params are supported",
    });
  }
  const names = new Set<string>();
  for (const segment of segmentsOf(pattern)) {
    if (segment === "") {
      throw new PwaNavError("invalid_args", `route "${pattern}" has an empty segment`);
    }
    if (segment.startsWith(":")) {
      if (!PARAM_NAME.test(segment)) {
        throw new PwaNavError("invalid_args", `route "${pattern}" has an invalid param "${segment}"`);
      }
      if (names.has(segment)) {
        throw new PwaNavError("invalid_args", `route "${pattern}" repeats param "${segment}"`);
      }
      names.add(segment);
    }
  }
}

function safeDecode(value: string): string | undefined {
  try {
    return decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

// Case-sensitive. Trailing slash is ignored on both sides. Null when the pathname does not match.
export function matchRoute(pattern: string, pathname: string): RouteMatch | null {
  assertValidRoutePattern(pattern);
  const wanted = segmentsOf(pattern);
  const actual = segmentsOf(pathname);
  if (wanted.length !== actual.length) {
    return null;
  }
  const params: Record<string, string> = {};
  let literalSegments = 0;
  let paramSegments = 0;
  for (const [index, segment] of wanted.entries()) {
    const decoded = safeDecode(actual[index] ?? "");
    if (decoded === undefined) {
      return null;
    }
    if (segment.startsWith(":")) {
      if (decoded === "") {
        return null;
      }
      params[segment.slice(1)] = decoded;
      paramSegments += 1;
    } else {
      if (decoded !== (safeDecode(segment) ?? segment)) {
        return null;
      }
      literalSegments += 1;
    }
  }
  return { params, literalSegments, paramSegments };
}

// Higher is more specific: more literal segments first, then fewer params.
export function routeSpecificity(match: Pick<RouteMatch, "literalSegments" | "paramSegments">): number {
  return match.literalSegments * 1024 - match.paramSegments;
}

function literalCount(segments: readonly string[]): number {
  return segments.filter((segment) => !segment.startsWith(":")).length;
}

// Two patterns overlap when some pathname matches both (segment-wise unifiable).
function unifiable(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  return a.every((left, index) => {
    const right = b[index] ?? "";
    if (left.startsWith(":") || right.startsWith(":")) {
      return true;
    }
    return (safeDecode(left) ?? left) === (safeDecode(right) ?? right);
  });
}

// Pairs of screen ids whose routes overlap with equal specificity.
export function findAmbiguousRoutes(screens: readonly Pick<Screen, "id" | "route">[]): [string, string][] {
  const pairs: [string, string][] = [];
  screens.forEach((first, index) => {
    const a = segmentsOf(first.route);
    for (const second of screens.slice(index + 1)) {
      const b = segmentsOf(second.route);
      if (literalCount(a) === literalCount(b) && unifiable(a, b)) {
        pairs.push([first.id, second.id]);
      }
    }
  });
  return pairs;
}

export function assertNoAmbiguousRoutes(map: Pick<ScreenMap, "screens">): void {
  for (const screen of map.screens) {
    assertValidRoutePattern(screen.route);
  }
  const [pair] = findAmbiguousRoutes(map.screens);
  if (pair !== undefined) {
    const routeOf = (id: string): string => map.screens.find((screen) => screen.id === id)?.route ?? "?";
    throw new PwaNavError(
      "invalid_args",
      `ambiguous routes: screen "${pair[0]}" (${routeOf(pair[0])}) and screen "${pair[1]}" (${routeOf(pair[1])}) can match the same URL`,
      { hint: "make one route more specific or remove the duplicate" },
    );
  }
}

function parseHttpUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch (error) {
    throw new PwaNavError("invalid_args", `not a valid URL: ${url}`, { cause: error });
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new PwaNavError("invalid_args", `only http(s) URLs can be mapped: ${url}`);
  }
  return parsed;
}

function originOf(origin: string): string {
  try {
    return new URL(origin).origin;
  } catch {
    return origin;
  }
}

export function findScreen(map: ScreenMap, url: string): { screen: Screen; params: Record<string, string> } {
  const parsed = parseHttpUrl(url);
  if (parsed.origin !== originOf(map.app.origin)) {
    throw new PwaNavError("unmapped_screen", `origin ${parsed.origin} is not covered by this screen map`, {
      hint: `this map covers ${map.app.origin}`,
    });
  }
  let best: { screen: Screen; params: Record<string, string>; score: number } | undefined;
  let tied = false;
  for (const screen of map.screens) {
    const match = matchRoute(screen.route, parsed.pathname);
    if (match === null) {
      continue;
    }
    const score = routeSpecificity(match);
    if (best === undefined || score > best.score) {
      best = { screen, params: match.params, score };
      tied = false;
    } else if (score === best.score) {
      tied = true;
    }
  }
  if (best === undefined) {
    throw new PwaNavError("unmapped_screen", `no mapped screen for ${parsed.pathname}`, {
      hint: `run: snapshot --learn (pathname ${parsed.pathname})`,
    });
  }
  if (tied) {
    throw new PwaNavError("invalid_args", `ambiguous screen map: several routes match ${parsed.pathname}`);
  }
  return { screen: best.screen, params: best.params };
}

export function resolveScreensDir(
  options: { screensDir?: string } = {},
  env: Record<string, string | undefined> = process.env,
): string {
  const fromEnv = env.PWA_NAV_SCREENS_DIR;
  return options.screensDir ?? (fromEnv === undefined || fromEnv === "" ? "./screens" : fromEnv);
}

function prefixed(path: string, error: unknown): unknown {
  if (error instanceof ScreenMapError) {
    return new ScreenMapError(error.issues.map((issue) => ({ path: `${path}${issue.path}`, message: issue.message })));
  }
  if (error instanceof SyntaxError) {
    return new PwaNavError("invalid_args", `${path}: ${error.message}`, { cause: error });
  }
  return error;
}

// `--screen-map <file>`: explicit path, validation errors name the file.
export async function loadExplicitMap(path: string): Promise<ScreenMap> {
  try {
    return await loadScreenMap(path);
  } catch (error) {
    throw prefixed(path, error);
  }
}

// Every `*.screens.json` in dir, sorted by name. Missing dir => []. Invalid files are not swallowed.
export async function loadScreenMapsFromDir(dir: string): Promise<LoadedMap[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const loaded: LoadedMap[] = [];
  for (const name of names.filter((entry) => entry.endsWith(".screens.json")).sort()) {
    const path = join(dir, name);
    loaded.push({ path, map: await loadExplicitMap(path) });
  }
  return loaded;
}

// The single map whose app.origin equals the URL origin.
export function selectMap(
  maps: readonly ScreenMap[] | readonly LoadedMap[],
  url: string,
  screensDir?: string,
): ScreenMap {
  const entries: LoadedMap[] = maps.map((entry) =>
    "map" in entry ? entry : { path: `${entry.app.id}.screens.json`, map: entry },
  );
  const origin = parseHttpUrl(url).origin;
  const hits = entries.filter((entry) => originOf(entry.map.app.origin) === origin);
  const [only, second] = hits;
  if (only === undefined) {
    const mapped = entries.map((entry) => entry.map.app.origin);
    throw new PwaNavError("unmapped_screen", `no screen map for origin ${origin}`, {
      hint:
        `mapped origins: ${mapped.length === 0 ? "none" : mapped.join(", ")}` +
        (screensDir === undefined ? "" : `; screens dir: ${screensDir}`) +
        "; run: snapshot --learn",
    });
  }
  if (second !== undefined) {
    throw new PwaNavError(
      "invalid_args",
      `several screen maps cover origin ${origin}: ${hits.map((entry) => entry.path).join(", ")}`,
      { hint: "keep one map per origin or pass --screen-map <file>" },
    );
  }
  return only.map;
}

export const selectMapForOrigin = selectMap;
