# 009 — visual-qa-screenshots — Tasks

Status legend: `todo` · `in_progress` · `blocked` · `interrupted` · `done`
Owner: `agent` (loop-runnable) · `human` (skipped by the loop)

- [ ] T001 [agent] [status:todo] Implement `browsingContext.captureScreenshot` in `src/bidi/protocol.ts` and fake BiDi server with protocol tests
- [ ] T002 [agent] [status:todo] Add `screenshot` to `Backend` port and implement in `src/browser/bidi-backend.ts` and `OfflineBackend`
- [ ] T003 [agent] [status:todo] Implement `performScreenshot` in `src/ops/ops.ts` writing binary PNG to disk
- [ ] T004 [agent] [status:todo] Integrate automatic screenshot capture on step failure and `screenshot` step in `src/ops/qa.ts` evidence runner
- [ ] T005 [agent] [status:todo] Add CLI `screenshot [--out <path>]` command and options in `src/cli.ts` with integration tests
- [ ] T006 [agent] [status:todo] Add `pwa_screenshot` tool to MCP server in `src/mcp/mcp-tools.ts` with conformance tests
- [ ] T007 [agent] [status:todo] Add real Firefox E2E test verifying screenshot generation in headless mode
- [ ] T008 [agent] [status:todo] Verify acceptance criteria (lint, build, test, smoke green)
