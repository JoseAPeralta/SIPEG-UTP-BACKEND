# Internal JWKS URL Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Permitir que la API consulte su JWKS por loopback para que Bot Fight Mode no impida validar access tokens.

**Architecture:** `AUTH_JWKS_URL` selecciona el endpoint HTTP(S) usado por el verificador y el health. Un resolver compartido en `src/config/auth-jwks.ts` mantiene el fallback actual a `AUTH_URL` cuando la variable falta o esta vacia. Compose usa `http://127.0.0.1:3000/api/auth/jwks`; issuer, audience, firmas EdDSA y caches de jose conservan sus reglas.

**Tech Stack:** TypeScript, Zod 4, jose 6, Express, Vitest, Docker Compose.

## Archivos

- Crear `src/config/auth-jwks.ts`: resolucion compartida de la URL.
- Modificar `src/config/env.ts` y `src/config/env.test.ts`: variable opcional HTTP(S), vacio como ausente, rechazo de valores invalidos.
- Modificar `src/utils/jwt-verifier.ts`: seleccionar la URL interna para el resolver remoto, incluido `refresh()`.
- Crear `src/utils/jwt-verifier.remote.test.ts`: prueba real con JWKS servido por HTTP local y endpoint publico simulado que devuelve challenge.
- Modificar `src/modules/health/health.controller.ts` y `src/modules/health/health.routes.test.ts`: misma URL, timeout de 3 segundos conservado.
- Modificar `src/modules/health/health.schemas.ts` y regenerar `openapi.json`: aclarar que `authJwksReachable` mide el endpoint configurado, manteniendo la forma de respuesta.
- Modificar `compose.prod.yaml`, `compose.dev.yaml`, `.env.example` y `.env.prod.example`: propagar y documentar el default Docker.
- Modificar `README.md`, `CONTEXT.md`, `AGENTS.md` y `docs/despliegue.md`: transporte interno, identidad publica y significado del health.
- Modificar `docs/superpowers/plans/despliegue-aplicacion.md`: registrar el incidente y las comprobaciones pendientes del VPS.

## Task 1: Pruebas de regresion

- [x] Agregar pruebas de `AUTH_JWKS_URL` valida, ausente, vacia e invalida en `src/config/env.test.ts`, con entorno aislado mediante `vi.stubEnv`.
- [x] Agregar prueba del health con `AUTH_URL` publico y `AUTH_JWKS_URL` interno. Debe consultar solo la URL interna con `AbortSignal.timeout(3_000)`.
- [x] Crear prueba del verificador con un servidor HTTP en `127.0.0.1`, puerto efimero. `/api/auth/jwks` simula un challenge `403`; `/internal-jwks` sirve las claves de `createTestJwks()`.
- [x] Firmar un token con issuer y audience `https://api.sipeg-utp.com`; verificarlo con `createJwtVerifier()` y `AUTH_JWKS_URL` apuntando a `/internal-jwks`. Exigir que no se consulte el endpoint publico.
- [x] Cubrir tambien `refresh()`, rechazo de issuer interno y fallback al endpoint derivado de `AUTH_URL` cuando no hay override.
- [x] Ejecutar y observar el fallo esperado antes de tocar produccion:

```bash
pnpm exec vitest run src/config/env.test.ts src/utils/jwt-verifier.remote.test.ts src/modules/health/health.routes.test.ts
```

## Task 2: Implementacion minima

- [x] Agregar a `envSchema`:

```ts
AUTH_JWKS_URL: z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.url({ protocol: /^https?$/ }).optional(),
),
```

- [x] Crear `src/config/auth-jwks.ts`:

```ts
import { env } from './env.js';

export const resolveJwksUrl = (): string =>
  env.AUTH_JWKS_URL ?? new URL('/api/auth/jwks', env.AUTH_URL).toString();
```

- [x] Importar `resolveJwksUrl` en el verificador y usar `jwksUrl: resolveJwksUrl()` en `buildConfig`. Conservar `issuer`, `audience`, algoritmos, cache y `refresh()`.
- [x] Importar `resolveJwksUrl` en health y usar:

```ts
const response = await fetch(resolveJwksUrl(), { signal: AbortSignal.timeout(3_000) });
```

