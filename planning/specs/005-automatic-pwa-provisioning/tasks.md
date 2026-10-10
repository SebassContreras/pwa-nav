# 005 - automatic-pwa-provisioning - Tasks

- [x] T001 [agent] [status:done] Define PwaProvisioner service interface and implement DefaultPwaProvisioner with slug extraction and isolated profile initialization
      covers: D1@1, D2@1
      changes: src/browser/provisioner.ts (+91 -0)
- [x] T002 [agent] [status:done] Implement standalone launch delegation in PwaProvisioner for arbitrary targets
      covers: D1@1, D3@1
      changes: src/browser/provisioner.ts (+7 -1)
- [x] T003 [agent] [status:done] Integrate PwaProvisioner into BidiBackend.open() to automatically provision uninstalled origins on demand
      covers: D3@1
      changes: src/browser/bidi-backend.ts (+21 -2)
- [x] T004 [agent] [status:done] Test: Unit test DefaultPwaProvisioner creates dedicated profile and resolves slug deterministically
      covers: R1@1, R3@1, D1@1, D2@1
      kind: test
      changes: src/browser/bidi-backend.ts (+13 -18), src/browser/test/provisioner.test.ts (+44 -0)
- [x] T005 [agent] [status:done] Test: Provisioner launches standalone process with isolated profile and remote debugging port
      covers: R1@1, R4@1, D1@1, D3@1
      kind: test
      changes: src/browser/test/provisioner.test.ts (+30 -0), test-cache/apps/example-com/profile/chrome/userChrome.css (+7 -0), test-cache/apps/example-com/profile/user.js (+8 -0)
- [x] T006 [agent] [status:done] Test: BidiBackend.open seamlessly provisions and navigates to arbitrary uninstalled domain
      covers: R2@1, R4@1, D3@1
      kind: test
      changes: src/browser/test/bidi-backend.test.ts (+42 -0), test-cache/apps/example-com/profile/chrome/userChrome.css (+0 -7), test-cache/apps/example-com/profile/user.js (+0 -8)
- [ ] T007 [human] [status:todo] Verify opening an arbitrary website launches in a dedicated standalone PWA window without manual installation
      covers: R2@1, R4@1
