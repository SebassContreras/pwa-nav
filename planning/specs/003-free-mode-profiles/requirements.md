# 003 - free-mode-profiles - Requirements

## What's being built

Standard Firefox profile engine ("Free Mode") allowing navigation and automation of any web application using the user's standard Firefox installation, without requiring the PWAsForFirefox extension or runtime.
Source: GitHub issue #5.

## Who it serves

Users and agents who want friction-free browsing automation across arbitrary URLs and web domains with persistent sessions, without installing each site as an individual PWA.

## Requirements

- ~~R1@1: Standard Firefox binary detection locates existing Firefox installations across Windows, Linux, and macOS without requiring PWAsForFirefox.~~ retired 2026-10-08
- ~~R2@1: An isolated, persistent agent profile directory (`.agent/browser-profile`) is initialized and maintained for Free Mode sessions.~~ retired 2026-10-08
- ~~R3@1: PWA Mode and Free Mode coexist seamlessly: known installed PWAs attach via PWAsForFirefox, while generic URLs launch via Free Mode profile.~~ retired 2026-10-08
- ~~R4@1: Free Mode launches with WebDriver BiDi enabled on the configured debugging port (default 9222).~~ retired 2026-10-08
- ~~R5@1: User authentication sessions (cookies, logins) persist across sessions inside the agent profile directory.~~ retired 2026-10-08
- R6@1: Revert all desktop Firefox engine code, tests and docs so the codebase remains purely PWA-focused.

## Out of scope

- Headless-only mode without UI rendering.
- Managing multiple concurrent Free Mode profiles.

## Dependencies

- None.

## Owner split

Agent: code, tests, docs. Human: verification of manual login retention.
