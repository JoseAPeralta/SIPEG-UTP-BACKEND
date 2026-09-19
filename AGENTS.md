# AGENTS.md

## Purpose

- This file is the primary working agreement for agents operating in this repository.
- Apply the installed project skills as operational references, but always inspect the actual code, package versions, scripts, and existing patterns before making changes.
- The repository is intended to be the backend-only REST API for SIPEG UTP. Keep frontend work in a separate repository or folder.

## Project Overview

- **Type**: Backend REST API.
- **Scope of this repository**: Node.js backend only.
- **Frontend**: A separate React frontend will consume this API over HTTP.
- **Product goal**: Event management platform for users, event programs, activities, attendance, certificates, classrooms, speaker registration, reports, and statistics.
- **Runtime target**: Node.js 24.x LTS, or the latest active LTS available in the project environment.
- **Backend framework**: Express.
- **ORM**: Prisma.
- **Authentication**: Better Auth 1.7.x + plugin JWT. Modulos `auth`, `authorization` y `users` activos, con middlewares `authenticate`/`authorize`, rate limiting y utilitarios de tokens. Ver `docs/adr/adr-0001-time-aware-collaboration-authorization.md`.
- **Language**: TypeScript.
- **Package manager**: pnpm.

## Current Repository State

- This repository may be in an early scaffold state. If `src/`, `prisma/`, `tsconfig.json`, or expected scripts are missing, treat the sections below as target conventions rather than proof that the implementation already exists.
- Create missing project structure only when it is required by the task being implemented.
- Do not add placeholder code, empty abstractions, or dependencies just to match the target structure.
- If current files contradict this document, preserve user work and ask only when the contradiction blocks the requested task.

## Installed Project Skills

Use these skills as the source of project-specific operating knowledge:

- `writing-plans`: Use for specs or multi-step work before touching code. Plans should map files, include concrete steps, include test commands, avoid placeholders, and be saved under `docs/superpowers/plans/YYYY-MM-DD-<feature-name>.md` unless the user chooses another location.
- `executing-plans`: Use when a written plan exists. Review it critically first, track progress with todos, follow steps exactly, run verifications, and stop on unclear instructions or repeated verification failures.
- `test-driven-development`: Use for new features, bug fixes, refactors, and behavior changes. Write a failing test first, verify the failure, implement the minimum code to pass, then refactor while tests stay green. Documentation-only and simple configuration-only updates do not require TDD unless behavior is affected.
- `nodejs-backend-patterns`: Use for Express backend structure, middleware, controllers, services, repositories, error handling, logging, health checks, graceful shutdown, database access, and API response patterns.
- `secure-code-guardian`: Use for authentication, authorization, JWTs, password hashing, CORS/CSP/security headers, input validation, OWASP prevention, encryption, and secure session management. Aplicar cuando se reimplementen los modulos de auth y autorizacion que hoy estan eliminados.
- `api-security-best-practices`: Use for new or modified API endpoints, API security reviews, rate limiting, throttling, data protection, and common API attack prevention.
- `prisma-cli`: Use before running Prisma CLI commands such as `prisma init`, `generate`, `migrate`, `db`, `studio`, `validate`, `format`, or `debug`.
- `prisma-client-api`: Use when writing Prisma Client CRUD operations, filters, relation queries, `select`/`include`/`omit`, pagination, raw queries, or transactions.
- `prisma-database-setup`: Use when configuring or changing database providers, connection strings, Prisma Client generation, adapters, or troubleshooting connections.
- `prisma-postgres`: Use only for Prisma Postgres provisioning, Console workflows, `create-db`, `prisma postgres link`, Management API, or related SDK work.
- `typescript-expert`: Use for TypeScript setup, strictness, module resolution, migration, compile errors, type performance, and TypeScript/JavaScript tooling decisions.
- `typescript-advanced-types`: Use for complex generic logic, conditional/mapped/template literal types, type-safe API contracts, reusable type utilities, and type tests.
- `multi-stage-dockerfile`: Use when adding or changing Dockerfiles. Prefer multi-stage builds, minimal runtime images, non-root users, `.dockerignore`, reproducible tags, and health checks.
- `architecture-blueprint-generator`: Use when asked to document or analyze the architecture. Generate architecture blueprints from the actual codebase, not from desired theory.
- `create-architectural-decision-record`: Use when documenting a significant architectural decision. Save ADRs under `docs/adr/adr-NNNN-<title-slug>.md` with the required template.
- `git-commit`: Use only when the user explicitly asks for a commit. Analyze the actual diff, avoid secrets, stage one logical change, and use Conventional Commits.

