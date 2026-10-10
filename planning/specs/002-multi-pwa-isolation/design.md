# 002 — multi-pwa-isolation — Design

## Approach

- D1@1 (implements R1, R5): Allocate dynamic debugging ports sequentially starting at DEFAULT_PORT (9222) via an injectable PortAllocator service that checks port availability via TCP probe and active registry entries. _(standard: W3C WebDriver BiDi — https://w3c.github.io/webdriver-bidi/)_
- D2@1 (implements R2): Launch each PWA as an independent OS process using its dedicated standalone profile directory (.agent/apps/<appSlug>/profile) and its assigned BiDi port. _(standard: Firefox Standalone PWA)_
- D3@1 (implements R3): Introduce a persistent, atomic InstanceRegistry (.agent/instances.json) mapping appSlug to active instance metadata (port, pid, url, startedAt), enabling target resolution by --app <slug> or --port <n>. _(standard: Service Registry Pattern)_
- D4@1 (implements R3): Expose --app and --port parameters across CLI commands and MCP tool calls to route operations to the corresponding active PWA instance. _(judgement, no standard)_
- D5@1 (implements R4, R5): Implement health-check and stale instance pruning that frees ports and removes registry entries when a process terminates or no longer listens on its port. _(judgement, no standard)_

## Deliverables

- `src/browser/port-allocator.ts`: Port allocation utility and collision avoidance.
- `src/browser/instance-registry.ts`: `PwaInstanceRegistry` interface and file-backed implementation.
- Updates to `src/browser/standalone-runner.ts` and `src/browser/bidi-backend.ts` for multi-port routing.
- Updates to `src/tools/`, `src/cli/`, and `src/mcp/` to accept `--app` and `--port`.
- Automated test suites for port allocation, registry, and concurrent multi-app isolation.

## Sequencing

1. `PortAllocator` and `InstanceRegistry` services and unit tests.
2. Integration into standalone launcher and backend resolution.
3. CLI and MCP parameter wiring.
4. Concurrency integration tests and manual verification.
