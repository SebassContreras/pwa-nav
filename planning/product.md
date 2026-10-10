# Product

## What this is

A stable CLI + MCP bridge for fluid QA of web applications and assisted, lawful browsing automation on login-walled sites where classic bots (Playwright, Puppeteer, Selenium) are blocked by Cloudflare, CAPTCHAs, or anti-bot defenses, including LLM notebooks (NotebookLM) and enterprise PWAs.

The browser is the user's standalone Firefox PWA instance driven directly over standard W3C WebDriver BiDi loopback (`--remote-debugging-port 9222`).

Key capabilities:
- **Dual Navigation Layers**:
  - *Fast Semantic Loop*: Per-app screen maps (`screens/<app>.screens.json`) providing compact views (86% token reduction), dynamic screen learning (`snapshot --learn`, `pwa_learn`), parameterized single-screen flows, and multi-screen declarative user journeys (`journey`) with automated network/DOM settling and destination assertions.
  - *Raw Accessibility Loop*: Ephemeral snapshot trees (`snapshot -i`) targeting accessibility refs (`e1`, `e2`, ...) with strict single-mutation invalidation.
- **Write Actions & Multi-Layer Safety Gate**: Click, fill, batch acts, and local file uploads (`upload`, `pwa_upload`). Default dry-run with explicit arming, origin allow-list gate, emergency kill-switch, sensitive field barriers (passwords/payments), and safe path boundaries for file uploads.
- **Visual QA Evidence & Context Economy**: Visual screenshots (`screenshot`, `pwa_screenshot`) and automated test run evidence (`qa run`) saved directly to disk (`.agent/screenshot.png`, `.agent/evidence/<run-id>/`) without dumping base64 or raw image bytes into LLM context.
- **Cross-Platform Runtime**: Out-of-the-box runtime discovery and direct launch across Windows (`%APPDATA%\FirefoxPWA`), Linux (standard XDG, Flatpak, system fallbacks), and macOS (`Application Support`, app bundle).
- **Dual Client Interfaces**: Standalone command-line interface (`pwa-nav`) and stdio Model Context Protocol adapter (`pwa-nav-mcp`) with dynamic flow and journey tool generation.

## Who uses it

Solo developers, QA engineers, and autonomous AI coding agents pair-programming with users.

## Out of scope

- Custom WebSocket bridge server (v2).
- Native WebMCP (`document.modelContext`) tools (v2).
- Multi-session management and dashboard UI (v2).
- Any bot evasion, CAPTCHA bypass, or credential scraping. Credentials remain strictly in the user's custody.