## General Workflow Rules

- Inspect existing files before editing.
- Preserve existing user changes. Never revert, delete, or overwrite unrelated work unless explicitly requested.
- Make the smallest correct change that satisfies the task.
- Prefer locality, clear seams, and simple functions over premature abstraction.
- Do not add libraries unless there is a concrete reason and the existing stack cannot reasonably solve the task.
- Do not invent product rules. If a business rule is ambiguous, implement the safest minimal behavior or ask one concise question when ambiguity blocks progress.
- Do not commit, push, amend, force-push, or modify git config unless the user explicitly asks.
- Do not run destructive commands such as `git reset --hard` or `git checkout --` unless explicitly requested and confirmed.
- Keep backend and frontend concerns separated.

## Development Commands

Target commands for a complete backend project:

```bash
pnpm install
pnpm run dev
pnpm run build
pnpm run start
pnpm run lint
pnpm test
pnpm run test:coverage
pnpm run docs:generate
pnpm run docs:check
pnpm run api:collection:import
pnpm run api:run:smoke
pnpm run api:run
pnpm prisma generate
pnpm prisma validate
pnpm prisma format
pnpm prisma migrate dev
pnpm prisma migrate deploy
pnpm prisma studio
pnpm prisma db seed
```

Rules:

- If a command is not configured yet, add it only when needed by the task.
- Prefer existing project scripts over raw tools once scripts exist.
- Use one-shot validation commands. Avoid watch or long-running development servers unless the user asks.
- Run `pnpm test` when adding or modifying tested behavior.
- Run `pnpm run build` or `pnpm exec tsc --noEmit` before considering substantial TypeScript changes complete when tooling is configured.
- Run `pnpm run docs:generate` after changing routes, request schemas, or response schemas, and commit `openapi.json` with the change. Run `pnpm run docs:check` to detect drift.
- `bruno/` is the versioned HTTP client collection imported from `openapi.json`. `pnpm run api:collection:import` is destructive and overwrites manual collection changes, including the login token-capture script.
- Prefer `pnpm run api:run:smoke` for safe connectivity checks. The full `pnpm run api:run` includes state-changing requests and must not target production without explicit user approval.
- Bruno MCP is pinned to an exact commit of the official `usebruno/bruno-mcp` repository until an npm release exists. Inspect requests before POST/PATCH/DELETE, and fall back to the pnpm/Bruno CLI scripts if MCP is unavailable.

## Expected Backend Structure

```txt
src/
|-- app.ts
|-- server.ts
|-- config/
|   |-- env.ts
|   `-- prisma.ts
|-- modules/
|   |-- organizational-units/
|   |-- careers/
|   |-- permissions/
|   |-- event-programs/
|   |-- activities/
|   |-- attendance/
|   |-- certificates/
|   |-- classrooms/
|   |-- speakers/
|   `-- reports/
|-- middlewares/
|   |-- error.middleware.ts
|   |-- notFound.middleware.ts
|   `-- validate.middleware.ts
|-- utils/
|   |-- ApiError.ts
|   |-- asyncHandler.ts
|   `-- response.ts
|-- types/
`-- tests/

prisma/
|-- schema.prisma
|-- migrations/
`-- seed.ts
```

> Estado actual: modulos `auth`, `authorization`, `users` y `activities` implementados, ademas de la infraestructura OpenAPI/Scalar. La estructura objetivo queda como referencia para los siguientes modulos; las carpetas se crean unicamente cuando la tarea lo requiere, siguiendo la regla "Do not add placeholder code...".

