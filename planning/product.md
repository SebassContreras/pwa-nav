# Product

## What this is

A stable CLI + PWA bridge for fluid QA of the user's web app and assisted, lawful browsing automation on login-walled sites where classic bots are blocked, including LLM notebooks. MVP = autonomous navigation + nav JSON snapshot (`snapshot` / `click` / `fill` + re-snapshot loop). The browser is the user's own logged-in Firefox PWA (PWAsForFirefox) driven over WebDriver BiDi; a per-app screen map tells agents what each screen offers.

## Who uses it

Solo developer + dev team (all devs).

## Out of scope

- Custom WebSocket bridge server (v2).
- Native WebMCP (`document.modelContext`) tools (v2).
- Multi-session management and dashboard UI (v2).
- Full notebook automation; MVP only extracts text from 1 notebook. Full "search any topic automatically" is the final done-when, not the MVP.
- Any bot evasion, CAPTCHA bypass, or credential scraping.
