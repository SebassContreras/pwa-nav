# 003 — qa-loop — Requirements

## What's being built

A `snapshot -> act -> verify` QA loop with `SKILL.md` for coding agents: run a named check (open, snapshot, act, extract, assert text present), save evidence (snapshot JSON + notes), and log pass/fail. Includes text extract from 1 LLM notebook as the notebook pilot.

## Who/what it serves

Dev team running fluid QA on their web app and lawful assisted info gathering, including the done-when pilot toward automatic notebook search.

## Hard constraints

- Loop script + `SKILL.md` only; no new browser engine — reuse 001/002.
- Evidence per run: snapshot JSON + short result log under `.agent/evidence/`.
- Notebook pilot is read-only text extract from 1 user-opened notebook; no auto-search-all-topics yet (that is the final done-when, post-MVP).
- Lawful use only.

## Acceptance criteria

- `qa run <check>` executes open/snapshot/act/extract/assert and reports pass/fail with evidence files.
- A failing check names the missing text/ref and the snapshot that proves it.
- `SKILL.md` lets a fresh agent session run `snapshot -> click -> verify` with no extra explanation.
- Notebook pilot extracts readable text from 1 LLM notebook page.

## Out of scope

- Full automatic search of any topic in notebooks (final goal, post-MVP), custom WS bridge, WebMCP, dashboard, multi-session.

## Dependencies

- 002 nav-actions (click/fill/extract + invalidation).

## Owner split

Agent: loop script, SKILL.md, evidence format, notebook text extract. Human: define first 3 QA checks, open notebook pages, final pass/fail sign-off.
