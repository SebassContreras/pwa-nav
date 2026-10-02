# 008 — file-uploads — Tasks

Status legend: `todo` · `in_progress` · `blocked` · `interrupted` · `done`
Owner: `agent` (loop-runnable) · `human` (skipped by the loop)

- [x] T001 [agent] [status:done] Add `input.setFiles` command to `src/bidi/protocol.ts` and fake server in `src/bidi/fake-server.ts` with protocol tests
      └─ BidiClient.setFiles implemented, fake-server handles input.setFiles, 38 bidi tests pass.
- [x] T002 [agent] [status:done] Implement file path allow-list gate `assertFileUploadAllowed` in `src/core/gate.ts` and `file_upload_blocked` error code in `src/core/errors.ts` with unit tests
      └─ file_upload_blocked (exit 15) added, path allow-list & sensitive file checks implemented, 24 core tests pass.
- [x] T003 [agent] [status:done] Update `src/browser/collector.ts` to tag file inputs and adjust actionability checks in `src/browser/actions.ts` for invisible file inputs
      └─ collector tags role textbox with inputType file; checkActionable permits file inputs without visibility/rect; 91 browser tests pass.
- [x] T004 [agent] [status:done] Implement `uploadFiles` in `src/browser/actions.ts` and `performUpload` in `src/ops/ops.ts` with settle wait
      └─ uploadFiles implemented, Backend.upload added, performUpload added with security gate & settle wait; bidi & actions tests pass.
- [x] T005 [agent] [status:done] Add CLI support for `upload <ref|@id> <path>` and `act upload:<ref>=<path>` in `src/cli.ts` with CLI integration tests
      └─ upload command and act upload:op added; dry-run/armed and semantic @id supported; CLI integration tests pass.
- [x] T006 [agent] [status:done] Add `pwa_upload` tool to MCP server in `src/mcp/mcp-tools.ts` with conformance tests
      └─ pwa_upload tool added to MCP server and TOOLS registry with semantic @id and ref support; conformance tests pass.
- [x] T007 [agent] [status:done] Update `README.md`, `SKILL.md` and docs with file upload instructions and security considerations
      └─ README.md, SKILL.md, and AGENTS.md updated with upload usage, MCP tool, exit code 15, and security rules.
- [x] T008 [agent] [status:done] Verify acceptance criteria (lint, build, test, smoke green)
      └─ lint, build, test (316 passing), smoke green. Spec 008 complete.
