# 004 - standalone-pwa-no-extension - Tasks

- [x] T001 [agent] [status:done] Implement standalone profile directory creator and user.js preference seed manager
      covers: D2@1
      changes: src/browser/standalone-profile.ts (+47 -0)
- [x] T002 [agent] [status:done] Implement standalone process launcher for LinkedIn with isolated profile and BiDi flags
      covers: D1@1
      changes: src/browser/standalone-runner.ts (+115 -0)
- [x] T003 [agent] [status:done] Test: Profile seed creates dedicated directory with required BiDi preferences without touching default browser profile
      covers: R4@1, D2@1
      kind: test
      changes: src/browser/test/standalone-profile.test.ts (+52 -0)
- [x] T004 [agent] [status:done] Test: Standalone launcher spawns LinkedIn with standalone flags without extension dependencies
      covers: R1@1, R2@1, D1@1
      kind: test
      changes: src/browser/test/standalone-runner.test.ts (+110 -0)
- [x] T005 [agent] [status:done] Test: BiDi connection attaches cleanly to the standalone LinkedIn instance on port 9222
      covers: R3@1, D3@1
      kind: test
      changes: src/browser/test/standalone-runner.test.ts (+33 -0)
- [x] T006 [human] [status:done] Visually verify LinkedIn window opens in standalone mode without browser tabs or address bar
      covers: R1@1
