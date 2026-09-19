# OpenAPI Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Expose an OpenAPI 3.1 contract generated from the existing Zod schemas, serve it live with a Scalar UI, and version `openapi.json` so the separate frontend repo can generate TypeScript types with `openapi-typescript`.

**Architecture:** Zod schemas are the single source of truth. Request bodies/queries reuse the existing validation schemas; public response schemas are added per module. `zod-openapi` builds the document code-first. The document is exposed at `GET /api/openapi.json` and rendered at `GET /api/docs` (Scalar), both gated by `DOCS_ENABLED`. A build-time script writes `openapi.json` at the repo root for versioned consumption (strategy A) while the live endpoint supports on-demand generation (strategy B).

**Tech Stack:** Node.js 24, TypeScript 6 (`NodeNext`), Express 5, Zod 4, Prisma 7.10, Vitest, pnpm. New deps: `zod-openapi`, `@scalar/express-api-reference`.

## Design Decisions Locked In

- Zod schemas are the only source of truth; no hand-written OpenAPI YAML.
- Paths are declared with the full `/api/v1/...` prefix so generated frontend types map 1:1 to real routes.
- Request schemas come from existing `*.schemas.ts` via `.shape.body` / `.shape.query`.
- Response schemas are public DTOs, never raw Prisma types; no password hashes, tokens internals, or Better Auth `name`.
- `openapi.json` is versioned at the repo root (strategy A) and also served live (strategy B).
- `DOCS_ENABLED` (default `true` in development/test, `false` in production) gates both endpoints.
- Better Auth's mounted `/api/auth/*` handler is **not** documented; the documented contract is `/api/v1/auth/*`.
- Private routes document `security: [{ bearerAuth: [] }]` (JWT EdDSA).
- Type names are fixed through Zod `.meta({ id })`; changing an `id` later is a breaking change for the frontend.
- Dates follow the real wire format: activities send `date` as `YYYY-MM-DD` and `startTime`/`endTime` as `HH:mm` strings, not ISO datetimes.

## File Structure

**New**

- `src/docs/schemas.ts` — shared envelope (`apiSuccess`), `apiError`, `validationError`, `bearerAuth` security scheme.
- `src/docs/openapi.ts` — central `createDocument` assembly (info, security schemes, paths).
- `src/docs/health.openapi.ts` — health path item.
- `src/modules/auth/auth.openapi.ts` — auth path items.
- `src/modules/users/users.openapi.ts` — users path items.
- `src/modules/activities/activities.openapi.ts` — activities path items.
- `src/docs/openapi.test.ts` — document contract tests + route coverage drift guard.
- `src/docs/generate.ts` — writes/checks `openapi.json`.
- `openapi.json` — versioned artifact.

**Modified**

- `src/modules/auth/auth.schemas.ts`, `src/modules/users/users.schemas.ts`, `src/modules/activities/activities.schemas.ts` — add public response schemas and `.meta()` metadata.
- `src/app.ts` — mount `/api/openapi.json` and `/api/docs`.
- `src/config/env.ts` — add `DOCS_ENABLED`.
- `package.json` — add `docs:generate`, `docs:check` scripts.
- `.env.example`, `README.md`, `AGENTS.md` — document usage and frontend consumption.

**Deviation from the original draft:** the health response schema lives in `src/docs/health.openapi.ts` instead of a new `src/modules/health/health.schemas.ts`, because `health` is not a domain module in this repo (it lives in `src/routes`/`src/controllers`/`src/models`). The schema uses `satisfies z.ZodType<HealthStatusResponse>` to stay aligned with the existing interface. Also, `openapi.json` was added to `.prettierignore` (generated artifact) and `src/docs/generate.ts` was excluded from `tsconfig.build.json` (build-time tool only).

## Tasks

### Task 1: Dependencies and shared documentation schemas

**Files:**

- Modify: `package.json`
- Create: `src/docs/schemas.ts`
- Create: `src/docs/schemas.test.ts`

- [x] **Step 1: Install dependencies**

Run: `pnpm add zod-openapi @scalar/express-api-reference`

- [x] **Step 2: Write failing tests for shared schemas**

Create `src/docs/schemas.test.ts` covering:

- `apiSuccess(z.string())` accepts `{ success: true, message, data }` and rejects `success: false`.
- `apiError` accepts `{ success: false, message, errors }` and rejects `success: true`.
- `validationIssueSchema` accepts `{ field, message }` and rejects missing `message`.

- [x] **Step 3: Run tests to verify they fail**

Run: `pnpm vitest run src/docs/schemas.test.ts`
Expected: FAIL because `src/docs/schemas.ts` does not exist.

- [x] **Step 4: Implement shared schemas**

Create `src/docs/schemas.ts` with `apiSuccessResponse`, `apiErrorResponse`, `validationIssueSchema`, and the `bearerAuth` scheme constant.

- [x] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run src/docs/schemas.test.ts`
Expected: PASS.

### Task 2: Public response schemas per module

**Files:**

- Modify: `src/modules/auth/auth.schemas.ts`
- Modify: `src/modules/users/users.schemas.ts`
- Modify: `src/modules/activities/activities.schemas.ts`
- Create: `src/modules/health/health.schemas.ts` (superseded by `src/docs/health.openapi.ts`, see deviation note)
- Create/Modify: corresponding `*.schemas.test.ts`

- [x] **Step 1: Write failing tests for each response schema**

Auth: `authTokensSchema` accepts the exact `formatAuthSuccess` shape; `registerResultSchema` accepts `{ userId }`.
Users: `userProfileSchema` accepts the exact `profileSelect` shape including nullable `unit`/`career`.
Activities: `activityListItemSchema` and `paginatedActivitiesSchema` accept the exact `toActivityListItem` + pagination shape with `YYYY-MM-DD` / `HH:mm` strings.
Health: `healthResponseSchema` accepts the `HealthStatusResponse` shape.

- [x] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/modules/auth/auth.schemas.test.ts src/modules/users/users.schemas.test.ts src/modules/activities/activities.schemas.test.ts`
Expected: FAIL because response schemas are not exported.

