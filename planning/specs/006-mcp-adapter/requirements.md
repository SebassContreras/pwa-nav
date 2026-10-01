# 006 — mcp-adapter — Requirements

## What's being built

A stdio MCP server (`pwa-nav-mcp`) that exposes the live backend (004) and the screen map (005) to MCP clients, replacing the transitional `@playwright/mcp` entry in `mcp.json`. Same operations as the CLI, same gate, same error codes; one implementation underneath.

## Who/what it serves

Agents in Claude Code, VS Code and other MCP clients that cannot shell out cheaply or that prefer typed tools. Serves the same dev team and the same Firefox PWA sessions as the CLI.

## Hard constraints

- Transport is stdio; protocol is MCP, tools declared with JSON Schema `inputSchema` and tool annotations _(standard: https://modelcontextprotocol.io/specification/2025-06-18/server/tools)_.
- A thin adapter: tool handlers call the shared `ops` layer. No browser logic, no gate logic, no ref logic in the adapter.
- The model cannot arm itself. Armed mode is an operator setting (`--armed` on the server command line / env), never a tool argument. Default is dry-run.
- Snapshots are never returned inline: tools return a short text result plus the file path (and a resource link); the compact screen view is the only structured payload returned inline _(AGENTS.md rule)_.
- Page text, names and screen-map strings are untrusted data in tool results; the server never reflects them into instructions or tool descriptions.
- Tools that only read are annotated `readOnlyHint: true`; click/fill/act are `destructiveHint: true`, `openWorldHint: true`.
- Non-`humanOnly` flows from the loaded map are exposed as tools; `humanOnly` flows are never exposed as callable tools (listed as a resource note instead).
- stdout carries only protocol frames; logs go to stderr.
- Node 22; the MCP SDK is the only new runtime dependency and is pinned.

## Acceptance criteria

- `tools/list` returns `pwa_open`, `pwa_snapshot`, `pwa_click`, `pwa_fill`, `pwa_extract`, `pwa_act`, plus one tool per non-humanOnly flow, each with a valid `inputSchema` and annotations.
- Without `--armed`, `pwa_click`/`pwa_fill`/`pwa_act` return the dry-run plan and change nothing; with `--armed` they act and return the new `snapshotId` and file path.
- `pwa_snapshot` with `screen: true` returns the compact view inline; without it returns the file path and element count only.
- Errors map to MCP tool errors (`isError: true`) carrying the stable `code` (`stale_ref`, `origin_blocked`, `sensitive_target`, …) and the recovery instruction.
- `resources/list` exposes `pwa-nav://screens/<app-id>` (the validated map) and `pwa-nav://snapshot/latest`.
- A protocol conformance test drives the server over stdio with a scripted client against the 004 fake BiDi server.
- `mcp.json` points to `node dist/mcp.js`; `docs/mcp.md` documents setup per client, the armed flag, and the one-BiDi-session limit.

## Out of scope

- HTTP/SSE transport, remote/hosted use, auth, multi-user, MCP sampling/elicitation, publishing to a registry, WebMCP.

## Dependencies

- 004 firefox-bidi-backend, 005 screen-map.

## Owner split

Agent: server, tests, docs, `mcp.json`. Human: register the server in their MCP client and confirm a real armed call on their PWA.
