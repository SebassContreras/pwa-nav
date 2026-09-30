# 001 — nav-snapshot — Tasks

Status legend: `todo` · `in_progress` · `blocked` · `interrupted` · `done`
Owner: `agent` (loop-runnable) · `human` (skipped by the loop)

- [x] T001 [agent] [status:done] Scaffold Node 22 + TS strict + pnpm project (package.json, tsconfig, eslint)
      └─ Scaffold verified: build+lint pass, dist/index.js runs.
- [x] T002 [agent] [status:done] Implement snapshot contract types + normalizer (src/snapshot.ts)
      └─ Types + pure normalize verified: build+lint pass.
- [x] T003 [agent] [status:done] Implement CLI open + snapshot commands writing .agent/snapshot.json
      └─ CLI verified: open/snapshot work, fresh snapshotId per run.
- [x] T004 [agent] [status:done] Add mcp.json adapter config for @playwright/mcp
      └─ mcp.json parses OK, docs/mcp.md written.
- [x] T005 [agent] [status:done] Add smoke script verifying open + snapshot on demo page and own web URL
      └─ Smoke passes offline (demo + own URL, fresh snapshotId).
- [ ] T006 [human] [status:todo] Log in to test sites in Chrome and approve test URLs
- [x] T007 [agent] [status:done] Verify acceptance criteria 001 (snapshot file, refs, fresh snapshotId)
      └─ File/refs/fresh-id pass; criterion 1 (live navigation) gap noted, needs human login + live backend.
