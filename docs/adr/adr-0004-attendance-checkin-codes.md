---
title: 'ADR-0004: Códigos de check-in por inscripción'
status: 'Accepted'
date: '2026-09-19'
authors: 'Equipo backend SIPEG UTP'
tags: ['architecture', 'database', 'prisma', 'attendance']
supersedes: ''
superseded_by: ''
---

# ADR-0004: Códigos de check-in por inscripción

## Status

**Accepted**

## Context

El diseño inicial modelaba los códigos de validación de asistencia en `activities`: `qr_code` (único global, obligatorio) y `manual_code` (opcional, único por programa). La tabla intermedia `attendance` (`activity_id` × `user_id`) guardaba, solo al completar el check-in, `method`, `used_code` y `checked_in_at`; el CHECK exigía que los tres fueran nulos en la inscripción y no nulos tras el check-in.

Ese esquema presentaba límites concretos:

- El código era de la actividad y se compartía entre todos los asistentes, por lo que no identificaba una inscripción individual ni permitía trazabilidad por persona.
- `used_code` duplicaba el dato ya almacenado en la actividad y quedaba nulo hasta el check-in.
- La validación de presencia no podía resolver directamente "la inscripción cuyo código es X", porque varios asistentes de una misma actividad compartían el mismo `used_code`.
- Listar las actividades de un usuario o los usuarios de una actividad no exponía el código asociado a cada inscripción.

## Decision

Mover los códigos de check-in a la inscripción y unificarlos en una sola columna:

- Se eliminan `Activity.qrCode` y `Activity.manualCode`, junto con `@@unique([eventProgramId, manualCode])`.
- `Attendance` incorpora `code String @unique @db.VarChar(64)`, generado al crear la inscripción (antes del check-in) y único a nivel global.
- Se elimina `Attendance.usedCode`; el nuevo `code` cumple ese rol y ya no es nulo.
- Se conserva `Attendance.method` (`QR`/`MANUAL`) para registrar cómo se validó la presencia.
- El CHECK de estado pasa a: `(checked_in_at IS NULL AND method IS NULL)` o `(checked_in_at IS NOT NULL AND method IS NOT NULL AND checked_in_at >= registered_at)`.

El endpoint `POST /api/v1/activities` no genera códigos; su creación queda en estado `DRAFT` y devuelve un DTO sin códigos. Un endpoint futuro de inscripción/check-in generará y validará `Attendance.code`.

## Consequences

### Positive

- **POS-001**: Cada inscripción tiene un código propio y globalmente único, lo que permite validar presencia por persona sin ambigüedad.
- **POS-002**: Se elimina la duplicación entre `activities.manual_code`/`qr_code` y `attendance.used_code`.
- **POS-003**: La relación `activity` × `user` ya expone naturalmente las actividades de un usuario y los usuarios de una actividad, cada uno con su código.
- **POS-004**: El estado de la inscripción y el check-in quedan desacoplados del ciclo de vida de la actividad.

### Negative

- **NEG-001**: El modelo queda adelantado a la API: mientras no exista el endpoint de inscripción, el código solo se poblará vía seed.
- **NEG-002**: La migración debe backfillear `attendance.code` con valores frescos; no puede reutilizar `used_code` porque estaba repetido entre asistentes.
- **NEG-003**: Un código por inscripción implica más filas con códigos que un único código por actividad, aunque el volumen es proporcional a las inscripciones.

## Alternatives Considered

### Mantener el código en la actividad y referenciarlo desde attendance

- **ALT-001**: **Description**: Conservar `qr_code`/`manual_code` en `activities` y que `attendance` solo referenciara el código usado.
- **ALT-002**: **Rejection Reason**: Mantiene el código compartido entre asistentes y no resuelve la validación individual ni la trazabilidad por inscripción.

### Conservar una sola columna `code` en Activity

- **ALT-003**: **Description**: Unificar `qr_code` y `manual_code` en un único `code` a nivel de actividad.
- **ALT-004**: **Rejection Reason**: Sigue sin asociar el código a la inscripción, que es el registro que valida la presencia.

### Código único por actividad dentro de attendance

- **ALT-005**: **Description**: Guardar en cada inscripción el mismo código de la actividad.
- **ALT-006**: **Rejection Reason**: Duplica el dato y no permite identificar una inscripción por su código.

## Implementation Notes

- **IMP-001**: `prisma/migrations/20260919175329_move_checkin_codes_to_attendance/migration.sql` agrega `attendance.code`, backfillea con `gen_random_uuid()`, crea el índice único, elimina `used_code`, `activities.qr_code` y `activities.manual_code`, y recrea el CHECK de estado.
- **IMP-002**: `prisma/seed/helpers.ts` expone `seedCode(...)`; `prisma/seed/attendance.seed.ts` asigna un código determinista por inscripción.
- **IMP-003**: `POST /api/v1/activities` (`src/modules/activities/activities.service.ts`) crea en `DRAFT` y no genera códigos.
- **IMP-004**: Criterio de éxito: `pnpm prisma:validate`, `pnpm typecheck`, `pnpm lint`, `pnpm test` y `pnpm docs:check` verdes; seed idempotente con códigos por inscripción.

## References

- **REF-001**: `prisma/schema.prisma` (`Activity`, `Attendance`).
- **REF-002**: `prisma/migrations/20260919175329_move_checkin_codes_to_attendance/migration.sql`.
- **REF-003**: `docs/er-diagram/ER-design-justification.md`.
- **REF-004**: `docs/superpowers/plans/2026-09-19-attendance-checkin-codes-and-create-activity.md`.
