# 007 — multi-screen-flows — Design

## Architecture overview

Journeys are declarative multi-step navigation paths defined at the app level in the screen map. The journey engine (`src/screens/screen-journey.ts` / `src/ops/journey.ts`) coordinates transitions:

```
[CLI / MCP Client]
        │
        ▼
   Journey Op: performJourney(name, inputs, { backend, armed })
        │
        ├─ 1. Load Screen Map & validate Journey definition
        ├─ 2. If !armed: print execution plan -> return
        ├─ 3. For each Step in Journey:
        │     a. Verify current screen matches step.screenId
        │     b. Resolve semantic actions/inputs for step
        │     c. Execute action batch via backend
        │     d. Settle (network-idle + DOM quiescence)
        │     e. Check post-condition: assert new URL matches step.expectScreen
        │     f. If mismatch -> fail fast with journey_step_failed (exit code)
        ▼
   Return final screen compact view
```

## Schema Extension

In `schemas/screen-map.schema.json`:

```json
{
  "journeys": {
    "type": "array",
    "items": {
      "type": "object",
      "required": ["id", "description", "steps"],
      "properties": {
        "id": { "$ref": "#/$defs/id" },
        "description": { "type": "string" },
        "humanOnly": { "type": "boolean" },
        "inputSchema": { "type": "object" },
        "steps": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["screenId", "action"],
            "properties": {
              "screenId": { "$ref": "#/$defs/id" },
              "action": { "type": "string" },
              "inputs": { "type": "object" },
              "expectScreen": { "$ref": "#/$defs/id" }
            }
          }
        }
      }
    }
  }
}
```

## Files & Changes

| Layer | File | Responsibilities |
|---|---|---|
| Schema | `schemas/screen-map.schema.json` | Add `journeys` definitions and types |
| Screens | `src/screens/screen-journey.ts` | Journey parser, validator, step interpolation |
| Screens | `src/screens/screen-map.ts` | Integrate journeys in `ScreenMap` types & cross-check |
| Ops | `src/ops/journey.ts` | `performJourney` execution loop with step settle and assertions |
| CLI | `src/cli.ts` | Subcommand `journey <name> [k=v...] [--armed]` |
| MCP | `src/mcp/mcp-flows.ts` | Register `journey_<app>_<name>` tools dynamically |
| Errors | `src/core/errors.ts` | Add `journey_step_failed` error code (exit code 14) |
