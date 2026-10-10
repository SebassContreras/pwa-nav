# 010 - profile-backup-restore - Requirements

## What's being built

CLI and programmatic utility (`pwa-nav profile backup/restore <app>`) for archiving, exporting, and restoring isolated PWA user profiles. Enables seamless migration of authenticated sessions, cookies, and local storage across machines or test runs while pruning bloated transient cache files.

## Who it serves

Developers and QA teams running multi-stage automated tests across environments who want to preserve and distribute authenticated app state without re-authenticating manually every time.

## Requirements

- R1@1: Clean archive generation: export `.agent/apps/<appSlug>/profile/` into a portable, compressed archive, omitting ephemeral transient folders (`cache2/`, `startupCache/`, `thumbnails/`).
- R2@1: Profile restoration: extract and restore archived profiles into `.agent/apps/<appSlug>/profile/` with appropriate file permissions and lock cleanup.
- R3@1: Sensitive path boundaries: ensure backup files reside strictly within permitted workspace directories or explicit user destinations.
- R4@1: Integrity verification: validate profile structure before overwriting an existing profile to prevent accidental state loss.

## Out of scope

- Cloud storage syncing or remote credential distribution.
- Altering or decrypting OS-bound credentials across differing operating systems.

## Dependencies

- 002 (multi-pwa-isolation).

## Owner split

Agent: code, tests, docs. Human: validation of profile portability across sessions.
