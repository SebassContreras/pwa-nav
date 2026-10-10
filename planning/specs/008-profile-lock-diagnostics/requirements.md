# 008 - profile-lock-diagnostics - Requirements

## What's being built

Robust profile lock diagnostics and stale lock recovery mechanism that inspects Firefox runtime lock artifacts (`parent.lock`) to distinguish between truly active browser sessions and orphaned locks caused by crashed or killed processes.

## Who it serves

Agents and automated workflows that encounter ambiguous BiDi connection errors (exit code 4 `no_browser` or code 5 `session_busy`) caused by lingering lock files after sudden process exits.

## Requirements

- R1@1: Lock inspection: inspect `parent.lock` in `.agent/apps/<appSlug>/profile/` before spawning or connecting to identify owning process IDs.
- R2@1: Stale lock detection: check process table to determine if the locking process is dead or active.
- R3@1: Safe automated recovery: cleanly clear orphaned `parent.lock` when no active browser process owns it, enabling instant unblocked launches.
- R4@1: Clear error feedback: if an active conflicting process holds the lock, return explicit diagnostics naming the PID and executable rather than generic timeout errors.

## Out of scope

- Killing arbitrary user processes without confirmation.
- Cross-user file permission bypass.

## Dependencies

- 002 (multi-pwa-isolation).

## Owner split

Agent: code, tests, docs. Human: validation across platform crash scenarios.
