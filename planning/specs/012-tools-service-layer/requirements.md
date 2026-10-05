# Requirements: 012-tools-service-layer

## Overview

Refactor the architecture of `pwa-nav` to introduce a unified Service / Tools layer (`src/tools/`). Both the Command-Line Interface (`src/cli/`) and the Model Context Protocol server (`src/mcp/`) must share the exact same underlying tools and execution logic. Furthermore, all tests across the project must be relocated into dedicated `test/` subdirectories within their respective modules.

## User Needs & Pain Points

1. **Coupling and Duplication**: Currently, `src/mcp/mcp-tools.ts` imports directly from `src/cli/cli-screens.ts`, while `src/cli.ts` bifurcates between `src/ops/` and `src/cli/cli-screens.ts`. Business logic, parameter validation, and semantic resolution should not be tied to CLI flags or MCP schemas.
2. **Feature Parity**: Every action supported in `pwa-nav` (e.g. `open`, `snapshot`, `click`, `fill`, `upload`, `act`, `journey`, `learn`, `screen`, `find`, `extract`, `wait`, `screenshot`, `auth`, `qa`) must be available through a single canonical tool implementation that both CLI and MCP invoke.
3. **Clean Colocation of Tests**: Test files currently sit flat beside production source code in module roots. Moving them into dedicated `test/` subfolders (`src/<module>/test/`) improves navigability and maintains a clean codebase structure.

## Functional Requirements

- **FR-001: Unified Tool Interfaces**:
  - Define `src/tools/` with a shared context (`ToolContext`) containing backend access, armed status, screen map options, and session/agent paths.
  - Implement standalone tools for: `open`, `snapshot`, `click`, `fill`, `upload`, `act`, `journey`, `learn`, `screen`, `find`, `extract`, `wait`, `screenshot`, `auth`, `qa`.
  - Each tool must return a standard `ToolOutcome` containing structured data and human-readable text representations.
- **FR-002: Thin CLI Adapter**:
  - `src/cli.ts` and `src/cli/` must only handle CLI option parsing (`node:util parseArgs`), pass normalized payloads to `src/tools/*`, format stdout/stderr, and return standard exit codes (0 to 15).
- **FR-003: Thin MCP Adapter**:
  - `src/mcp/mcp-tools.ts` and `src/mcp/mcp-server.ts` must define MCP tool definitions and schemas, invoke `src/tools/*`, and return standard MCP contents (`{ content: [{ type: "text", text }], structured }`).
  - No imports from `src/cli/` in `src/mcp/`.
- **FR-004: Dedicated `test/` Subdirectories**:
  - Relocate all test files (`*.test.ts`) into subfolders named `test/` under each domain folder:
    - `src/bidi/test/`
    - `src/browser/test/`
    - `src/core/test/`
    - `src/screens/test/`
    - `src/tools/test/`
    - `src/cli/test/`
    - `src/mcp/test/`
    - `src/test/` (for global/e2e tests)
  - Adjust relative imports in relocated tests so all tests pass.
- **FR-005: Non-Regression & Verification**:
  - `pnpm lint`, `pnpm build`, and `pnpm test` must continue to pass cleanly.
