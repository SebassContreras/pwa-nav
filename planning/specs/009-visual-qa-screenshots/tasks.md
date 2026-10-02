# 009 — visual-qa-screenshots — Tasks

Status legend: `todo` · `in_progress` · `blocked` · `interrupted` · `done`
Owner: `agent` (loop-runnable) · `human` (skipped by the loop)

- [x] T001 [agent] [status:done] Implement `browsingContext.captureScreenshot` in `src/bidi/protocol.ts` and fake BiDi server with protocol tests
- [x] T002 [agent] [status:done] Add `screenshot` to `Backend` port and implement in `src/browser/bidi-backend.ts` and `OfflineBackend`
- [x] T003 [agent] [status:done] Implement `performScreenshot` in `src/ops/ops.ts` writing binary PNG to disk
- [x] T004 [agent] [status:done] Integrate automatic screenshot capture on step failure and `screenshot` step in `src/ops/qa.ts` evidence runner
- [x] T005 [agent] [status:done] Add CLI `screenshot [--out <path>]` command and options in `src/cli.ts` with integration tests
- [x] T006 [agent] [status:done] Add `pwa_screenshot` tool to MCP server in `src/mcp/mcp-tools.ts` with conformance tests
- [x] T007 [agent] [status:done] Add real Firefox E2E test verifying screenshot generation in headless mode
- [x] T008 [agent] [status:done] Verify acceptance criteria (lint, build, test, smoke green)
