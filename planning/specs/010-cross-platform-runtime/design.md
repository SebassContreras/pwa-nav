# 010 — cross-platform-runtime — Design

## Platform Data & Binary Layout

PWAsForFirefox directory layout per OS:

```
Linux:
  Config & profiles: ~/.local/share/firefoxpwa/
                     ├── config.json
                     ├── profiles/<ULID>/
                     └── runtime/firefox (or /usr/lib/firefoxpwa/runtime/firefox)

macOS:
  Config & profiles: ~/Library/Application Support/firefoxpwa/
                     ├── config.json
                     ├── profiles/<ULID>/
                     └── runtime/Firefox.app/Contents/MacOS/firefox
```

## Implementation Plan

In `src/browser/pwa-runtime.ts`:

1. Update `DATA_DIR_TABLE`:
   - `win32`: `%APPDATA%\FirefoxPWA`
   - `linux`: `env["XDG_DATA_HOME"] ?? join(env["HOME"], ".local", "share", "firefoxpwa")`
   - `darwin`: `join(env["HOME"], "Library", "Application Support", "firefoxpwa")`

2. Update `runtimePath`:
   - `win32`: `join(dataDir, "runtime", "firefox.exe")`
   - `linux`: `join(dataDir, "runtime", "firefox")` (fallback to `/usr/lib/firefoxpwa/runtime/firefox`)
   - `darwin`: Check `join(dataDir, "runtime", "Firefox.app", "Contents", "MacOS", "firefox")` and `join(dataDir, "runtime", "firefox")`

3. Shell launch hint formatting:
   - POSIX platforms: print bash command with single-quoted arguments.
   - Windows: print PowerShell `Start-Process` with `@(...)` array.

## Files & Changes

| Layer | File | Responsibilities |
|---|---|---|
| Browser | `src/browser/pwa-runtime.ts` | Complete macOS & Linux runtime discovery and launch command formatting |
| Tests | `src/browser/pwa-runtime.test.ts` | Add matrix unit tests with Linux and macOS filesystem fixtures |
| Docs | `docs/firefox-pwa.md` | Document verified Linux and macOS launch commands and troubleshooting |