Rules:

- Follow existing structure when it exists.
- Keep files focused. Split only when it improves clarity or testability.
- Keep controllers focused on HTTP concerns: DTO extraction, status codes, response shape, and delegating to services.
- Keep services focused on business rules.
- Keep Prisma database access out of controllers.
- Prefer a repository layer only when query complexity, reuse, or testing pressure justifies it.
- Do not place business logic directly inside route files.

## Environment Variables

Required variables should be documented in `.env.example` when the backend is configured:

```txt
NODE_ENV=development
PORT=3000
DATABASE_URL=""
CORS_ORIGIN="http://localhost:5173"
DOCS_ENABLED=true
```

Rules:

- Never commit `.env` files.
- Always keep `.env.example` updated when adding, removing, or renaming environment variables.
- Do not hardcode secrets, database URLs, tokens, email credentials, or private service keys.
- Validate required environment variables when the application starts.
- Do not log environment values that may contain secrets.

## Backend Architecture Rules

- Use Express for HTTP routing.
- Keep `server.ts` responsible for starting the HTTP server and handling graceful shutdown.
- Keep `app.ts` responsible for configuring Express, global middleware, routes, not-found handling, and error handling.
- Use modular domain folders for users, organizational units, careers, permissions, event programs, activities, attendance, certificates, classrooms, speakers, and reports.
- Route files should only wire paths, validation, middleware, and controller handlers.
- Controllers should not call Prisma directly.
- Services should enforce business rules and authorization-sensitive decisions.
- Shared utilities should stay small and generic.
- Calculate business calendar dates in the institutional time zone `America/Panama` (UTC-5, no DST) via `src/utils/date.ts`; keep audit instants in UTC. See `docs/adr/adr-0002-institutional-timezone-panama.md`.
- Implement health checks when deployment or container work needs them.
- Use structured logging when logging is added, and never log passwords, tokens, authorization headers, database URLs, CV contents, or private environment variables.

## API Design Rules

- Prefer REST endpoints under a versioned prefix such as `/api/v1`.
- Use plural resource names: `/users`, `/event-programs`, `/activities`, `/attendance`, `/classrooms`, `/speakers`, `/reports`.
- Use HTTP methods consistently:
  - `GET` for reading.
  - `POST` for creation and operations that change server state.
  - `PATCH` for partial updates.
  - `PUT` only when full replacement is intended.
  - `DELETE` for deletion.
- Use appropriate HTTP status codes.
- Return consistent JSON responses unless an existing convention already exists:

```json
{
  "success": true,
  "message": "Operation completed successfully.",
  "data": {}
}
```

For errors:

```json
{
  "success": false,
  "message": "Validation error.",
  "errors": []
}
```

- Use pagination for list endpoints that can grow.
- Prefer cursor pagination for large or frequently changing lists; offset pagination is acceptable for simple administrative lists.
- Use filters for event-program and activity lists, reports, attendance records, organizational units, careers, and classroom availability.
- Document endpoints with the code-first OpenAPI 3.1 pipeline: Zod schemas are the single source of truth, `zod-openapi` builds the document, and `pnpm run docs:generate` writes `openapi.json`.
- Keep public request and response schemas in the module `*.schemas.ts`; never document raw Prisma models or internal Better Auth fields. Fixed component names come from `.meta({ id })` and are breaking changes for the frontend when renamed.
- Serve the contract at `/api/openapi.json` and the Scalar UI at `/api/docs`, gated by `DOCS_ENABLED` (default enabled outside production).
- Keep the Bruno collection under `bruno/` aligned with `openapi.json`; after a destructive import, restore the login post-response script that captures `data.accessToken` and `data.refreshToken`.
- Never commit real Bruno tokens or production credentials. Use ignored `bruno/environments/*.private.bru` overrides or runtime variables.
- Do not return password hashes, refresh tokens, JWT internals, raw database errors, internal-only IDs, or sensitive audit information.
- Keep frontend URLs out of controllers except for explicitly configured redirects or CORS rules.

## Prisma Rules

