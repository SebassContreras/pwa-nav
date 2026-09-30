# SKILL.md — pwa-nav QA loop

Loop: `snapshot -> act -> verify`. Repeat until the check passes.

## Commands

All commands run from the repo root after `pnpm build` (`node ./dist/cli.js ...` or `pwa-nav ...`).

- `pwa-nav open <url>` — persist target URL to `.agent/session.json`.
- `pwa-nav snapshot -i --input <tree.txt> [--url <u>] [--title <t>]` — normalize ARIA tree, write `.agent/snapshot.json`, print `(id <snapshotId>)`.
- `pwa-nav click --snapshot <id> <ref>` — click ref, print next `(id <newId>)`.
- `pwa-nav fill --snapshot <id> <ref> <text>` — fill ref, print next `(id <newId>)`.
- `pwa-nav act --snapshot <id> <op>...` — bulk ops: `fill:<ref>=<text>`, `click:<ref>`. Prints next id.
- `pwa-nav extract --snapshot <id> --mode text|links` — read-only narrow extraction. Never supersedes.
- `pwa-nav qa run <check-file>` — run a JSON check, save evidence, exit 0 pass / 1 fail.

## Invalidation rule (hard)

Refs are valid for ONE snapshot only. `click`/`fill`/`act` supersede the snapshot and return a new id.

- Always use the newest printed id + its refs for the next mutation.
- `code: stale_ref` (unknown/superseded id, unknown ref) means: re-snapshot, then retry with the fresh id + refs.
- `extract` never invalidates; `open` needs a `snapshot` before any act.

## Snapshots

- Contract: `{snapshotId, url, title, elements[{ref, role, name, value, disabled}]}` in `.agent/snapshot.json`.
- Never paste full trees inline. Grep the file (`rg '"e5"' .agent/snapshot.json`).

## Checks and evidence

- Check file: `{"steps":[...]}` with ops `open | snapshot | click | fill | act | extract | assert-text`. Examples: `checks/`.
- `snapshot` step: `{"op":"snapshot","input":"<tree.txt>","url":"...","title":"..."}` (`input` optional when a stored snapshot exists).
- `assert-text` step: `{"op":"assert-text","text":"..."}` — fails naming missing text + snapshot.
- Evidence per run: `.agent/evidence/<run-id>/` with per-step snapshots + `result.json` (`{pass, failedStep, evidenceDir}`).

## Lawful use (hard)

User's own sessions only; user performs all logins. Never bypass CAPTCHA, bot walls, or access controls. Never handle credentials. Never commit secrets or `.env`.
