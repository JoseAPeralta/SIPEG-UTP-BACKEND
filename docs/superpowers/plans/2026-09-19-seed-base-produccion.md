# Plan: Seed base de produccion vs. seed demo

Fecha: 2026-09-19
Estado: completado y verificado (2026-09-19)

## Objetivo

Separar el seed en dos modos para que la data institucional estable (unidades
organizativas, programas predeterminados, carreras, aulas y catalogo de
permisos) se cargue en el despliegue de produccion, junto con un ADMIN inicial
configurable por variables de entorno, sin cargar datos sinteticos.

- **Modo `ensure` (base/produccion):** crea solo lo que falta; nunca
  sobrescribe nombre, descripcion, `isActive` ni `headId` de filas existentes.
- **Modo `sync` (demo/local):** comportamiento actual de upsert/refresh.
- **Permisos:** siempre `upsert` en ambos modos (el catalogo crece por fase y no
  es editable por admins).
- **Demo:** usuarios, ponentes, programas adicionales, actividades,
  colaboraciones, asistencias, certificados, propuestas y alertas quedan
  excluidos de produccion.

## Mapeo con el plan maestro

| Seccion del plan maestro                       | Relacion                                                                                                                                                                                                 |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fase 0.4 (seed idempotente)                    | Extiende el criterio: el seed base es idempotente y no destructivo en `NODE_ENV=production`.                                                                                                             |
| Fase 1.10 (crear usuario administrativo)       | El bootstrap de ADMIN por env resuelve el huevo-gallina previo a ese endpoint.                                                                                                                           |
| Fase 2 (2.A unidades, 2.B carreras, 2.C aulas) | El seed base precarga esos catalogos; los endpoints son la via de administracion posterior. Respeta 2.A.3 (unidad + programa default atomico) y 2.A.7 (invariante del default). Se agrega como item 2.0. |
| Definicion de terminado global                 | Actualizar seed, `.env.example`, README, CONTEXT, AGENTS y ADR.                                                                                                                                          |
| Fase 12.4-12.6                                 | Runbook de deploy y cierre tecnico.                                                                                                                                                                      |
| Decision pendiente #7 (catalogos solo ADMIN)   | Consistente: el seed base no otorga permisos delegables ni colaboraciones.                                                                                                                               |

## Data a sembrar en produccion

- Catalogo de permisos (19 filas de `PERMISSION_NAMES`).
- 10 unidades organizativas (6 facultades + 4 subdirecciones) con nombre, codigo,
  descripcion y tipo.
- 10 programas predeterminados `Programa de Eventos - <unidad>` (sin `headId`,
  sin `createdById`, sin fechas).
- 25 carreras: 24 oficiales mas la carrera global `Otros` (sin unidad).
- 10 aulas con amenidades y disponibilidad.
- 1 ADMIN inicial opcional via env (`SEED_ADMIN_*`), creado solo si el email no
  existe.

## Fase A - Refactor test-first del seed

### A1. Tests que fallan primero

- [x] Extender `vitest.config.ts`: `include` con `prisma/**/*.{test,spec}.ts`.
- [x] Crear `prisma/seed/test-helpers/fake-prisma.ts`: fake en memoria con
      `organizationalUnit`, `eventProgram`, `career`, `classroom`,
      `classroomAmenity`, `classroomAvailability`, `permission`, `user`, `account`
      y conteo de escrituras.
- [x] Crear `prisma/seed/base.seed.test.ts` con casos:
  - ensure en BD vacia: 10 unidades, 10 programas default, 25 carreras, 10 aulas,
    19 permisos y 1 admin.
  - ensure no actualiza filas existentes (unidad renombrada, aula inactiva).
  - idempotencia: segunda pasada no crea nada.
  - permisos: agrega el permiso faltante aunque existan otros.
  - admin: skip si el email existe (password intacto); falla si no hay ADMIN ni
    config; corre con `NODE_ENV=production` sin `SEED_ALLOW_PRODUCTION`.
  - regresion demo: `seedDatabase` conserva semantica sync.
