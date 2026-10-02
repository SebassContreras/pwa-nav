# 007 — multi-screen-flows — Tasks

Status legend: `todo` · `in_progress` · `blocked` · `interrupted` · `done`
Owner: `agent` (loop-runnable) · `human` (skipped by the loop)

- [x] T001 [agent] [status:done] Update `schemas/screen-map.schema.json` with `journeys` schema, crossCheck validation in `src/screens/screen-map.ts`, and add `journey_step_failed` error code to `src/core/errors.ts`
- [x] T002 [agent] [status:done] Implement `src/screens/screen-journey.ts` (journey model, input parameter substitution, step sequence parser) with unit tests
- [x] T003 [agent] [status:done] Implement `src/ops/journey.ts` `performJourney` (multi-screen loop, step execution, transition settle, route expectation verification) with unit tests over fake BiDi backend
- [x] T004 [agent] [status:done] Wire CLI `pwa-nav journey <name> [key=value...] [--armed]` and dry-run execution in `src/cli.ts` with CLI integration tests
- [x] T005 [agent] [status:done] Expose dynamic journey tools in `src/mcp/mcp-flows.ts` (`journey_<id>`) with schema validation and conformance tests
- [ ] T006 [agent] [status:todo] Add demo journey to `examples/screens/demo-app.screens.json` and document journey authoring in `docs/screen-map.md` and `SKILL.md`
- [ ] T007 [agent] [status:todo] Verify acceptance criteria (lint, build, test, smoke green)
