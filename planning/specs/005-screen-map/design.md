# 005 — screen-map — Design

## Approach

The map is data plus four small pure modules (match, view, learn, resolve) around the validator that already exists. Nothing here talks to the browser except through spec 004's `Backend` port, so every module is unit-testable with fixtures.

Agent loop for a known screen: `snapshot --screen` (compact view, zero browser round trips beyond reading the URL) → `act @a @b …` (each target re-resolved live, dry-run unless `--armed`) → the post-action compact view. A full `snapshot` is only needed on an unmapped or drifted screen.

## Data contract (shipped: T001–T003)

- `schemas/screen-map.schema.json` — JSON Schema 2020-12, `additionalProperties: false` everywhere. App-agnostic: nothing in the schema, validator or learner names an app, framework or language; only `app.locale` records the UI language.
- Maps live in the screens dir (default `./screens`, `--screens-dir` / `PWA_NAV_SCREENS_DIR`); the tool repo ships only `examples/screens/`.
- Top level: `schemaVersion` (1.x.y), `app {id, name, origin, version?, locale, learnedAt}`, `screens[]`, `unmapped[]`.
- Screen: `id`, `route` (literal/`:param` pathname), `title`, `access`, `fingerprint`, `observedAt`, `fields[]`, `actions[]`, `links[]`, `flows[]`, `a11y[]?`.
- Field: role, name, `nameSource`, `inputType`, `sensitive`, `agentFillable`, `locator`. Action: `kind` (submit/toggle/button), `effect` (none/ui-state/submit), `requires[]`, `locator`. Link: `href`, `external`. Flow: `humanOnly`, `inputSchema`, `steps[{op: fill|click, target: @id, from?}]`.
- Locator = `{role, name, occurrence}` — the same triple spec 004 stores per snapshot element. Never a node handle or CSS class.
- Fingerprint = sha256 of sorted `role<TAB>name` lines (code-point order, LF, UTF-8) of the screen's fields, actions and links. `crossCheck` recomputes it on every load.
- `crossCheck` rules beyond the schema: external link hrefs are origin-only; unique screen ids and routes; one id space per screen across fields/actions/links; `requires` and flow/a11y targets exist; fill only fields, click only actions/links; sensitive ⇒ not agent-fillable; flow touching a sensitive field ⇒ `humanOnly`; fill steps have `from`; fingerprint matches.

## Modules (to build)

| File | Responsibility |
|---|---|
| `src/screen-map.ts` | Shipped. Types, `validateScreenMap`, `crossCheck`, `fingerprintOf`, `loadScreenMap` |
| `src/screen-match.ts` | Select the map by `app.origin`; match `location.pathname` to a screen: literal segments beat `:param`, ties are an error at load time |
| `src/screen-view.ts` | Render the compact view (below) from a `Screen`; deterministic, golden-tested |
| `src/screen-learn.ts` | Live elements → `Screen`: classify (textbox/checkbox/radio/combobox → field; button → action; link → link), derive ids, flag sensitive, compute fingerprint, diff and merge against the existing map |
| `src/screen-resolve.ts` | `@id` / `flow:<id>` → locator or refusal (`sensitive_target`, `unknown_target`), then hand the locator to the 004 action layer |

Collector extras needed from 004 (additive, optional in the snapshot file): `nameSource`, `inputType`, `href`, `autocomplete`. They are used by learn and then dropped; the public snapshot contract does not change.

## Key decisions

- **Ids**: slug of the accessible name (NFD-folded to ASCII, lowercase, hyphenated), `-2`, `-3` on collision; nameless elements use role + position (`button-1`). An id is assigned once; re-learn matches existing entries by locator and keeps their ids even if the name changed, flagging drift.
- **Sensitive detection** (learn): `type=password`, `autocomplete` in {`current-password`, `new-password`, `one-time-code`}, or name/label matching `pass|pwd|contrase|token|otp|secret|clave`. False positives are safe (user fills by hand); the human review task catches them.
- **Compact view** (`snapshot --screen`), one line per group, ids first (golden: `checks/fixtures/views/demo-login.view.txt`):
  ```
  login /login public fp:40288a29
  fields: @email textbox "Email" | @password textbox "Password" SENSITIVE(human)
  actions: @show-password button "Show password" | @sign-in button "Sign in" needs(@email,@password) submit
  links: @forgot-password -> /forgot-password | @help-center -> external help.example.com
  flows: login HUMAN-ONLY
  ```
  An `a11y: @target code` line is appended when the screen has findings.
- **Drift** is a warning on action (locator still resolves) and a diff on `--learn`; it is an error only when the locator no longer resolves (`stale_ref`).
- **Flows with inputs**: `act flow:<id> key=value…`, inputs validated against the flow's `inputSchema` (Ajv) before any step; humanOnly flows refuse unconditionally.
- **Where the map comes from**: `--screen-map <file>` or the single `screens/*.screens.json` whose `app.origin` equals the current origin; zero or several matches → `unmapped_screen` with the list.
- **Errors** (extend spec 004's table): `sensitive_target` 11, `unknown_target` 12, `unmapped_screen` 13.
- The a11y findings are a free QA by-product (for example a password input named only by its placeholder, WCAG 3.3.2, seen on the first real app) and are reported by `--learn`; they never block actions.

## Measured size (login screen, chars/4 as a rough token proxy)

Measured on the first real app's login screen (6 interactive elements):

| Artifact | Bytes | ≈ tokens |
|---|---|---|
| `snapshot.json` (6 elements, pretty JSON) | 692 | 170 |
| Screen entry as raw JSON | 3475 | 860 |
| Compact view | 365 | 90 |

Reading the map's raw JSON costs more than one small snapshot; the compact view costs about half. The saving that matters is round trips: a 3-step flow with per-step re-snapshots needs 4 snapshots, while `act @a @b @c` on a mapped screen needs none plus one compact view. Larger real screens (hundreds of elements) widen the gap because the map keeps only task-relevant elements. Docs may claim only these measured figures; re-measure on an authenticated screen after T011.

## Testing

- Unit: matcher (literal vs `:param`, ambiguity), renderer golden files, learner on fixture element lists (ids, collisions, sensitive detection, idempotence, drift, prune), resolver refusals.
- Validator conformance already covers: schema violations, sensitive-field rule, humanOnly rule, bad targets, drift in fingerprint, every committed `screens/*.screens.json`.
- Integration (with 004's fake BiDi server): `--screen`, `act @…` dry-run and armed, `--learn` idempotence.

## Sequencing

Schema + seed map + validator (done) → matcher → renderer → learner (needs 004 collector extras) → resolver → CLI wiring → flows → docs → human learn pass on authenticated screens → verify.
