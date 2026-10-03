# 011 — fast-exploration-and-wait — Requirements

## Context & Motivation

Live interaction analysis with autonomous AI agents (such as OpenCode) driving `pwa-nav` against complex, AI-driven PWAs (like Google NotebookLM) revealed three critical bottlenecks:
1. **Element Blindness Past 100 Items**: Large PWAs routinely render 200–500+ interactive elements. `pwa_extract` was capped at 100 lines and lacked substring (`query`), `role`, or pagination (`offset`) filters. Agents seeking elements located deeper in the DOM were unable to discover them through MCP tools, prompting them to resort to PowerShell and ad-hoc Python scripts to parse `.agent/snapshot.json`.
2. **Arbitrary Sleep Loops**: AI PWAs execute long-running asynchronous background operations (Fast Research, source importing, audio/video synthesis, note generation) taking 10–60 seconds. In the absence of an explicit DOM condition waiter, agents resorted to running `Start-Sleep` pauses in host shells, violating the core zero-arbitrary-sleep invariant.
3. **Exploration Latency**: After executing `pwa_learn`, agents received no immediate feedback on what semantic targets were registered, requiring a redundant follow-up call to `pwa_snapshot({ screen: true })`.

## Functional Requirements

### FR1: Advanced Filtering in `extract` (CLI & MCP)
- `performExtract` and `pwa_extract` must accept:
  - `query` (optional string): case-insensitive substring filter matching element name or value.
  - `role` (optional string): case-insensitive exact role filter (e.g. `button`, `textbox`, `link`).
  - `offset` (optional integer, min 0): pagination offset.
  - `limit` (optional integer): maximum lines to return. When `query` or `role` is specified, max limit can be up to 200; default without filters remains 100.
- CLI: `pwa-nav extract [--snapshot <id>] [--mode text|links] [--query <str>] [--role <str>] [--offset <n>] [--limit <n>]`.

### FR2: Direct Query Filtering in `snapshot` (CLI & MCP)
- `pwa_snapshot` and `pwa-nav snapshot` must accept:
  - `query` (optional string): filter elements directly during snapshot capture.
  - `role` (optional string): filter elements by role during snapshot capture.
- When `query` or `role` is provided to `pwa_snapshot`, matching elements are returned inline in the tool text outcome and structured response, saving an extra roundtrip.

### FR3: Reactive DOM Condition Waiter (`wait` CLI & `pwa_wait` MCP)
- New tool `pwa_wait` and CLI command `pwa-nav wait`:
  - Target specification: either `target` (semantic `@id` or visible text or `eN`) OR `query` (substring search).
  - Condition `state`: `"visible"` (default), `"hidden"`, `"enabled"`.
  - `timeoutMs`: maximum wait duration (default 15000ms, max 60000ms).
  - `intervalMs`: polling cadence (default 1000ms, min 250ms).
- Repeatedly checks the browser accessibility tree/DOM via BiDi without shell blocking.
- Resolves successfully when the condition is met with `{ status: "ok", elapsedMs, matchedRef, matchedName }`.
- Throws exit code 9 (`timeout`) if the condition is not met within `timeoutMs`.

### FR4: Enriched `pwa_learn` Feedback
- `pwa_learn` structured outcome must include `targets`: array of generated semantic `@id` identifiers (e.g. `["@nuevo-cuaderno", "@anadir-fuente", ...]`) and inline text summary of discovered targets.

### FR5: Agent Guidelines & Policy Hardening
- Update `SKILL.md`, `AGENTS.md`, and `docs/mcp.md` to:
  - Document `pwa_wait`, `pwa_extract` filters, and `pwa_snapshot` filters.
  - Prohibit shell sleep commands (`Start-Sleep`, `sleep`) and shell/Python scripts for reading `.agent/snapshot.json`.

## Non-Functional Requirements
- Maintain Clean Architecture boundaries (`src/core/`, `src/ops/`, `src/mcp/`, `src/cli/`).
- No external runtime dependencies introduced.
- Strict backwards compatibility for existing CLI commands and MCP tools.
