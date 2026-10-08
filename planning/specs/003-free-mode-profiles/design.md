# 003 - free-mode-profiles - Design

## Context

PWAsForFirefox requires installing an extension and native runtime. Free Mode leverages standard Firefox with a dedicated profile for flexible web navigation.

## Decisions

- D1@1 (implements R1): Find Firefox executable using cross-platform known paths and PATH discovery in standard-runtime.ts.
- D2@1 (implements R2, R4, R5): Initialize dedicated profile directory in .agent/browser-profile with prefs.js enabling remote debugging port.
- D3@1 (implements R3): Integrate Free Mode runtime with BidiBackend and ops.ts, automatically routing non-PWA navigations to standard runtime.
