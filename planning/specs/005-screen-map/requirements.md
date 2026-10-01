# 005 — screen-map — Requirements

## What's being built

A per-app JSON "screen map" (`<screens-dir>/<app-id>.screens.json`, default `./screens`, override with `--screens-dir` or `PWA_NAV_SCREENS_DIR`) that says what can be done on each screen: fields, actions, links and named flows. Agents read a compact view of it instead of snapshotting known screens, and act on stable `@id` targets that are re-resolved against the live DOM at action time. The map is learned from live snapshots (`snapshot --learn`), never hand-invented.

## Who/what it serves

Dev team and agents doing QA/browsing on any known app. The tool is app-agnostic: it ships no app-specific map. `examples/screens/demo-app.screens.json` (derived from `checks/fixtures/login.html`) is the reference and test fixture; each team keeps its own maps next to its app or in its own `screens/`. Cuts the snapshot → act → re-snapshot round trips that dominate token cost, and gives QA a drift signal when a screen changes. Builds on 004 (live collector, locators, gate).

## Hard constraints

- Contract is JSON Schema 2020-12 (`schemas/screen-map.schema.json`); the schema is the single source of truth, extra rules live in `crossCheck` _(standard: https://json-schema.org/draft/2020-12)_.
- Flows are shaped like MCP tool descriptors (name, description, JSON Schema `inputSchema`) so spec 006 can expose them without translation _(standard: MCP tools — https://modelcontextprotocol.io/specification/2025-06-18/server/tools)_.
- The map never contains field values, credentials, cookies or tokens. External links are stored as origin only (no path, query or fragment) because paths often carry form ids or tokens; enforced by `crossCheck`. Sensitive fields (password/OTP/secret) are `sensitive: true`, `agentFillable: false`; any flow touching one is `humanOnly: true`; the agent refuses them and asks the user.
- No invented content: unobserved routes go to `unmapped` with a reason; authenticated screens are learned only after the user logs in by hand.
- Re-learning never deletes or renames existing ids; removal needs an explicit `--prune`. Ids are stable semantic slugs, not per-snapshot refs.
- `@id` targets are re-resolved by role + name + occurrence on a fresh DOM before any input; a mismatch is `stale_ref`, never a click on a different element. The `eN` per-snapshot ref rule is unchanged.
- Accessible names are locale-bound; the map records `app.locale` and a name change surfaces as drift, not as a silent miss.
- Keep the verb surface: new behavior is flags/modes on `snapshot`, `click`, `fill`, `act` (AGENTS.md rule).
- Node 22 compatible: no reliance on the global `URLPattern`; routes use the documented literal/`:param` subset.

## Acceptance criteria

- `examples/screens/demo-app.screens.json` and every `*.screens.json` in the screens dir validate in CI (`pnpm test`); the example describes `checks/fixtures/login.html` (fields, actions, links, `login` flow humanOnly), with `unmapped` listing the forgot-password route and "authenticated screens". A map learned from a real app (first: Sigestran Web login, observed 2026-10-01) validates the same way.
- `snapshot --screen` on `/login` of the example app prints the compact view (≤ 10 lines for this screen, ids and needs/sensitive markers included) without collecting a snapshot; on an unknown route exits `unmapped_screen` and names `snapshot --learn`.
- `click @toggle-password --armed` resolves via the map, clicks, and returns the compact view of the resulting screen — no full snapshot in between.
- `fill @password …` exits `sensitive_target` before any input; `act flow:login …` exits `sensitive_target` (humanOnly) and says the user must do it by hand.
- `snapshot --learn` on the live login screen reproduces the committed screen entry (same ids, locators, fingerprint) — idempotent, no diff.
- After a UI change (renamed button), `snapshot --learn` reports the change as drift (old fingerprint → new) and does not drop the old entry unless `--prune`.
- A screen entry's `fingerprint` is recomputed on load; a hand-edited element without a fingerprint update fails validation.
- Measured size for the login screen is recorded in the design (snapshot vs compact view) and the token claim in docs is limited to what was measured.

## Out of scope

- Learning authenticated screens (needs the user's manual login), multi-app routing beyond matching `app.origin`, visual/screenshot maps, auto-generated QA assertions, WebMCP (`document.modelContext`) publication by the app itself, localization of one map across locales.

## Dependencies

- 004 firefox-bidi-backend: live collector, locators, gate and `Backend` port (T007–T011 there). Tasks T001–T003 here are independent of it and already done.

## Owner split

Agent: schema, validator, matcher, renderer, learner, resolver, CLI, docs. Human: log in to the app by hand, run `snapshot --learn` per authenticated screen, review the generated map before committing it.
