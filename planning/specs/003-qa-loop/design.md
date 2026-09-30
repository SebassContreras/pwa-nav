# 003 — qa-loop — Design

## Approach

A `qa` command + `SKILL.md`: a check is a small YAML/JSON file (`checks/login.yaml`) listing steps (`open`, `snapshot`, `click`, `assert-text`). The runner executes steps via 001/002 modules, saves each step's snapshot to `.agent/evidence/<run>/`, and writes `result.json` (pass/fail + missing expectations). Notebook pilot reuses `extract --mode text` on a user-opened notebook URL.

## Deliverables

- `src/qa.ts` runner + `checks/` examples (3 checks)
- `SKILL.md` (agent instructions: snapshot -> act -> verify, grep files)
- `.agent/evidence/` layout + `result.json` schema
- Notebook text-extract pilot doc

## Sequencing

After 002. Order: runner -> 3 checks -> SKILL.md -> notebook pilot.
