# 001 — nav-snapshot — Design

## Approach

Thin TypeScript CLI over Playwright MCP backend: `open` launches/persists a Chromium context using the user's Chrome profile (headed by default for login-walled sites); `snapshot` calls `browser_snapshot` in interactive-only JSON mode and writes the normalized contract to `.agent/snapshot.json` with a fresh `snapshotId` (uuid). No custom browser engine.

## Deliverables

- `src/cli.ts` with `open`, `snapshot` commands
- `src/snapshot.ts` normalizer (Playwright ARIA tree -> `{snapshotId, url, title, elements[]}`)
- `package.json` scripts (`pnpm i`, `pnpm build`, `pnpm smoke`)
- `mcp.json` adapter config for `@playwright/mcp`
- `smoke.sh` opening demo page + own web URL
- `.agent/snapshot.json` sample output

## Sequencing

001 first, no internal order beyond: contract type -> CLI -> smoke. 002/003 depend on its output.
