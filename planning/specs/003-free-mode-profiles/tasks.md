# 003 - free-mode-profiles - Tasks

- [x] T001 [agent] [status:done] Implement standard Firefox binary discovery and profile initialization
      covers: D1@1, D2@1
      changes: src/browser/standard-runtime.ts (+89), src/browser/test/standard-runtime.test.ts (+36)
- [x] T002 [agent] [status:done] Integrate Free Mode with BidiBackend and operational tools
      covers: D3@1
      changes: src/browser/bidi-backend.ts (+35 -12), src/ops/ops.ts (+79 -27)
- [x] T003 [agent] [status:done] Document Free Mode in README, AGENTS.md, SKILL.md, and docs
      covers: R3@1
      changes: README.md (+19 -7), AGENTS.md (+8 -2), docs/firefox-pwa.md (+14)
- [x] T004 [agent] [status:done] Revert standard desktop Firefox code, tests, and documentation
      covers: D4@1
      retires: T001, T002, T003
      changes: src/browser/standard-runtime.ts (-89), src/browser/test/standard-runtime.test.ts (-36), src/browser/bidi-backend.ts (-35 +12), src/ops/ops.ts (-79 +27), README.md (-19 +7), AGENTS.md (-8 +2), docs/firefox-pwa.md (-14)
