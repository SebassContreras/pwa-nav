# 007 - session-health-check - Requirements

## What's being built

Session health inspection tool and proactive check (`pwa_auth` action `status` / `pwa-nav status <app>`) that reads profile storage artifacts (`cookies.sqlite`, `webappsstore.sqlite`) in read-only mode to determine whether key authentication tokens/cookies exist and are valid before initiating browser actions or failing with timeouts.

## Who it serves

Agents and developers needing immediate, zero-token feedback on whether a target application session is authenticated or expired, avoiding unnecessary browser launch cycles, failed element interactions, and blind timeouts.

## Requirements

- R1@1: Read-only profile inspection: safely inspect `cookies.sqlite` and `webappsstore.sqlite` under `.agent/apps/<appSlug>/profile/` without locking or modifying browser databases.
- R2@1: Session status detection: determine whether active session cookies for the target domain exist, calculating remaining TTL/expiration timestamps.
- R3@1: MCP & CLI interfaces: expose status checks via `pwa_auth({ action: "status", app: "<app>" })` and `pwa-nav status <app>`.
- R4@1: Actionable guidance: when cookies are expired or absent, return structured status with immediate guidance to run `pwa_auth clean` without attempting doomed UI navigation.

## Out of scope

- Decrypting password stores (`logins.db` / `key4.db`).
- Modifying, injecting, or tampering with cookie values.
- Automating credential entry.

## Dependencies

- 002 (multi-pwa-isolation).

## Owner split

Agent: code, tests, docs. Human: validation with authenticated profiles.
