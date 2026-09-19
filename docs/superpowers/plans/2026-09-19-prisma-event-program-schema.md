# Prisma Event Program Schema Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the legacy event/small-event Prisma model with the approved 19-entity event-program/activity model on Prisma 7.10 and PostgreSQL 18.

**Architecture:** Prisma Schema Language defines models, relations, enums, indexes, and referential actions. A clean baseline migration adds PostgreSQL constraints unsupported by Prisma, while authorization is updated to query unified collaborations. The refresh-token authentication module was later removed entirely and is being rewritten from 0; `RefreshToken` is not part of the new schema.

**Tech Stack:** Node.js 24, TypeScript 6, Prisma ORM 7.10, PostgreSQL 18, Vitest, pnpm.

---

### Task 1: Authorization Contract Tests

**Files:**

- Modify: `src/services/authorization.service.test.ts`
- Modify: `src/middlewares/authorize.middleware.test.ts`

- [ ] Replace legacy Prisma mocks with `collaboration.findFirst` and `activity.findUnique`.
- [ ] Rename event-program authorization expectations to `resolveProgramAccess` and `requireProgramRole`.
- [ ] Expect activity access to combine local `activity.collaborations` with inherited `eventProgram.collaborations`.
- [ ] Run `pnpm exec vitest run src/services/authorization.service.test.ts src/middlewares/authorize.middleware.test.ts` and verify failure against the legacy implementation.

> Nota: este paso quedo obsoleto porque los archivos `authorization.service.test.ts` y `authorize.middleware.test.ts` fueron eliminados junto con su implementacion durante el purge de auth. Si se reimplementa la autorizacion basada en colaboraciones, deberan recrearse como parte del rewrite.

### Task 2: Prisma 7.10 Schema

**Files:**

- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `prisma/schema.prisma`

- [ ] Upgrade `prisma`, `@prisma/client`, and `@prisma/adapter-pg` to 7.10.x.
- [ ] Enable the `partialIndexes` preview feature on the `prisma-client` generator.
- [ ] Define the 9 approved enums and 19 domain models with snake-case table/column mappings.
- [ ] Preserve current scalar conventions: CUID identifiers, bounded strings, integer floors, ISO weekdays, minute durations, and `Timestamptz(3)` audit instants.
- [ ] Declare compound keys, ordinary indexes, partial unique indexes, and deliberate referential actions.
- [ ] Exclude `RefreshToken` and its `User` relation.
- [ ] Run `pnpm run prisma:format`, `pnpm run prisma:validate`, and `pnpm run prisma:generate`.

### Task 3: Clean PostgreSQL Baseline

**Files:**

- Delete: `prisma/migrations/20260513230500_add_users/migration.sql`
- Delete: `prisma/migrations/20260514220000_refactor_schema_to_english/migration.sql`
- Delete: `prisma/migrations/20260918221917_add_refresh_tokens_and_activity_collaborators/migration.sql`
- Create: `prisma/migrations/migration_lock.toml`
- Create: `prisma/migrations/20260919000000_initialize_event_program_schema/migration.sql`

- [ ] Generate an empty-to-schema PostgreSQL migration as the new baseline.
- [ ] Add named CHECK constraints for program ownership/metadata/status, collaboration scope, temporal ranges, capacities, attendance, proposal feedback, versions, availability, and alert targets.
- [ ] Add `btree_gist` and the partial classroom overlap exclusion constraint.
- [ ] Add trigger guards that prevent physical deletion of event programs and mutation of default identity/ownership.
- [ ] Do not add data conversion or backfill logic because the development database is explicitly disposable.

### Task 4: Authorization Implementation

**Files:**

- Modify: `src/services/authorization.service.ts`
- Modify: `src/middlewares/authorize.middleware.ts`

- [ ] Replace `EventRole` with `CollaborationRole`.
- [ ] Resolve program access through `collaboration.findFirst`, because partial unique indexes do not produce a Prisma unique selector.
- [ ] Resolve activity access through `activity.findUnique`, local collaborations, and the parent program collaboration.
- [ ] Rename middleware and route parameter terminology from event to event program.
- [ ] Run targeted authorization tests and verify they pass.

### Task 5: Database And Project Verification

**Files:**

- Verify: `prisma/schema.prisma`
- Verify: `prisma/migrations/20260919000000_initialize_event_program_schema/migration.sql`

- [ ] Start the isolated development PostgreSQL service if Docker is available.
- [ ] Reset the disposable schema and apply the clean baseline.
- [ ] Run `pnpm run prisma:migrate:status` and verify the database is current.
- [ ] Run targeted authorization tests, `pnpm run prisma:validate`, `pnpm run prisma:generate`, `pnpm run typecheck`, `pnpm run lint`, `pnpm test`, and `pnpm run build`.
- [ ] Record failures caused only by the intentionally deferred auth rewrite; do not add a temporary `RefreshToken` compatibility model.

> Nota: tras el purge de auth, los tests del modulo `users/` fallaran por imports rotos hacia `auth.middleware`. Esto es intencional y se resuelve reimplementando auth o eliminando/reescribiendo `users/`.
