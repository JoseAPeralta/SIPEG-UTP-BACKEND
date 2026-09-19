# Plan: códigos de check-in por inscripción + endpoint de crear actividad + OpenAPI

## Objetivo

Mover los códigos de check-in (`qrCode`/`manualCode`) desde la actividad hacia la
inscripción (`attendance`), unificándolos en un único `code` por inscripción, e
implementar `POST /api/v1/activities` documentado con OpenAPI 3.1 + Scalar.

## Decisiones

- Un código por inscripción (`attendance` = activity×user), generado al inscribirse.
- Se eliminan `Activity.qrCode` y `Activity.manualCode` (unificación real).
- `Attendance.usedCode` se elimina; el nuevo `code` es único global.
- Se conserva `Attendance.method` (QR/MANUAL).
- `POST /api/v1/activities` no genera códigos; crea en estado `DRAFT`.
- Documentación OpenAPI/Scalar completa.

## Modelo objetivo

- `Activity`: sin `qrCode`, sin `manualCode`, sin `@@unique([eventProgramId, manualCode])`.
- `Attendance`: `code String @unique @db.VarChar(64)`, sin `usedCode`.
- CHECK: `(checked_in_at IS NULL AND method IS NULL)` o
  `(checked_in_at IS NOT NULL AND method IS NOT NULL AND checked_in_at >= registered_at)`.

## Fase 1 - Schema, migración y seed

1. Editar `prisma/schema.prisma`.
2. Crear migración con backfill seguro (`gen_random_uuid()`), no reutilizar `used_code`.
3. Actualizar `prisma/seed/helpers.ts`, `activities.seed.ts`, `attendance.seed.ts`.
4. `pnpm prisma validate`, `prisma format`, `prisma generate`.

## Fase 2 - Endpoint `POST /api/v1/activities`

- `createActivitySchema` (body estricto, `endTime > startTime`, sin `status`).
- `activityDetailSchema` (`ActivityDetail`, sin códigos).
- `createActivity` service: programa existe/`ACTIVE`, rango de fechas (no-default),
  aula/ponente activos, `DRAFT`, equipamiento.
- Ruta: `authenticate -> requirePermission(activity:create, scope desde body) -> validate -> handler`.
- Tests de schemas, servicio y ruta.

## Fase 3 - OpenAPI/Scalar

- `health.schemas.ts`, fragmentos `*.openapi.ts`, `src/docs/openapi.ts`.
- `DOCS_ENABLED` en `env.ts`; montaje en `app.ts`.
- `openapi.test.ts` (12 operaciones, drift guard, Bearer).
- `src/docs/generate.ts` + scripts + `openapi.json`.

## Fase 4 - Documentación

- ADR-0004, ER docs, README, CONTEXT, AGENTS, `.env.example`.
- Follow-up: endpoint de inscripción/check-in que genere y valide `Attendance.code`.

## Fase 5 - Verificación

```
pnpm prisma validate
pnpm prisma generate
pnpm typecheck
pnpm lint
pnpm test
pnpm docs:generate && pnpm docs:check
```
