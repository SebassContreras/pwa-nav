# 006 - retire-pwasforfirefox - Tasks

- [x] T001 [agent] [status:done] Remove legacy config.json parsing, ULID resolution, and site models from src/browser/pwa-runtime.ts
      covers: R1@1, R2@1, D1@1, D2@1
      changes: src/browser/pwa-runtime.ts (+15 -327), src/browser/standalone-runner.ts (+4 -7), src/browser/test/bidi-backend.test.ts (+14 -12), src/browser/test/provisioner.test.ts (+5 -4), src/browser/test/standalone-runner.test.ts (+6 -4), test-cache/apps/example-com/profile/chrome/userChrome.css (+7 -0), test-cache/apps/example-com/profile/user.js (+8 -0)
- [x] T002 [agent] [status:done] Unify BidiBackend to use PwaProvisioner and standalone runner directly, removing siteId and firefoxpwa discovery
      covers: R1@1, R2@1, D1@1, D3@1
      changes: src/backend/backend-factory.ts (+0 -2), src/browser/bidi-backend.ts (+15 -63), src/browser/standalone-runner.ts (+70 -0), src/mcp.ts (+0 -4), src/ops/ops.ts (+13 -21)
- [x] T003 [agent] [status:done] Remove --site CLI option and update MCP server prompts to eliminate firefoxpwa references
      covers: R1@1, D1@1
      changes: src/cli.ts (+4 -15), src/mcp/mcp-server.ts (+1 -1)
- [x] T004 [agent] [status:done] Update documentation across README.md, AGENTS.md, SKILL.md, and docs/ to reflect zero dependency on PWAsForFirefox
      covers: R3@1, D4@1
      changes: AGENTS.md (+4 -4), README.md (+10 -22), SKILL.md (+3 -3), docs/firefox-pwa.md (+11 -17), docs/mcp.md (+3 -3)
- [x] T005 [agent] [status:done] Test: Update browser and backend unit tests to remove legacy firefoxpwa fixtures and verify standalone runtime assertions
      covers: R4@1, D4@1
      kind: test
      changes: src/browser/test/bidi-backend.test.ts (+20 -29), src/browser/test/pwa-runtime.test.ts (+12 -265), src/cli/test/cli.test.ts (+0 -1), src/tools/auth.ts (+5 -1), src/tools/common.ts (+0 -1), src/tools/open.ts (+4 -5), src/tools/test/tools.test.ts (+1 -1), src/tools/types.ts (+0 -1)
- [x] T006 [agent] [status:done] Test: Verify full test suite passes with zero PWAsForFirefox artifacts
      covers: R4@1, D4@1
      kind: test
      changes: src/browser/bidi-backend.ts (+2 -2)
- [x] T007 [human] [status:done] Review documentation and verify clean standalone operation without third-party extension dependencies
      covers: R3@1, R4@1
      changes: README.md (+1 -1), docs/firefox-pwa.md (+1 -1), src/cli.ts (+1 -1)
