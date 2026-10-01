# Architecture

## Container

Local-only CLI + MCP adapter driving the user's own logged-in Firefox PWA (PWAsForFirefox runtime) over W3C WebDriver BiDi. No prod deploy in MVP.

## Stack

| Decision | Choice | Why |
|---|---|---|
| Runtime | Node 22 LTS, ESM, TypeScript strict | LTS + native TS support; team standard |
| Package manager | pnpm 11 | Fast, strict, requires Node 22 |
| Browser automation | Raw W3C WebDriver BiDi over WebSocket (Node 22 global `WebSocket`, zero runtime deps) attached to the PWA runtime started with `--remote-debugging-port` | Standard protocol, reuses the logged-in PWA profile; Playwright's Firefox is a patched build that cannot attach to the user's PWA; Mozilla's own tooling (`firefox-devtools-mcp`) validates the approach |
| Snapshot contract | `{snapshotId, url, title, elements[{ref, role, name, value, disabled}]}` written to disk | Refs stable per snapshot only; file + grep keeps tokens low |
| Screen map | `screens/<app>.screens.json`, validated by `schemas/screen-map.schema.json` (JSON Schema 2020-12); routes as URL Pattern strings; flows/actions shaped like MCP tool descriptors (`inputSchema`) | Known screens need no snapshot: agent reads a few hundred tokens of capabilities and targets stable `@id`s |
| Interface | CLI (`open`, `snapshot`, `click`, `fill`, `extract`) + MCP stdio adapter + SKILL.md | CLI-first is token-efficient; MCP reuses same backend |
| Datastore | Local filesystem JSON | No DB needed for MVP |
| Identity | Firefox PWA profile (`%APPDATA%\FirefoxPWA\profiles\<ULID>`), user performs logins | Lawful: agent never handles credentials |
| Write safety | Dry-run unless `--armed`; kill-switch file; origin allow-list | Same gate the user already trusts in `browser-bidi`; limits prompt-injection blast radius |
| CI | `pnpm lint && pnpm build && pnpm test && pnpm smoke` | Minimal gate |
| Secrets | `.env`, never committed | Standard |
| Observability | `.specloop/logs` + per-run evidence files | Audit trail |

## Conventions

TypeScript `strict: true`, `module/moduleResolution: nodenext`, `target: es2025`. ESLint + Prettier. All docs in English.

## Fixed rules

- Lawful use only; no CAPTCHA/bot-wall bypass. Hard rule.
- Docs in English, chat in Spanish. Hard rule.
- Re-snapshot after every mutation; stale refs fail fast with re-snapshot instruction.
- Never paste full snapshots inline; write to file and grep.

## Still to define

- PWA SDK shape (v2 custom bridge).
- Whether node references survive across BiDi sessions (spec 004 spike decides the ref locator strategy).
- Notebook adapter beyond text extract (post-MVP).

## Declined

- Custom WebSocket bridge in MVP — reuse existing MCP servers for speed.
- Headless credential-based login — use the user's own session.
