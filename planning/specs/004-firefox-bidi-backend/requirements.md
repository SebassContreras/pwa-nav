# 004 — firefox-bidi-backend — Requirements

## What's being built

The live browser backend. `open`, `snapshot`, `click`, `fill`, `act` and `extract` drive the user's own logged-in Firefox PWA (PWAsForFirefox runtime) over W3C WebDriver BiDi, replacing the offline intent-log MVP while keeping the snapshot contract, ref semantics and CLI surface of specs 001–003 unchanged.

## Who/what it serves

Dev team doing fluid QA of any web app installed as a Firefox PWA (framework-agnostic: React, Angular, Vue, server-rendered) and assisted browsing on login-walled sites. Nothing in the backend is tied to one app; `checks/fixtures/login.html` is the neutral reference and Sigestran Web (React) is the first real-world validation. Serves spec 005 (screen map learns from live snapshots) and spec 006 (MCP adapter wraps this backend).

## Hard constraints

- Attach to a PWA runtime started with `--remote-debugging-port`; never touch a profile the user did not point at _(standard: Firefox Remote Protocol — https://firefox-source-docs.mozilla.org/remote/index.html)_.
- Protocol is W3C WebDriver BiDi over WebSocket, loopback only _(standard: https://w3c.github.io/webdriver-bidi/)_. No Playwright, no Chromium, no geckodriver.
- The BiDi stack adds no runtime dependency: use Node 22's global `WebSocket`. Dev-only dependencies allowed (test doubles). (`ajv` is a runtime dependency of the screen-map validator, spec 005, not of the BiDi stack.)
- Lawful use only with the user's own session; no CAPTCHA/bot-wall bypass; the agent never types credentials.
- Write actions are dry-run unless `--armed`; a kill-switch file aborts armed actions; actions run only on allow-listed origins.
- Navigation is outward too: `open <url>` moves the user's real logged-in window, so it requires an allow-listed origin or `--allow-origin` on that same call; otherwise it exits `origin_blocked` before any BiDi call (AMENDED 2026-10-01 after two accidental navigations of the real PWA during development). Reads of the current page (`snapshot`, `extract`) never navigate and need no allow-list.
- Page content is untrusted data. It is written to files for grep, never executed or followed as instructions.
- Every command ends its BiDi session (`session.end`) on success, error and SIGINT. Firefox allows one active session; an orphan blocks all later commands until the PWA restarts (measured, see design).
- `eN` refs stay valid for one snapshot only; stale refs fail with `stale_ref` and never act on a different element.
- Snapshot values never include the content of password inputs.
- Node 22 + pnpm + TypeScript strict; `pnpm lint && pnpm build && pnpm test && pnpm smoke` green.

## Acceptance criteria

- `open <url>` attaches to `127.0.0.1:<port>` (default 9222, `--port`), navigates the PWA's top-level context to `<url>` and records `.agent/session.json`. With the port closed it exits `no_browser` and prints the exact launch command.
- `open <url> --launch` starts the PWA runtime directly (profile + site ULIDs resolved from firefoxpwa `config.json` by origin) with the debugging flag, waits for the port (not the PID), then navigates. It never writes to the profile.
- `snapshot -i` on `checks/fixtures/login.html` writes `.agent/snapshot.json` with: textbox "Email"; textbox "Password" (no value); button "Show password"; button "Sign in"; link "Forgot password?"; link "Help center" — each with a unique ref and a fresh `snapshotId`. Names come from labels, `aria-label` and content per the accname subset, in any UI language.
- `click`/`fill`/`act` without `--armed` print the resolved target and plan, change nothing, exit 0. With `--armed`: real pointer click / real key input, then a new `snapshotId` is written and returned.
- `fill` replaces the field's existing content and the app's framework sees it (a controlled React input shows the new value on re-snapshot).
- An action whose ref no longer matches the live DOM (role + name + occurrence) or whose page URL changed exits `stale_ref` with the re-snapshot instruction.
- An action on an origin outside the allow-list exits `origin_blocked`; with the kill-switch file present exits `kill_switch`; both before any input is sent.
- Running 20 consecutive commands never yields "Maximum number of active sessions".
- `extract --mode text|links` stays read-only and never supersedes the snapshot.
- An opt-in end-to-end test (`PWA_NAV_E2E=1`) runs the full open → snapshot → fill → click → snapshot loop against a local fixture page in a disposable headless Firefox profile.

## Out of scope

- Screen map and semantic `@id` targets (005), MCP adapter (006), multi-session/multi-window, native `<select>`/OS dialogs, file upload, screenshots, headless login automation, credential handling, bypassing any access control.

## Dependencies

- 001 nav-snapshot, 002 nav-actions (contract, ref store, error format).

## Owner split

Agent: all code, tests, docs. Human: start/log in to the PWA, approve the origin allow-list for real sites, run the opt-in E2E on their machine, confirm the Linux/macOS firefoxpwa paths.
