# 010 — cross-platform-runtime — Tasks

Status legend: `todo` · `in_progress` · `blocked` · `interrupted` · `done`
Owner: `agent` (loop-runnable) · `human` (skipped by the loop)

- [ ] T001 [agent] [status:todo] Implement comprehensive Linux and macOS path resolution in `src/browser/pwa-runtime.ts` (`DATA_DIR_TABLE`, `runtimePath`)
- [ ] T002 [agent] [status:todo] Add POSIX shell launch hint formatter for Linux/macOS in `src/browser/pwa-runtime.ts`
- [ ] T003 [agent] [status:todo] Add Linux and macOS matrix unit tests in `src/browser/pwa-runtime.test.ts` verifying path resolution, config parsing, and launch argument generation
- [ ] T004 [agent] [status:todo] Update `docs/firefox-pwa.md` and `README.md` with tested launch commands for Linux and macOS
- [ ] T005 [human] [status:todo] Verify live runtime launch on a native Linux or macOS machine when available
- [ ] T006 [agent] [status:todo] Verify acceptance criteria (lint, build, test, smoke green)
