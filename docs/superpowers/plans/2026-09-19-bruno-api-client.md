# Bruno API Client Integration Plan

**Goal:** Version a complete Bruno collection generated from `openapi.json`, make it easy for humans and AI agents to run API requests, and expose the collection to opencode through a local MCP server.

**Architecture:** The OpenAPI 3.1 document remains the API contract source. Bruno CLI imports the document into classic `.bru` files grouped by tags. A committed local environment provides non-secret defaults, the login request captures access and refresh tokens at runtime, and private requests reuse the access token. opencode runs the official MCP server pinned to a Git commit, with the Bruno CLI as a Bash fallback.

**Security:** Never commit real tokens or production credentials. Private environment overrides remain ignored. AI agents must use dry-run before state-changing requests and must not run the collection against production unless the user explicitly approves it.

## Task 1: CLI And Scripts

- Add `@usebruno/cli` as a pinned development dependency.
- Add scripts to import the OpenAPI contract, run the complete collection, and run the health smoke request.
- Document that importing is destructive because it regenerates collection files.

## Task 2: Complete Collection

- Import `openapi.json` to `bruno/` with classic `.bru` files grouped by OpenAPI tags.
- Add a committed `local` environment with `baseUrl`, empty token values, and development seed credentials.
- Add a login post-response script that stores `data.accessToken` and `data.refreshToken`.
- Ensure private requests use the captured bearer token.

## Task 3: AI Integration

- Add the official `usebruno/bruno-mcp` server, pinned to a Git commit, to project `opencode.json`.
- Keep the Bruno CLI scripts as the fallback when MCP is unavailable.
- Require an opencode restart after config changes.

## Task 4: Documentation And Safety

- Ignore private Bruno environment overrides.
- Document Bruno commands and workflows in `README.md` and `AGENTS.md`.
- Warn about destructive imports, authentication rate limits, production use, and state-changing requests.

## Task 5: Verification

- Verify the imported collection structure and environment.
- Run a Bruno health smoke request when the local API is available.
- Run project tests, type checking, linting, formatting checks, and OpenAPI drift checks.