- Use Prisma Client through a centralized instance, preferably `src/config/prisma.ts`.
- Do not instantiate Prisma Client repeatedly across modules.
- Inspect the installed Prisma version and existing generator before applying Prisma examples. Do not migrate Prisma major versions as a side effect of a feature.
- For Prisma 7 SQL setups, expect `prisma.config.ts`, explicit generator output, and driver adapters such as `@prisma/adapter-pg` when appropriate.
- For Prisma 6 or `prisma-client-js` setups, follow the existing project pattern unless a migration is explicitly requested.
- For MongoDB projects, do not apply SQL adapter guidance.
- Keep all schema changes in `prisma/schema.prisma` and generate migrations when schema changes are part of the task.
- Run `pnpm prisma validate` and `pnpm prisma format` after meaningful schema edits when Prisma is configured.
- Run `pnpm prisma generate` after changing the Prisma schema.
- Use `pnpm prisma migrate dev` during development when creating migrations.
- Use `pnpm prisma migrate deploy` for production deployment flows.
- Commit Prisma migrations when schema changes are part of the requested work and the user asks for a commit.
- Use `select` or `omit` to avoid returning sensitive fields.
- Use transactions for multi-step writes that must succeed or fail together.
- Avoid raw SQL unless there is a concrete, documented reason.
- When raw SQL is necessary, use Prisma safe raw APIs and never interpolate untrusted strings.
- Use relations, indexes, unique constraints, and enums where they improve data integrity.
- Use soft delete only if the domain requires recoverability or auditability; otherwise implement deletion clearly and safely.

## Authentication And Authorization Rules

- Stack: proveedor de auth modular con env vars **library-agnostic** (`AUTH_*`). Internamente usa Better Auth 1.7.x + plugin JWT. Si se reemplaza el proveedor, las env vars no cambian.
- Password hashing: **Argon2id** (OWASP Password Storage Cheat Sheet, parametros `t=2, m=19 MiB, p=1`). Configurable opcionalmente via `AUTH_ARGON2_MEMORY_COST`, `AUTH_ARGON2_TIME_COST`, `AUTH_ARGON2_PARALLELISM`.
- Sesiones del proveedor = refresh tokens (vida 7 dias por defecto). Rotacion automatica, revocacion server-side inmediata via delete en `sessions`.
- Access tokens: JWT EdDSA Ed25519 (vida 15 min por defecto), firmados con la clave privada del JWKS almacenado en la tabla `jwks`. Validados contra `/api/auth/jwks` cacheado con jose (`createRemoteJWKSet`). La API privada es stateless.
- Algoritmos JWT permitidos en el verifier: solo `['EdDSA']`. Issuer/Audience validados contra `AUTH_ISSUER`/`AUTH_AUDIENCE` (default = `AUTH_URL`).
- Variables de entorno relevantes:
  - `AUTH_SECRET` (requerido, >=32 chars) — secreto de Better Auth para cookies y cifrado simetrico
  - `AUTH_URL` (default `http://localhost:3000`)
  - `AUTH_ISSUER`, `AUTH_AUDIENCE` (default = `AUTH_URL`)
  - `AUTH_TOKEN_TTL` (default `15m`), `AUTH_REFRESH_TTL` (default `7d`)
  - `TRUSTED_ORIGINS` (CSV adicional a `CORS_ORIGIN`)
- Rate limiting (via express-rate-limit):
  - Login: 5/min por usuario/IP
  - Register: 3/min por usuario/IP
  - Password reset: 3/min por usuario/IP
  - Better Auth rate limit global: 100/min (configurable)
- `src/lib/auth.ts` es la unica instancia del proveedor.
- `src/lib/password.ts` centraliza hashing Argon2id (usado por el proveedor via `password.hash`/`password.verify`).
- `src/utils/jwt-verifier.ts` es el unico verificador de access tokens.
- `src/middlewares/authenticate.middleware.ts` carga `req.user` desde DB usando solo el `sub` del JWT.
- `src/middlewares/authorize.middleware.ts` provee `requireRole`, `requireAdmin`, `requireOwnership` y `requirePermission`.
- Orden recomendado de middlewares en rutas privadas:
  `authenticate -> requirePermission/requireRole/requireOwnership -> validate(schema) -> controller`.

