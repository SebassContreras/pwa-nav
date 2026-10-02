# Screen map (spec 005)

Per-app JSON file saying what each screen offers: fields, actions, links, named flows. Agents read a compact view of a known screen instead of snapshotting it, and act on stable `@id` targets re-resolved against the live DOM at action time.

## What it is and is not

- App-agnostic. The tool ships no app-specific map. `examples/screens/demo-app.screens.json` (derived from `checks/fixtures/login.html`) is the reference and test fixture.
- Your maps live in the screens dir: `--screens-dir <dir>` > env `PWA_NAV_SCREENS_DIR` > `./screens`. This repo git-ignores `screens/` because maps are per-user data.
- Learned from live snapshots (`snapshot --learn`), never invented. The human reviews every learned map before relying on it.
- Not a replacement for `eN` refs: refs stay valid for one snapshot only. `@id` is a semantic target resolved on a fresh snapshot.
- Never stores field values, credentials, cookies or tokens.

## File structure

Schema: `schemas/screen-map.schema.json` (JSON Schema 2020-12, `additionalProperties: false`).

| Key | Content |
|---|---|
| `schemaVersion` | `1.x.y` |
| `app` | `{id, name, origin, version?, locale, learnedAt}` |
| `screens[]` | `{id, route, title, access, fingerprint, observedAt, fields[], actions[], links[], flows[], a11y[]?}`; `route` is a literal or `:param` pathname |
| `fields[]` | role, name, `nameSource`, `inputType`, `sensitive`, `agentFillable`, `locator` |
| `actions[]` | `kind` (submit/toggle/button), `effect` (none/ui-state/submit), `requires[]`, `locator` |
| `links[]` | `href`, `external`, `locator` |
| `flows[]` | `{id, description, humanOnly, inputSchema, steps[{op: fill\|click, target: @id, from?}]}`, shaped like MCP tool descriptors |
| `journeys[]` | `{id, description, humanOnly?, inputSchema?, steps[{screenId, action, inputs?, expectScreen?}]}`, multi-screen declarative workflows |
| `a11y[]` | findings (`code`, `target`, `detail`, `wcag`) |
| `unmapped[]` | routes seen but not mapped, with a reason |

Locator = `{role, name, occurrence}`. Never a node handle or CSS class.

`crossCheck` rules (run on every load, beyond the schema):

- Screen ids and routes are unique; one id space per screen across fields/actions/links.
- `requires` and flow/a11y targets exist; fill steps target fields, click steps target actions/links; fill steps have `from`.
- `sensitive` implies `agentFillable: false`.
- A flow touching a sensitive field is `humanOnly: true`.
- Journey ids are unique; journey steps reference valid screen ids (`screenId` and `expectScreen`).
- External link hrefs are origin-only (no path, query, fragment).
- Fingerprint integrity: sha256 of sorted `role<TAB>name` lines of the screen's fields, actions and links is recomputed; a hand edit without a fingerprint update fails validation.

## Compact view

`snapshot --screen` on the demo app's `/login` (golden: `checks/fixtures/views/demo-login.view.txt`):

```
login /login public fp:40288a29
fields: @email textbox "Email" | @password textbox "Password" SENSITIVE(human)
actions: @show-password button "Show password" | @sign-in button "Sign in" needs(@email,@password) submit
links: @forgot-password -> /forgot-password | @help-center -> external help.example.com
flows: login HUMAN-ONLY
```

Lines: header (`id route access fp:<8 hex>`), then `fields`, `actions`, `links`, `flows`, and `a11y` when findings exist.

## Commands

| Command | What it does |
|---|---|
| `snapshot --screen` | Print the compact view of the screen matching the current page URL. Reads the URL only: no DOM collection, no snapshot written. Offline: URL from `.agent/session.json`. No map or screen: exit 13. |
| `snapshot --learn` | Live snapshot, then learn the screen from that same collection. Prints the diff and `screen map: <path> (written\|unchanged)`. Idempotent. |
| `click @id`, `fill @id <text>` | Semantic targets; dry-run unless `--armed`. |
| `act click:@id fill:@id=<text> ...` | Bulk semantic ops. Do not mix with plain refs. |
| `act flow:<id> key=value ...` | Run a named flow; inputs validated against the flow's `inputSchema` before any step. |
| `journey <name> [k=v...] [--armed]` | Run a multi-screen user journey across route transitions; dry-run unless `--armed`. |

