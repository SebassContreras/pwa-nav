# 006 — mcp-adapter — Tasks

Status legend: `todo` · `in_progress` · `blocked` · `interrupted` · `done`
Owner: `agent` (loop-runnable) · `human` (skipped by the loop)

- [x] T001 [agent] [status:done] Add the pinned MCP SDK dependency and `src/mcp.ts` skeleton serving `pwa_open` and `pwa_snapshot` over stdio, logs on stderr
      └─ mcp.ts entry (stderr logs, parseArgs, stdio), mcp-server.ts (low-level SDK Server, JSON Schema + Ajv validation, mutex), mcp-tools.ts; SDK pinned 1.31.0; bin pwa-nav-mcp.
- [x] T002 [agent] [status:done] Add `pwa_click`, `pwa_fill`, `pwa_act` with operator-only `--armed`/`PWA_NAV_ARMED`, destructive annotations and dry-run default
      └─ pwa_click/fill/act: operator-only --armed/PWA_NAV_ARMED, no armed field in any schema (tested), destructive annotations, dry-run default, @id targets and flow ops.
- [x] T003 [agent] [status:done] Add `pwa_extract` with a bounded inline cap and omitted-count message
      └─ pwa_extract capped at 100 inline lines with omitted-count message.
- [x] T004 [agent] [status:done] Map `PwaNavError` codes to MCP tool errors with `structuredContent.code`; serialize calls through one mutex
      └─ PwaNavError -> isError + structuredContent {code, exitCode, hint}; arguments never echoed; single promise-chain mutex (5 concurrent snapshots test).
- [x] T005 [agent] [status:done] Generate `flow_<id>` tools from the loaded screen map (skip `humanOnly`) and expose `pwa-nav://screens/<app-id>` and `pwa-nav://snapshot/latest` resources
      └─ mcp-flows.ts: flow_<screen>_<flow> tools from the single loaded map (humanOnly never registered; live-screen check, never navigates), screens/snapshot resources, server instructions; bad/ambiguous map never blocks startup.
- [x] T006 [agent] [status:done] Conformance tests with a scripted stdio client over the 004 fake BiDi server (tools, resources, dry-run vs armed, errors, clean stdout)
      └─ 281 tests: in-memory conformance + real stdio child against the fake BiDi server (dry-run vs armed, stdout JSON-RPC only, exit 0 on stdin close).
- [x] T007 [agent] [status:done] Replace `mcp.json` with the `pwa-nav` server entry and rewrite `docs/mcp.md` (per-client setup, armed flag, one-session limit)
      └─ mcp.json -> pwa-nav entry (no --armed); docs/mcp.md rewritten; README/SKILL consistent; handshake verified offline. Master synced the docs once flows/resources landed.
- [ ] T008 [human] [status:todo] Register the server in your MCP client and confirm one armed call on one of your PWAs
- [x] T009 [agent] [status:done] Verify acceptance criteria 006 (lint, build, test, smoke green)
      └─ lint/build/test(281)/smoke/3 qa/E2E 13/13 green. Criteria evidenced in src/mcp-server.test.ts (tools+annotations+schemas, dry-run vs armed, screen:true view, error mapping, resources, flows) and src/mcp.bidi.stdio.test.ts (real stdio child vs fake BiDi, stdout JSON-RPC only). Not verified live: a real MCP client session against the user's authenticated PWA (human T008).
