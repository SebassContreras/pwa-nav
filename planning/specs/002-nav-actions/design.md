# 002 — nav-actions — Design

## Approach

Extend the same CLI with `click`, `fill`, `extract`, `act` (bulk). Each action takes `--snapshot <id>` + `ref`, resolves the ref via the stored refMap, executes via Playwright, then immediately invalidates the old snapshot and writes a new one. Stale `snapshotId+ref` returns `stale_ref` error telling the agent to re-snapshot. `extract` reuses Playwright text/link collection.

## Deliverables

- `src/actions.ts` (`click`, `fill`, `extract`, `act` bulk parser `fill:eA=.. click:eB`)
- RefMap store + invalidation (`src/refs.ts`)
- Error format `{code: "stale_ref", message, snapshotId}`
- Updated `SKILL.md` snippet for action usage

## Sequencing

After 001. Order: refs store -> click -> fill -> extract -> bulk `act`.
