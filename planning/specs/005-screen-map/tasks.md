# 005 — screen-map — Tasks

Status legend: `todo` · `in_progress` · `blocked` · `interrupted` · `done`
Owner: `agent` (loop-runnable) · `human` (skipped by the loop)

- [x] T001 [agent] [status:done] Write `schemas/screen-map.schema.json` (JSON Schema 2020-12)
      └─ Compiles under Ajv strict mode; additionalProperties:false throughout.
- [x] T002 [agent] [status:done] Write the app-agnostic reference `examples/screens/demo-app.screens.json` + `checks/fixtures/login.html`; first real-app map kept locally in `screens/` (`unmapped` for unseen routes and authenticated areas)
      └─ Real map observed 2026-10-01 via BiDi probe (v0.0.14); nothing invented; external hrefs reduced to origin.
- [x] T003 [agent] [status:done] Implement `src/screen-map.ts` (types, schema validation, cross-reference rules, fingerprint) with `node:test` tests; add `pnpm test`
      └─ 15 tests; build + lint + test + smoke green.
- [x] T004 [agent] [status:done] Implement `src/screen-match.ts` (map by origin, route match literal-over-`:param`, ambiguity error) with tests
      └─ screen-match.ts: literal/:param matcher, ambiguity detection, origin/map selection, screens dir resolution; 19 tests.
- [x] T005 [agent] [status:done] Implement `src/screen-view.ts` compact renderer with golden-file tests (login screen golden)
      └─ screen-view.ts compact renderer + golden checks/fixtures/views/demo-login.view.txt; external links show host only (design sample showed none).
- [x] T006 [agent] [status:done] Implement `src/screen-learn.ts` classification, id derivation, sensitive detection, fingerprint, with fixture tests (depends on 004 T007 collector extras)
      └─ screen-learn.ts: classification, ids, sensitive detection, origin-only external hrefs, a11y findings; reproduces the demo screen; collector gained optional buttonType (golden updated); flows never invented.
- [x] T007 [agent] [status:done] Implement learn diff/merge: idempotent re-learn, drift report, id stability, `--prune`, with tests
      └─ screen-merge.ts (diff/merge/prune, rename pairing, id stability, idempotent) + screen-store.ts (validated atomic write, learnIntoFile, renderDiff); master changed sensitive merge so the stored flag is reviewer-authoritative (only password inputs auto-escalate) + regression test; 246 tests.
- [x] T008 [agent] [status:done] Implement `src/screen-resolve.ts` (`@id`, `flow:<id>`, `sensitive_target`, `unknown_target`, input validation against `inputSchema`) with tests
      └─ screen-resolve.ts: @id/flow parsing, sensitive_target/unknown_target, humanOnly refused before reading inputs, Ajv input validation, no values in messages; 14 tests.
- [x] T009 [agent] [status:done] Wire CLI: `snapshot --screen`, `snapshot --learn [--prune] [--screen-map]`, `@id` targets in `click`/`fill`/`act`, new exit codes 11–13
      └─ cli-screens.ts + cli.ts/ops.ts: snapshot --screen/--learn(--prune,--locale,--access,--app-id,--app-name), @id click/fill/act, flow:<id>; @id resolves via a fresh quiet snapshot so gate/dry-run/invalidation reuse existing paths; new maps require --locale (page lang measured untrustworthy); 258 tests + E2E 13/13.
- [x] T010 [agent] [status:done] Integration tests over the 004 fake BiDi server: `--screen`, dry-run and armed `act @…`, `--learn` idempotence
      └─ Covered by src/cli.screens.test.ts (12 tests over the 004 fake BiDi server): --screen without collect frames, dry-run/armed click, flow batch with one new snapshot, --learn new/idempotent/renamed, sensitive and unknown refusals. No separate suite needed.
- [x] T011 [agent] [status:done] Update `SKILL.md`, `README.md`, `docs/` with the mapped-screen loop; keep token claims to measured figures
      └─ docs/screen-map.md (new), README, SKILL.md mapped-screen loop, mcp.md; measured-size table verbatim, no extra numbers; offline commands run for real, live examples copied from tests and labelled as fake-server/E2E validated.
- [x] T012 [human] [status:done] Log in to your app by hand (first: Sigestran Web), run `snapshot --learn` on each authenticated screen, review sensitive flags and a11y findings, commit the map
      └─ 2026-10-02 run on real Sigestran Web PWA (port 9222): learned /app/ authenticated dashboard (24 elements), verified dry-run click '@dashboards', measured sizes (57% snapshot / 86% raw JSON token reduction) recorded in docs/screen-map.md.
- [x] T013 [agent] [status:done] Verify acceptance criteria 005 (lint, build, test, smoke green); the authenticated-screen size re-measure waits for human T012
      └─ Criteria evidenced: examples + screens dir validate in pnpm test; --screen prints the compact view without collect; armed/dry-run @id click works live; fill @password/flow:login exit 11 pre-collect; --learn idempotent and rename keeps id; fingerprint integrity in crossCheck; full authenticated-screen size table measured and documented in docs/screen-map.md.

