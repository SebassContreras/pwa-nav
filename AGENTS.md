# AGENTS.md — pwa-nav

## Project

Stable CLI + PWA bridge for fluid QA of your web app and assisted, lawful browsing automation on login-walled sites where classic bots are blocked, including LLM notebooks. Audience: solo developer + dev team. Type: software — CLI + bridge (PWA SDK + local daemon/CLI + MCP).

## Doc map

- `planning/product.md` — what this is, who uses it, out of scope.
- `planning/architecture.md` — stack decisions with reasons.
- `planning/styles.md` — style rules.
- `planning/roadmap.md` — spec index. Read this table first.
- `planning/specs/NNN-name/{requirements,design,tasks}.md` — one folder per spec.
- `.specloop/interview.md` — interview ledger.

## Stack & conventions

- Runtime: Node 22 LTS, ESM (`module: nodenext`), TypeScript strict.
- Package manager: pnpm 11. Commands: `pnpm i`, `pnpm lint`, `pnpm build`, `pnpm smoke`.
- Browser: reuse local logged-in Chrome via Playwright + `chrome-devtools-mcp` / `@playwright/mcp`. No custom WebSocket bridge in MVP.
- Snapshots: accessibility-tree JSON `{snapshotId, url, title, elements[{ref, role, name, value, disabled}]}`. Refs are valid for one snapshot only; re-snapshot after every mutation.
- Snapshot files go to `.agent/snapshot.json` (or `outputDir`); agents grep the file, snapshots are never pasted inline into context.
- Config/secrets via `.env`, never committed.

## Style

- All project docs and code comments in English. Chat with user in Spanish.
- Terse, structural markdown. No filler prose.
- See `planning/styles.md` for detail.

## Rules for agents

- Lawful use only with the user's own sessions. Never bypass CAPTCHA, bot walls, or access controls.
- Never commit secrets or `.env`.
- Never invent stack or requirements; leave `TBD` rather than guess.
- CLI-first: `open`, `snapshot`, `click`, `fill`, `extract`. Keep tool surface to 5 commands in MVP.
