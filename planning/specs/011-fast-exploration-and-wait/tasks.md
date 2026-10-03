# 011 — fast-exploration-and-wait — Tasks

Status legend: `todo` · `in_progress` · `blocked` · `interrupted` · `done`
Owner: `agent` (loop-runnable) · `human` (skipped by the loop)

- [x] T001 [agent] [status:done] Implement advanced filtering (`query`, `role`, `offset`, `limit`) in `src/ops/ops.ts` (`performExtract`) and add unit tests in `src/ops/extract.test.ts`
- [x] T002 [agent] [status:done] Implement condition waiter `performWait` in `src/ops/ops.ts` and add unit tests in `src/ops/wait.test.ts`
- [x] T003 [agent] [status:done] Update MCP tools in `src/mcp/mcp-tools.ts`: extend `pwa_extract` and `pwa_snapshot` with filters, register `pwa_wait`, and enrich `pwa_learn` output with discovered targets
- [x] T004 [agent] [status:done] Update CLI in `src/cli/cli.ts` to support `--query`, `--role`, `--offset` for `extract`/`snapshot` and add the `wait` command
- [x] T005 [agent] [status:done] Update `SKILL.md`, `AGENTS.md`, and `docs/mcp.md` with new tools, workflows, and strict anti-pattern guidelines
- [x] T006 [agent] [status:done] Verify full project verification suite (`pnpm lint`, `pnpm build`, `pnpm test`, `pnpm smoke`)
