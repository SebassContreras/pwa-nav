# 002 - multi-pwa-isolation - Tasks

- [x] T001 [agent] [status:done] Define PwaInstanceRegistry interface and PortAllocator utility
      covers: D1@1, R1@1
      changes: src/browser/port-allocator.ts (+61 -0)
- [x] T002 [agent] [status:done] Unit tests for port allocation and probe collision avoidance
      covers: D1@1, R1@1
      kind: test
      changes: src/browser/test/port-allocator.test.ts (+37 -0), test-cache/apps/example-com/profile/chrome/userChrome.css (+7 -0), test-cache/apps/example-com/profile/user.js (+8 -0)
- [x] T003 [agent] [status:done] Implement file-backed InstanceRegistry with atomic sync and stale pruning
      covers: D3@1, D5@1, R3@1, R5@1
      changes: src/browser/instance-registry.ts (+102 -0)
- [x] T004 [agent] [status:done] Unit tests for InstanceRegistry lifecycle and stale pruning
      covers: D3@1, D5@1, R3@1, R5@1
      kind: test
      changes: src/browser/test/instance-registry.test.ts (+76 -0)
- [x] T005 [agent] [status:done] Integrate PortAllocator and InstanceRegistry into launchStandaloneApp
      covers: D2@1, R2@1
      changes: src/browser/standalone-runner.ts (+34 -8)
- [x] T006 [agent] [status:done] Support app and port target resolution in BidiBackend and tools
      covers: D4@1, R3@1, R4@1
      changes: src/backend/backend-factory.ts (+12 -1), src/tools/common.ts (+2 -0), src/tools/open.ts (+4 -2), src/tools/types.ts (+4 -0)
- [x] T007 [agent] [status:done] Wire --app and --port flags into CLI and MCP adapters
      covers: D4@1, R3@1
      changes: src/cli.ts (+6 -1), src/mcp.ts (+5 -2)
- [x] T008 [agent] [status:done] Integration test for concurrent isolated PWA instances
      covers: D2@1, D4@1, R2@1, R4@1
      kind: test
      changes: src/browser/test/multi-pwa.test.ts (+72 -0)
- [ ] T009 [human] [status:todo] Manual verification of launching two concurrent live PWAs in separate OS windows
      covers: R1@1, R2@1, R3@1, R4@1, R5@1
      kind: test
