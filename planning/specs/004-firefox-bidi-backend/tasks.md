# 004 — firefox-bidi-backend — Tasks

Status legend: `todo` · `in_progress` · `blocked` · `interrupted` · `done`
Owner: `agent` (loop-runnable) · `human` (skipped by the loop)

- [x] T001 [agent] [status:done] Add `ws` + `@types/ws` (fake BiDi server) and `jsdom` + `@types/jsdom` (collector unit tests) dev deps and document the CI chain `lint && build && test && smoke` (the `node:test` runner and `pnpm test` already exist, added with spec 005)
      └─ ws 8.22, jsdom 30.1 + types as devDeps; CI chain documented; lint/build/test/smoke green.
- [x] T002 [agent] [status:done] Implement `src/errors.ts` (`PwaNavError`, code union, exit-code map) and migrate `StaleRefError` onto it without changing its message
      └─ errors.ts (12 codes, exit map), StaleRefError migrated, cli exits via exitCodeOf (stale_ref now 3, was 1); 21 tests green.
- [x] T003 [agent] [status:done] Implement `src/gate.ts` (armed, kill-switch, origin allow-list) with unit tests
      └─ gate.ts: pure decideAction + kill-switch/allow-list I/O; 11 tests.
- [x] T004 [agent] [status:done] Implement `src/bidi/transport.ts` with id correlation, timeouts, event fan-out; test against an in-process fake BiDi server
      └─ bidi/transport.ts (global WebSocket, loopback-only, session_busy mapping) + reusable fake-server.ts; ws only in the test double.
- [x] T005 [agent] [status:done] Implement `src/bidi/protocol.ts` typed command subset and `src/bidi/session.ts` `withSession` (ends session on success, throw, SIGINT/SIGTERM) with tests
      └─ bidi/protocol.ts (typed BidiClient, fromRemoteValue, nav helpers) + session.ts withSession (end+close in finally, signals injectable); 20-session loop test; session.end failure on success path throws protocol with restart hint.
- [x] T006 [agent] [status:done] Implement `src/browser/pwa-runtime.ts` (config.json parsing, site match by origin, direct runtime spawn, wait for port) with fixture-based tests
      └─ browser/pwa-runtime.ts: config parse, findSite by origin (+--site), direct spawn, waitForPort; 12 tests, no real browser; linux/macOS paths flagged UNVERIFIED.
- [x] T007 [agent] [status:done] Implement `src/browser/collector.ts` (role + accname subset, hidden filtering, no password values, occurrence index; also emit optional `nameSource`, `inputType`, `href`, `autocomplete` for spec 005 learn) and `checks/fixtures/login.html` with a golden snapshot test
      └─ browser/collector.ts self-contained (COLLECTOR_SOURCE), accname subset, no password values; golden test on login.html; content precedes title per accname 2F/2I.
- [x] T008 [agent] [status:done] Store per-element locators beside snapshots in the refs store; resolve by role+name+occurrence and URL; stale on mismatch
      └─ live-snapshot.ts (e1..eN + locators + extras kept out of snapshot.json), locate.ts (findByLocator, sameDocumentUrl, assertFresh), refs.ts sidecar saveLive/loadLocators/resolveLocator; public Snapshot unchanged.
- [x] T009 [agent] [status:done] Implement `src/browser/actions.ts` (pointer click, key-input fill with readback, settle wait, actionability checks)
      └─ actions.ts: collectLive/clickLocator/fillLocator/settle/checkActionable; same-session node handles; password readback length-only; 125 tests. Not yet run on real Firefox (T012/T014); constants SETTLE_WINDOW_MS/QUIET_MS/SETTLE_TIMEOUT_MS are initial values; readback timing vs controlled inputs to confirm in T012.
- [x] T010 [agent] [status:done] Introduce the `Backend` port; keep `OfflineBackend` for fixtures; wire `ops.ts` `perform*` through it so qa checks and smoke stay green
      └─ Backend port + OfflineBackend (verbatim) + BidiBackend (one session per op, act = one session/one new snapshot, gate before input) + createBackend; 147 tests; qa checks + smoke unchanged.
