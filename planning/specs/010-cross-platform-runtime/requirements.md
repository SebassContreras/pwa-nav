# 010 — cross-platform-runtime — Requirements

## What's being built

Full validation, hardening, and test double verification for `firefoxpwa` directory resolution, binary detection, profile management, and direct runtime execution across **Linux** (`~/.local/share/firefoxpwa` and Flatpak paths) and **macOS** (`~/Library/Application Support/firefoxpwa`). Replaces all `UNVERIFIED` path comments and placeholder exceptions with tested implementations.

## Who/what it serves

Developers and CI/CD pipelines running on Linux containers (GitHub Actions, Docker) or macOS developer workstations, ensuring `pwa-nav open --launch` works identically regardless of operating system.

## Hard constraints

- Linux directory support: Standard XDG paths (`~/.local/share/firefoxpwa`), native package installations (`/usr/bin/firefoxpwa`), and Flatpak profile directory structures.
- macOS directory support: Standard macOS Application Support (`~/Library/Application Support/firefoxpwa`), Homebrew installations (`/opt/homebrew` / `/usr/local`), and macOS app bundles (`Firefox.app/Contents/MacOS/firefox`).
- Environment variable override: `PWA_NAV_FIREFOXPWA_DIR` remains authoritative across all platforms.
- Process launching: Clean process spawning without shell dependencies, handling platform-specific detached process groups (`child.unref()`, `setsid`).
- CI validation: Matrix tests in CI simulating all three platforms (`win32`, `linux`, `darwin`) with mock filesystem structures.

## Acceptance criteria

- `src/browser/pwa-runtime.ts` resolves correct runtime binary, profile paths, and config files for `linux` and `darwin` without throwing `TBD`.
- `runtimePath` correctly locates the runtime executable on macOS (`Contents/MacOS/firefox` or standard symlink) and Linux.
- Tests in `src/browser/pwa-runtime.test.ts` verify config parsing and launch argument construction for Linux and macOS fixtures.
- Platform-specific launch hints output valid bash/zsh shell syntax for Unix and PowerShell syntax for Windows.
- Documentation in `docs/firefox-pwa.md` updated with verified platform recipes.

## Out of scope

- Windows Subsystem for Linux (WSL) cross-boundary GUI bridging (covered via normal Linux paths inside WSL).
- Mobile runtimes (Android/iOS).

## Dependencies

- 004 firefox-bidi-backend.

## Owner split

Agent: path algorithms, platform logic, matrix unit tests, documentation. Human: verify on native physical Linux/macOS hardware if available.
