# Plan: Carreras sin `isActive`, carrera global `OTROS` y unidad "Otro" (`unitId: null`)

Fecha: 2026-09-19
Estado: completado y verificado (2026-09-19)

## Objetivo

- Quitar `isActive` de `Career`; el catalogo de carreras no se mantiene al dia.
- Agregar una unica carrera global `Otros` (`OTROS`, `unitId` nullable) para
  usuarios cuya carrera no esta listada.
- Permitir que la facultad/unidad "Otro" se represente con `unitId: null`; al
  elegirla, la carrera queda forzada a `OTROS`.
- `OTROS` es global: seleccionable con cualquier unidad real; al cambiar a una
  unidad real se conserva.
- Sin fila de unidad "Otro": no hay programa de eventos predeterminado asociado.

## A. TDD: pruebas que fallan primero

- [x] `src/modules/users/users.service.test.ts`
  - [x] Reemplazar "rejects an unavailable career" por "rejects an unknown career" (`null` -> 400 `Career not found.`).
  - [x] Quitar `isActive` de los mocks de career.
  - [x] "accepts global OTROS with any real unit" (`career.unitId = null`).
  - [x] "unitId null (Otro) forces OTROS".
  - [x] "unitId null con careerId distinto" -> 400.
  - [x] "OTROS no existe en BD" + unitId null -> 409.
  - [x] "keeps global OTROS when switching to a real unit".
- [x] `src/modules/users/users.schemas.test.ts`: acepta `unitId: null`; sigue rechazando `""`.
- [x] `prisma/seed/base.seed.test.ts`: `OTROS` existe con `unitId = null`; conteo 25.
- [x] Verificar rojo por la razon esperada.

## B. Modelo y migracion

- [x] `prisma/schema.prisma` (`Career`): eliminar `isActive`; `unitId String?` + `unit OrganizationalUnit?`.
- [x] Migracion `remove_career_active_and_optional_unit`: `DROP COLUMN is_active` + `ALTER COLUMN unit_id DROP NOT NULL`.

## C. Seed

- [x] `prisma/seed/organizations.seed.ts`: `CareerCatalogEntry.unitKey: string | null`; quitar `isActive: true`; crear con `unitId: unit?.id ?? null`; agregar `OTROS` (`unitKey: null`) -> 25 carreras.

## D. Contrato y logica de usuarios

- [x] `users.schemas.ts`: `unitId` nullable opcional.
- [x] `users.types.ts`: `unitId?: string | null`.
- [x] `users.service.ts`:
  - [x] career lookup sin `isActive`; si no existe -> 400 `Career not found.`.
  - [x] coherencia/derivacion de unidad solo si `career.unitId !== null`.
  - [x] `unitId === null` -> forzar `OTROS`; conflicto -> 400; OTROS ausente -> 409.
  - [x] no borrar carrera global al cambiar de unidad.
- [x] Registro: sin cambios de validacion; documentar que el cliente envia `careerId` de OTROS cuando no envia unidad.

## E. Documentacion

- [x] ADR-0006 `docs/adr/adr-0006-global-careers-without-active-flag.md`.
- [x] `docs/er-diagram/ER-design-justification.md` y `er-diagram.drawio`.
- [x] `README.md`: 25 carreras, OTROS global, `unitId: null` = Otro y contrato del PATCH.
- [x] Plan maestro (2.B y 2.0.a) y `2026-09-19-seed-base-produccion.md` (24 -> 25).

## F. Verificacion

- [x] `pnpm prisma:validate`, `format`, `migrate dev`, `generate`.
- [x] `pnpm test`, `typecheck`, `lint`, `build`.
- [x] `pnpm run docs:generate` + `docs:check`; actualizar Bruno restaurando el script de login.
- [x] Seed demo dos veces (25 carreras, OTROS con `unit_id NULL`).
- [x] Seed base en BD desechable dos veces (idempotente).
- [x] `PATCH /users/me` real: `unitId: null` -> `career = Otros`; facultad real -> OTROS se conserva.
