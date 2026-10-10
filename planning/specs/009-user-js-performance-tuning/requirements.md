# 009 - user-js-performance-tuning - Requirements

## What's being built

Optimized Gecko engine profile configuration template (`user.js`) tailored for fast, low-overhead BiDi QA and testing automation. Strips non-essential background services, telemetry, and heavy UI animations while optimizing cache and network idle triggers.

## Who it serves

Agents and test runners that require snappy navigation, consistent network idle settling, and minimized RAM/CPU footprint when driving PWA instances.

## Requirements

- R1@1: Performance preference tuning: inject calibrated Gecko preferences in `.agent/apps/<appSlug>/profile/user.js` to disable non-essential features (telemetry, background update pings, speculative connections, smooth scrolling/heavy CSS transitions).
- R2@1: Predictable settling: adjust network and DOM timing preferences to improve the reliability of WebDriver BiDi `networkIdle` detection.
- R3@1: Cache optimization: optimize script compilation cache (`startupCache`) settings to accelerate cold and warm launches of complex web applications.
- R4@1: Non-destructive merge: ensure custom user-defined preferences in `user.js` are preserved without being unconditionally overwritten.

## Out of scope

- Content-blocking adblock extensions or invasive HTML mutation.
- Bypassing site security headers.

## Dependencies

- 004 (standalone-pwa-no-extension).

## Owner split

Agent: code, tests, docs. Human: performance benchmark verification.
