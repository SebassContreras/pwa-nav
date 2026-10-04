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

### Step 3: Launch Your PWA (On-Demand & Assisted Auth)

Launch your installed PWA on demand with remote debugging enabled:
```powershell
pwa-nav open notebook
```
*(Automatically resolves installed apps like Gemini Notebook, launches the runtime with port 9222 if closed, and connects immediately).*

> [!TIP]
> **Assisted Login for Google & Login-Walled Apps**: If an app uses Google Sign-In or strict bot walls that block interactive logins when debugging ports are open, run:
> ```powershell
> pwa-nav auth notebook
> ```
> This opens the PWA in clean mode for you to log in normally, and re-attaches in debug mode once authenticated.

### Step 4: Your First Navigation Loop

```powershell
# 1. Connect / Navigate to your installed PWA (auto-whitelisted)
pwa-nav open notebook

# 2. Take an accessibility snapshot
pwa-nav snapshot

# 3. Dry-run an action (prints the execution plan, sends NO input)
pwa-nav click '@sign-in'

# 4. Execute the action for real (armed)
pwa-nav click '@sign-in' --armed

# 5. Re-snapshot after mutation
pwa-nav snapshot
```

---

## 🗺️ Screen Maps & Multi-Screen Journeys

For repeated testing and high-speed agent navigation without round trips, use the **Screen Map subsystem** (`docs/screen-map.md`):

### 1. Learn & Continuously Enrich a Screen
Once on a screen you want to map, run:
```powershell
pwa-nav snapshot --learn --locale es-ES --access public
```
This generates or updates `screens/<app-id>.screens.json` with semantic IDs (`@search-input`, `@submit-button`, `@cart-link`). Every snapshot and learn step collaborates in enriching this single map (fields, actions, journeys, and nested modal branches), while raw session data stays strictly isolated in `.agent/apps/<appSlug>/snapshot.json` without scattering loose files across your workspace.

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

### 4. Action Trees & Modal Branches (`opens`)
When an action opens a modal dialog or sub-view (like clicking `@crear-publicacion` to author a post), the screen map captures this in `action.opens`. The controls inside the modal (`@editor-post`, `@boton-publicar`) are directly addressable by `@id` without re-scanning or re-learning background elements. Rich contenteditable editors are mapped as `textbox` with placeholders extracted automatically.

### 5. Execute Multi-Screen User Journeys
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

`pwa-nav` includes a standard W3C BiDi MCP server (`pwa-nav-mcp`) over stdio for Claude Desktop, Cursor, Windsurf, Claude Code, or Antigravity.

### Adding to Your Agent / MCP Client

Add to your client config (`mcp.json`, `claude_desktop_config.json`, or `.vscode/mcp.json`):

```json
{
  "mcpServers": {
    "pwa-nav": {
      "command": "node",
      "args": [
        "C:/path/to/pwa-nav/dist/mcp.js"
      ]
    }
  }
}
```

> [!TIP]
> **Zero Manual Firefox Configuration**: You do not need to specify `"--port", "9222"`. The server defaults to port `9222`. The runtime binary is spawned with `--remote-debugging-port 9222` on demand, keeping your Firefox profile and `config.json` clean so normal manual browsing and logins (like Google Accounts) remain unblocked.

### Server Flags & Options

The MCP server accepts the following command-line flags in `"args"`:

| Flag | Env Variable | Default | Purpose |
|---|---|---|---|
| *(none)* | - | - | Minimal invocation: `node <path>/dist/mcp.js`. Runs in direct active **armed** mode on port 9222. |
| `--dry-run` | `PWA_NAV_DRY_RUN=1` | *off* | Run in dry-run mode (previews mutations). Direct active execution (armed) is default. |
| `--armed` | `PWA_NAV_ARMED=1` | *on* (active) | Retained for backward compatibility (active mode is default). |
| `--port <n>` | - | `9222` | Optional. Override BiDi port only if your PWA uses a non-standard port (1024-65535). |
| `--screens-dir <dir>` | `PWA_NAV_SCREENS_DIR` | `./screens` | Directory where screen maps (`*.screens.json`) are stored. |
| `--screen-map <file>` | - | *auto-discovery* | Explicit path to a single screen map file. |
| `--agent-dir <dir>` | - | `.agent` | Output directory for `.agent/allow.json`, sessions, and screenshots. |
| `--backend offline\|bidi` | - | `bidi` | Use `offline` for testing against static fixtures without a browser. |

The MCP server exposes:
- **Core tools**: `pwa_open`, `pwa_snapshot`, `pwa_find`, `pwa_click`, `pwa_fill`, `pwa_upload`, `pwa_screenshot`, `pwa_extract`, `pwa_act`, `pwa_learn`, `pwa_wait`.
- **Dynamic flow tools**: `flow_<screen>_<flow>` for single-screen mapped tasks.
- **Dynamic journey tools**: `journey_<id>` for multi-screen workflows with `destructiveHint: true`.
- **Resources**: `pwa-nav://screens/<app-id>` and `pwa-nav://snapshot/latest`.

---

## 📖 Command Reference