### Modelo de Autorizacion Por Colaboracion

- Fuente de verdad: `GlobalRole` (`USER`/`ADMIN`), `Collaboration` (scope programa o actividad), `CollaborationRole` (`ORGANIZER`/`EDITOR`/`VIEWER`), catalogo `Permission` y `CollaborationPermission`.
- Catalogo canonico y defaults en `src/modules/authorization/permissions.ts`. Formato de clave `recurso:accion`. `permission:grant` no esta en ningun default de rol: se concede manualmente.
- Permisos efectivos en un scope = union aditiva de las colaboraciones de la actividad y de su programa padre, filtrada por ventana vigente. No hay `DENY` local; un permiso heredado no se puede revocar en la actividad.
- Resolutor: `getEffectivePermissions` / `getPermissionEnvelopes` en `src/modules/authorization/authorization.service.ts`. `ADMIN` hace bypass total.
- Ventana temporal por permiso: `validFrom`/`validUntil` en `collaboration_permissions`. `NULL` = sin limite de ese lado. Los grants vencidos se ignoran y no se borran (historico). CHECK `valid_until > valid_from`.
- `source` distingue `ROLE_DEFAULT` (materializado al asignar rol) de `OVERRIDE` (ajuste fino). Cambiar de rol reemplaza los `ROLE_DEFAULT` y preserva los `OVERRIDE`.
- Delegacion en `src/modules/authorization/delegation.service.ts`: `addCollaborator`, `updateCollaboratorRole`, `removeCollaborator`, `grantPermission`, `revokePermission`.
- Invariante de subconjunto simetrico: otorgar, revocar y asignar rol exigen que el conjunto actuado este contenido en los permisos efectivos del actor en el mismo scope. `permission:grant` se puede delegar si el actor lo posee.
- Atenuacion temporal: la ventana otorgada debe quedar dentro del envelope del actor para ese permiso; un envelope acotado prohibe grants sin limite.
- No ampliacion de scope: un permiso de actividad no permite gestionar el programa padre.
- Todo grant registra `grantedById` y `grantedAt`. No exponer estos campos internos innecesariamente.
- El catalogo se puebla con `pnpm prisma:seed` (idempotente).

- Passwords: 12-128 chars, hasheados con Argon2id. El campo `passwordHash` en User fue eliminado; Better Auth usa `Account.password`.
- **No devolver** password hashes, hashes Argon2, tokens internos, ni `name` (campo interno de Better Auth).
- **No loguear** tokens, headers `Authorization`, passwords ni env vars con secretos.
- En startup, `ensureJwks()` se asegura de que la tabla `jwks` tenga al menos una fila para firmar access tokens.

## Security Rules

- Follow secure-by-default backend practices aligned with OWASP API Security Top 10.
- Threat-model new authentication, authorization, file upload, report export, and public form flows before implementation.
- Validate and sanitize all incoming data.
- Validate route params, query params, request bodies, and file uploads before service logic.
- Prefer allowlists over blocklists.
- Restrict file uploads by type, size, destination, and expected content. CV uploads must not execute or be publicly served without safe controls.
- Use CORS with explicit allowed origins.
- Do not use wildcard CORS in production.
- Add rate limiting for authentication, registration, speaker submission, QR attendance, manual attendance codes, public forms, and expensive reports.
- Add security headers when appropriate, typically with Helmet for Express.
- Use centralized error handling.
- Avoid exposing implementation details in error messages.
- Use HTTPS in production.
- Consider audit logs for sensitive administrative actions such as archiving event programs, deleting activities, modifying permissions, exporting reports, and generating certificates.
- Log security-relevant events such as failed authentication, blocked authorization, suspicious upload attempts, and rate-limit triggers without logging secrets or sensitive payloads.

## Validation Rules

