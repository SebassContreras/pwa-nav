# 004 — firefox-bidi-backend — Design

## Approach

Raw BiDi client in TypeScript behind a small ports-and-adapters layer so the ref store, gate and CLI stay testable without a browser. Each CLI invocation is one short-lived BiDi session: connect → `session.new` → work → `session.end` (in `finally`) → close. No daemon in MVP.

Refs are re-resolved by locator, not by node handle (see Measured facts). A snapshot stores, next to each element, a `locator {role, name, occurrence}`; an action re-collects the live DOM in the same session and matches the locator before sending input.

## Measured facts (2026-10-01, Firefox 156.0.1, firefoxpwa runtime, Windows)

- Endpoint `ws://127.0.0.1:<port>/session`; `session.new` with empty capabilities works.
- Closing the socket without `session.end` leaves the session active; the next `session.new` fails with `session not created: Maximum number of active sessions`. Recovery = restart the PWA. Hence `session.end` is mandatory and wrapped in `finally`/SIGINT.
- A node `sharedId` obtained in one session is rejected in the next (`no such node`), and the top-level context id differs between sessions. Hence refs cannot be node handles.
- `firefoxpwa site launch <id> -- --remote-debugging-port N` drops the flag (firefoxpwa 2.19.0, per the browser-bidi skill notes); the runtime binary must be spawned directly.
- First real-world app observed (Sigestran Web, React, v0.0.14, Spanish UI): password input has only a placeholder (HTML-AAM name falls back to it); icon button named via `aria-label`; no `data-testid`, no ARIA landmarks. Consequence for the design: names must be computed by the accname subset, never assumed from test ids or English labels.

## Modules

| File | Responsibility |
|---|---|
| `src/errors.ts` | `PwaNavError` + code union and exit-code map (below) |
| `src/bidi/transport.ts` | WebSocket, command/response correlation by `id`, per-command timeout, event fan-out, close/abort handling |
| `src/bidi/protocol.ts` | Typed subset only: `session.new/end`, `browsingContext.getTree/navigate`, `script.evaluate/callFunction`, `input.performActions`, load/navigation events |
| `src/bidi/session.ts` | `withSession(endpoint, fn)`: guarantees `session.end` on success, throw and SIGINT/SIGTERM |
| `src/browser/pwa-runtime.ts` | Locate firefoxpwa dir per OS, read `config.json`, match site by origin, spawn runtime with flags, wait for port |
| `src/browser/collector.ts` | In-page collector (serialized function) returning interactive elements with role, accessible name, value (never password), disabled, occurrence |
| `src/browser/actions.ts` | Locator resolution, actionability checks, pointer click, key-input fill, settle wait |
| `src/gate.ts` | Pure: armed flag, kill-switch file, origin allow-list decision |
| `src/ops.ts` | Existing shared layer; `perform*` delegate to the backend port instead of writing intent logs |

`Backend` port (interface): `open(url)`, `collect()`, `click(locator)`, `fill(locator, text)`, `url()`. `BidiBackend` implements it; `OfflineBackend` keeps today's fixture/intent behavior so existing checks and `pnpm smoke` stay green.

## Key decisions

- Role/name: explicit `role` → implicit role map by tag/type (HTML-AAM subset: button, link with href, textbox, checkbox, radio, combobox, heading, img with alt) → name via `aria-labelledby` → `aria-label` → `<label for>`/wrapping label → `alt`/`title`/`placeholder` fallback → visible text _(standard: Accessible Name and Description Computation — https://www.w3.org/TR/accname-1.2/)_. Subset documented; deviations are bugs, not features.
- Interactive-only default (`-i`); full tree only on request. Hidden, `aria-hidden` and zero-size elements excluded.
- Click = `input.performActions` pointer with element origin (scrolls into view, real events). Fill = focus, select-all, key events per code point; the value is read back and compared; mismatch → `not_actionable`.
- Settle after input: wait for `browsingContext.navigationStarted`/`load` if it fires inside the settle window, else DOM quiescence via MutationObserver. Window and quiet durations are named constants tuned in T007/T009; no number is asserted here.
- Context choice: the single top-level context of the PWA window; more than one → require `--context`.
- Loopback only: `--host` other than `127.0.0.1`/`::1`/`localhost` is rejected.
- Allow-list: `.agent/allow.json` `{origins: [...]}`; an origin is added only by an explicit `--allow-origin` on `open`; reads never need it.
- Kill-switch: `PWA_NAV_KILL_SWITCH` env path or `.agent/kill`; checked before every armed action in a batch.
- Launch never writes `user.js`/`prefs.js`. Docs point to `remote.prefs.recommended=false` as the user's opt-in mitigation for Firefox rewriting ~100 prefs on attach (source: https://github.com/UnknownCaz/firefox-mcp notes).
- Only one BiDi session exists at a time: `pwa-nav` and the `browser-bidi` skill cannot run concurrently; the `session_busy` message says so.

## Error codes → exit codes

| code | exit | meaning |
|---|---|---|
| `invalid_args` | 2 | bad CLI input |
| `stale_ref` | 3 | snapshot superseded, ref/locator mismatch or URL changed |
| `no_browser` | 4 | port closed / PWA not running (prints launch command) |
| `session_busy` | 5 | another BiDi session is active |
| `origin_blocked` | 6 | origin not allow-listed |
| `kill_switch` | 7 | kill-switch present |
| `not_actionable` | 8 | hidden, disabled, covered or readback mismatch |
| `timeout` | 9 | command or settle timeout |
| `protocol` | 10 | unexpected BiDi error (message preserved) |

## Testing

- Unit (`node --test` on compiled output, no browser): gate, error mapping, transport against an in-process fake BiDi server (`ws`, dev-only), locator matching, runtime-config parsing from a fixture `config.json`, session cleanup on throw/SIGINT.
- Contract: collector output on `checks/fixtures/login.html` equals a committed golden snapshot.
- E2E (opt-in `PWA_NAV_E2E=1`): spawns the PWA runtime headless with a temp profile and a local static server; never touches the user's real profile.

## Sequencing

Measured facts (done) → errors/gate/transport/session → protocol → runtime launcher → collector → locators + actions → wire `ops.ts` behind `Backend` → CLI flags → E2E → docs → verify.