Flags:

| Flag | Meaning |
|---|---|
| `--screens-dir <dir>` | Maps directory (env `PWA_NAV_SCREENS_DIR`, default `./screens`). |
| `--screen-map <file>` | Explicit map file; wins over directory selection. Default: the single map whose `app.origin` equals the current origin. |
| `--prune` | With `--learn`: remove entries no longer on the page. Default keeps and flags them as missing. |
| `--locale <bcp47>` | With `--learn`: UI language (`en`, `es-ES`). Required for a NEW map; ignored for an existing one (stored locale is kept). |
| `--access public\|authenticated\|unknown` | With `--learn`: access level of the screen (default `unknown`). |
| `--app-id <slug>` | New map only. Default: slug of `host[-port]`. |
| `--app-name <text>` | New map only. Default: page title. |

Why `--locale` is required: `<html lang>` was measured untrustworthy on a real Spanish app (it said `en`), so the locale is never inferred. Accessible names are locale-bound; a name change surfaces as drift.

Map selection: `--screen-map`, else the one `*.screens.json` in the screens dir whose `app.origin` matches. Zero or several matches on `--screen` is `unmapped_screen`; several on `--learn` is `invalid_args`.

## Ids, drift, renames

- Ids are stable semantic slugs of the accessible name (ASCII-folded, lowercase, hyphenated; `-2`, `-3` on collision; nameless elements use role + position, e.g. `button-1`).
- An id is assigned once. Re-learning matches existing entries by locator and keeps their ids even if the name changed.
- Re-learning never deletes; removal needs `--prune`.
- `@id` is resolved by role + name + occurrence on a fresh snapshot. If it no longer resolves: `stale_ref` (exit 3), never a click on another element.

`--learn` prints the diff (`renderDiff`), one line per change:

```
new screen
+ <group> @<id> <role> "<name>"
- missing @<id> <group> <role> "<name>"
~ renamed @<id> "<old name>" -> "<new name>"
~ changed @<id> <field>: <old> -> <new>
fp: <old 8 hex> -> <new 8 hex> DRIFT
a11y: +<code> <target>
a11y: -<code> <target>
```

No differences prints `no changes` and leaves the file untouched. Real example from `src/cli.screens.test.ts` after renaming "Sign in" to "Log in":

```
~ renamed @sign-in "Sign in" -> "Log in"
```

followed by a `fp: ... DRIFT` line. The entry keeps id `sign-in` with the new name.

a11y findings are a by-product and never block actions. Codes in the learner: `name-from-placeholder-only` (WCAG 3.3.2), `missing-accessible-name` (4.1.2), `duplicate-name`.

## Safety

- Never stores values. Typed text of sensitive fields is never printed.
- Sensitive field (`fill @password ...`): refused with exit 11 before any DOM collection or input.
- `humanOnly` flow (`act flow:login ...`): refused with exit 11 before reading its inputs, even with malformed ones.
- Unknown `@id` or flow: exit 12 (lists available ids). No map or screen: exit 13.
- Dry-run unless `--armed`; origin allow-list and kill-switch still apply. An armed action prints the compact view of the resulting screen, never a full snapshot.
- Learning authenticated screens: only after the user logs in by hand.
- Review every learned map before relying on it. Flags (`sensitive`, `agentFillable`, `humanOnly`) can be corrected by hand and stay authoritative on re-learn, except that a password input always escalates to sensitive. False positives are safe: the user fills by hand.

## Worked loop (demo app)

Offline, verified:

