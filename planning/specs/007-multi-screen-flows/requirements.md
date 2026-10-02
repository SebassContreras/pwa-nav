# 007 — multi-screen-flows — Requirements

## What's being built

A declarative multi-screen flow (User Journey) engine that executes sequences of operations across multiple screens and route boundaries. Currently, `screen-map` flows (`screens[].flows[]`) are scoped to a single screen, and `act` expects to execute within a single DOM state. This spec adds app-level multi-screen journeys with route transition assertions, intermediate step settles, parameter binding, dry-run previews, and execution via CLI and MCP.

## Who/what it serves

Developers and autonomous QA agents testing multi-step user scenarios (e.g. Login -> Navigation -> Form Submission -> Confirmation, or Search -> Product Detail -> Add to Cart) without manual step-by-step orchestrator round trips.

## Hard constraints

- Declarative journeys live in `<app>.screens.json` under an `app.journeys[]` schema array (or root `journeys[]`) validated against `schemas/screen-map.schema.json`.
- Each journey step declares its target screen (`screenId`), action/flow (`flowId` or `@id` action/fill), inputs, and expected post-transition screen.
- After every screen transition, the engine waits for network idle and DOM quiescence (`settle`), verifies the resulting route matches the expected `screenId`, and halts safely if route or assertions mismatch (`journey_step_failed` exit code).
- Dry-run by default unless `--armed`: dry-run outputs the entire execution plan and step sequence without touching the browser.
- Operator security gate applies to all steps: no journey may touch `sensitive` fields without `humanOnly: true` (which cannot be automated); kill-switch aborts immediately; only allow-listed origins can be navigated.
- Journeys are exposed as MCP tools (`journey_<app>_<name>`) alongside existing single-screen `flow_*` tools, annotated `destructiveHint: true`.

## Acceptance criteria

- `schemas/screen-map.schema.json` updated with `journeys` definition and cross-check validation (referencing valid screens, fields, and actions).
- CLI command `pwa-nav journey <name> [key=value...] [--armed]` executes or dry-runs the journey.
- MCP server lists non-humanOnly journeys as callable tools with their compiled `inputSchema`.
- Offline runner and fake BiDi tests verify step transitions, parameter interpolation, and failure recovery when a step fails to reach the expected screen.
- Clear error reporting: when a step fails, output names the exact failed step, current screen vs expected screen, and preserves evidence.

## Out of scope

- Conditional branching logic (if/else trees) within journeys (keep journeys linear in MVP).
- Looping constructs (repeat N times).

## Dependencies

- 004 firefox-bidi-backend, 005 screen-map.

## Owner split

Agent: schema, journey runner, CLI command, MCP integration, tests, docs. Human: review and approve journey definitions on target PWAs.
