# 006 — mcp-adapter — Design

## Approach

`src/mcp.ts` builds an MCP server with the official TypeScript SDK over stdio. Each tool handler: validate input (the SDK enforces the JSON Schema), call the matching `perform*` in `src/ops.ts`, translate the result or `PwaNavError` into an MCP tool result. The gate (armed, kill-switch, origin allow-list) is read from server startup options and the same files the CLI uses, so CLI and MCP cannot diverge.

## Tool surface

| Tool | Maps to | Annotations | Inline payload |
|---|---|---|---|
| `pwa_open` | `open` | openWorld | one line + session path |
| `pwa_snapshot` | `snapshot` (`-i`, `screen`) | readOnly | path + count, or compact view when `screen: true` |
| `pwa_click` | `click` | destructive, openWorld | dry-run plan or new `snapshotId` + path |
| `pwa_fill` | `fill` | destructive, openWorld | same |
| `pwa_extract` | `extract` | readOnly | lines from the snapshot (bounded) |
| `pwa_act` | `act` | destructive, openWorld | same |
| `flow_<id>` | `act flow:<id>` | destructive, openWorld | same |

Targets accept both `eN` (with `snapshotId`) and `@id`. `learn` is deliberately CLI-only: it rewrites a committed file and needs human review.

## Key decisions

- **Armed is operator-controlled**: `pwa-nav-mcp --armed` (or `PWA_NAV_ARMED=1`). The tool schemas contain no `armed` field, so a prompt-injected page cannot ask the model to arm.
- **Bounded output**: `pwa_extract` caps inline lines and says how many were omitted, pointing to the file; the cap is a named constant measured in T004.
- **Error mapping**: `PwaNavError.code` → `{isError: true, content: [{type: "text", text: "<code>: <instruction>"}], structuredContent: {code}}`. Unknown errors become `protocol` with the message.
- **Resources**: `pwa-nav://screens/<app-id>` (validated map, JSON) and `pwa-nav://snapshot/latest`; both read-only.
- **Dynamic tools**: flow tools are generated once at startup from the single matching map; changing the map requires a server restart (documented; list-changed notification is out of scope).
- **Single BiDi session**: the adapter serializes tool calls through a mutex so two concurrent calls never open two sessions; `session_busy` surfaces if something else holds it.
- **Config**: `mcp.json` entry `pwa-nav` → `node dist/mcp.js` with optional `--port`, `--armed`, `--screen-map`.

## Testing

- Scripted stdio client (SDK client) against the server wired to the 004 fake BiDi backend: list tools/resources, dry-run vs armed, error mapping, humanOnly flows absent, concurrent calls serialized, stdout stays clean.
- Schema test: every tool's `inputSchema` compiles under Ajv 2020-12.

## Sequencing

Shared `ops` is already the single implementation → server skeleton + `pwa_open/pwa_snapshot` → write tools + gate → flows + resources → conformance tests → `mcp.json` + docs → human registration → verify.
