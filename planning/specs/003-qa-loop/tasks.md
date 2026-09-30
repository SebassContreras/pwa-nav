# 003 — qa-loop — Tasks

Status legend: `todo` · `in_progress` · `blocked` · `interrupted` · `done`
Owner: `agent` (loop-runnable) · `human` (skipped by the loop)

- [x] T001 [agent] [status:done] Implement qa runner (open/snapshot/act/assert-text) with evidence output
      └─ Runner verified: pass/fail + evidence, shared ops layer.
- [x] T002 [agent] [status:done] Add 3 example checks under checks/
      └─ 3 checks pass via qa run (demo, login flow, extract).
- [x] T003 [agent] [status:done] Write SKILL.md for fresh agent sessions
      └─ SKILL.md verified by literal run-through (demo check passes).
- [x] T004 [agent] [status:done] Implement notebook text-extract pilot doc + verification
      └─ Pilot verified end-to-end; parser colon edge fixed by master.
- [ ] T005 [human] [status:todo] Define first 3 QA checks and open notebook pages
- [x] T006 [agent] [status:done] Verify acceptance criteria 003 (qa run pass/fail + evidence + SKILL.md)
      └─ All 4 criteria pass, build+lint+smoke green.
