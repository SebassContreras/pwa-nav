# 008 — file-uploads — Design

## Protocol Implementation

W3C WebDriver BiDi `input.setFiles`:

```typescript
// in src/bidi/protocol.ts
async setFiles(context: string, element: SharedReference, files: string[]): Promise<void> {
  await this.send("input.setFiles", {
    context,
    element,
    files,
  });
}
```

## Security Gate for File Access

In `src/core/gate.ts`:

```typescript
export function assertFileUploadAllowed(filePath: string, safeRoots: string[]): void {
  const resolved = resolve(filePath);
  // Prevent path traversal outside allowed directories
  const isInside = safeRoots.some(root => resolved.startsWith(resolve(root)));
  if (!isInside) {
    throw new PwaNavError("file_upload_blocked", `file ${filePath} is outside allowed upload paths`, {
      hint: "Files can only be uploaded from workspace root or .agent/ directory.",
    });
  }
}
```

## Actionability Adaptation

In `src/browser/actions.ts`:
Standard `checkActionable` requires non-zero bounding box and visibility. For `<input type="file">`, these requirements are bypassed if the input is in the DOM and not disabled, because native file inputs are styled invisible in modern frontends.

## Files & Changes

| Layer | File | Responsibilities |
|---|---|---|
| Core | `src/core/errors.ts` | Add `file_upload_blocked` code (exit code 15) |
| Core | `src/core/gate.ts` | Path security allow-list verification |
| BiDi | `src/bidi/protocol.ts` | Add `input.setFiles` typed method |
| Browser | `src/browser/collector.ts` | Tag file inputs with `inputType: "file"` |
| Browser | `src/browser/actions.ts` | Implement `uploadFiles` operation bypassing pointer visibility checks |
| Ops | `src/ops/ops.ts` | Add `performUpload` |
| CLI | `src/cli.ts` | `upload` command and `upload:<ref>=<path>` in `act` |
| MCP | `src/mcp/mcp-tools.ts` | Add `pwa_upload` tool definition and handler |
