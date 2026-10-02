// Compact screen view for spec 005-screen-map (T005).
// Pure, deterministic text rendering of a Screen: one line per non-empty group,
// ids first, array order preserved. No IO, no mutation of the input.
import type { Screen, ScreenMap } from "./screen-map.js";

export interface RenderOptions {
  maxNameLength?: number;
}

const DEFAULT_MAX_NAME = 60;

// Backslash-escapes quotes, backslashes and control chars so a name never breaks a line.
function escapeName(raw: string): string {
  let out = "";
  for (const ch of raw) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === "\\" || ch === '"') {
      out += `\\${ch}`;
    } else if (ch === "\n") {
      out += "\\n";
    } else if (ch === "\r") {
      out += "\\r";
    } else if (ch === "\t") {
      out += "\\t";
    } else if (code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029) {
      out += `\\u${code.toString(16).padStart(4, "0")}`;
    } else {
      out += ch;
    }
  }
  return out;
}

// Truncates by code point (before escaping) and quotes the result.
function quoted(name: string, max: number): string {
  const chars = Array.from(name);
  const text = chars.length > max ? `${chars.slice(0, Math.max(0, max - 1)).join("")}…` : name;
  return `"${escapeName(text)}"`;
}

function fingerprintShort(fingerprint: string): string {
  return fingerprint.replace(/^sha256:/, "").slice(0, 8);
}

function externalHost(href: string): string {
  try {
    return new URL(href).host;
  } catch {
    return href;
  }
}

function requiredInputs(schema: Record<string, unknown>): string[] {
  const required = schema["required"];
  return Array.isArray(required) ? required.filter((item): item is string => typeof item === "string") : [];
}

export function renderScreenView(screen: Screen, options: RenderOptions = {}): string {
  const max = options.maxNameLength ?? DEFAULT_MAX_NAME;
  const lines = [`${screen.id} ${screen.route} ${screen.access} fp:${fingerprintShort(screen.fingerprint)}`];

  const fields = screen.fields.map((f) => {
    const parts = [`@${f.id}`, f.role, quoted(f.name, max)];
    if (f.sensitive || !f.agentFillable) {
      parts.push("SENSITIVE(human)");
    }
    return parts.join(" ");
  });
  const actions = screen.actions.map((a) => {
    const parts = [`@${a.id}`, a.role, quoted(a.name, max)];
    if (a.requires !== undefined && a.requires.length > 0) {
      parts.push(`needs(${a.requires.map((id) => `@${id}`).join(",")})`);
    }
    if (a.effect === "submit") {
      parts.push("submit");
    }
    return parts.join(" ");
  });
  const links = screen.links.map((l) => `@${l.id} -> ${l.external ? `external ${externalHost(l.href)}` : l.href}`);
  const flows = screen.flows.map((f) =>
    f.humanOnly ? `${f.id} HUMAN-ONLY` : `${f.id} inputs(${requiredInputs(f.inputSchema).join(",")})`,
  );
  const a11y = (screen.a11y ?? []).map((finding) => `${finding.target} ${finding.code}`);

  const groups: [string, string[]][] = [
    ["fields", fields],
    ["actions", actions],
    ["links", links],
    ["flows", flows],
    ["a11y", a11y],
  ];
  for (const [label, entries] of groups) {
    if (entries.length > 0) {
      lines.push(`${label}: ${entries.join(" | ")}`);
    }
  }
  return lines.join("\n");
}

// Shown by the CLI when no mapped screen matches the current location.
export function renderUnmappedHint(pathname: string, origin: string): string {
  return [
    `unmapped screen: ${pathname} on ${origin}`,
    "run `snapshot --learn` on this screen to add it to the map",
  ].join("\n");
}

// Compact map overview: app header, one line per screen, unmapped entries.
export function renderMapSummary(map: ScreenMap): string {
  const { app } = map;
  const lines = [`app: ${app.id} "${escapeName(app.name)}" ${app.origin} locale:${app.locale}`];
  for (const s of map.screens) {
    lines.push(`${s.id} ${s.route} ${s.access} fp:${fingerprintShort(s.fingerprint)}`);
  }
  const unmapped = (map.unmapped ?? []).map((u) => `${u.route ?? "*"} ${u.reason}`);
  if (unmapped.length > 0) {
    lines.push(`unmapped: ${unmapped.join(" | ")}`);
  }
  return lines.join("\n");
}