- [x] Verificar rojo por la razon esperada (modulos inexistentes / comportamiento
      actual).

### A2. Implementacion

- [x] `prisma/seed/organizations.seed.ts`: `seedOrganizations(prisma, mode)`;
      `ensureDefaultProgram(..., mode)`; modo `sync` conserva el comportamiento
      actual.
- [x] `prisma/seed/classrooms.seed.ts`: `seedClassrooms(prisma, mode)`; en
      `ensure` no reescribe amenidades ni disponibilidad existentes.
- [x] `prisma/seed/helpers.ts`: `readInitialAdminConfig()` con validacion
      (email/password/identificacion obligatorios juntos; password 12-128;
      `first_name`/`last_name` opcionales con defaults). Nunca loguear password.
- [x] `prisma/seed/base.seed.ts`: `seedBaseDatabase(prisma)` con permisos,
      unidades, programas default, carreras, aulas y `ensureInitialAdmin`. Si no hay
      ningun ADMIN y no hay config, falla con mensaje claro.
- [x] `prisma/seed.base.ts`: entrypoint delgado.
- [x] `prisma/seed/index.ts`: `seedDatabase` (demo) explicita modo `sync`.
- [x] `package.json`: script `prisma:seed:base`; `prisma:seed` sin cambios.
- [x] Verde: `pnpm test`, `pnpm run typecheck`, `pnpm run lint`.

## Fase B - Docker y Compose de produccion

- [x] `Dockerfile` stage `migrate`: copiar `tsconfig.json` y `src`, ejecutar
      `pnpm run prisma:generate` (el seed base importa `src/lib/password.ts`,
      `src/utils/date.ts`, `src/modules/authorization/permissions.ts` y el cliente
      generado).
- [x] `compose.prod.yaml`: servicio one-shot `seed` (`target: migrate`,
      `entrypoint: ['pnpm','exec','tsx']`, `command: ['prisma/seed.base.ts']`, env
      `DATABASE_URL` y `SEED_ADMIN_*`, `depends_on migrate` completado).
- [x] `api.depends_on` incluye `seed: service_completed_successfully`.
- [x] `compose.dev.yaml` sin cambios.
- [x] Build local del stage `migrate` y corrida del servicio contra BD
      desechable.

## Fase C - Documentacion

- [x] `.env.example`: bloque `SEED_ADMIN_*` y nota de seguridad.
- [x] `README.md`: seccion "Datos base de produccion" con runbook, verificacion
      de idempotencia y rotacion del password admin.
- [x] `AGENTS.md` y `CONTEXT.md`: regla de clasificacion base vs demo.
- [x] `docs/adr/adr-0005-production-baseline-seed.md`.
- [x] Plan maestro: item 2.0, registro en Fase 0.4 y decision pendiente de
      bootstrap admin.

## Verificacion

1. `pnpm test`, `pnpm run typecheck`, `pnpm run lint`, `pnpm run build`.
2. `pnpm prisma:validate` y `pnpm prisma:format` si cambia schema (no aplica).
3. `pnpm prisma:seed` dos veces con conteos identicos (regresion demo).
4. `pnpm prisma:seed:base` dos veces contra BD desechable; mutar nombre de unidad
   y `isActive` de aula; re-ejecutar y confirmar que no se sobrescribe.
5. Confirmar que logs no exponen password ni hash del admin.
6. `docker compose -f compose.prod.yaml build migrate` y corrida del servicio
   `seed`.

## Riesgos aceptados

- `tsx` viaja en la imagen one-shot `migrate` (devDependency); no llega al
  runtime.
- `SEED_ADMIN_PASSWORD` visible en `docker inspect`; mitigado con `.env.prod`
  (ignorado por git) y rotacion post-login.
- Si un admin edita y luego re-ejecuta el seed base, no se pisa por diseno; los
  permisos si se refrescan (solo descripcion/nuevas filas).
