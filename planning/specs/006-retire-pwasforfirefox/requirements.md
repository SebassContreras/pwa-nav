# 006 - retire-pwasforfirefox - Requirements

## What's being built

Complete retirement and removal of all legacy dependencies, schemas, and runtime discovery code specific to PWAsForFirefox and its extension connector across the entire repository. The repository will rely exclusively on the standalone runtime and internal provisioning engine established in Specs 004 and 005.

## Who it serves

Developers and agents maintaining `pwa-nav`, providing a completely standalone codebase free of third-party extension baggage and legacy configuration formats.

## Requirements

- R1@1: Remove all references and runtime discovery logic tied to PWAsForFirefox extension (`firefoxpwa` connector, `firefoxpwa.json`, native messaging manifests).
- R2@1: Replace third-party configuration schemas (`config.json` parsing from PWAsForFirefox) with native, minimal `pwa-nav` standalone metadata stores.
- R3@1: Update all documentation (`README.md`, `AGENTS.md`, `SKILL.md`, `docs/`) to reflect zero dependency on PWAsForFirefox.
- R4@1: Ensure full suite of unit, integration, and smoke tests pass without requiring any PWAsForFirefox artifacts.

## Out of scope

- Retrofitting deprecated browser engines.

## Dependencies

- 004, 005.

## Owner split

Agent: code, tests, docs. Human: review and sign-off.
