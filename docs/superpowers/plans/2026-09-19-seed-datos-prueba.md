# Plan: Unificacion de unidades organizativas + seed completo

Fecha: 2026-09-19
Estado: aprobado y en ejecucion

## Objetivo

1. Unificar `Faculty` y `Subdirectorate` en un unico modelo `OrganizationalUnit`
   con enum `UnitType` (`FACULTY`, `SUBDIRECTORATE`) y campo opcional `head`
   (encargado) hacia `User`.
2. Unificar `EventProgram.facultyId` + `EventProgram.subdirectorateId` en una
   sola FK `organizationalUnitId` (NOT NULL, `ON DELETE RESTRICT`).
3. Renombrar `User.facultyId` y `Career.facultyId` a `unitId`, incluyendo el
   contrato publico (JWT, API de registro, perfil).
4. Actualizar `docs/er-diagram/` (informe, justificacion y drawio), `AGENTS.md`,
   `CONTEXT.md`, `README.md` y crear ADR.
5. Crear un seed idempotente con datos de prueba completos para toda la BD:
   6 facultades + 4 subdirecciones, carreras, usuarios, aulas, programas
   predeterminados y adicionales, actividades, colaboraciones, asistencias,
   certificados, propuestas, feedback y alertas.

## Decisiones

| Tema               | Decision                                                                             |
| ------------------ | ------------------------------------------------------------------------------------ |
| Modelo unificado   | `OrganizationalUnit` / tabla `organizational_units`                                  |
| FK de programa     | `organizationalUnitId` / `organizationalUnit`                                        |
| Encargado          | `headId` / `head` (opcional, `ON DELETE SET NULL`)                                   |
| Enum               | `UnitType { FACULTY, SUBDIRECTORATE }`                                               |
| Contrato publico   | renombre total a `unitId` / `unit` (JWT y API)                                       |
| Seed               | idempotente con upserts e IDs deterministas `seed_*`                                 |
| Credenciales demo  | password unica `Sipeg2026*UTP`, emails `@utp.ac.pa`                                  |
| Unidades a sembrar | 6 facultades + 4 subdirecciones (Academica, Administrativa, Vida Universitaria, IPE) |

## Fase A - Schema, migracion, codigo y docs

### A1. `prisma/schema.prisma`

- Agregar `enum UnitType { FACULTY SUBDIRECTORATE }`.
- Agregar `OrganizationalUnit` con `name`, `code (UQ)`, `description?`, `type`,
  `headId?` (FK `users`, SetNull), `isActive`, timestamps, indices
  `[type, isActive]` y `[headId]`, relaciones `members`, `careers`,
  `eventPrograms`.
- Eliminar modelos `Faculty` y `Subdirectorate`.
- `User`: `unitId?` + `unit` (SetNull) + `headedUnits` (relation
  `OrganizationalUnitHead`) + indice.
- `Career`: `unitId` + `unit` (Restrict) + indice.
- `EventProgram`: `organizationalUnitId` + `organizationalUnit` (Restrict),
  unique parcial `event_programs_default_unit_key` e indice
  `[organizationalUnitId, status]`.

### A2. Migracion `unify_organizational_units`

Generar con `prisma migrate dev --create-only` y editar:

1. Crear `UnitType`.
2. Eliminar triggers/funciones que referencian tablas antiguas.
3. Crear `organizational_units` + FK `head_id` + indices + unique `code`.
4. Backfill desde `faculties` (`FACULTY`) y `subdirectorates`
   (`SUBDIRECTORATE`) con validacion de colision de `code`.
5. `event_programs`: nueva columna, backfill `COALESCE`, NOT NULL, FK, drop de
   columnas viejas, unique parcial nuevo e indice.
6. `careers`: `unit_id` (NOT NULL, Restrict), drop `faculty_id`.
7. `users`: `unit_id` (SetNull), drop `faculty_id`, indice.
8. Recrear funciones/triggers adaptados.
9. Drop de `faculties` y `subdirectorates`.

### A3. Codigo

Renombrar `facultyId`/`faculty` a `unitId`/`unit` en:

- `src/lib/auth.ts` (additionalFields y payload JWT)
- `src/modules/auth/auth.schemas.ts`, `auth.service.ts`
- `src/utils/jwt-verifier.ts`, `src/types/express.d.ts`
- `src/middlewares/authenticate.middleware.ts`
- `src/modules/users/users.service.ts`, `users.schemas.ts`, `users.types.ts`

Reglas mantenidas: unidad activa obligatoria; coherencia carrera-unidad;
mensajes de error en ingles alineados (`Organizational unit is not available.`,
`Career does not belong to the selected unit.`).

### A4. Tests

Actualizar mocks/fixtures y agregar casos de unidad inactiva y carrera de otra
unidad. Ejecutar `pnpm typecheck`, `pnpm lint`, `pnpm test`.

### A5. Documentacion

- `docs/er-diagram/ER-design-justification.md`
- `docs/er-diagram/2026-09-18-informe-requisitos-y-diagrama-er.md`
- `docs/er-diagram/er-diagram.drawio`
- `AGENTS.md`, `CONTEXT.md`, `README.md`
- Nuevo `docs/adr/adr-0002-unified-organizational-units.md`

## Fase B - Seed

Estructura:

```
prisma/seed.ts                 # entrypoint delgado
prisma/seed/index.ts           # orquestacion y resumen
prisma/seed/helpers.ts         # ids, fechas, time, upsert helpers
prisma/seed/organizations.seed.ts
prisma/seed/users.seed.ts
prisma/seed/classrooms.seed.ts
prisma/seed/programs.seed.ts
prisma/seed/collaborations.seed.ts
prisma/seed/activities.seed.ts
prisma/seed/attendance.seed.ts
prisma/seed/proposals.seed.ts
prisma/seed/alerts.seed.ts
prisma/tsconfig.json
```

Contenido: permisos, unidades + programas predeterminados, carreras, usuarios
(admin, organizadores, editor, visor, ponentes, estudiantes) con `Account`
credential, aulas con amenidades/disponibilidad, programas adicionales,
actividades con equipamiento, colaboraciones con permisos materializados y
overrides, asistencias con check-in, certificados, propuestas con versiones y
feedback, y alertas.

Guardas: abortar en `NODE_ENV=production` salvo `SEED_ALLOW_PRODUCTION=true`;
no usar DELETE; versiones de propuesta insert-only; respetar CHECKs y triggers.

## Verificacion

1. `pnpm prisma validate`, `pnpm prisma format`, `pnpm prisma generate`.
2. Migracion aplicada; triggers y tablas verificados con psql.
3. `pnpm typecheck`, `pnpm lint`, `pnpm test`.
4. `pnpm prisma:seed` dos veces con conteos identicos.
5. Login real con `admin@utp.ac.pa` y claim `unitId` en el JWT.
6. `xmllint --noout docs/er-diagram/er-diagram.drawio`.