- [x] **Step 3: Implement response schemas**

Add the schemas with `.meta({ id, description, examples })` metadata and export inferred types.

- [x] **Step 4: Run tests to verify they pass**

Run: `pnpm typecheck && pnpm vitest run`
Expected: PASS.

### Task 3: OpenAPI document and per-module paths

**Files:**

- Create: `src/docs/openapi.ts`
- Create: `src/docs/health.openapi.ts`
- Create: `src/modules/auth/auth.openapi.ts`
- Create: `src/modules/users/users.openapi.ts`
- Create: `src/modules/activities/activities.openapi.ts`
- Create: `src/docs/openapi.test.ts`

- [x] **Step 1: Write failing contract tests**

Create `src/docs/openapi.test.ts` asserting:

- The document builds and reports `openapi: '3.1.0'`.
- It contains exactly the expected `/api/v1` paths (11 operations).
- Private operations declare `security: [{ bearerAuth: [] }]`.
- Auth rate-limited operations document `429`.
- `components.schemas` includes the shared envelope/error schemas.

- [x] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/docs/openapi.test.ts`
Expected: FAIL because the document module does not exist.

- [x] **Step 3: Implement path fragments and the document**

Each `*.openapi.ts` exports a `ZodOpenApiPathsObject` fragment; `src/docs/openapi.ts` merges them, sets `info`, `tags`, `servers`, and `components.securitySchemes.bearerAuth`.

- [x] **Step 4: Add route coverage drift guard**

In `src/docs/openapi.test.ts`, assert that every route registered in `src/routes/index.ts` + `src/modules/auth/auth.routes.ts` appears in the document, using an explicit expected-list comparison so newly added routes fail the test until documented.

- [x] **Step 5: Run tests to verify they pass**

Run: `pnpm vitest run src/docs/openapi.test.ts && pnpm typecheck`
Expected: PASS.

### Task 4: Serve JSON and Scalar UI

**Files:**

- Modify: `src/config/env.ts`
- Modify: `src/app.ts`
- Modify: `src/routes/health.routes.test.ts` or create `src/app.test.ts`

- [x] **Step 1: Write failing endpoint tests**

Assert `GET /api/openapi.json` returns 200 with `openapi: '3.1.0'` when `DOCS_ENABLED` is true, and 404 when false. Keep the test environment deterministic via `vi.stubEnv`/module reset as the existing tests do.

- [x] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run src/app.test.ts`
Expected: FAIL with 404 for the docs route.

- [x] **Step 3: Implement `DOCS_ENABLED` and mounting**

Add `DOCS_ENABLED` to `env.ts` (default true in development/test, false in production) and mount the JSON endpoint plus `apiReference({ content: openApiDocument })` in `app.ts` before the not-found handler.

- [x] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/app.test.ts src/routes/health.routes.test.ts`
Expected: PASS.

### Task 5: Generation and drift-check scripts

**Files:**

- Create: `src/docs/generate.ts`
- Modify: `package.json`
- Create: `openapi.json`

- [x] **Step 1: Implement the generator**

`src/docs/generate.ts` imports `openApiDocument`, serializes it deterministically (`JSON.stringify(document, null, 2) + '\n'`), writes `openapi.json` at the repo root, and supports `--check` to fail when the committed file differs.

- [x] **Step 2: Add scripts**

Add `"docs:generate": "tsx src/docs/generate.ts"` and `"docs:check": "tsx src/docs/generate.ts --check"`.

- [x] **Step 3: Generate and verify idempotency**

Run: `pnpm docs:generate && pnpm docs:check`
Expected: `openapi.json` created; second run reports no drift.

- [x] **Step 4: Verify the full suite**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: PASS.

### Task 6: Document frontend consumption and repo usage

**Files:**

- Modify: `README.md`
- Modify: `AGENTS.md`
- Modify: `.env.example` (if present)

- [x] **Step 1: Document endpoints and workflow**

README section: Scalar UI at `/api/docs`, spec at `/api/openapi.json`, `pnpm docs:generate` + `docs:check`, and the contract-change workflow (regenerate, commit `openapi.json`, CI checks drift).

- [x] **Step 2: Document frontend typed client**

README section with `openapi-typescript` (strategy A) and live-endpoint (strategy B) commands plus an `openapi-fetch` usage example.

- [x] **Step 3: Update AGENTS.md and `.env.example`**

Add `DOCS_ENABLED` to the environment variables section and document the docs generation rule under API Design Rules.

## Verification Checklist

- [x] `pnpm docs:check` is clean after `pnpm docs:generate`.
- [x] `pnpm lint`, `pnpm typecheck`, `pnpm test` pass.
- [x] `/api/openapi.json` returns the versioned document; `/api/docs` renders Scalar.
- [x] Every route in `routes/index.ts` + `auth.routes.ts` is covered by the contract test.
- [x] No secrets, tokens, or internal Better Auth fields appear in the document.