- [x] T011 [agent] [status:done] CLI: `open --launch/--port/--allow-origin`, `--armed`, `--context`; dry-run output; exit codes from the error map
      └─ cli.ts on node:util parseArgs; --backend/--port/--context/--armed (flag-only)/--launch/--site/--allow-origin/--all; usage errors exit 2; dry-run default; includeAll persisted in sidecar; 158 tests. Master fixed: CLI tests now poison default port (a worker test had navigated the real PWA to app.test; restored), gate hint wording.
- [x] T012 [agent] [status:done] Opt-in E2E (`PWA_NAV_E2E=1`): headless runtime + temp profile + local fixture server; open → snapshot → fill → click → snapshot
      └─ Real headless Firefox 156 E2E, 13/13 green (master reran): controlled input, contenteditable, SPA vs full nav, disabled/covered, gate, kill-switch, 20 sessions. 3 real bugs fixed (readback race, contenteditable caret + NBSP). Constants unchanged with evidence in comments. Open: one 23s outlier not reproduced; only win32.
- [x] T013 [agent] [status:done] Update `SKILL.md`, `README.md`, `docs/` for live usage, launch recipe per OS, one-session limit, `remote.prefs.recommended` note
      └─ README, SKILL.md, docs/firefox-pwa.md (new), notebook-pilot, mcp banner; offline examples verified by running; Linux/macOS flagged UNVERIFIED.
- [x] T014 [human] [status:done] Start one of your PWAs (first target: Sigestran Web) with the debugging port, log in by hand, approve its origin, run the E2E and one armed `fill`+`click` on a non-login screen
      └─ 2026-10-01 run with the user's consent on their real Sigestran PWA (port 9222): live snapshot, dry-run, armed @submit click (login succeeded -> /app/), armed fill into the React-controlled menu search (framework saw it: menu filtered), armed click on 'Limpiar búsqueda' restored the state. Not exercised: `open --launch` on the real runtime.
- [ ] T015 [human] [status:todo] Confirm firefoxpwa config paths on Linux and macOS (only Windows verified)
- [x] T016 [agent] [status:done] Verify acceptance criteria 004 (lint, build, test, smoke green; criteria evidenced in `.agent/evidence`)
      └─ lint/build/test(167)/smoke/3 qa checks green; real-Firefox E2E 13/13. Criteria evidence: open+no_browser+allow-list (cli.test, bidi-backend.test, e2e); snapshot -i elements/no password value (collector golden, e2e); dry-run vs armed, controlled-input fill, stale_ref, origin_blocked/kill_switch before input, 20 sessions (cli.test, e2e). NOT verified live by the loop: `open --launch` against the real PWA runtime and an armed action on a logged-in screen (human T014); Linux/macOS paths (T015).
- [x] T017 [agent] [status:done] Safety: make `open` (navigation of the user's real logged-in window) require an allow-listed origin or `--allow-origin`, else `origin_blocked` before any BiDi call; update requirements, help, docs and tests (two accidental navigations of the real PWA during development motivated this)
      └─ assertNavigationAllowed in gate.ts: open needs allow-listed origin or --allow-origin, kill-switch blocks it, all before any connect/probe/spawn; 167 tests + E2E 13/13.
- [x] T018 [agent] [status:done] Settle after submit-like actions: the armed login click returned the login compact view because the SPA route changed after the quiescence window (async request). Add network-idle awareness (BiDi `network.beforeRequestSent`/`responseCompleted` in-flight tracking) to `settle`, keep the named-constant cap, and re-measure with the E2E (add a fixture that navigates after a delayed fetch)
      └─ NavigationWatch tracks in-flight network requests (network.beforeRequestSent/responseCompleted/fetchError); settle loops until network idle + DOM quiescence; unit tests in protocol.test and actions.test; real-Firefox E2E fixture with 400ms delayed fetch passes (14/14 green in 24s).
