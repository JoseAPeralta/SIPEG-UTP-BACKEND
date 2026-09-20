---
title: 'ADR-0005: Seed base de producción separado del seed demo'
status: 'Accepted'
date: '2026-09-19'
authors: 'Equipo backend SIPEG UTP'
tags: ['architecture', 'prisma', 'seed', 'deployment']
supersedes: ''
superseded_by: ''
---

# ADR-0005: Seed base de producción separado del seed demo

## Status

**Accepted**

## Context

El seed original (`prisma/seed.ts`) era un unico flujo con datos de prueba
completos: catalogo de permisos, unidades organizativas con sus programas
predeterminados, carreras, aulas, usuarios demo, ponentes, programas
adicionales, actividades, colaboraciones, asistencias, certificados, propuestas
y alertas. Por seguridad abortaba en `NODE_ENV=production` salvo
`SEED_ALLOW_PRODUCTION=true`.

Ese diseno deja tres problemas para el despliegue real:

- Produccion necesita el catalogo de permisos de autorizacion y los catalogos
  institucionales (unidades, programas predeterminados, carreras, aulas) desde
  el primer arranque, pero no puede recibir PII sintetica ni fechas relativas al
  momento del seed.
- No existia una via soportada para crear el primer ADMIN: sin ADMIN no se puede
  usar la API administrativa (Fase 1.10 del plan maestro), un huevo-gallina.
- La unica forma de poblar catalogos en produccion era habilitar el seed demo
  completo con `SEED_ALLOW_PRODUCTION=true`, lo que ademas sobrescribia nombres,
  descripciones e `isActive` en cada corrida.

## Decision

Separar el seed en dos entrypoints y dos modos de escritura:

- `prisma/seed.base.ts` (`pnpm prisma:seed:base`) ejecuta
  `seedBaseDatabase`: permisos, unidades organizativas con programas
  predeterminados, carreras, aulas y el ADMIN inicial. Es seguro en produccion,
  no requiere `SEED_ALLOW_PRODUCTION` y usa **modo `ensure`**: crea solo lo que
  falta y nunca sobrescribe nombre, descripcion, `isActive`, `headId` ni
  passwords de filas existentes.
- `prisma/seed.ts` (`pnpm prisma:seed`, `prisma db seed`) conserva el seed demo
  completo con **modo `sync`** (upsert/refresh) y su guarda de produccion.
- Los permisos se siembran siempre con `upsert` en ambos modos: el catalogo
  canonico crece con cada fase y no es editable por administradores; no se
  eliminan permisos.
- El ADMIN inicial se configura por variables `SEED_ADMIN_EMAIL`,
  `SEED_ADMIN_PASSWORD` y `SEED_ADMIN_IDENTIFICATION_NUMBER` (nombres opcionales
  con defaults). Solo se crea si el email no existe. Si la base no tiene ningun
  ADMIN y no hay bootstrap configurado, el seed base falla con un mensaje claro
  para preservar la operabilidad.
- En produccion, un servicio one-shot `seed` de `compose.prod.yaml` ejecuta el
  seed base despues de `migrate` y antes de la API; si falla, la API no arranca.

## Consequences

### Positive

- **POS-001**: Produccion recibe solo data institucional estable; ningun dato
  sintetico, PII ni fechas relativas.
- **POS-002**: Las ediciones de administradores (renombres, desactivaciones,
  encargados) sobreviven a cada despliegue por el modo `ensure`.
- **POS-003**: El bootstrap del ADMIN por env resuelve el huevo-gallina sin
  exponer credenciales en el repositorio.
- **POS-004**: El seed base es idempotente y re-ejecutable como parte del
  runbook (`docker compose ... run --rm seed`).
- **POS-005**: Los permisos nuevos llegan a produccion en cada despliegue sin
  migraciones de datos manuales.

### Negative

- **NEG-001**: Dos entrypoints y dos modos agregan superficie de mantenimiento;
  las constantes de catalogo siguen siendo compartidas para evitar divergencia.
- **NEG-002**: La imagen one-shot `migrate` ahora incluye `src/` y ejecuta
  `prisma generate` (incluye `tsx`, una devDependency) para poder correr el seed
  base; no afecta a la imagen runtime.
- **NEG-003**: `SEED_ADMIN_PASSWORD` queda visible para `docker inspect`; se
  mitiga usando `.env.prod` ignorado por git y rotando el password tras el
  primer inicio de sesion.
- **NEG-004**: El ADMIN bootstrap crea la cuenta con `emailVerified: true` sin
  correo de verificación; es una excepcion de bootstrap documentada.

## Alternatives Considered

### Seed unico con flag `SEED_MODE=base`

- **ALT-001**: **Description**: Un solo archivo con bandera de modo para elegir
  entre base y demo.
- **ALT-002**: **Rejection Reason**: `prisma db seed` no reenvia argumentos; la
  bandera dependeria de env y el riesgo de correr demo en produccion por un
  error de configuracion se mantiene. Dos entrypoints separados hacen explicito
  el contrato.

### Migracion de datos de Prisma con `INSERT` de catalogos

- **ALT-003**: **Description**: Versionar los catalogos como migraciones SQL
  aplicadas por `prisma migrate deploy`.
- **ALT-004**: **Rejection Reason**: Mezcla datos con esquema, vuelve costoso
  editar catalogos (una migracion por ajuste) y rompe la idempotencia natural
  del seed. Las migraciones deben describir estructura.

### Crear el ADMIN via `POST /api/v1/admin/users`

- **ALT-005**: **Description**: Documentar un bootstrap manual por API.
- **ALT-006**: **Rejection Reason**: Requiere sesion ADMIN previa, que no puede
  existir en una base vacia; ademas Fase 1.10 aun no esta implementada.

### Ejecutar el seed base manualmente desde `migrate`

- **ALT-007**: **Description**: Encadenar `migrate deploy && seed base` en el
  servicio `migrate` existente.
- **ALT-008**: **Rejection Reason**: Acopla responsabilidades y dificulta
  re-ejecutar solo el seed. Un servicio `seed` separado da trazabilidad en logs
  y permite `run --rm seed` sin re-migrar.

## Implementation Notes

- **IMP-001**: `prisma/seed/helpers.ts` define `SeedWriteMode`, `InitialAdminConfig`
  y `readInitialAdminConfig`; `prisma/seed/organizations.seed.ts` y
  `prisma/seed/classrooms.seed.ts` aceptan el modo.
- **IMP-002**: `prisma/seed/base.seed.ts` expone `seedBaseDatabase`; el
  entrypoint es `prisma/seed.base.ts`.
- **IMP-003**: `Dockerfile` (stage `migrate`) copia `src/` y genera Prisma Client.
- **IMP-004**: `compose.prod.yaml` agrega el servicio one-shot `seed`
  (`prisma/seed.base.ts`) y la API depende de su finalizacion exitosa.
- **IMP-005**: Criterio de exito: `pnpm test` (con pruebas del modo `ensure` y
  del bootstrap), `pnpm typecheck`, `pnpm lint`, `pnpm build` verdes; seed base
  idempotente y no destructivo.

## References

- **REF-001**: `docs/superpowers/plans/2026-09-19-seed-base-produccion.md`.
- **REF-002**: `docs/superpowers/plans/2026-09-19-plan-maestro-sipeg-utp.md`.
- **REF-003**: `prisma/seed/base.seed.ts`, `prisma/seed/organizations.seed.ts`,
  `prisma/seed/classrooms.seed.ts`.
- **REF-004**: `compose.prod.yaml`, `Dockerfile`.
