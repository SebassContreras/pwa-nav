# 002 - multi-pwa-isolation - Requirements

## What's being built

Multi-PWA session management and window isolation. Enable opening multiple PWAs concurrently without forcing subsequent PWAs into navigation or new tabs within an existing PWA's OS window on port 9222.
Source: GitHub issue #4.

## Who it serves

Agents and developers running multiple web apps simultaneously (e.g., WhatsApp and LinkedIn) who need each application to live in its own independent desktop window with dedicated debugging lifecycle.

## Requirements

- R1@1: Opening a second PWA while another PWA is already listening on port 9222 allocates an independent debugging port (e.g. 9223+) or isolates the launch so the apps do not collide or cross-navigate.
- R2@1: Each launched PWA maintains its own standalone OS window instance instead of opening as a tab or replacing the location of an existing PWA window.
- R3@1: CLI and MCP tools allow targeting a specific active PWA instance via `--app` or `--port` without ambiguous session hijacking.
- R4@1: Releasing or closing a BiDi session for one PWA does not terminate or invalidate connections to other active PWA instances.
- R5@1: Active debugging ports and their associated app slugs are tracked cleanly and freed when the browser process exits.

## Out of scope

- Synchronizing browser state, cookies, or localStorage across isolated PWA instances.
- Supporting browsers other than Firefox PWA runtime and standard Firefox.

## Dependencies

- None.

## Owner split

Agent: code, tests, docs. Human: verification with multiple concurrent live PWA launches.
