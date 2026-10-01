# 002 — nav-actions — Design

## Approach

Extend the same CLI with `click`, `fill`, `extract`, `act` (bulk). Each action takes `--snapshot <id>` + `ref`, resolves the ref via the stored refMap, executes via the browser backend (as shipped: intent log only; live execution via BiDi in spec 004), then immediately invalidates the old snapshot and writes a new one. Stale `snapshotId+ref` returns `stale_ref` error telling the agent to re-snapshot. `extract` reuses the snapshot's text/link elements.

## Deliverables

- `src/actions.ts` (`click`, `fill`, `extract`, `act` bulk parser `fill:eA=.. click:eB`)
- RefMap store + invalidation (`src/refs.ts`)
- Error format `{code: "stale_ref", message, snapshotId}`
- Updated `SKILL.md` snippet for action usage

## Sequencing

After 001. Order: refs store -> click -> fill -> extract -> bulk `act`.
