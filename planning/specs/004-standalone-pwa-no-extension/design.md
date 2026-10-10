# 004 - standalone-pwa-no-extension - Design

## Approach

- D1@1 (implements R1, R2): Dedicated standalone runner launches LinkedIn via Firefox PWA runtime binary (`runtime/firefox`) passing an isolated profile directory (`.agent/apps/linkedin/profile`) and direct CLI flags `--profile <dir> --pwa linkedin --remote-debugging-port <port> https://www.linkedin.com` without reading `config.json` sites or querying the PWAsForFirefox browser extension. _(judgement, no standard)_
- D2@1 (implements R4): Isolated profile directory structure (`.agent/apps/linkedin/profile`) is automatically initialized on demand if absent, seeded with a minimal `user.js` containing BiDi configuration (`remote.active-protocols: 1`, `remote.experimental-modules: 1`), enabling legacy stylesheet customizations (`toolkit.legacyUserProfileCustomizations.stylesheets: true`), and seeding `chrome/userChrome.css` to collapse `#TabsToolbar` and `#nav-bar`, keeping cookies and authentication storage fully persistent across runs without touching the user's primary browser profile. _(standard: Firefox user.js and userChrome.css profile configuration - https://developer.mozilla.org/en-US/docs/Mozilla/Preferences/A_brief_guide_to_preferences)_
- D3@1 (implements R3): WebDriver BiDi client connects to `ws://127.0.0.1:<port>/session` on the standalone LinkedIn instance, asserting connection health with a top-level context query and recycling connections per operation through the standard `withTopLevelContext` lifecycle. _(standard: W3C WebDriver BiDi - https://w3c.github.io/webdriver-bidi/)_

## Deliverables

- `src/browser/standalone-runner.ts` - launcher for standalone PWA instances without extension dependency (D1, D2).
- `src/browser/standalone-profile.ts` - profile creator and `user.js` seed manager (D2).
- Unit and integration tests in `src/browser/test/standalone-runner.test.ts`.

## Sequencing

D2 before D1 (profile initialization precedes runtime process spawn). D3 validates BiDi connectivity against the spawned instance.

## Open questions

None.
