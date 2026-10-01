# Interview ledger — pwa-nav

| dimension | status | answer summary or skip reason |
|---|---|---|
| idea-detail | covered | User wants something more stable for fluid QA of their website, plus lawful assisted browsing on robot-restricted sites for info gathering, plus LLM notebook automation. Original quote (ES): "quiero algo que sea mas estable par hacer qa de mi web de una manera fluida y tambien pueda conectarce a sitios donde los robots no esten permitidos de manera legal para ayudarme a buscar info, poder automatizar cuadernos de notebook llm y demas" |
| project-type | covered | software — CLI + bridge (PWA SDK + local daemon/CLI + MCP) |
| goal | covered | A stable CLI + PWA bridge for fluid QA of your web app and assisted, lawful browsing automation on login-walled sites where classic bots are blocked, including LLM notebooks. |
| audience | covered | Solo developer + team, all devs |
| mvp | covered | MVP: autonomous navigation + nav JSON snapshot (snapshot/click/fill + re-snapshot). Explicit v2 exclusions: custom WS bridge, native WebMCP tools, multi-session, dashboard, full notebook automation (only text extract of 1 notebook in MVP) |
| done-when | covered | Done when user can automatically search any topic in LLM notebooks |
| constraints-hard | covered | Lawful use only with own sessions (standard: no CAPTCHA/bot-evasion — derived solo per user "sigue solo" instruction) (standard: Playwright MCP docs — accessibility snapshots + user-owned browser context — https://playwright.dev/docs/getting-started-mcp) |
| stakeholders | covered | None — solo + dev team, no external approval (derived solo) |
| automatability | covered | Agent: CLI snapshot/actions/QA loop/evidence logs. Human: logins, approvals on login-walled sites, final verification (derived solo) |
| runtime | covered | Node 22 LTS + pnpm 11 + TypeScript strict ESM (standard: Node 22 native TS + tsconfig/node22 — https://nodejs.org/docs/latest-v22.x/api/typescript.html; pnpm 11 requires Node 22 — https://pnpm.io/blog/releases/11.0) (derived solo) |
| framework | covered | CORRECTED 2026-10-01: raw W3C WebDriver BiDi attached to the user's Firefox PWA (PWAsForFirefox), no Playwright/Chromium, no custom WS bridge between CLI and daemon (standard: W3C WebDriver BiDi — https://w3c.github.io/webdriver-bidi/; Firefox remote protocol — https://firefox-source-docs.mozilla.org/remote/index.html). Snapshot contract and ref semantics unchanged. User quote (ES): "no era con chrome es con firefox con la pwa que se crea al Progressive Web Apps for Firefox" |
| toolchain | covered | pnpm + tsc + eslint + smoke script; `pnpm i && pnpm lint && pnpm build && pnpm smoke` (standard: TS 2026 setup — community preset) (derived solo) |
| datastore | covered | Local filesystem JSON `.agent/snapshot.json`, no DB in MVP (derived solo) |
| data-model | covered | Snapshot {snapshotId, url, title, elements[{ref, role, name, value, disabled}]}; refs invalidated after each mutation (standard: Playwright snapshot refs — https://playwright.dev/mcp/snapshots) (derived solo) |
| interface | covered | CLI (snapshot/click/fill/extract) + MCP stdio adapter + SKILL.md (derived solo) |
| identity | covered | CORRECTED 2026-10-01: reuse the PWAsForFirefox profile of the user's logged-in app (e.g. Sigestran Web), no credential storage; sensitive fields are never filled by the agent |
| hosting | covered | Local-only for MVP, no prod deploy (derived solo) |
| ci | covered | tsc + eslint + smoke script must pass (derived solo) |
| env-secrets | covered | .env + env vars, never committed (derived solo) |
| verification | covered | Snapshot assertions + smoke run on demo page + 1 own web page (derived solo) |
| third-party | covered | CORRECTED 2026-10-01: none at runtime (Node global WebSocket); dev-only: ajv (schema validation), ws (BiDi test double). Reference tooling: firefoxpwa, mozilla/firefox-devtools-mcp |
| observability | covered | File logs `.specloop/logs` + per-run evidence (snapshot JSON + notes) (derived solo) |
| helper-skills | covered | Playwright CLI skill via `playwright-cli install --skills`, installed on demand with confirmation (derived solo) |
| worker-cli | covered | opencode (current session) (derived solo) |
| agent-rules | covered | Docs in English, chat in Spanish; lawful use only; never commit secrets; never bypass CAPTCHA/blocks (derived solo) |
| visual-surface | covered | No visual surface in MVP — CLI only (derived solo) |
| tone | covered | Docs EN, chat ES (user instruction) |
| code-conventions | covered | TS strict, ESM (nodenext), pnpm, prettier/eslint (derived solo) |
| anti-preferences | covered | No bot evasion, no secrets in repo, no inline snapshots in context — write to disk (derived solo) |
| preference-strength | covered | Lawful-use + language rules are hard rules; rest are defaults (derived solo) |
