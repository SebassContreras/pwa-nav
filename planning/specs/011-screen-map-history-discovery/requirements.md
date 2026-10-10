# 011 - screen-map-history-discovery - Requirements

## What's being built

History-assisted route discovery engine that inspects local navigation history (`places.sqlite` in the app's profile) to extract visited URLs, route hierarchies, and page titles, automatically bootstrapping and enriching `.agent/apps/<appSlug>/screens.json` with unmapped candidate screens.

## Who it serves

Agents and developers exploring new or complex web applications (e.g. LinkedIn, Mercadona) who want rapid discovery of candidate routes and screens without manually wandering and discovering each page one BiDi step at a time.

## Requirements

- R1@1: Read-only history extraction: query `places.sqlite` within the app's profile to extract visited distinct paths, titles, and visit timestamps matching the app's domain.
- R2@1: Screen map candidate generation: map extracted URLs against existing screens in `screens.json` to identify unmapped routes.
- R3@1: Safe map enrichment: propose or automatically scaffold skeletal screen entries in `screens.json` with route patterns and suggested IDs for newly discovered pages.
- R4@1: Zero-token discovery CLI/MCP action: expose `pwa-nav screens discover <app>` and MCP support to surface candidate screens instantly without launching live browser round-trips.

## Out of scope

- Extracting browsing history outside the app's isolated profile domain.
- Scraping external web pages.

## Dependencies

- 001 (screen-map-filtering), 002 (multi-pwa-isolation).

## Owner split

Agent: code, tests, docs. Human: review of discovered screen patterns and IDs.
