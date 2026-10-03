# Hardening del flujo de recuperacion de contrasena

Fecha: 2026-09-29

## Contexto

Diagnostico sobre la relacion entre `POST /api/v1/auth/forgot-password` y
`POST /api/v1/auth/reset-password`. Conclusion: **no son redundantes y el flujo es
correcto**. `forgot-password` genera el token y lo entrega out-of-band (correo);
`reset-password` lo consume. No pueden fusionarse porque el token debe probar
que quien resetea es dueno del buzon. Better Auth expone exactamente estos dos
endpoints y no ofrece alternativa.

El diagnostico destapo tres problemas reales en la implementacion. Este plan
cubre el primero y el segundo.

## Problema 1 - `AUTH_PASSWORD_RESET_URL` fuera de `trustedOrigins`

Better Auth valida `redirectTo` contra `trustedOrigins` **antes** de generar el
token (`origin-check.mjs` -> `originCheck` en `requestPasswordReset`). Si el
origin no esta en la lista, la peticion falla con 403 y **no se envia correo**.

La implementacion actual solo funciona porque el default de
`AUTH_PASSWORD_RESET_URL` coincide por casualidad con `CORS_ORIGIN`. Nada lo
garantiza ni lo documenta. Un frontend servido en otro host rompe el reset de
silencio en produccion, y el OpenAPI ni siquiera documenta el 403.

Arreglo:

- `src/config/env.ts`: nueva regla en el `superRefine` que falla al arrancar
  cuando el origin de `AUTH_PASSWORD_RESET_URL` no esta en
  `CORS_ORIGIN` union `TRUSTED_ORIGINS`.
- `src/lib/auth.ts`: anadir el origin del reset URL al set de `trustedOrigins`.
- `src/modules/auth/auth.openapi.ts`: documentar `403` en `forgot-password`.

## Problema 2 - `/api/auth/*` expone el handler completo

`src/app.ts` monta `toNodeHandler(auth)` bajo `/api/auth/*splat`, bloqueando solo
`sign-up/email`. Eso deja accesibles `/api/auth/request-password-reset`,
`/api/auth/reset-password` y `/api/auth/sign-in/email` sin pasar por los
limitadores de `express-rate-limit`. El limitador interno de Better Auth usa
clave `ip + path` **sin email**, asi que el bucket por email+IP queda sin efecto:
`forgot-password` pasa de 3/min por email+IP a 3/min solo por IP.

Arreglo: allowlist fail-closed. Solo `/api/auth/jwks` es necesario (lo consumen
el verificador JWT y el health check). El resto de la app usa `auth.api.*` en
server-side, que no pasa por el router HTTP.

Se descarta `disabledPaths` de Better Auth: exige enumerar las ~28 rutas core,
no cubre rutas de plugins futuros, y devuelve un 404 crudo que se salta
`notFoundHandler` y su logging.

Cubre T11.1 y T11.2 de `docs/superpowers/plans/logging-y-auditoria.md`.

## Fuera de alcance

**Token en fragment (`#token=` en vez de `?token=`).** Descartado por decision
explícita. El token sigue en query string, igual que el default de Better Auth.
El beneficio real es menor de lo estimado: el `Referer-Policy: no-referrer` de
Helmet protege las respuestas de esta API, pero la pagina de reset la sirve el
frontend, no el backend. El fragmento solo evita la fuga si esa pagina carga
subrecursos cross-origin, y no protege contra el historial del navegador.
Ademas requiere coordinar el cambio con el repo del frontend.

## Pasos

1. Tests fallidos de la regla de `trustedOrigins` en `src/config/env.test.ts`.
2. Implementar la regla en `src/config/env.ts`.
3. Anadir el origin del reset URL a `trustedOrigins` en `src/lib/auth.ts`.
4. Documentar `403` en `forgot-password` y regenerar `openapi.json`.
5. Tests fallidos de la allowlist en `src/app.test.ts`.
6. Implementar la allowlist en `src/app.ts`.
7. Verificar.
8. Alinear documentacion.

## Verificacion

```bash
pnpm test
pnpm run typecheck
pnpm run lint
pnpm run format:check
pnpm run docs:generate
pnpm run docs:check
```

## Rollout

El paso 2 es fail-fast: si produccion tiene el reset URL en un host distinto de
`CORS_ORIGIN` / `TRUSTED_ORIGINS`, **la app deja de arrancar** en vez de fallar
en silencio. Hay que alinear esas variables antes de desplegar.

El paso 6 no rompe clientes: la coleccion Bruno no toca `/api/auth/*` y el
frontend solo consume `/api/auth/jwks`.
