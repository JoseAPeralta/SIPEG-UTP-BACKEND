# Auditoria de contenedores y separacion dev/prod

**Fecha:** 2026-09-18

**Objetivo:** actualizar versiones LTS, aplicar buenas practicas de contenedores, minimizar la imagen de produccion y dividir los entornos de desarrollo y produccion.

## Cambios

### Dockerfile

- `node:24.21.0-slim` y `pnpm@12.4.2`.
- Stages: `base`, `deps`, `prod-deps`, `build`, `dev`, `migrate`, `runtime`.
- `dev` incluye dependencias completas y arranca con hot reload; el codigo se monta como volumen.
- `migrate` es one-shot y ejecuta `prisma migrate deploy`.
- `runtime` solo copia dependencias de produccion, `dist` y `package.json`; ejecuta como usuario `node`.
- `HEALTHCHECK` en forma exec (sin expansion del shell).
- `runtime` instala `ca-certificates` y `openssl`.

### Compose

- `compose.dev.yaml`: hot reload, volumenes de codigo, PostgreSQL publicado en loopback, migracion automatica antes de arrancar la API.
- `compose.prod.yaml`: secretos obligatorios, base de datos sin puertos al host, `cap_drop: ALL`, `stop_grace_period`, migracion one-shot.
- Volumen de PostgreSQL montado en `/var/lib/postgresql` (ruta correcta para PostgreSQL 18).
- Se elimina `docker-compose.yml`.

### Versionado y configuracion

- `.node-version` con `24.21.0`.
- `@types/node` alineado a `^24.13.6`; `engines.node` limitado a `>=24.0.0 <25`.
- `tsconfig.build.json` genera produccion sin source maps.
- `.dockerignore` excluye `.opencode`, `docs`, tests y configuracion de herramientas.
- `.env.example` separa variables de desarrollo y produccion.

## Verificacion

- `pnpm run typecheck`, `pnpm run lint`, `pnpm test`, `pnpm run build` en verde.
- Build de produccion sin archivos `.map`.
- YAML de ambos compose valido.

## Pendiente

- Validar build de imagenes y arranque de stacks en una maquina con Docker activo.
- Prisma: migraciones sin versionar y `migration_lock.toml` ausente (fuera de alcance por ahora).
