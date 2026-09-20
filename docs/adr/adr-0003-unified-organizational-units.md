---
title: 'ADR-0003: Unificación de unidades organizativas'
status: 'Accepted'
date: '2026-09-19'
authors: 'Equipo backend SIPEG UTP'
tags: ['architecture', 'database', 'prisma', 'organizational-units']
supersedes: ''
superseded_by: ''
---

# ADR-0003: Unificación de unidades organizativas

## Status

**Accepted**

## Context

El diseño ER original modelaba `faculties` y `subdirectorates` como dos catálogos separados con atributos idénticos (`name`, `code`, `description`, `is_active`, timestamps). `event_programs` referenciaba a ambas mediante dos FKs opcionales protegidas por un CHECK XOR, y `users` y `careers` solo podían apuntar a facultades.

Esa estructura presentaba límites concretos:

- Cada nueva clase de unidad (direcciones, centros regionales, vicerrectorías) exigía una tabla nueva, una FK nueva en `event_programs` y reescribir el CHECK XOR, los índices parciales y los triggers de archivado/reactivación.
- La unicidad del programa predeterminado requería un índice parcial por cada tabla propietaria.
- La distinción entre facultad y subdirección era una diferencia de tipo, no de atributos, por lo que duplicar tablas no aportaba integridad.

## Decision

Unificar los catálogos en un único modelo `OrganizationalUnit` (tabla `organizational_units`) con un enum `UnitType` (`FACULTY`, `SUBDIRECTORATE`) y colapsar la propiedad de los programas en una sola FK obligatoria `EventProgram.organizationalUnitId`.

- `users.unit_id` y `careers.unit_id` reemplazan `faculty_id`; el contrato público (JWT y API) usa `unitId`/`unit`.
- `organizational_units.head_id` es una FK opcional hacia `users` (`ON DELETE SET NULL`) que registra al encargado de la unidad.
- La unicidad del programa predeterminado pasa a un único índice parcial `event_programs_default_unit_key` sobre `organizational_unit_id` `WHERE is_default`.
- El CHECK XOR se elimina; la FK `NOT NULL` con `ON DELETE RESTRICT` garantiza la propiedad exacta.
- La convención de códigos conserva el tipo por prefijo (`FIC`, `FIE`, ..., `SUB-ACAD`, `SUB-ADMIN`) para filtros y reportes.
- `OrganizationUnit` conserva la distinción funcional mediante `UnitType`; agregar direcciones o centros regionales en el futuro es ampliar el enum y sembrar filas, sin migrar relaciones.

## Consequences

### Positive

- **POS-001**: Una sola tabla, una sola FK y un solo índice parcial eliminan la duplicación y reducen el costo de agregar nuevos tipos de unidad.
- **POS-002**: Los triggers y funciones de archivado/reactivación pasan a operar sobre una única tabla y columna.
- **POS-003**: El encargado (`head_id`) habilita responsables formales por unidad sin depender de colaboraciones de programa.
- **POS-004**: La migración preserva datos: las filas de `faculties` y `subdirectorates` se copian tipadas, y las referencias de usuarios, carreras y programas se reasignan antes de eliminar las tablas antiguas.

### Negative

- **NEG-001**: Cambia el contrato público (`facultyId` → `unitId`, `faculty` → `unit`) para el frontend y para los JWT emitidos; sesiones con tokens viejos deben renovarse.
- **NEG-002**: La base de datos ya no fuerza que una carrera o un usuario pertenezca específicamente a una unidad de tipo `FACULTY`; esa validación queda en el servicio.
- **NEG-003**: Los códigos ahora comparten un único espacio de unicidad; la migración falla explícitamente si existiera una colisión entre tablas antiguas.

## Alternatives Considered

### Mantener dos tablas y agregar más

- **ALT-001**: **Description**: Conservar `faculties` y `subdirectorates` y añadir tablas análogas para direcciones y centros regionales.
- **ALT-002**: **Rejection Reason**: Multiplica tablas idénticas, FKs, CHECKs XOR, índices parciales y ramas de triggers sin mejorar la integridad.

### Un solo catálogo sin tipo

- **ALT-003**: **Description**: Unificar en una tabla sin `UnitType`.
- **ALT-004**: **Rejection Reason**: Se perdería la distinción entre facultades y subdirecciones necesaria para filtros, reportes y la coherencia carrera-unidad.

### Renombrar el modelo sin migrar la tabla

- **ALT-005**: **Description**: Renombrar solo el modelo Prisma con `@@map("subdirectorates")`.
- **ALT-006**: **Rejection Reason**: No resuelve la unificación real: las facultades seguirían en otra tabla y `event_programs` mantendría dos FKs.

## Implementation Notes

- **IMP-001**: `prisma/migrations/20260919093000_unify_organizational_units/migration.sql` crea `UnitType` y `organizational_units`, copia datos, reasigna FKs y recrea triggers.
- **IMP-002**: La migración aborta si existe código duplicado entre `faculties` y `subdirectorates` o si un programa quedara sin unidad propietaria.
- **IMP-003**: `src/lib/auth.ts`, `src/modules/auth/*`, `src/middlewares/authenticate.middleware.ts` y `src/modules/users/*` usan `unitId`/`unit`.
- **IMP-004**: Criterio de éxito: seed idempotente con 6 facultades y 4 subdirecciones, cada una con programa predeterminado, y login que emite JWT con claim `unitId`.

## References

- **REF-001**: `prisma/schema.prisma` (`OrganizationalUnit`, `UnitType`).
- **REF-002**: `docs/er-diagram/ER-design-justification.md` (D20, D21).
- **REF-003**: `docs/er-diagram/2026-09-18-informe-requisitos-y-diagrama-er.md`.
- **REF-004**: `docs/superpowers/plans/2026-09-19-seed-datos-prueba.md`.
