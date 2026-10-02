# 010 — cross-platform-runtime — Tasks

Status legend: `todo` · `in_progress` · `blocked` · `interrupted` · `done`
Owner: `agent` (loop-runnable) · `human` (skipped by the loop)

- [x] T001 [agent] [status:done] Implement comprehensive Linux and macOS path resolution in `src/browser/pwa-runtime.ts` (`DATA_DIR_TABLE`, `runtimePath`)
- [x] T002 [agent] [status:done] Add POSIX shell launch hint formatter for Linux/macOS in `src/browser/pwa-runtime.ts`
- [x] T003 [agent] [status:done] Add Linux and macOS matrix unit tests in `src/browser/pwa-runtime.test.ts` verifying path resolution, config parsing, and launch argument generation
- [x] T004 [agent] [status:done] Update `docs/firefox-pwa.md` and `README.md` with tested launch commands for Linux and macOS
- [ ] T005 [human] [status:todo] Verify live runtime launch on a native Linux or macOS machine when available
- [x] T006 [agent] [status:done] Verify acceptance criteria (lint, build, test, smoke green)
