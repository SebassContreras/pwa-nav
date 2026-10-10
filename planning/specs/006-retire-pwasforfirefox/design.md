# 006 - retire-pwasforfirefox - Design

## Approach

- D1@1 (implements R1, R2): Eliminate all `firefoxpwa` legacy configuration parsing (`config.json`, ULID site models, `findSite`, `readConfig`, `parseConfig`, `cleanDebuggingPortConfigured`) and purge the `--site <ULID>` CLI flag and options from the codebase, replacing site resolution with pure standalone URL/slug mapping. _(judgement, no standard)_
- D2@1 (implements R1): Refactor and decompose `src/browser/pwa-runtime.ts` following Single Responsibility Principle (SRP): extract network socket probing (`waitForPort`, `tcpProbe`, `validatePort`) and runtime binary location into focused, pure, injectable helpers/services, leaving zero references to the PWAsForFirefox extension connector or directory layouts. _(standard: SOLID Principles & SRP - https://en.wikipedia.org/wiki/Single-responsibility_principle)_
- D3@1 (implements R1, R2): Make `DefaultPwaProvisioner` and `launchStandaloneApp` the single, primary execution path in `BidiBackend.open()`, eliminating the legacy try/catch fallback branch that checked for installed `firefoxpwa` sites. _(judgement, no standard)_
- D4@1 (implements R3, R4): Clean all documentation (`README.md`, `AGENTS.md`, `SKILL.md`, `docs/`) and tests, replacing legacy `PWA_NAV_FIREFOXPWA_DIR` fixtures with native `.agent/apps/<appSlug>` metadata tests and verifying the entire 385+ test suite passes without any PWAsForFirefox dependencies. _(standard: Clean Code & Invariant Testing - https://martinfowler.com/bliki/TestDrivenDevelopment.html)_

## Deliverables

- Refactor `src/browser/pwa-runtime.ts`: strip legacy `firefoxpwa` functions and retain only runtime path discovery and port utilities (or modularize helpers) (D1, D2).
- Update `src/browser/bidi-backend.ts`: purge `siteId`, `getInstalledOrigins`, `findSite`, and route directly through `provisioner.provisionAndLaunch` when launch is requested (D1, D3).
- Update `src/cli.ts` & `src/mcp/mcp-server.ts`: remove `--site` flag and clean descriptions (D1).
- Update documentation: `README.md`, `AGENTS.md`, `SKILL.md`, `docs/firefox-pwa.md`, `planning/architecture.md` (D4).
- Update tests: `src/browser/test/pwa-runtime.test.ts`, `src/browser/test/bidi-backend.test.ts`, and CLI/MCP test suites (D4).

## Sequencing

D1, D2, and D3 remove the legacy engine and unify the standalone runner. D4 updates documentation and test fixtures to ensure full green verification.

## Open questions

None.
