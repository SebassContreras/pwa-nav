# 001 — nav-snapshot — Requirements

## What's being built

CLI `open` + `snapshot` commands that navigate to a URL in the user's own logged-in Firefox PWA (live backend: spec 004, WebDriver BiDi) and write an accessibility-tree nav JSON snapshot to disk (`.agent/snapshot.json`), with stable per-snapshot refs.

## Who/what it serves

Solo dev + dev team doing fluid QA; serves specs 002 (actions) and 003 (QA loop) which consume its snapshot contract.

## Hard constraints

- Reuse the Playwright-MCP-style snapshot text format (roles, names, `[ref=eN]`) as the normalizer input and the `{snapshotId, url, title, elements[]}` contract as output _(standard: Playwright MCP snapshots — https://playwright.dev/docs/getting-started-mcp)_. The live source is the BiDi collector of spec 004, which emits the same contract.
- Local-only, user's own browser profile; no credential handling, no bot evasion.
- Snapshots written to file, never inlined fully into agent context _(standard: Playwright MCP file-output / pull model)_.
- Node 22 + pnpm + TypeScript strict _(standard: Node 22 TS docs — https://nodejs.org/docs/latest-v22.x/api/typescript.html)_.

## Acceptance criteria

- `open <url>` navigates to the user's own web app and to 1 login-walled page using the existing session.
- `snapshot -i --json` writes `.agent/snapshot.json` with `snapshotId, url, title, elements[{ref, role, name}]`.
- Interactive-only snapshot contains the login button / main nav controls with unique refs.
- Re-running `snapshot` after navigation produces a new `snapshotId` and fresh refs.

## Out of scope

- Click/fill actions (spec 002), QA assertions (spec 003), custom WS bridge, WebMCP tools, multi-session, dashboard.

## Dependencies

None.

## Owner split

Agent: all CLI + snapshot contract + smoke script. Human: perform logins in the Firefox PWA, approve login-walled test URLs.
