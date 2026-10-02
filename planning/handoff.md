# Handoff — 2026-10-01

State after implementing specs 004–006. Read `planning/roadmap.md` first, then this file.

## State

| Spec | Status | Agent work | Open |
|---|---|---|---|
| 001–003 | done | MVP (offline) | — |
| 004 firefox-bidi-backend | done | T001–T014, T016–T018 done | T015 (human) |
| 005 screen-map | done | T001–T014 done | — |
| 006 mcp-adapter | done | T001–T007, T009 done | **T008** (human) |

Gate at handoff: `pnpm lint && pnpm build && pnpm test` (285 tests) `&& pnpm smoke`, the three `node dist/cli.js qa run <check-file>`, and the opt-in real-Firefox E2E `PWA_NAV_E2E=1 node --test dist/e2e.test.js` (14/14, headless Firefox, temp profile) all green.

## Open work

1. **004 T018 — settle after submit-like actions (agent, DONE).** Network-idle awareness added to `settle` in `src/browser/actions.ts` via BiDi `network.beforeRequestSent` / `network.responseCompleted` / `network.fetchError` in-flight tracking. Loops until network idle and DOM quiescence. Unit tests added to `protocol.test.ts` and `actions.test.ts`. Real-Firefox E2E fixture with 400 ms delayed fetch added to `checks/fixtures/e2e/index.html` and verified green (14/14).
2. **005 T012 — learn authenticated screens (human-assisted, DONE).** Learned `/app/` on the live Sigestran PWA (port 9222); generated `screens/sigestran-web.screens.json` with 24 interactive elements, verified live dry-run `@id` actions, and measured token reduction (57% vs full snapshot, 86% vs raw screen JSON) in `docs/screen-map.md`.
3. **004 T015 — firefoxpwa paths on Linux/macOS (human).** Only Windows (`%APPDATA%\FirefoxPWA`) is verified. Linux `~/.local/share/firefoxpwa` is taken from the `browser-bidi` skill notes, macOS is a TBD error in `runtimePath`. `PWA_NAV_FIREFOXPWA_DIR` overrides.
4. **006 T008 — register the MCP server (human).** `claude mcp add pwa-nav -- node <abs>/dist/mcp.js --port 9222` or use the repo `mcp.json`; confirm one armed call (separate `--armed` entry, supervised). Client-specific syntax in `docs/mcp.md` is marked unverified.
5. Not exercised live: `open --launch` against the real PWA runtime (it would close/reopen the user's window); MCP session from a real client.

## Safety rules learned the hard way

- The user's real Sigestran PWA runs with `--remote-debugging-port 9222`. Default `--port` is 9222 and the default backend is live. Two sub-agents navigated the real window by accident (a test, then a docs run). Never run the CLI or tests without an explicit fake/closed port; CLI tests already poison `PWA_NAV_PORT` (`src/cli.test.ts`).
- Firefox allows ONE BiDi session. A client that exits without `session.end` blocks everything ("Maximum number of active sessions") until the PWA restarts. Every pwa-nav command ends its session in `finally`; the `browser-bidi` skill cannot run at the same time.
- `open` now needs an allow-listed origin or `--allow-origin` (navigation moves the real window). `.agent/allow.json` currently lists `http://localhost:5173` (git-ignored).
- Writes are dry-run unless `--armed`. `--armed` is flag-only on the CLI; the MCP server arms only from its own `--armed` / `PWA_NAV_ARMED=1`, never from a tool argument.
- The agent never fills sensitive fields (exit 11); `humanOnly` flows are refused before inputs are read.

## Decisions worth knowing

- Browser: Firefox PWA over raw W3C WebDriver BiDi (Node global `WebSocket`, no runtime dependency in the BiDi stack). Playwright cannot attach to a PWAsForFirefox profile. `firefoxpwa site launch -- args` drops the debugging flag, so the runtime is spawned directly.
- Node handles do not survive BiDi sessions (measured), so refs are re-resolved by locator `{role, name, occurrence}` against a fresh DOM; `includeAll` is stored in the snapshot sidecar so occurrence indexes match.
- Default backend is `bidi`; offline fixtures need `--backend offline` (smoke and `qa run` do).
- Screen maps are app-agnostic data: the repo ships `examples/screens/demo-app.screens.json` only; real maps live in the git-ignored `screens/`. External links are stored origin-only. Re-learn never renames or deletes ids (`--prune` is explicit); a reviewer's `sensitive` correction is authoritative, only a password input escalates automatically.
- `@id` actions resolve through a fresh quiet snapshot so gate, dry-run and snapshot invalidation reuse the `eN` paths (costs one extra BiDi session, zero tokens).
- MCP uses the low-level SDK `Server` (JSON Schema tools, Ajv validation); the lint rule `no-deprecated` is disabled for that file on purpose. Flow tools are `flow_<screen>_<flow>`, loaded once at startup from the single map found.
- `ajv` is a runtime dependency (map validation, MCP argument validation); `@modelcontextprotocol/sdk` is pinned at 1.31.0.

## Known limits and risks

- Only Windows + Firefox 156.0.1 verified. `contenteditable` caret and NBSP behavior measured on that version only.
- One E2E run had a 23 s `fill` outlier (not reproduced in 5 reruns). A page with perpetual mutations costs the 5 s settle cap per action.
- `\n` in `fill` text is typed as Enter (can submit a form). Private-use code points are rejected (WebDriver reads them as special keys).
- Dry-run and armed plans echo non-sensitive fill text; sensitive fields are redacted.
- The `waitFrames` fallback (100 ms) in `actions.ts` is a literal inside the in-page function, not a named constant.
- Token claims are limited to one measured 6-element screen: the saving is round trips, not payload.

## Map of the code

| Area | Files |
|---|---|
| Core domain | `src/core/{errors,snapshot,refs,gate}.ts` |
| BiDi stack | `src/bidi/{transport,protocol,session,fake-server}.ts` |
| Browser layer | `src/browser/{pwa-runtime,collector,live-snapshot,locate,actions,bidi-backend}.ts` |
| Backend ports | `src/backend/{backend,backend-factory}.ts` |
| Operations | `src/ops/{ops,qa}.ts` |
| Screen map | `schemas/screen-map.schema.json`, `src/screens/screen-{map,match,view,learn,merge,store,resolve}.ts`, `examples/screens/` |
| CLI adapter | `src/cli.ts` (entry), `src/cli/cli-screens.ts` |
| MCP adapter | `src/mcp.ts` (entry), `src/mcp/{mcp-server,mcp-tools,mcp-flows}.ts`, `mcp.json` |
| Tests | `src/**/*.test.ts` (node:test), E2E `src/e2e.test.ts` + `checks/fixtures/e2e/`, goldens `checks/fixtures/{login.golden.json,views/}` |
| Docs | `README.md`, `SKILL.md`, `docs/{firefox-pwa,screen-map,mcp,notebook-pilot}.md` |

Loop logs per spec: `.specloop/logs/<id>.log` (git-ignored). Worker config: `.specloop/loop.config.json` (`claude` first).

## Suggested next steps

1. T012: learn the main authenticated screens on your live PWA, review the map, re-measure tokens.
2. T008: register the MCP server; try `screen: true` and an `@id` dry-run from the client.
3. Live test: test the login flow on the real app to confirm that the new settle properly captures the authenticated dashboard.
4. T015 when a Linux/macOS machine is available.
