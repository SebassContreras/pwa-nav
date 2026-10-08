# 004 - standalone-pwa-no-extension - Requirements

## What's being built

Standalone PWA launcher and automation runner for LinkedIn without requiring the PWAsForFirefox browser extension or manual user installation. It directly launches the underlying Firefox PWA standalone runtime with WebDriver BiDi enabled on the configured debugging port (9222), with persistent session profile isolation and no traditional desktop browser toolbars or tabs.

## Who it serves

Agents and users needing automated access to LinkedIn as an isolated, standalone desktop web application with persistent authentication, without manual browser extension setup.

## Requirements

- R1@1: Launch LinkedIn (https://www.linkedin.com) directly in standalone window mode (no address bar, no tabs) using the Firefox PWA runtime binary.
- R2@1: Eliminate dependency on the PWAsForFirefox browser extension: LinkedIn standalone session is created and managed directly without extension messaging.
- R3@1: Attach WebDriver BiDi directly to the standalone LinkedIn instance on port 9222.
- R4@1: Maintain a dedicated persistent profile for LinkedIn so login cookies and user sessions persist across restarts.

## Out of scope

- General automatic provisioning for arbitrary domains (deferred to Spec 005).
- Removing PWAsForFirefox legacy code paths (deferred to Spec 006).

## Dependencies

- None.

## Owner split

Agent: code, tests, docs. Human: verifying visual standalone window rendering.
