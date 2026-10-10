# pwa-nav

> **Stable CLI + MCP bridge for fluid QA testing and lawful, bot-proof browser automation on login-walled web apps using your own authenticated Firefox PWA.**

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D22.0.0-brightgreen.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![BiDi: W3C Standard](https://img.shields.io/badge/WebDriver-BiDi%20Standard-orange.svg)](https://w3c.github.io/webdriver-bidi/)

---

## ⚡ 5-Minute Quickstart

Want to see `pwa-nav` in action immediately? Follow this quick progression:

```bash
# 1. Clone, install dependencies and build
git clone https://github.com/SebassContreras/pwa-nav.git
cd pwa-nav
pnpm install
pnpm build

# 2. Run the offline smoke test to verify your build
pnpm smoke

# 3. Link globally so you can use `pwa-nav` and `pwa-nav-mcp` anywhere
pnpm link --global
```

Now launch any web app (e.g. NotebookLM, Mercadona, LinkedIn, or your SaaS portal) and inspect it:

```powershell
# Open URL or web app and attach via WebDriver BiDi (port 9222)
pwa-nav open "https://notebooklm.google.com" --launch

# Inspect the active UI elements in clean text (zero screenshots)
pwa-nav snapshot

# Search for a button or input
pwa-nav find "New notebook"

# Click with preview (dry-run preview is the CLI default)
pwa-nav click '@new-notebook'

# Execute live in your real browser (requires --armed)
pwa-nav click '@new-notebook' --armed
```

---

## 💡 What Problem Does It Solve?

Traditional browser automation tools (Playwright, Puppeteer, Selenium with Chromium) face severe roadblocks on modern web applications:

1. **Anti-Bot & CAPTCHA Walls**: Cloudflare Turnstile, reCAPTCHA, and bot-defense shields detect synthetic browser profiles, headless flags, and Chromium automation binaries, blocking access to web apps like Google NotebookLM, Mercadona, and internal enterprise portals.
2. **Login & 2FA Barriers**: Storing credentials or automating 2FA tokens in automation scripts is brittle, dangerous, and frequently triggers fraud alerts or account bans.
3. **Massive Token Waste**: Dumping full HTML DOM trees into LLM contexts burns thousands of tokens per step, slows down agents, and causes hallucinations when locators change.

### The `pwa-nav` Solution:

- **Attaches to Your Real Browser**: Connects directly to your dedicated, standalone **Firefox PWA** runtime over standard **W3C WebDriver BiDi** on loopback (`localhost:9222`).
- **Zero Bot Footprints**: It runs in authentic Firefox profiles with your active sessions, cookies, and human hardware fingerprint. You log in once by hand; the agent operates lawfully and seamlessly alongside you.
- **Accessibility Tree Contracts**: Instead of pixel coordinates or brittle CSS selectors, `pwa-nav` uses a clean accessibility snapshot with ephemeral refs (`e1`, `e2`, ...). Mutations invalidate refs immediately, preventing stale misclicks.
- **Screen Maps & User Journeys**: Declarative screen models (`screens/<app>.screens.json`) provide permanent semantic `@id` targets, slashing LLM token consumption by up to **86%** and enabling declarative multi-screen workflows (`pwa-nav journey <name>`).
- **Native Model Context Protocol (MCP)**: Exposes all browser tools and workflows directly to AI coding assistants (Claude Desktop, Cursor, Antigravity, Claude Code, Windsurf, etc.).

---

## 📋 Prerequisites

Before installing `pwa-nav`, ensure you have the following installed on your system:

### 1. Node.js & Package Manager
- **Node.js**: `v22.0.0` or higher (`node --version`).
- **pnpm**: `v10.0.0` or higher (`pnpm --version`), or `npm` / `corepack`.

### 2. Standalone Firefox Runtime
`pwa-nav` uses the standalone Firefox runtime binary to render dedicated, isolated app windows without browser chrome or extension overhead.
Each web application maintains its own dedicated profile folder inside `.agent/apps/<appSlug>/profile`.

---

## 📦 Installation & Setup

### Step 1: Clone and Build `pwa-nav`

```bash
git clone https://github.com/SebassContreras/pwa-nav.git
cd pwa-nav
pnpm install
pnpm build
```

Verify that the build succeeded by running the offline smoke test:
```bash
pnpm smoke
```
*(You should see `smoke passed: open + snapshot verified`).*

### Step 2: Choose How to Run `pwa-nav`

You can run `pwa-nav` in two ways:

#### Option 1: Global Link (Recommended for CLI and MCP)
Link the binaries globally so `pwa-nav` and `pwa-nav-mcp` are available in your system `PATH`:

```bash
# With pnpm:
pnpm link --global

# Or with npm:
npm link
```

Now you can run `pwa-nav <command>` and `pwa-nav-mcp` directly from any terminal.

#### Option 2: Local Project Execution
If you prefer not to link globally, run commands directly from the repo directory:
```bash
# Using Node directly:
node dist/cli.js <command>
node dist/mcp.js

# Or using pnpm exec:
pnpm exec pwa-nav <command>
```

---

## 🚀 How to Use

`pwa-nav` offers two complementary interfaces:
1. **As an MCP Server** for autonomous AI assistants (Claude, Cursor, Antigravity, Claude Code, Windsurf).
2. **As a CLI Tool** for terminal users, developers, and QA scripts.

---

### Interface A: Using with AI Assistants via MCP (Recommended)

In MCP mode, `pwa-nav` runs an stdio server (`dist/mcp.js` or `pwa-nav-mcp`) where tools are **armed by default** (actions execute directly in the browser window).

#### 1. Configure Your MCP Client

Add `pwa-nav` to your client configuration using the absolute path to `dist/mcp.js`:

##### Claude Desktop
File location:
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`

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

##### Cursor
File location: `.cursor/mcp.json` or `Settings > Features > MCP > Add New MCP Server`:
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

##### Claude Code
Run from your terminal:
```bash
claude mcp add pwa-nav -- node C:/path/to/pwa-nav/dist/mcp.js
```

##### Antigravity / Generic Stdio MCP Clients
If you linked globally, you can also specify the binary command directly:
```json
{
  "mcpServers": {
    "pwa-nav": {
      "command": "pwa-nav-mcp"
    }
  }
}
```

> [!TIP]
> **Zero-Config Port & Automatic Launch**: Passing `--port 9222` is optional (9222 is the default). When the agent calls `pwa_open({ url: "notebook" })`, `pwa-nav` automatically finds your installed PWA profile, launches the Firefox PWA runtime with `--remote-debugging-port 9222` if it is closed, and connects seamlessly.

> [!NOTE]
> **Initial Startup Notice**:
> When the MCP server starts, it prints a message to stderr like:
> ```text
> pwa-nav-mcp ready (backend bidi, ARMED)
> ```
> **This is completely normal and expected.** The repository does not ship with pre-baked screen maps for your personal apps. `pwa-nav` is fully functional from the very first second: as the AI agent navigates to an unmapped screen, it calls `pwa_learn` to autonomously generate and enrich `screens/<app>.screens.json`.

#### 2. Key MCP Tools Available to Agents

| MCP Tool | Description |
|---|---|
| `pwa_open` | Opens an installed PWA by slug/name (e.g. `"notebook"`) or navigates to an approved URL. |
| `pwa_auth` | Assisted login workflow for Google Accounts and anti-bot protected login pages. |
| `pwa_snapshot` | Inspects the active screen in clean text (`screen: true` for compact screen map view). |
| `pwa_find` | Fast element search across accessible names, roles, placeholders, and modal dialogs. |
| `pwa_click` | Clicks elements by semantic `@id` (e.g. `@submit-btn`) or ref (`e1`). |
| `pwa_fill` | Types text into inputs, textareas, and rich `contenteditable` editors. |
| `pwa_upload` | Safely uploads local files to `<input type="file">`. |
| `pwa_wait` | Deterministically waits for background AI generation or DOM conditions (no arbitrary sleeps). |
| `pwa_learn` | Autonomously learns and persists new screen maps into `screens/<app>.screens.json`. |
| `pwa_act` | Executes batched mutations (e.g. `fill:@input=query`, `click:@submit`) in a single BiDi turn. |

---

### Interface B: Using the CLI in Terminal

The CLI is designed for interactive exploration, manual workflows, and continuous QA testing.

> [!IMPORTANT]
> **Safety Mode in CLI**: To prevent accidental clicks, write operations (`click`, `fill`, `upload`, `act`, `journey`) in the CLI run in **dry-run mode** (preview only) by default. Pass `--armed` to execute the action live in the browser.
>
> **PowerShell Splatting**: In Windows PowerShell, tokens starting with `@` (e.g. `@sign-in`) must always be enclosed in single quotes: `'@sign-in'` or `click:'@sign-in'`.

#### 1. Open and Connect to Your PWA

Open an installed PWA by its name or partial slug:

```powershell
# Open installed PWA by name (case-insensitive):
pwa-nav open "Google NotebookLM"

# Or open by partial slug:
pwa-nav open notebook

# Or open any web URL (requires explicit consent flag on first visit):
pwa-nav open https://example.com --allow-origin
```

*(If the PWA window is closed, `pwa-nav open` automatically starts the runtime with `--remote-debugging-port 9222` and attaches).*

#### 2. Assisted Login for Protected Sites (`auth`)

If an application uses Google Sign-In or strict bot walls that detect active debugging ports during login, use the assisted `auth` command:

```powershell
pwa-nav auth notebook
```

1. `pwa-nav` launches the PWA in **clean mode** (no debugging flags).
2. You sign in comfortably in the browser window with your credentials and 2FA.
3. Press **Enter** in the terminal: `pwa-nav` restarts the PWA with debugging port 9222 enabled, keeping your authenticated session intact.

#### 3. Inspect the Screen (Snapshot)

```powershell
# Interactive summary of inputs, buttons, links, and active dialogs:
pwa-nav snapshot

# Filter snapshot by text query or role:
pwa-nav snapshot --query "Search" --role textbox

# Inspect the compact screen-map view (saves 86% tokens):
pwa-nav snapshot --screen
```

#### 4. Find Elements (`find`)

Locate controls without dumping the entire page:

```powershell
# Search for any button or input matching text:
pwa-nav find "Save"

# Search inside the active modal dialog only:
pwa-nav find "Confirm" --dialog
```

#### 5. Interact with Elements (`click` and `fill`)

```powershell
# 1. Preview click (dry-run):
pwa-nav click '@sign-in'

# 2. Execute click live in browser:
pwa-nav click '@sign-in' --armed

# 3. Fill text into an input or rich contenteditable editor:
pwa-nav fill '@search-input' "Quantum computing" --armed

# 4. Click using ephemeral ref from snapshot:
pwa-nav click --snapshot snap-123 e1 --armed
```

#### 6. Deterministic Waiting (`wait`)

Never use arbitrary shell pauses (`sleep`, `Start-Sleep`). Wait deterministically for async rendering:

```powershell
# Wait for element to become visible (timeout in ms or s):
pwa-nav wait '@results-card' --state visible --timeout 30s

# Wait for text notice to disappear:
pwa-nav wait --query "Generating response..." --state hidden --timeout 60s
```

#### 7. Atomic Multi-Action Chaining (`act`)

Batch multiple actions into a single BiDi turn without round-trips:

```powershell
pwa-nav act fill:'@search'="AI trends" click:'@search-button' --armed
```

---

## 🗺️ Screen Maps & Multi-Screen Journeys

For repeatable, high-speed automation without token waste, `pwa-nav` uses declarative **Screen Maps** (`docs/screen-map.md`):

### 1. Auto-Learn a Screen
Navigate to any page in your PWA and run:
```powershell
pwa-nav snapshot --learn --locale en-US --access authenticated
```
This generates or enriches `screens/<app-id>.screens.json` with semantic IDs (`@search-input`, `@submit-button`, `@cart-link`). Subsequent snapshots enrich the same map without creating loose files in your workspace.

### 2. Modals and Subdialogs (`opens`)
When clicking a button opens a modal or subdialog (e.g. clicking `@new-post` opens a post composer), `pwa-nav` stores this in `action.opens`. The controls inside the modal (`@post-textarea`, `@publish-button`) become addressable immediately by `@id` without re-scanning background elements.

### 3. Declarative Multi-Screen User Journeys
Declare multi-step user journeys in `screens/<app>.screens.json` and execute them across route transitions with route verification and network settling:

```powershell
# Preview journey steps:
pwa-nav journey checkout-journey item="shoes"

# Execute live in browser:
pwa-nav journey checkout-journey item="shoes" --armed
```
If any intermediate step fails or the destination URL does not match `expectScreen`, execution halts immediately with exit code `14` (`journey_step_failed`), preserving evidence.

---

## 📖 Complete CLI Command Reference

| Command | Description |
|---|---|
| `pwa-nav open <url|app> [--launch] [--allow-origin]` | Open an installed PWA or navigate to a URL. Auto-whitelists installed apps. |
| `pwa-nav auth [<app\|url>] [--clean] [--debug] [--port <n>]` | Assisted login workflow for Google accounts and bot-walled login screens. |
| `pwa-nav snapshot [-i \| --all] [--query <str>] [--role <str>] [--json] [--out <path>]` | Capture live accessibility DOM snapshot. Highlights active modal/dialogs. |
| `pwa-nav snapshot --screen [--screen-map <f>] [--screens-dir <dir>]` | Print compact view of mapped screen matching current URL (no DOM dump). |
| `pwa-nav snapshot --learn [--prune] [--locale <lang>] [--access <level>]` | Learn live screen into `screens/<app>.screens.json` and show diff. |
| `pwa-nav find [<query>] [--role <str>] [--dialog] [--offset <n>] [--limit <n>]` | Fast targeted element search across names, roles, placeholders, and dialogs. |
| `pwa-nav click [--armed] '@<id>'` | Click element by permanent semantic ID (e.g. `'@submit-btn'`). |
| `pwa-nav click --snapshot <id> [--armed] <ref>` | Click element by snapshot ref (e.g. `e3`). |
| `pwa-nav fill [--armed] '@<id>' <text>` | Type text into input, textarea, or `contenteditable` editor by semantic ID. |
| `pwa-nav fill --snapshot <id> [--armed] <ref> <text>` | Type text by snapshot ref. Sensitive fields are strictly blocked (exit 11). |
| `pwa-nav upload [--armed] '@<id>' <path...>` | Upload local safe file(s) to file inputs by semantic ID. |
| `pwa-nav upload --snapshot <id> [--armed] <ref> <path...>` | Upload local file(s) by snapshot ref. |
| `pwa-nav act [--armed] <ops...>` | Batch mutations (`click:'@id'`, `fill:'@id'=val`, `flow:<id>`) in a single BiDi turn. |
| `pwa-nav journey <name> [key=value...] [--armed]` | Execute declarative multi-screen user journey across route transitions. |
| `pwa-nav wait <target> [--state visible\|hidden\|enabled] [--timeout <ms>]` | Wait deterministically for an element or query condition. |
| `pwa-nav screenshot [--out <path>] [--format png\|jpeg\|webp]` | Capture visual screenshot to disk (`.agent/screenshot.png` by default). |
| `pwa-nav extract [--snapshot <id>] [--mode all\|text\|links] [--query <str>]` | Extract clean text or links for bulk scraping without altering state. |
| `pwa-nav qa run <check-file>` | Run offline JSON QA test suite and save per-step evidence to `.agent/evidence/`. |

### Global Flags
- `--backend offline|bidi`: Default is `bidi` (live Firefox PWA). Use `offline` for fixture checks.
- `--port <n>`: BiDi debugging port (default: `9222`, env: `PWA_NAV_PORT`).
- `--context <id>`: Target browsing context ID when multiple tabs are open.
- `--cache-dir <dir>`: Directory for cache and agent state (default: `<projectRoot>/.agent` or `~/.pwa-nav`, env: `PWA_NAV_CACHE_DIR`).
- `--screens-dir <dir>`: Directory containing screen maps (default: `<cache-dir>/screens`, env: `PWA_NAV_SCREENS_DIR`).
- `--screen-map <file>`: Explicit path to a single screen map file.

---

## ⚙️ Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `PWA_NAV_PORT` | `9222` | Override WebDriver BiDi debugging port. |
| `PWA_NAV_BACKEND` | `bidi` | Default backend mode (`bidi` or `offline`). |
| `PWA_NAV_CACHE_DIR` | `<projectRoot>/.agent` | Directory for cache, snapshots, sessions, allow-list, and screen maps. |
| `PWA_NAV_SCREENS_DIR` | `<cache-dir>/screens` | Directory where screen map JSON files are stored. |
| `PWA_NAV_DRY_RUN` | `0` | Set to `1` to force dry-run mode in MCP server. |
| `PWA_NAV_KILL_SWITCH` | — | Path to emergency kill-switch file (or set to `1`). |
| `PWA_NAV_RUNTIME_DIR` | Auto | Override standalone runtime directory. |

---

## 🛡️ Security & Safety Gates

1. **User's Own Sessions**: Operates exclusively in your authenticated Firefox profile. Never automates credentials or bypasses CAPTCHAs.
2. **Sensitive Fields Barrier**: Password fields, tokens, and payment inputs (`sensitive: true` / `humanOnly: true`) are never typed by the agent (fails fast with code 11 `sensitive_target`). You type them by hand.
3. **Origin Allow-List Gate**: Navigation to external origins is safely checked against `.agent/allow.json` or explicitly consented with `--allow-origin` (code 6 `origin_blocked`).
4. **Emergency Kill-Switch**: Creating `.agent/kill` or setting `PWA_NAV_KILL_SWITCH` immediately terminates any armed operation (code 7 `kill_switch`).
5. **Untrusted Page Content**: All HTML page contents, aria names, and element text are treated strictly as untrusted data, never instructions.
6. **File Upload Security Boundary**: File uploads (`pwa_upload`, `upload`) are strictly restricted to files within allowed safe directories (workspace root or `.agent/`). Path traversal (`..`) or targeting sensitive files (`.env*`, private keys) is blocked immediately (exit code 15 `file_upload_blocked`).
7. **Text-First & Vision-Free Automation**: `pwa_screenshot` is strictly restricted to user-requested image artifacts. Agents must never take random screenshots to discover UI elements or check state; state is re-inspected in pure text with `pwa_snapshot`.

---

## 🚦 Exit Codes & Troubleshooting

| Code | Name | Common Cause & Recovery Action |
|:---:|---|---|
| `0` | `ok` | Command completed successfully. |
| `1` | `failure` | General error or QA check failure. Check error message. |
| `2` | `invalid_args` | Missing or malformed CLI arguments/flags. Run with `--help`. |
| `3` | `stale_ref` | Snapshot ref (`eN`) expired due to page mutation. Run `snapshot` and retry. |
| `4` | `no_browser` | Port 9222 is closed. Run `pwa-nav open <app>` to launch with debugging. |
| `5` | `session_busy` | Another client or orphan is connected to BiDi. Restart the PWA window. |
| `6` | `origin_blocked` | Target URL is not allow-listed. Run `open <url> --allow-origin`. |
| `7` | `kill_switch` | Kill-switch file `.agent/kill` exists. Remove it to resume. |
| `8` | `not_actionable` | Element is hidden, covered, disabled, or non-interactable. |
| `9` | `timeout` | Browser action, network idle, or navigation timed out. |
| `10` | `protocol` | Low-level WebDriver BiDi protocol mismatch. |
| `11` | `sensitive_target` | Refusal to type into sensitive field or execute human-only flow. Type manually! |
| `12` | `unknown_target` | Semantic `@id` not found in screen map. Run `snapshot --screen` to inspect IDs. |
| `13` | `unmapped_screen` | Route not recognized in screen map. Run `snapshot --learn` to register it. |
| `14` | `journey_step_failed` | Multi-screen journey transition failed or expected screen not reached. |
| `15` | `file_upload_blocked` | File upload path is outside allowed directories or targets sensitive files. |

---

## 🧪 Testing & Verification

Run the full CI verification chain:
```bash
pnpm lint && pnpm build && pnpm test && pnpm smoke
```
- **383 Automated Tests** across dedicated module test suites (`src/*/test/`) covering WebDriver BiDi serialization, DOM collectors, semantic target resolution, screen maps, multi-screen journeys, the unified tools service layer (`src/tools/`), and MCP server conformance.

---

## 📄 Documentation Index

- [`docs/firefox-pwa.md`](docs/firefox-pwa.md) — Detailed guide to setting up Firefox PWA on Windows, Linux, and macOS.
- [`docs/screen-map.md`](docs/screen-map.md) — Screen map specification, compact views, and authoring user journeys.
- [`docs/mcp.md`](docs/mcp.md) — Setting up the MCP server with Claude Desktop, Cursor, and other tools.
- [`SKILL.md`](SKILL.md) — One-page agent manual for coding assistants driving `pwa-nav`.
- [`AGENTS.md`](AGENTS.md) — Core architecture, coding conventions, and agent guidelines.

---

## ⚖️ Lawful Use Policy

`pwa-nav` is designed strictly for QA testing and automating your **own web applications** and **personal, authenticated sessions**. It does not bypass paywalls, bot walls, or access controls. All credentials remain in the user's custody.
