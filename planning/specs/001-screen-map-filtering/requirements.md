# 001 - screen-map-filtering - Requirements

## What's being built

Screen Map persistence (`pwa_learn` and the auto-learn inside `pwa_snapshot`) stops writing
user content - chat messages, reactions, quoted messages, feed items - into
`screens.json` as static `@id` targets. Live snapshots keep seeing everything.
Source: GitHub issue #3.

## Who it serves

Agents and developers who learn screens of chat, feed or comment UIs and need a
`screens.json` that stays valid across threads and sessions.

## Requirements

- R1@1: After learning a screen, `screens.json` contains no field, action or link whose element sits inside a dynamic content region (ARIA `feed`, `log` or `article`); the region appears only as a pattern entry.
- R2@1: Outside dynamic regions, an element named from its own text (`nameSource: "content"`) that reads as prose - at least 5 words and ending in `.`, `!`, `?` or `…` - is not persisted.
- R3@1: An element whose accessible name matches the transient blocklist (reactions, quoted messages, in English and Spanish) is not persisted, wherever it sits.
- R4@1: Live `pwa_snapshot` output is unchanged by this spec: every element excluded from persistence is still listed with a ref and can be found and clicked.
- R5@1: A dynamic region is persisted as one pattern per item role, marked `dynamicChildren: true`, with no per-item ids - also when the screen already exists in `screens.json`.
- R6@1: UI chrome outside dynamic regions (e.g. "Send", "Attach file", "Sign in", "Search") is persisted exactly as before.
- R7@1: Entries already in `screens.json` that the new rules exclude are removed when learning with `prune`, and kept otherwise.

## Out of scope

- Abstract item templates with per-item fields (`@message-bubble-template` contents) beyond the pattern entry.
- User-configurable blocklists.
- Automatic cleanup of existing `screens.json` files without `prune`.

## Dependencies

None.

## Owner split

Agent: code, tests, docs. Human: one check against a real chat PWA with a live, logged-in session.
