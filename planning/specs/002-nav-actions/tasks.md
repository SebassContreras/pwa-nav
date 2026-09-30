# 002 — nav-actions — Tasks

Status legend: `todo` · `in_progress` · `blocked` · `interrupted` · `done`
Owner: `agent` (loop-runnable) · `human` (skipped by the loop)

- [x] T001 [agent] [status:done] Implement refMap store with snapshotId invalidation (src/refs.ts)
      └─ Store verified: save/load/resolve + stale_ref, build+lint pass.
- [x] T002 [agent] [status:done] Implement click by snapshotId + ref with stale_ref error
      └─ Click verified: valid logs intent + supersedes, stale fails fast.
- [x] T003 [agent] [status:done] Implement fill/type by snapshotId + ref
      └─ Fill verified: valid logs intent + supersedes, stale fails fast.
- [x] T004 [agent] [status:done] Implement extract (text/links) command
      └─ Extract verified: text/links read-only, stale id fails fast.
- [x] T005 [agent] [status:done] Implement bulk act parser (fill:eA=.. click:eB)
      └─ Bulk act verified: sequential ops, abort on first stale.
- [x] T006 [agent] [status:done] Verify acceptance criteria 002 (click, fill, stale_ref, extract, bulk)
      └─ All 4 criteria pass, build+lint+smoke green.
