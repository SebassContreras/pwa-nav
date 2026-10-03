# 011 — fast-exploration-and-wait — Design

## Architecture & Component Design

```
+-------------------------------------------------------------+
| CLI: pwa-nav (extract, snapshot, wait)                      |
| MCP: pwa_extract, pwa_snapshot, pwa_wait, pwa_learn         |
+-------------------------------------------------------------+
                              │
                              ▼
+-------------------------------------------------------------+
| Ops Layer (src/ops/ops.ts)                                  |
| - performExtract (filters: query, role, offset, limit)      |
| - performWait (polling loop, condition checker)             |
| - performLiveSnapshot (query, role filter inline output)    |
+-------------------------------------------------------------+
                              │
               +--------------+--------------+
               ▼                             ▼
+-----------------------------+ +-----------------------------+
| Screens / Semantic Layer    | | Backend (Bidi / Offline)    |
| - runLearn (targets return) | | - collectLiveElements       |
| - resolveTarget             | | - DOM settling              |
+-----------------------------+ +-----------------------------+
```

## Detailed Component Specifications

### 1. `performExtract` in `src/ops/ops.ts`
```ts
export interface ExtractOptions extends OpOptions {
  query?: string;
  role?: string;
  offset?: number;
  limit?: number;
}

export async function performExtract(
  snapshotId: string | undefined,
  mode: ExtractMode,
  options: ExtractOptions = {},
): Promise<{ lines: string[]; total: number; offset: number; returned: number }>
```
- Filters elements by `mode` ("text" vs "links"), then applies `options.role` (case-insensitive equality) and `options.query` (case-insensitive substring of `name` or `value`).
- Computes `total` matching elements.
- Slices by `[offset, offset + limit]`.

### 2. `performWait` in `src/ops/ops.ts`
```ts
export interface WaitOptions extends OpOptions {
  target?: string;
  query?: string;
  state?: "visible" | "hidden" | "enabled";
  timeoutMs?: number;
  intervalMs?: number;
}

export interface WaitResult {
  status: "ok";
  elapsedMs: number;
  matchedRef?: string;
  matchedName?: string;
}
```
- Polling loop executing with `setInterval`/`sleep` promise helper up to `timeoutMs`.
- At each iteration:
  - Takes a live snapshot (or reads backend).
  - Evaluates match:
    - If `target`: resolves target (semantic `@id` or `eN` or visible text).
    - If `query`: searches snapshot elements for substring match in `name` or `value`.
  - Checks state condition:
    - `"visible"`: match found.
    - `"hidden"`: match NOT found.
    - `"enabled"`: match found and `disabled !== true`.
- On match: returns `WaitResult`.
- On timeout: throws `PwaNavError("timeout", `wait condition timed out after ${timeoutMs}ms`)`.

### 3. MCP Tool Definitions in `src/mcp/mcp-tools.ts`
- `pwa_extract`: add `query`, `role`, `offset`, `limit` (max 200).
- `pwa_snapshot`: add `query`, `role`.
- `pwa_wait`: new tool with `target`, `query`, `state`, `timeoutMs`, `intervalMs`.
- `pwa_learn`: enrich outcome with list of semantic target identifiers.

### 4. CLI Commands in `src/cli/cli.ts`
- `extract`: parse `--query`, `--role`, `--offset`, `--limit`.
- `snapshot`: parse `--query`, `--role`.
- `wait`: new command `pwa-nav wait [<target>] [--query <q>] [--state <state>] [--timeout <ms>] [--interval <ms>]`.
