# pwa-nav

> **Stable CLI + MCP bridge for fluid QA testing and lawful, bot-proof browser automation on login-walled sites using your own authenticated Firefox PWA.**

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![BiDi: W3C Standard](https://img.shields.io/badge/WebDriver-BiDi%20Standard-orange.svg)](https://w3c.github.io/webdriver-bidi/)

---

## 💡 What Problem Does It Solve?

Traditional browser automation tools (Playwright, Puppeteer, Selenium with Chromium) face severe roadblocks on the modern web:

1. **Anti-Bot & CAPTCHA Walls**: Cloudflare Turnstile, reCAPTCHA, and bot-defense shields instantly detect automated Chromium instances, headless flags, and synthetic browser profiles, blocking access to web apps like Google NotebookLM, Mercadona, and enterprise portals.
2. **Login & 2FA Barriers**: Storing passwords or handling 2FA tokens in automation scripts is brittle, insecure, and frequently triggers fraud alerts or account bans.
3. **Massive Token Waste**: Dumping full HTML DOM trees into LLM contexts burns thousands of tokens per step, slows down agents, and causes hallucinations when locators change.

### The `pwa-nav` Solution:

- **Attaches to Your Real Browser**: Connects directly to your everyday, already-authenticated **Firefox PWA** (Progressive Web App installed via PWAsForFirefox) over standard **W3C WebDriver BiDi** on loopback (`localhost:9222`).
- **Zero Bot Footprints**: It's your authentic Firefox profile, with your active session, cookies, and human hardware fingerprint. You log in by hand; the agent operates lawfully and seamlessly alongside you.
- **Accessibility Tree Contracts**: Instead of pixel coordinates or messy CSS selectors, `pwa-nav` uses a clean accessibility snapshot (`.agent/snapshot.json`) with ephemeral refs (`e1`, `e2`, ...). Mutations invalidate refs immediately, preventing stale misclicks.
- **Screen Maps & User Journeys**: Declarative screen models (`screens/<app>.screens.json`) provide semantic `@id` targets, slashing LLM token consumption by up to **86%** and enabling declarative multi-screen workflows (`pwa-nav journey <name>`).
- **Built-in Model Context Protocol (MCP)**: Exposes all browser operations and declarative flows directly to AI assistants (Claude Desktop, Cursor, Antigravity, etc.).

---

## 🚀 Quickstart: Running in 5 Minutes

### Prerequisites
- **Node.js**: `v22.0.0` or higher.
- **pnpm**: `v11.0.0` or higher (`npm install -g pnpm`).
- **Firefox** with the [PWAsForFirefox extension and native runtime](https://github.com/filips123/PWAsForFirefox) installed.

### Step 1: Install & Build

```bash
git clone https://github.com/SebassContreras/pwa-nav.git
cd pwa-nav
pnpm install
pnpm build
```

Verify everything is working with the built-in smoke test:
```bash
pnpm smoke
```

### Step 2: Install or Identify Your Target PWA
1. Open Firefox, go to any web app you want to test or automate (e.g., your local app, Mercadona, Google NotebookLM, or your own SaaS).
2. Install it as a PWA using the PWAsForFirefox extension button in the address bar.
3. Log in to the application normally.

### Step 3: Launch Your PWA with Remote Debugging
To allow `pwa-nav` to attach, launch your installed PWA with `--remote-debugging-port 9222`.

**Windows (PowerShell):**
```powershell
$FFPWA = "$env:APPDATA\FirefoxPWA"
# Find your site ULID using: firefoxpwa sites
Start-Process -FilePath "$FFPWA\runtime\firefox.exe" -ArgumentList @("--pwa","<SITE-ULID>","--remote-debugging-port","9222")
```

**Linux:**
```bash
~/.local/share/firefoxpwa/runtime/firefox --pwa <SITE-ULID> --remote-debugging-port 9222
```

*(Alternatively, use `pwa-nav open <url> --launch --allow-origin` to start the runtime automatically).*

### Step 4: Your First Navigation Loop

```powershell
# 1. Allow and verify navigation to origin
pwa-nav open https://app.example.com --allow-origin

# 2. Take an accessibility snapshot
pwa-nav snapshot -i

# 3. Dry-run an action (prints the execution plan, sends NO input)
pwa-nav click --snapshot <snapshotId> e3

# 4. Execute the action for real (armed)
pwa-nav click --snapshot <snapshotId> e3 --armed

# 5. Re-snapshot after mutation (refs of the previous snapshot are invalidated)
pwa-nav snapshot -i
```

---

## 🗺️ Screen Maps & Multi-Screen Journeys

For repeated testing and high-speed agent navigation without round trips, use the **Screen Map subsystem** (`docs/screen-map.md`):

### 1. Learn a Screen
Once on a screen you want to map, run:
```powershell
pwa-nav snapshot --learn --locale es-ES --access public
```
This generates or updates `screens/<app-id>.screens.json` with semantic IDs (`@search-input`, `@submit-button`, `@cart-link`).

### 2. View Compact Screen Info
Instead of collecting full DOM trees, inspect the screen's compact summary (saves 86% tokens):
```powershell
pwa-nav snapshot --screen
```

### 3. Act on Semantic Targets
Interact directly with stable `@id` targets without passing snapshot IDs:
```powershell
# Note: Always quote '@id' in PowerShell
pwa-nav fill '@search-box' "olive oil" --armed
pwa-nav click '@search-btn' --armed
```

### 4. Execute Multi-Screen User Journeys
Declare complex cross-screen workflows in `screens/<app>.screens.json` and run them in one command:
```powershell
# Dry-run preview
pwa-nav journey checkout-flow query="olive oil"

# Armed execution (settles network & DOM, validates expected screens)
pwa-nav journey checkout-flow query="olive oil" --armed
```
If a step fails or the destination route does not match `expectScreen`, the journey halts immediately with exit code `14` (`journey_step_failed`), preserving evidence.

---

## 🤖 MCP Server Integration (AI Agents)

`pwa-nav` includes an MCP stdio server (`pwa-nav-mcp`) ready for Claude Desktop, Cursor, or Antigravity.

Add to your `mcp.json` or `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "pwa-nav": {
      "command": "node",
      "args": [
        "C:/path/to/pwa-nav/dist/mcp.js",
        "--port",
        "9222"
      ]
    }
  }
}
```

The MCP server exposes:
- **Core tools**: `pwa_open`, `pwa_snapshot`, `pwa_click`, `pwa_fill`, `pwa_extract`, `pwa_act`, `pwa_learn`.
- **Dynamic flow tools**: `flow_<screen>_<flow>` for single-screen mapped tasks.
- **Dynamic journey tools**: `journey_<id>` for multi-screen workflows with `destructiveHint: true`.
- **Resources**: `pwa-nav://screens/<app-id>` and `pwa-nav://snapshot/latest`.

---

## 📖 Command Reference

| Command | Description |
|---|---|
| `pwa-nav open <url> [--launch] [--site <ULID>] [--allow-origin]` | Navigate to URL. Requires origin in `.agent/allow.json` or explicit `--allow-origin`. |
| `pwa-nav snapshot [-i \| --all] [--json] [--out <path>]` | Capture live accessibility DOM snapshot. `-i` interactive elements only (default). |
| `pwa-nav snapshot --screen [--screen-map <f>]` | Print compact view of mapped screen matching current URL (no DOM dump). |
| `pwa-nav snapshot --learn [--prune] [--locale <lang>]` | Learn live screen into `screens/<app>.screens.json` and show diff. |
| `pwa-nav click --snapshot <id> [--armed] <ref>` | Click element by snapshot ref (e.g. `e3`). Dry-run unless `--armed`. |
| `pwa-nav click [--armed] '@<id>'` | Click element by semantic ID (e.g. `'@submit-btn'`). |
| `pwa-nav fill --snapshot <id> [--armed] <ref> <text>` | Fill field by ref. Typed text of sensitive fields is never printed or stored. |
| `pwa-nav fill [--armed] '@<id>' <text>` | Fill field by semantic ID. Sensitive fields are blocked (exit 11). |
| `pwa-nav act --snapshot <id> [--armed] <ops...>` | Batch mutations (`click:<ref>`, `fill:<ref>=<text>`) in a single session. |
| `pwa-nav act [--armed] <semantic-ops...>` | Batch semantic ops (`click:'@id'`, `fill:'@id'=val`, `flow:<id>`). |
| `pwa-nav journey <name> [key=value...] [--armed]` | Execute declarative multi-screen user journey across route transitions. |
| `pwa-nav extract --snapshot <id> --mode text\|links` | Fast read-only text or links extraction from stored snapshot. |
| `pwa-nav qa run <check-file>` | Run offline JSON check file and save per-step evidence to `.agent/evidence/`. |

### Global Flags
- `--backend offline|bidi`: Default is `bidi` (live Firefox PWA). Use `offline` for fixture checks.
- `--port <n>`: BiDi debugging port (default: `9222`, env: `PWA_NAV_PORT`).
- `--context <id>`: Target browsing context ID when multiple tabs are open.
- `--screen-map <file>`: Explicit path to screen map JSON.
- `--screens-dir <dir>`: Directory containing screen maps (default: `./screens`).

---

## 🛡️ Security & Safety Gates

1. **Dry-Run by Default**: Actions only execute in dry-run mode unless `--armed` is explicitly supplied.
2. **Sensitive Fields Barrier**: Password fields, tokens, and payment inputs (`sensitive: true` / `humanOnly: true`) are never typed by the agent (fails fast with code 11 `sensitive_target`). The user types them by hand.
3. **Origin Allow-List**: Navigation is strictly blocked unless the origin is approved in `.agent/allow.json` or explicitly passed via `--allow-origin` (code 6 `origin_blocked`).
4. **Kill-Switch**: Creating `.agent/kill` or setting `PWA_NAV_KILL_SWITCH` immediately terminates any armed operation (code 7 `kill_switch`).
5. **Untrusted Page Content**: All HTML page contents, aria names, and element text are treated strictly as untrusted data, never instructions.

---

## 🚦 Exit Codes

| Code | Name | Description & Action |
|:---:|---|---|
| `0` | `ok` | Success. |
| `1` | `failure` | General error or QA check failure. |
| `2` | `invalid_args` | Missing or invalid arguments/flags. |
| `3` | `stale_ref` | Snapshot or `eN` ref expired due to page mutation. Re-snapshot! |
| `4` | `no_browser` | BiDi port is closed. Launch PWA with remote debugging. |
| `5` | `session_busy` | Firefox BiDi session in use. Only one active session is allowed. |
| `6` | `origin_blocked` | Origin not allowed. Re-run with `--allow-origin` if authorized. |
| `7` | `kill_switch` | Kill-switch active (`.agent/kill`). Operation aborted. |
| `8` | `not_actionable` | Element is hidden, covered, disabled, or non-interactable. |
| `9` | `timeout` | Action, network idle, or navigation timed out. |
| `10` | `protocol` | Low-level WebDriver BiDi protocol failure. |
| `11` | `sensitive_target` | Refusal to type into sensitive field or execute human-only flow. |
| `12` | `unknown_target` | Semantic `@id` not found in screen map. |
| `13` | `unmapped_screen` | Route not recognized in screen map. Use `snapshot -i` or learn it. |
| `14` | `journey_step_failed` | Journey transition failed or expected screen not reached. |

---

## 🧪 Testing & Verification

Run the full CI verification chain:
```bash
pnpm lint && pnpm build && pnpm test && pnpm smoke
```
- **301+ Automated Tests** covering protocol serialization, BiDi fake server, DOM collection, semantic resolution, screen maps, multi-screen journeys, and MCP conformance.

---

## 📄 Documentation Index

- [`docs/firefox-pwa.md`](docs/firefox-pwa.md) — Detailed guide to setting up Firefox PWA on Windows, Linux, and macOS.
- [`docs/screen-map.md`](docs/screen-map.md) — Screen map specification, compact views, and authoring user journeys.
- [`docs/mcp.md`](docs/mcp.md) — Setting up the MCP server with Claude Desktop, Cursor, and other tools.
- [`SKILL.md`](SKILL.md) — One-page agent manual for coding assistants driving `pwa-nav`.
- [`AGENTS.md`](AGENTS.md) — Core architecture, coding conventions, and agent guidelines.

---

## ⚖️ Lawful Use Policy

`pwa-nav` is designed strictly for testing and automating your **own web applications** and **personal, authenticated sessions**. It does not bypass paywalls, bot walls, or access controls. All credentials remain in the user's custody.
