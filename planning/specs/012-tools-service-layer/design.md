# Design: 012-tools-service-layer

## Architecture Overview

```
                      ┌───────────────┐
                      │    CLI Bin    │
                      │  (src/cli.ts) │
                      └───────┬───────┘
                              │
                      ┌───────▼───────┐        ┌──────────────────┐
                      │  src/cli/     │        │    src/mcp/      │
                      │  (Adapters)   │        │   (MCP Tools)    │
                      └───────┬───────┘        └────────┬─────────┘
                              │                         │
                              └───────────┬─────────────┘
                                          │
                               ┌──────────▼──────────┐
                               │     src/tools/      │
                               │   (Service Layer)   │
                               └──────────┬──────────┘
                                          │
                  ┌───────────────────────┼───────────────────────┐
                  ▼                       ▼                       ▼
           ┌──────────────┐        ┌──────────────┐        ┌──────────────┐
           │   src/core   │        │  src/screens │        │  src/browser │
           └──────────────┘        └──────────────┘        └──────────────┘
```

### 1. `src/tools/` Structure & Contract

Each tool exports a strongly-typed function accepting:
1. `args`: A typed argument DTO specific to the tool.
2. `ctx`: A shared `ToolContext`:
```ts
export interface ToolContext {
  backendFactory: BackendFactory;
  armed: boolean;
  mode?: "offline" | "bidi";
  screensDir?: string;
  screenMap?: string;
  agentDir?: string;
}
```

The outcome is standardized:
```ts
export interface ToolOutcome {
  text?: string;
  structured: Record<string, unknown>;
}
```

### 2. Tools Catalogue in `src/tools/`

- `open.ts`: `runOpen(args, ctx)`
- `snapshot.ts`: `runSnapshot(args, ctx)`
- `click.ts`: `runClick(args, ctx)`
- `fill.ts`: `runFill(args, ctx)`
- `upload.ts`: `runUpload(args, ctx)`
- `act.ts`: `runAct(args, ctx)`
- `journey.ts`: `runJourney(args, ctx)`
- `learn.ts`: `runLearn(args, ctx)`
- `screen.ts`: `runScreen(args, ctx)`
- `find.ts`: `runFind(args, ctx)`
- `extract.ts`: `runExtract(args, ctx)`
- `wait.ts`: `runWait(args, ctx)`
- `screenshot.ts`: `runScreenshot(args, ctx)`
- `auth.ts`: `runAuth(args, ctx)`
- `qa.ts`: `runQa(args, ctx)`
- `index.ts`: Re-exports all tools and shared types.

### 3. Layer Separation

- **No circular dependencies**:
  - `src/tools/` depends only on `src/core/`, `src/backend/`, `src/browser/`, and `src/screens/`.
  - `src/tools/` does NOT depend on `src/cli/` or `src/mcp/`.
  - `src/mcp/` depends on `src/tools/` (and never on `src/cli/`).
  - `src/cli/` depends on `src/tools/`.

### 4. Test Relocation Plan

Every directory with test files will have a `test/` subfolder:
- `src/bidi/test/`
- `src/browser/test/`
- `src/core/test/`
- `src/screens/test/`
- `src/cli/test/`
- `src/mcp/test/`
- `src/tools/test/` (absorbing tests from `src/ops/` and tool-level tests)
- `src/test/` (holding `e2e.test.ts`)

Relative import paths in tests will be adjusted to point one level up (`../` -> `../../` or `./` -> `../`).
