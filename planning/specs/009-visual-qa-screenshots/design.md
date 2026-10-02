# 009 — visual-qa-screenshots — Design

## Architecture

```
[BiDi Protocol] ──► browsingContext.captureScreenshot ──► Base64 string
                                                                  │
                                                         Buffer.from(b64, 'base64')
                                                                  │
                                                                  ▼
                                                      Save to disk (.png)
                                                                  │
                    ┌─────────────────────────────────────────────┴──────────────────┐
                    ▼                                                                ▼
      [CLI: pwa-nav screenshot]                                        [QA Runner: qa run]
       Outputs: screenshot saved to <path>                              Writes: .agent/evidence/<run-id>/
                                                                                step-<n>-<op>.png
```

## Protocol Implementation

In `src/bidi/protocol.ts`:

```typescript
export interface CaptureScreenshotOptions {
  clip?: {
    type: "box" | "element";
    x?: number;
    y?: number;
    width?: number;
    height?: number;
    element?: SharedReference;
  };
  format?: {
    type: "image/png" | "image/jpeg" | "image/webp";
    quality?: number;
  };
}

async captureScreenshot(context: string, options?: CaptureScreenshotOptions): Promise<string> {
  const result = await this.send("browsingContext.captureScreenshot", {
    context,
    ...options,
  });
  return (result as { data: string }).data;
}
```

## Evidence Integration

In `src/ops/qa.ts`:
If step has `screenshot: true` or when a step fails:
Save `step-<n>-<op>.png` alongside `step-<n>-<op>-snapshot.json` in `evidenceDir`.

## Files & Changes

| Layer | File | Responsibilities |
|---|---|---|
| BiDi | `src/bidi/protocol.ts` | Implement `browsingContext.captureScreenshot` |
| Browser | `src/browser/bidi-backend.ts` | Add `screenshot` method returning PNG buffer |
| Ops | `src/ops/ops.ts` | Add `performScreenshot` writing to disk |
| Ops | `src/ops/qa.ts` | Save screenshot on failure and on explicit screenshot op |
| CLI | `src/cli.ts` | Subcommand `screenshot [--out <path>]` |
| MCP | `src/mcp/mcp-tools.ts` | Add `pwa_screenshot` tool |
