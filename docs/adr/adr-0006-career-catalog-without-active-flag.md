---
title: 'ADR-0006: Catálogo de carreras sin isActive y opción global Otros'
status: 'Accepted'
date: '2026-09-19'
authors: 'Equipo backend SIPEG UTP'
tags: ['architecture', 'database', 'prisma', 'careers', 'seed']
supersedes: ''
superseded_by: ''
---

# ADR-0006: Catálogo de carreras sin isActive y opción global Otros

## Status

**Accepted**

## Context

El plan maestro de Fase 2.B asumía un catálogo de carreras administrable con
desactivación (`isActive`), similar a unidades organizativas y aulas. En la
práctica:

- Mantener el catálogo al día con la oferta académica oficial (que cambia cada
  año y por centro regional) tiene un costo alto y no aporta al objetivo del
  sistema.
- Faltaban carreras de varias facultades y surgió la necesidad de una opción
  "Otros" para usuarios cuya carrera no está listada.
- La facultad/unidad también debía ofrecer una opción "Otro"; `User.unitId` ya
  es opcional y `null` ya representa "sin unidad", por lo que no hacía falta una
  fila nueva en `organizational_units` ni un valor nuevo en `UnitType`.
- `Career.unitId` era obligatorio (`NOT NULL`), lo que impedía una carrera global
  seleccionable desde cualquier facultad.

## Decision

- **Eliminar `Career.isActive`.** El catálogo de carreras no se mantiene al día;
  no hay desactivación. Una carrera solo podrá eliminarse físicamente si no
  tiene usuarios asociados (la relación `users.career_id` usa `ON DELETE SET
NULL`, por lo que la regla se aplicará en la capa de servicio durante Fase
  2.B; con usuarios asociados la operación responderá 409).
- **`Career.unitId` pasa a ser opcional.** Una carrera con `unit_id` nulo es
  global. Se siembra una única carrera global `Otros` (código `OTROS`).
- **Facultad "Otro" = `User.unitId` nulo.** No se crea fila en
  `organizational_units`, no se toca `UnitType` y no existe programa de eventos
  predeterminado para "Otro".
- **Regla de implicación:** al enviar `unitId: null` en `PATCH /api/v1/users/me`
  la carrera queda forzada a `OTROS`; si el cliente envía una carrera distinta,
  responde 400; si `OTROS` no existe en la base, responde 409.
- **`OTROS` es global:** puede seleccionarse junto a cualquier unidad real y se
  conserva al cambiar a una unidad real (la limpieza de carrera al cambiar de
  unidad solo aplica a carreras con unidad propia).
- **Registro:** no cambia su validación actual; el cliente debe enviar el
  `careerId` de `OTROS` cuando no envíe unidad (Better Auth no acepta `null` en
  `additionalFields`).

## Consequences

### Positive

- **POS-001**: Desaparece el mantenimiento del catálogo de carreras; la opción
  `Otros` cubre cualquier carrera no listada.
- **POS-002**: Sin fila de unidad "Otro" no hay que tocar `UnitType`, filtros de
  programas ni la invariante unidad → programa predeterminado.
- **POS-003**: `OTROS` global evita duplicar la opción por facultad.
- **POS-004**: Los usuarios existentes conservan su `career_id`; la migración
  solo elimina una columna y relaja `NOT NULL`.

### Negative

- **NEG-001**: Los listados de carreras ya no pueden filtrar por estado; toda
  carrera del catálogo es seleccionable.
- **NEG-002**: `PATCH /users/me` cambia de contrato: `unitId` acepta `null`.
  Requiere regenerar OpenAPI y actualizar Bruno.
- **NEG-003**: La base sin seed no tiene `OTROS`; el servicio responde 409 hasta
  que el seed base (o un admin) cree la carrera.
- **NEG-004**: El registro público no valida la coherencia unidad-carrera hoy;
  queda como deuda para la Fase 1/2 si se desea simetría con el PATCH.

## Alternatives Considered

### Expandir el catálogo con la oferta oficial 2026

- **ALT-001**: **Description**: Cargar las 27 licenciaturas faltantes (y
  opcionalmente técnicos) según la oferta UTP.
- **ALT-002**: **Rejection Reason**: Alto costo de mantenimiento anual y por
  centro regional; no garantiza que el catálogo quede completo. Se descartó
  explícitamente.

### Fila real "Otro" en organizational_units

- **ALT-003**: **Description**: Crear una unidad `OTRO` con nuevo
  `UnitType.OTHER` o reutilizando `FACULTY`.
- **ALT-004**: **Rejection Reason**: Obliga a migrar el enum, actualizar filtros
  `unitType` en API/OpenAPI/Bruno y decidir si lleva programa predeterminado.
  `unitId: null` ya representa la ausencia de unidad sin costo adicional.

### Una carrera "Otros" por unidad

- **ALT-005**: **Description**: Sembrar 10 filas `OTROS-<unidad>` para mantener
  `unitId` obligatorio.
- **ALT-006**: **Rejection Reason**: Duplica la opción, ensucia los listados y
  contradice la decisión de una única carrera global.

### Mantener `isActive` solo para desactivar carreras obsoletas

- **ALT-007**: **Description**: Conservar la columna para desactivar carreras
  retiradas (por ejemplo `FIE-CTR`).
- **ALT-008**: **Rejection Reason**: El catálogo es estable y la desactivación no
  era un requisito real; quitarla simplifica modelo, seed y futura API.

## Implementation Notes

- **IMP-001**: Migración
  `prisma/migrations/20260920014035_remove_career_active_and_optional_unit/`
  ejecuta `ALTER TABLE "careers" DROP COLUMN "is_active"` y
  `ALTER COLUMN "unit_id" DROP NOT NULL`.
- **IMP-002**: `prisma/seed/organizations.seed.ts` agrega
  `{ key: 'otros', code: 'OTROS', name: 'Otros', unitKey: null }` y crea
  carreras con `unitId: unit?.id ?? null` (25 carreras en total).
- **IMP-003**: `src/modules/users/users.service.ts` fuerza `OTROS` cuando
  `unitId === null`, valida `Career not found.` (400) y trata las carreras
  globales como universales.
- **IMP-004**: `updateProfileSchema` acepta `unitId: null`; OpenAPI regenerado.
- **IMP-005**: Criterio de éxito: `pnpm test`, `typecheck`, `lint`, `build`,
  `docs:check`, seeds idempotentes y `PATCH /users/me` real con `unitId: null`.

## References

- **REF-001**: `docs/superpowers/plans/2026-09-19-carreras-unidad-otro.md`.
- **REF-002**: `docs/superpowers/plans/plan-maestro-sipeg-utp.md` (Fase 2.B).
- **REF-003**: `prisma/schema.prisma` (`Career`), `prisma/seed/organizations.seed.ts`.
- **REF-004**: `src/modules/users/users.service.ts`, `users.schemas.ts`.
