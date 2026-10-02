# 008 — file-uploads — Requirements

## What's being built

Support for uploading local files to file input elements (`<input type="file">`) over W3C WebDriver BiDi via the `input.setFiles` protocol command. Adds safe path handling, element resolution for hidden/styled file inputs, dry-run previews, CLI `upload` verb/mode, and MCP `pwa_upload` tool.

## Who/what it serves

Developers and automated QA agents needing to test forms with file attachments (invoices, PDF receipts, avatar images, CSV/Excel imports) without resorting to OS file chooser dialogs.

## Hard constraints

- Protocol mechanism: W3C WebDriver BiDi command `input.setFiles` targetted at the specific browsing context and element node handle.
- Actionability for file inputs: In most modern web apps, `<input type="file">` is hidden (`display: none`, `opacity: 0`, or styled overlay button). Actionability checks must detect file inputs and permit setting files without requiring pointer click coordinates or visible bounding boxes.
- Security gate / Path allow-list: To prevent malicious prompt injection attacks from exfiltrating arbitrary local files (e.g. `~/.ssh/id_rsa`, `.env`), only files within explicit allow-listed directories (workspace root, `.agent/`, fixtures, or paths passed via explicit CLI option) may be uploaded. Uploads from outside allowed directories fail with `file_upload_blocked` before touching the browser.
- Dry-run default: Without `--armed`, the tool validates file existence, permissions, and target element, and prints the plan without dispatching `input.setFiles`.
- Screen map integration: Fields in `<app>.screens.json` with `role: "textbox"` and `inputType: "file"` (or classified as file inputs) support `@id` targets.

## Acceptance criteria

- BiDi protocol client in `src/bidi/protocol.ts` implements `input.setFiles(context, element, files)`.
- Collector in `src/browser/collector.ts` recognizes `<input type="file">` and tags it with `inputType: "file"`.
- Gate in `src/core/gate.ts` enforces path security checks (preventing paths with `..` escaping safe directories or targeting sensitive files).
- CLI supports `pwa-nav upload <ref|@id> <filepath> [--armed]` (or `act upload:<ref>=<filepath>`).
- MCP adapter exposes `pwa_upload` tool with file path and target parameters.
- Unit and integration tests over fake BiDi verify single and multiple file uploads, dry-run previews, and security boundary refusals.

## Out of scope

- Direct file downloads extraction from browser memory (use network monitoring / existing download folder mechanics).
- Manipulating OS native file dialogs.

## Dependencies

- 004 firefox-bidi-backend.

## Owner split

Agent: protocol implementation, collector tagging, security gate, CLI/MCP commands, tests, docs. Human: test with real PWA file submission.
