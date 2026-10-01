# 002 — nav-actions — Requirements

## What's being built

CLI `click`, `fill`, `extract` commands addressed by `snapshotId + ref`, with automatic snapshot invalidation: every mutation invalidates the previous snapshot and requires a fresh one.

## Who/what it serves

Dev team driving autonomous navigation; consumes 001's snapshot, serves 003's QA loop.

## Hard constraints

- Interaction only via `snapshotId + ref`; stale refs fail fast with a re-snapshot instruction, never act on the wrong element _(standard: Playwright snapshot refs — https://playwright.dev/mcp/snapshots)_.
- Actionability (visible, enabled, stable) is enforced by the live backend before any pointer/key input _(spec 004; standard: Playwright actionability checks — https://playwright.dev/docs/actionability)_.
- Lawful use only; no CAPTCHA/bot-wall bypass.
- Token-efficient: actions return a short result + new snapshot path, not the full tree inline.

## Acceptance criteria

- `click eN` on a button from the latest snapshot navigates or mutates the page and returns a new `snapshotId`.
- `fill eN "text"` fills the target input; a stale ref errors with `stale_ref, re-snapshot`.
- `extract --mode text|links` returns page text or link list from the current page.
- Bulk `act fill:eA=... click:eB` performs login-style flows in one call.

## Out of scope

- QA assertions/reporting (spec 003), custom bridge, WebMCP, notebooks beyond text extract.

## Dependencies

- 001 nav-snapshot (snapshot contract + `open`).

## Owner split

Agent: all commands + invalidation logic. Human: approve test credentials/pages where login is needed.