- Validate all inputs before they reach service logic.
- Prefer schema-based validation if a validation library is already installed.
- Keep validation schemas close to each module, for example `*.schemas.ts`.
- Return clear validation errors without leaking internal details or echoing unsafe raw input.
- Validate dates, times, activity capacity, classroom capacity, email format, role values, permission values, enum values, pagination bounds, file metadata, and report filters.
- Do not rely only on frontend validation.

## Error Handling Rules

- Use centralized error handling middleware.
- Use custom application errors for expected failures.
- Return predictable status codes and messages.
- Do not throw plain strings.
- Do not duplicate try/catch blocks when an `asyncHandler` or equivalent pattern exists.
- Handle Prisma known request errors explicitly when they affect user-facing behavior, such as unique constraint violations or missing records.
- Do not expose stack traces, raw database errors, JWT internals, or sensitive values in API responses.

## TypeScript Rules

- Prefer strict TypeScript configuration when the project is initialized.
- Use `unknown` instead of `any` for untrusted or external data.
- Avoid type assertions unless they are justified and local.
- Prefer `interface` for object shapes and `type` for unions, mapped types, and complex utility types.
- Use discriminated unions for state or result variants when they simplify control flow.
- Keep public API return types explicit.
- Co-locate simple module-specific types with the module. Move shared types to `src/types` only when they are reused.
- Avoid global type augmentation unless required by framework integration, such as Express request user typing.
- Do not introduce advanced types when plain interfaces are clearer.
- Add type tests only for complex type utilities or API contracts where runtime tests cannot cover correctness.

## Testing Rules

- Use TDD for features, bug fixes, refactors, and behavior changes.
- A behavior change should start with a failing test that proves the expected behavior or reproduces the bug.
- Verify the test fails for the expected reason before implementing production code.
- Write the minimum code needed to pass, then refactor while tests remain green.
- Add tests for meaningful backend behavior.
- Test services, middleware, and critical routes.
- Include authentication and authorization tests for protected endpoints.
- Include validation tests for required fields and invalid payloads.
- Include security tests for horizontal authorization, invalid credentials, expired or invalid tokens, rate-limited flows, and unsafe file uploads when those features exist.
- Include Prisma-related tests only with an isolated test database or a controlled testing strategy.
- Do not run tests against production data.
- Documentation-only changes do not require tests.

## Docker Rules

- Use the `multi-stage-dockerfile` skill when adding or changing Dockerfiles.
- Use multi-stage builds: dependencies, build/test, then minimal runtime.
- Pin base image versions instead of using floating tags.
- Use a non-root runtime user.
- Copy only required runtime artifacts.
- Add `.dockerignore` when adding Docker support.
- Set `NODE_ENV=production` in runtime images.
- Add a health check when the deployed API needs container health reporting.
- Do not include build secrets, `.env`, development caches, or source maps in runtime images unless explicitly required.

## Documentation Rules

- Keep `AGENTS.md`, `CONTEXT.md`, `.env.example`, API contracts, and README docs aligned when behavior or setup changes.
- If API response contracts change, document the effect for the frontend integration.
- Create ADRs for significant architectural decisions using `docs/adr/adr-NNNN-<title-slug>.md`.
- Generate architecture blueprints only from actual code and configuration.
- Avoid stale TODOs. If a future task is important, document it as a clear follow-up rather than adding vague placeholders.

## Backend Boundary

- The frontend will consume this backend through HTTP APIs.
- Do not import frontend code into this backend.
- Do not add React, Chakra UI, Vite frontend pages, browser components, Zustand stores, or frontend state management here.
- Do not hardcode frontend component names, UI libraries, or browser-only APIs in backend modules.
- Backend code should expose stable API contracts and avoid frontend-specific assumptions.
- Keep frontend integration concerns limited to CORS, API contracts, OpenAPI documentation if added, response formats, and explicitly configured redirects when required.
- Keep API base URLs configurable from the frontend side.

## Expected Product Features

### User Management

- Create users.
- Authenticate users.
- Manage user sessions or token refresh when required.
- Send email notifications if an email service is configured.
- Select organizational unit.
- Select career.
- Modify user data.
- Assign permissions in event programs and activities.
- Manage roles and permissions securely.