```bash
node ./dist/cli.js open http://localhost:8080/login --backend offline
node ./dist/cli.js snapshot --screen --backend offline --screen-map examples/screens/demo-app.screens.json
# prints the compact view above
node ./dist/cli.js snapshot --screen --backend offline        # no ./screens dir
# error: unmapped screen: /login on http://localhost:8080   (exit 13)
```

Live, copied from `src/cli.screens.test.ts` (validated against a fake BiDi server and the opt-in E2E, not yet against real authenticated screens). Map seeded in `./screens`, PWA on `/login`:

```bash
pwa-nav snapshot --screen                    # compact view, no browser round trip beyond the URL
pwa-nav click @show-password                 # click @show-password: button "Show password" (action, occurrence 0)
                                             # click dry-run: ...
                                             # no input sent (pass --armed to execute)
pwa-nav click @show-password --armed         # click ok: ...  then the compact view: login /login public fp:40288a29
pwa-nav fill @password secret --armed        # exit 11 sensitive_target, nothing sent
pwa-nav act flow:login --armed               # exit 11 (human-only flow): the user logs in by hand
pwa-nav click @nope                          # exit 12 unknown_target (lists available ids)
pwa-nav snapshot --learn --access public     # after a UI change: ~ renamed ... / DRIFT
```

New map from scratch (live): `pwa-nav snapshot --learn --locale es-ES --access public` prints `new screen` and `screen map: screens/<host-port>.screens.json (written)`; without `--locale` it exits 2.

## Measured size

Measured on a real web app (Sigestran Web) across both the public login screen and an authenticated main dashboard screen, using chars/4 as a rough token proxy.

| Screen | Artifact | Bytes | ≈ tokens |
|---|---|---|---|
| Login (6 elements) | `snapshot.json` (pretty JSON) | 692 | 170 |
| Login (6 elements) | Screen entry as raw JSON | 3475 | 860 |
| Login (6 elements) | Compact view | 365 | 90 |
| Authenticated Dashboard (24 elements) | `snapshot.json` (pretty JSON) | 2197 | 550 |
| Authenticated Dashboard (24 elements) | Screen entry as raw JSON | 7088 | 1770 |
| Authenticated Dashboard (24 elements) | Compact view | 953 | 240 |

Conclusion: the compact view reduces token volume by 57% compared to full DOM snapshots and 86% compared to raw map JSON. The major saving is round trips: a multi-step action sequence (`act click:@id fill:@id=text`) operates directly on semantic targets without intermediate snapshot round trips, returning a single compact view upon completion.

## User Journeys (multi-screen flows)

User Journeys are declarative multi-step workflows defined at the map root level (`journeys[]`):

```json
{
  "journeys": [
    {
      "id": "search-and-select",
      "description": "Search product and pick first result",
      "inputSchema": {
        "type": "object",
        "required": ["term"],
        "properties": { "term": { "type": "string" } }
      },
      "steps": [
        {
          "screenId": "home",
          "action": "fill:@search-box=${inputs.term}",
          "expectScreen": "search-results"
        },
        {
          "screenId": "search-results",
          "action": "click:@first-item",
          "expectScreen": "product-detail"
        }
      ]
    }
  ]
}
```

Key features:
- **Action syntax**: `flow:<id>`, `click:@<id>`, `fill:@<id>=<val>`, `fill:@<id>`, or bare `@<id>`.
- **Parameter interpolation**: Replaces `${inputs.param}` and `${param}` from journey inputs into step actions and step inputs.
- **Screen transition assertions**: After every step, the engine waits for settle (network idle and DOM quiescence) and verifies the resulting route matches `expectScreen`. Mismatch aborts immediately with exit code 14 (`journey_step_failed`).
- **Dry-run preview**: `pwa-nav journey <name> [key=value...]` outputs the full planned step sequence without touching the browser. Use `--armed` to execute.
- **Dynamic MCP tools**: Non-human-only journeys are automatically exposed as callable tools (`journey_<id>`) on the MCP server with `destructiveHint: true`.

> **Tip for PowerShell users:** Quote `@id` targets (e.g. `pwa-nav click '@show-password'`) to prevent PowerShell from interpreting `@` as a variable splatting operator.
