# Active Event Programs List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a public, paginated `GET /api/v1/event-programs` endpoint that returns active event programs and supports organizational-unit and text filters.

**Architecture:** Follow the existing event-program module and the public activities-list pattern. Validate query parameters with Zod, keep HTTP handling in the controller, build a typed Prisma `findMany`/`count` query in the service, and reuse the existing event-program DTO for list items.

**Tech Stack:** TypeScript, Express 5, Zod 4, Prisma 7, Vitest, zod-openapi, Bruno.

---

### Task 1: Query contract and pagination DTO

**Files:**

- Modify: `src/modules/event-programs/event-programs.types.ts`
- Modify: `src/modules/event-programs/event-programs.schemas.ts`
- Test: `src/modules/event-programs/event-programs.schemas.test.ts`

- [ ] Add failing tests for pagination defaults, coercion, filters, unknown query parameters, invalid limits and invalid unit types.
- [ ] Run the focused schema tests and confirm the new exports are missing.
- [ ] Add `ListEventProgramsQuery`, `PaginatedEventPrograms`, `listEventProgramsQuerySchema` and `paginatedEventProgramsSchema`.
- [ ] Re-run the schema tests and confirm they pass.

### Task 2: Paginated Prisma query

**Files:**

- Modify: `src/modules/event-programs/event-programs.service.ts`
- Test: `src/modules/event-programs/event-programs.service.test.ts`

- [ ] Add failing tests proving only `ACTIVE` programs are queried, pagination metadata is calculated, dates are serialized and optional filters are applied.
- [ ] Run the focused service tests and confirm `listEventPrograms` is missing.
- [ ] Implement `listEventPrograms` using `findMany` and `count`, stable name/id ordering and the existing public DTO mapper.
- [ ] Re-run the service tests and confirm they pass.

### Task 3: Public HTTP endpoint

**Files:**

- Modify: `src/controllers/event-programs.controller.ts`
- Modify: `src/routes/event-programs.routes.ts`
- Test: `src/routes/event-programs.routes.test.ts`

- [ ] Add failing route tests for anonymous access, default pagination, parsed filters and invalid query rejection.
- [ ] Run the focused route tests and confirm the GET route returns 404.
- [ ] Add `getEventPrograms` and register the validated public GET route without authentication middleware.
- [ ] Re-run the route tests and confirm they pass.

### Task 4: API contract and consumer documentation

**Files:**

- Modify: `src/modules/event-programs/event-programs.openapi.ts`
- Modify: `README.md`
- Modify: `CONTEXT.md`
- Regenerate: `openapi.json`
- Regenerate: `bruno/`

- [ ] Document the GET operation, its filters, success response and validation error.
- [ ] Update README and project context with the public-list behavior.
- [ ] Regenerate the OpenAPI document and Bruno collection.
- [ ] Verify the Bruno login post-response token capture remains intact.

### Task 5: Final verification

- [ ] Run `pnpm test`.
- [ ] Run `pnpm run typecheck`.
- [ ] Run `pnpm run lint`.
- [ ] Run `pnpm run docs:check`.
