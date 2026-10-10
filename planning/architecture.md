# Architecture

## Container

Local-only CLI + MCP adapter driving standalone Firefox PWA instances over W3C WebDriver BiDi. No prod deploy in MVP.

## Stack

| Decision | Choice | Why |
|---|---|---|
| Runtime | Node 22 LTS, ESM, TypeScript strict | LTS + native TS support; team standard |
| Package manager | pnpm 11 | Fast, strict, requires Node 22 |
| Browser automation | Raw W3C WebDriver BiDi over WebSocket (Node 22 global `WebSocket`, zero runtime deps) attached to the PWA runtime started with `--remote-debugging-port` | Standard protocol, reuses the logged-in PWA profile; Playwright's Firefox is a patched build that cannot attach to the user's PWA; Mozilla's own tooling (`firefox-devtools-mcp`) validates the approach |
| Snapshot contract | `{snapshotId, url, title, elements[{ref, role, name, value, disabled}]}` written to disk | Refs stable per snapshot only; file + grep keeps tokens low |
| Screen map | `screens/<app>.screens.json`, validated by `schemas/screen-map.schema.json` (JSON Schema 2020-12); routes as URL Pattern strings; flows and multi-screen user journeys across route transitions with settle assertion (`expectScreen`) | Known screens need no snapshot: agent reads a few hundred tokens of capabilities and targets stable `@id`s |
| Interface | CLI (`open`, `snapshot`, `click`, `fill`, `upload`, `act`, `journey`, `screenshot`, `extract`, `qa`) + MCP stdio adapter (`pwa_open`, `pwa_snapshot`, `pwa_click`, `pwa_fill`, `pwa_upload`, `pwa_screenshot`, `pwa_extract`, `pwa_act`, `pwa_learn`, dynamic flows, dynamic journeys) + SKILL.md | CLI-first is token-efficient; MCP reuses same backend |
| Datastore | Local filesystem JSON | No DB needed for MVP |
| Identity | Standalone Firefox PWA profile under `.agent/apps/<appSlug>/profile`; user performs logins | Lawful: agent never handles credentials |
| Write safety | Dry-run unless `--armed`; kill-switch file; origin allow-list; file upload safe path boundary | Multi-layer safety gate limits prompt-injection blast radius |
| Visual QA & Evidence | BiDi `captureScreenshot` saved directly to disk (`.agent/screenshot.png`, `.agent/evidence/`); zero base64 in LLM context | Strict context economy while capturing deterministic visual test evidence |
| CI | `pnpm lint && pnpm build && pnpm test && pnpm smoke` (plus opt-in real Firefox E2E) | Minimal gate, 328+ automated tests |
| Secrets | `.env`, never committed | Standard |
| Observability | `.spectrace/logs` + per-run evidence files | Audit trail |

## Conventions

TypeScript `strict: true`, `module/moduleResolution: nodenext`, `target: es2024` (the pinned TypeScript 5.x accepts at most es2024; see `tsconfig.json`). ESLint; no formatter is configured. All docs in English.

### Codebase structure (Clean Architecture layers)

All source files are partitioned strictly by responsibility under `src/`:

| Layer | Directory | Responsibilities | Dependencies |
|---|---|---|---|
| Core Domain | `src/core/` | Snapshot data types, error taxonomy (`PwaNavError`, 14 error codes mapping to exit codes 2–15), security gates (allow-list, kill-switch, file upload boundary), stable ref store and locator resolution | Zero external I/O |
| Screens Subsystem | `src/screens/` | Screen map models, schema validation (Ajv), route matching, compact view renderer, learn & merge algorithms, user journeys (`journey-model.ts`) | `core` |
| BiDi Protocol | `src/bidi/` | Low-level W3C WebDriver BiDi transport, framing, protocol commands (including `input.setFiles` and `browsingContext.captureScreenshot`), session lifecycle, test fake server | `core` |
| Browser Automation | `src/browser/` | Cross-platform Firefox PWA runtime discovery (Windows, Linux, macOS), in-page DOM collection, element actions (click, fill, upload) with network-idle settle, BiDi backend | `core`, `bidi` |
| Backend Ports | `src/backend/` | `Backend` interface port, `OfflineBackend` and `BidiBackend` implementations, `createBackend` factory | `core`, `browser` |
| Operations | `src/ops/` | High-level CLI/MCP operations (`perform*`), user journeys engine (`journey.ts`), QA verification engine with visual evidence (`qa.ts`) | `core`, `screens`, `backend` |
| CLI Adapter | `src/cli/` | CLI options, screen map subcommands, upload/screenshot commands, command integration tests | `core`, `screens`, `ops` |
| MCP Adapter | `src/mcp/` | Stdio MCP server, tools, dynamic flow and journey tool generators, MCP stdio tests | `core`, `screens`, `ops` |
| Root Binaries | `src/` | Binary entrypoints: `cli.ts` (CLI), `mcp.ts` (MCP), `smoke.ts` (smoke test), `index.ts` (exports), `e2e.test.ts` (Firefox E2E) | Layer modules |

Tests live colocated beside their corresponding unit (e.g. `src/core/gate.test.ts`, `src/browser/actions.test.ts`).

## Fixed rules

- Lawful use only; no CAPTCHA/bot-wall bypass. Hard rule.
- Docs in English, chat in Spanish. Hard rule.
- Re-snapshot after every mutation; stale refs fail fast with re-snapshot instruction.
- Never paste full snapshots inline; write to file and grep.
- Never dump binary images or base64 strings into LLM context; save to disk and report `{path, width, height}`.
- In PowerShell, always quote semantic targets (`'@id'`).
- Restrict file uploads to workspace root and `.agent/` directories without path traversal.

## Still to define

- PWA SDK shape (v2 custom bridge).
- Notebook adapter beyond text extract (post-MVP).

## Declined

- Custom WebSocket bridge in MVP — reuse existing MCP servers for speed.
- Headless credential-based login — use the user's own session.
