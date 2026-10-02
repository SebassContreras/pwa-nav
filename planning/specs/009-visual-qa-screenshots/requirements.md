# 009 — visual-qa-screenshots — Requirements

## What's being built

Visual screenshot capture capability via W3C WebDriver BiDi `browsingContext.captureScreenshot` for visual QA reporting, evidence generation, and automated diff inspection. Screenshots are saved to `.agent/evidence/<run-id>/` during `qa run` (and optionally on failures or on-demand).

## Who/what it serves

Developers and QA teams running regression tests who need visual proof of UI state beyond text/accessibility trees (e.g. styling bugs, layout shifts, element overlaps, responsive rendering).

## Hard constraints

- Visual capture mechanism: WebDriver BiDi `browsingContext.captureScreenshot`. Returns base64 PNG data; written directly to disk (never returned inline into chat or MCP context to preserve token limits).
- Non-breaking QA evidence: Screenshots are saved in `.agent/evidence/<run-id>/step-<n>-<op>.png` beside existing `step-<n>-<op>-snapshot.json` files.
- Offline behavior: In offline mode (`--backend offline`), screenshot ops record an empty placeholder or skip binary generation, keeping tests fully deterministic without requiring a real browser.
- CLI command: `pwa-nav screenshot [--out <path>]` (or `--screenshot` flag on `snapshot`).
- QA step: `{"op": "screenshot", "name": "step-name"}` supported in QA check files.
- MCP tool: `pwa_screenshot` returns the saved file path and image dimensions, never base64 bytes inline.

## Acceptance criteria

- `src/bidi/protocol.ts` implements `captureScreenshot(context, format?, clip?)`.
- `qa run` check runner records visual PNGs when a step fails or when explicit `screenshot` step is present.
- CLI subcommand/flag writes PNG files to disk and logs the path.
- MCP server exposes `pwa_screenshot` tool returning `{ path, width, height }`.
- Conformance tests verify screenshot command over fake BiDi and real E2E Firefox.

## Out of scope

- Pixel-by-pixel computer vision or visual AI comparison (agents inspect snapshots or review saved PNG paths).
- Video recording of browsing sessions.

## Dependencies

- 003 qa-loop, 004 firefox-bidi-backend.

## Owner split

Agent: protocol client, screenshot persistence, QA integration, CLI/MCP handlers, tests. Human: review visual evidence output.
