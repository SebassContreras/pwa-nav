# 001 — nav-snapshot — Design

## Approach

Thin TypeScript CLI. As shipped (offline MVP) `open` persists the URL and `snapshot` normalizes a caller-supplied ARIA tree into `.agent/snapshot.json` with a fresh `snapshotId` (uuid). The live browser source was originally planned on Playwright MCP/Chromium; AMENDED 2026-10-01: the live source is the user's Firefox PWA over WebDriver BiDi (spec 004). No custom browser engine.

## Deliverables

- `src/cli.ts` with `open`, `snapshot` commands
- `src/snapshot.ts` normalizer (Playwright ARIA tree -> `{snapshotId, url, title, elements[]}`)
- `package.json` scripts (`pnpm i`, `pnpm build`, `pnpm smoke`)
- `mcp.json` adapter config for `@playwright/mcp` (transitional; replaced by spec 006)
- `smoke.sh` opening demo page + own web URL
- `.agent/snapshot.json` sample output

## Sequencing

001 first, no internal order beyond: contract type -> CLI -> smoke. 002/003 depend on its output.
