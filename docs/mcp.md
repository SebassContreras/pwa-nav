# MCP — Playwright adapter

## Config

- File: `mcp.json`
- Server: `playwright`
- Command: `npx`
- Args: `@playwright/mcp@latest`

```json
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest"]
    }
  }
}
```

## Point a client at it

- Claude Code / VS Code / generic MCP client: reference repo-root `mcp.json` as the MCP config file.
- CLI equivalent: `npx @playwright/mcp@latest`.
- Requires Node 22.
- Uses the user's own logged-in Chrome profile. No credentials handled by the agent.

## Snapshots

- Output: `.agent/snapshot.json`
- Contract: `{snapshotId, url, title, elements[{ref, role, name, value, disabled}]}`
- Refs valid for one snapshot only. Re-snapshot after every navigation or mutation.
- Agents grep the file. Never paste full snapshots into context.
