# pwa-nav

A stable CLI + snapshot bridge for fluid QA of web apps and assisted, lawful browsing automation on login-walled sites where classic bots are blocked — including LLM notebooks.

Instead of driving pixels, agents work from a **nav JSON snapshot**: an accessibility-tree contract with stable per-snapshot refs (`e1`, `e2`, …). Every mutation invalidates the snapshot, so stale refs fail fast with a re-snapshot instruction instead of clicking the wrong element.

## Status

MVP is working: `open` → `snapshot` → `click` / `fill` / `extract` → `qa run` with evidence. See `planning/roadmap.md` for the spec index (all three MVP specs are done).

## Quickstart

Requirements: Node 22+, pnpm 11.

```bash
pnpm i
pnpm build
pnpm smoke
node ./dist/cli.js qa run checks/demo-snapshot.json
```

Point an MCP client at the Playwright backend via `mcp.json` (`@playwright/mcp`), and give coding agents `SKILL.md` — it documents the whole workflow in one page.

## Commands

| Command | What it does |
|---|---|
| `open <url>` | Persist the target URL (MVP: no live browser launch; the user browses in their own logged-in Chrome) |
| `snapshot [-i] [--json]` | Write `.agent/snapshot.json` with a fresh `snapshotId` |
| `click --snapshot <id> <ref>` | Log a click intent, supersede the snapshot |
| `fill --snapshot <id> <ref> <text>` | Log a fill intent, supersede the snapshot |
| `extract --snapshot <id> --mode text\|links` | Read-only narrow extraction (never supersedes) |
| `act --snapshot <id> <op>…` | Bulk ops (`fill:<ref>=<text>`, `click:<ref>`), executed in order |
| `qa run <check-file>` | Run a JSON check (`open/snapshot/click/fill/act/extract/assert-text`), save evidence + `result.json` |

## The one rule

Refs are valid for **one snapshot only**. After every mutation, re-snapshot. A stale `snapshotId + ref` fails with `stale_ref — re-snapshot`, never acts on the wrong element.

## Evidence

Every `qa run` writes per-step snapshots plus `result.json` under `.agent/evidence/<run-id>/`, so a failing check names the missing text and the snapshot that proves it.

## Lawful use

This tool drives **your own browser session** — you log in, the agent assists. It never bypasses CAPTCHAs, bot walls, or access controls, and never handles credentials.

## What's next

Post-MVP: live Playwright browser backend, native WebMCP (`document.modelContext`) tools, multi-session support, and full automatic notebook search (the pilot in `docs/notebook-pilot.md` is read-only text extraction for now).

## Layout

- `src/` — CLI, snapshot normalizer, refs store, QA runner
- `checks/` — example QA checks + offline ARIA fixtures
- `docs/` — MCP setup (`mcp.md`), notebook pilot
- `planning/` — product, architecture, roadmap, per-spec requirements/design/tasks
- `SKILL.md` — one-page agent guide