### Event Programs And Activities

- Treat an event program as the mandatory organizational parent of activities.
- Create one permanent default event program automatically for every organizational unit (faculty or subdirectorate).
- Keep the default flag and owning organizational unit immutable for default event programs.
- Allow only site administrators to create additional event programs.
- Associate each event program with exactly one organizational unit.
- Default event programs do not require start or end dates; additional programs include name, dates, custom label, and banner.
- Add collaborators and permissions to event programs.
- Event-program collaborators and permissions are inherited by their activities by default.
- Create activities only inside an existing event program.
- Allow new activities only in active event programs.
- Activities include name, type, one or more speakers, classroom, date, time, required equipment, and banner.
- Add collaborators and permissions directly to activities when local access is required.
- Expose inherited and local permissions through the API with an explicit precedence rule.
- Archive event programs instead of deleting them physically.
- Prohibit physical deletion of event programs, including empty programs.
- Do not archive an additional event program while it has scheduled or ongoing activities.
- Do not archive a default event program while its organizational unit remains active.
- Reactivate an organizational unit and its existing default event program atomically.
- Delete or cancel activities according to the applicable retention rule.
- Before modifying, cancelling, or deleting an activity, support an option to notify registered attendees.
- Provide event-program and activity list endpoints.
- Provide available and past activity endpoints or filters.
- Allow filtering by organizational unit and unit type.
- Prioritize or filter activities through the organizational unit of their event program.

### Attendance

- Allow an attendance record to represent registration before check-in and presence after check-in.
- Register attendance for a specific activity.
- Store a single per-registration `code` (unique global) on `attendance`; it is the QR/manual check-in validation method. See `docs/adr/adr-0004-attendance-checkin-codes.md`.
- Support QR code attendance.
- Support manual attendance codes (`method` records `QR`/`MANUAL`).
- Prevent duplicate attendance records when the business rule requires unique attendance per user and activity.
- Validate activity availability before accepting attendance.
- Keep attendance operations auditable when possible.

### Certificates

- Generate attendance certificates automatically when the activity rules are met.
- Generate certificates from the attendance list.
- Store certificate metadata.
- Avoid regenerating duplicate certificates unless explicitly requested.
- Protect certificate generation endpoints with authorization rules.

### Classroom Inventory

- Manage available classrooms.
- Classroom types include laboratory and classroom.
- Store available hours.
- Store available days.
- Store maximum capacity.
- Store amenities such as projector, desks, tables, smart board, and whiteboard.
- Validate classroom availability before assigning it to an activity.

### Speaker Registration

- Provide a speaker registration endpoint.
- Allow speakers to submit proposals without a platform account; the `speakers` catalog links a `userId` only when an account exists.
- Capture first name and last name.
- Capture email.
- Capture CV.
- Capture approximate duration.
- Capture talk type such as workshop, seminar, or similar.
- Capture proposal title and content.
- Capture submission date.
- Preserve an immutable version history when the speaker updates a proposal.
- Allow authorized program collaborators to provide proposal feedback as text or an image.
- Notify the speaker and responsible collaborators when proposals are submitted, updated, or answered.
- Optionally forward the form to a specific email if email service is configured.
- Specify the event program the speaker is applying to.
- Validate and restrict uploaded CV files.

### Reports And Statistics

- Provide attendance numbers.
- Provide event-program and activity participation statistics.
- Export reports to Excel if export support is implemented.
- Export reports to PDF if export support is implemented.
- Protect report export endpoints with authorization rules.
- Avoid exposing personal data in reports unless the requesting user is authorized.

## Completion Checklist For Agents

- Existing files were inspected before editing.
- Changes are scoped to the user request.
- Backend-only boundary is preserved.
- Security and validation implications were considered.
- Tests or build/type checks were run when behavior or TypeScript implementation changed and tooling exists.
- Documentation and `.env.example` were updated when setup or API contracts changed.
- No secrets, `.env` files, generated Prisma Client files, or unrelated user changes were committed or modified.
