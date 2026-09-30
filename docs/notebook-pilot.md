# Notebook Text-Extract Pilot

Read-only pilot: text extract from 1 user-opened LLM notebook page.
Lawful use only: the user opens their own logged-in page; the agent never handles credentials, CAPTCHAs, or bot walls.

## Flow

1. User opens 1 notebook page in their own logged-in Chrome.
2. Agent runs `open` + `snapshot` + `extract --mode text` on it.
3. Evidence saved under `.agent/evidence/<run-id>/` (per-step snapshot JSON + `result.json`).

Real commands (`src/cli.ts`, shared `src/ops.ts` layer, same backend as `qa run`):

```sh
pwa-nav open <notebook-url>   # persists target URL to .agent/session.json (no browser launch in MVP)
pwa-nav snapshot -i --input checks/fixtures/notebook-tree.txt --url <notebook-url> --title "My Research Notebook"
# prints: snapshot ok: <n> elements -> .agent/snapshot.json (id <snapshotId>)
pwa-nav extract --snapshot <snapshotId> --mode text
# read-only: never supersedes the snapshot; one line per named element
```

`extract --mode text` output format is `<ref> <role> "<name>"` (plus `: <value>` when set).

## Worked example (generic fixture, no real URLs or secrets)

Fixture `checks/fixtures/notebook-tree.txt` is a notebook-like ARIA tree used in place of a live page (MVP has no browser engine; snapshot input comes from `--input` or stdin).

CLI run:

```sh
pwa-nav open https://example.com/notebook
pwa-nav snapshot -i --input checks/fixtures/notebook-tree.txt --url https://example.com/notebook --title "My Research Notebook"
pwa-nav extract --snapshot <snapshotId> --mode text
```

Expected extract output (notebook content lines):

```text
e1 heading "My Research Notebook"
e2 textbox "Ask about this notebook"
e3 button "Send"
e4 article "Notebook answer - read-only pilot summary"
e5 paragraph "Key point - extract text lists one line per named element."
e6 paragraph "Evidence lands under .agent evidence run dir for audit."
e7 link "Sources"
```

Same flow via the qa runner (`src/qa.ts`):

```json
{"steps": [
  {"op": "open", "url": "https://example.com/notebook"},
  {"op": "snapshot", "input": "checks/fixtures/notebook-tree.txt",
   "url": "https://example.com/notebook", "title": "My Research Notebook"},
  {"op": "extract", "mode": "text"},
  {"op": "assert-text", "text": "Notebook answer - read-only pilot summary"}
]}
```

```sh
pwa-nav qa run <check-file>
# qa pass: <n> steps, evidence .agent/evidence/<run-id>/
```

Evidence layout per run: `step-<n>-<op>-snapshot.json` per step + `result.json` `{pass, failedStep, evidenceDir}`.

## NOT in the pilot

- Automatic search of any topic across notebooks = post-MVP done-when (final goal). This pilot covers 1 user-opened page only.
- No auto-navigation between notebook pages, no bulk export, no credential handling.
- No new browser engine; reuses 001/002 snapshot + extract path.
