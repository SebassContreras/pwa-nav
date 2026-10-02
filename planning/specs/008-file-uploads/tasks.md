# 008 — file-uploads — Tasks

Status legend: `todo` · `in_progress` · `blocked` · `interrupted` · `done`
Owner: `agent` (loop-runnable) · `human` (skipped by the loop)

- [ ] T001 [agent] [status:todo] Add `input.setFiles` command to `src/bidi/protocol.ts` and fake server in `src/bidi/fake-server.ts` with protocol tests
- [ ] T002 [agent] [status:todo] Implement file path allow-list gate `assertFileUploadAllowed` in `src/core/gate.ts` and `file_upload_blocked` error code in `src/core/errors.ts` with unit tests
- [ ] T003 [agent] [status:todo] Update `src/browser/collector.ts` to tag file inputs and adjust actionability checks in `src/browser/actions.ts` for invisible file inputs
- [ ] T004 [agent] [status:todo] Implement `uploadFiles` in `src/browser/actions.ts` and `performUpload` in `src/ops/ops.ts` with settle wait
- [ ] T005 [agent] [status:todo] Add CLI support for `upload <ref|@id> <path>` and `act upload:<ref>=<path>` in `src/cli.ts` with CLI integration tests
- [ ] T006 [agent] [status:todo] Add `pwa_upload` tool to MCP server in `src/mcp/mcp-tools.ts` with conformance tests
- [ ] T007 [agent] [status:todo] Update `README.md`, `SKILL.md` and docs with file upload instructions and security considerations
- [ ] T008 [agent] [status:todo] Verify acceptance criteria (lint, build, test, smoke green)