| Command | Description |
|---|---|
| `pwa-nav open <url> [--launch] [--site <ULID>] [--allow-origin]` | Navigate to URL. Requires origin in `.agent/allow.json` or explicit `--allow-origin`. |
| `pwa-nav snapshot [-i \| --all] [--query <str>] [--role <str>] [--json] [--out <path>]` | Capture live accessibility DOM snapshot. `-i` interactive elements only (default). Optional `--query` and `--role` filters. Highlights active modal/dialog. |
| `pwa-nav snapshot --screen [--screen-map <f>]` | Print compact view of mapped screen matching current URL (no DOM dump). |
| `pwa-nav snapshot --learn [--prune] [--locale <lang>]` | Learn live screen into `screens/<app>.screens.json` and show diff. |
| `pwa-nav find [<query>] [--role <str>] [--dialog] [--offset <n>] [--limit <n>] [--snapshot <id>]` | Fast targeted search across names, roles, placeholders, values, and dialog titles with modal filtering. |
| `pwa-nav click --snapshot <id> [--armed] <ref>` | Click element by snapshot ref (e.g. `e3`). Dry-run unless `--armed`. |
| `pwa-nav click [--armed] '@<id>'` | Click element by semantic ID (e.g. `'@submit-btn'`). |
| `pwa-nav fill --snapshot <id> [--armed] <ref> <text>` | Fill field by ref (supports inputs, textareas, and rich `contenteditable` editors). |
| `pwa-nav fill [--armed] '@<id>' <text>` | Fill field by semantic ID. Sensitive fields are blocked (exit 11). |
| `pwa-nav upload --snapshot <id> [--armed] <ref> <path...>` | Upload local file(s) to `<input type="file">`. Dry-run unless `--armed`. |
| `pwa-nav upload [--armed] '@<id>' <path...>` | Upload local file(s) by semantic ID. |
| `pwa-nav act --snapshot <id> [--armed] <ops...>` | Batch mutations (`click:<ref>`, `fill:<ref>=<text>`, `upload:<ref>=<path>`) in a single session. |
| `pwa-nav act [--armed] <semantic-ops...>` | Batch semantic ops (`click:'@id'`, `fill:'@id'=val`, `upload:'@id'=path`, `flow:<id>`). |
| `pwa-nav journey <name> [key=value...] [--armed]` | Execute declarative multi-screen user journey across route transitions. |
| `pwa-nav screenshot [--out <path>] [--format png\|jpeg\|webp]` | Capture visual screenshot to disk (`.agent/screenshot.png` by default). |
| `pwa-nav extract [--snapshot <id>] [--mode all\|text\|links] [--query <str>] [--role <str>] [--offset <n>] [--limit <n>]` | Fast read-only text or links extraction with query/role filtering and pagination. |
| `pwa-nav wait <target> [--state visible\|hidden\|enabled] [--timeout <ms>] [--interval <ms>]` | Wait deterministically for an element or query to become visible, hidden, or enabled. |
| `pwa-nav qa run <check-file>` | Run offline JSON check file and save per-step evidence to `.agent/evidence/`. |

### Global Flags
- `--backend offline|bidi`: Default is `bidi` (live Firefox PWA). Use `offline` for fixture checks.
- `--port <n>`: BiDi debugging port (default: `9222`, env: `PWA_NAV_PORT`).
- `--context <id>`: Target browsing context ID when multiple tabs are open.
- `--screen-map <file>`: Explicit path to screen map JSON.
- `--screens-dir <dir>`: Directory containing screen maps (default: `./screens`).

---

## 🛡️ Security & Safety Gates

1. **Execution-First & Armed by Default (MCP)**: Actions execute directly and actively on the browser by default. Use `--dry-run` when simulation/preview is explicitly requested.
2. **Sensitive Fields Barrier**: Password fields, tokens, and payment inputs (`sensitive: true` / `humanOnly: true`) are never typed by the agent (fails fast with code 11 `sensitive_target`). The user types them by hand.
3. **Origin Allow-List**: Navigation is strictly blocked unless the origin is approved in `.agent/allow.json` or explicitly passed via `--allow-origin` (code 6 `origin_blocked`).
4. **Kill-Switch**: Creating `.agent/kill` or setting `PWA_NAV_KILL_SWITCH` immediately terminates any armed operation (code 7 `kill_switch`).
5. **Untrusted Page Content**: All HTML page contents, aria names, and element text are treated strictly as untrusted data, never instructions.
6. **File Upload Security Gate**: Local file uploads (`pwa_upload`, `upload`) are strictly restricted to files within allowed safe directories (workspace root or `.agent/`). Files attempting path traversal (`..`), sensitive environment files (`.env*`), or private keys (`id_rsa`, etc.) are blocked immediately before touching the browser (fails fast with code 15 `file_upload_blocked`).
7. **Visual Screenshots & Context Economy**: Binary images and screenshots are saved directly to disk (`.agent/screenshot.png` or `--out <path>`). Binary image data and base64 strings are never dumped into chat or agent context.
8. **Text-First & Vision-Free Automation (Zero Random Screenshots)**: `pwa_screenshot` is strictly restricted to user-requested image artifacts. Agents must never take screenshots to inspect state or discover UI elements. Re-read state in pure text with `pwa_snapshot`.
9. **Autonomous Screen Learning**: Agents autonomously register new screens using `pwa_learn` when encountering unmapped routes, keeping maps persisted without human intervention.
10. **PowerShell Splatting Guard**: In PowerShell on Windows, `@id` without quotes is treated as an empty array splatting variable. Semantic targets must always be quoted: `'@id'` or `click:'@id'`.

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
| `13` | `unmapped_screen` | Route not recognized in screen map. Autonomously learn and enrich `screens/<app>.screens.json`. |
| `14` | `journey_step_failed` | Journey transition failed or expected screen not reached. |
| `15` | `file_upload_blocked` | File path is outside allowed safe directories or targets sensitive files. |

---

## 🧪 Testing & Verification

Run the full CI verification chain:
```bash
pnpm lint && pnpm build && pnpm test && pnpm smoke
```
- **340+ Automated Tests** covering protocol serialization, BiDi fake server, DOM collection, semantic resolution, screen maps, multi-screen journeys, visual screenshots, and MCP conformance.

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