- [x] Ejecutar las pruebas anteriores y `src/utils/jwt-verifier.test.ts`; deben pasar.

## Task 3: Configuracion y documentacion

- [x] Agregar a `api.environment` de ambos Compose:

```yaml
AUTH_JWKS_URL: ${AUTH_JWKS_URL:-http://127.0.0.1:3000/api/auth/jwks}
```

- [x] Incluir en `.env.prod.example` el valor operativo:

```dotenv
AUTH_JWKS_URL=http://127.0.0.1:3000/api/auth/jwks
```

- [x] Documentar en `.env.example` que la variable es opcional fuera de Compose y no cambia issuer/audience.
- [x] Actualizar README, CONTEXT, AGENTS y despliegue: health mide el endpoint configurado; la ruta publica se verifica externamente.
- [x] Aclarar la descripcion de `authJwksReachable` y ejecutar `pnpm run docs:generate` para actualizar `openapi.json`.
- [x] Ajustar el comentario de `compose.cloudflare.yaml`: el conector sigue arrancando independientemente; la API ya no necesita el tunel para consultar JWKS.
- [x] Registrar el incidente confirmado por Security Events (Bot Fight Mode, `Managed Challenge`, user-agent `node`, `/api/auth/jwks`) en el plan de despliegue. Mantener pendientes las pruebas reales de navegador/VPS.

## Task 4: Verificacion y commits

- [x] Ejecutar `pnpm test` sin otras tareas pesadas en paralelo.
- [x] Ejecutar `pnpm run typecheck`, `pnpm run lint`, `pnpm run build` y `pnpm run docs:check`.
- [x] Comprobar formato de codigo, Compose, documentacion operativa y este plan, y `git diff --check`.
- [x] Validar Compose de desarrollo y los tres archivos de produccion con valores ficticios de proceso. Comprobar default y override de `AUTH_JWKS_URL`, conservando identidad publica.
- [x] Revisar status, diff y log; crear el commit `fix(auth)` con codigo, pruebas, configuracion y documentacion operativa (`9acc05e`). Excluir `.env.prod` y datos generados. Los planes se versionan aparte como documentacion de despliegue.

## Verificacion en el VPS

- [x] Actualizar el codigo y desplegarlo con `IMAGE_TAG=2026-10-10-r1`; el health y el login confirman que el codigo nuevo esta en ejecucion.
- [x] Comprobar `authJwksReachable: true`, login y una peticion protegida desde el navegador.
- [x] Publicar una etiqueta nueva: `2026-10-20-r1` esta aplicada en `api`, `migrate` y `seed`; `ps -a` la refleja.

Bot Fight Mode puede conservarse activo: el verificador descarga claves por loopback. El JWKS publico sigue sujeto a las reglas del edge y su accesibilidad se comprueba separadamente; no queda acreditada por el health interno.

## Resultados locales

- Rojo: 12 pruebas fallaron porque la variable no se reconocia y verificador/health seguian consultando el endpoint publico simulado con challenge.
- Verde focalizado: 39 pruebas aprobadas en configuracion, verificador local/remoto y health.
- Suite completa: 74 archivos aprobados, 2 omitidos; 1639 pruebas aprobadas, 9 omitidas (integracion de auditoria/alertas sin base aislada configurada).
- Typecheck, lint, build, OpenAPI y formato: aprobados. La respuesta HTTP del health conserva sus campos; solo cambia la descripcion del endpoint que mide.
- Compose de desarrollo y produccion: validacion correcta, default interno, variable vacia y override personalizados comprobados; issuer, audience y `AUTH_URL` conservan sus valores publicos.

## Resultados en el VPS (2026-10-20)

- Health publico: `authJwksReachable: true`.
- JWKS publico: `200`, clave `EdDSA` y `cf-cache-status: DYNAMIC`.
- `api` healthy; `migrate` y `seed` con codigo `0`; `db`, proxy de socket, Loki y Grafana healthy; Alloy y `cloudflared` en ejecucion.
- Login del ADMIN y peticion protegida desde el navegador: correctos.
- La etiqueta `2026-10-20-r1` esta aplicada en `api`, `migrate` y `seed`; la verificacion de health y login sigue correcta.
