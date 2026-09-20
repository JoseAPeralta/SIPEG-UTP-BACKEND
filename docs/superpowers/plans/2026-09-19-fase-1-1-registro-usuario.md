# Fase 1.1 - Registro de usuario Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar el checklist 1.1 del plan maestro: `POST /api/v1/auth/register` inserta `users` + `accounts` con Argon2id, no devuelve hash, rol inicial `USER`, duplicados de email/identificacion producen 409 y el cuarto intento por minuto produce 429.

**Architecture:** Better Auth 1.7.5 + `prismaAdapter` crea `users` y `accounts`; `auth.service.ts` orquesta y traduce errores a `ApiError`. El registro hoy propaga el 422 de Better Auth (`USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL`) y el P2002 de identificacion queda como 422 generico. Se agrega pre-check de email normalizado e identificacion, se detecta el exito sintetico de Better Auth con `autoSignIn: false` y se traduce el 422 restante a 409 tras re-consultar la BD.

**Tech Stack:** TypeScript, Express 5, Better Auth 1.7.5, Prisma 7, Zod 4, Vitest, Supertest, Bruno.

**Hallazgos de partida (2026-09-19):**

- Email duplicado: Better Auth lanza `APIError` 422 solo sin `autoSignIn: false` (`node_modules/better-auth/dist/api/routes/sign-up.mjs:211`). Con `autoSignIn: false` (configurado en `src/lib/auth.ts:43`) devuelve un **201 sintetico** con un `userId` generado que no existe en BD (`sign-up.mjs:162,202-209`).
- Identificacion duplicada: el P2002 del adapter lo traga Better Auth y lo re-lanza como 422 `FAILED_TO_CREATE_USER` (`sign-up.mjs:230-234`).
- `openapi.json` ya documenta 409 para register (`src/modules/auth/auth.openapi.ts:60`): habia drift semantico.
- Sin tests de 409/429/BD; `auth.routes.test.ts` solo cubria el 201.

---

### Task 1: Tests de servicio (rojo)

**Files:**

- Modify: `src/modules/auth/auth.service.test.ts`

- [x] Test: identificacion duplicada detectada por pre-check `findUnique` produce 409 y no llama a `signUpEmail`.
- [x] Test: email duplicado detectado por pre-check produce 409 y no llama a `signUpEmail`.
- [x] Test: el pre-check normaliza el email a minusculas.
- [x] Test: exito sintetico de Better Auth sin fila persistida produce 409.
- [x] Test: `APIError` 422 de Better Auth con email existente en BD produce 409.
- [x] Test: `APIError` 422 sin conflicto en BD conserva 422.
- [x] Test: el body enviado a `signUpEmail` no incluye `globalRole` (rol inicial `USER` del schema).
- [x] Ejecutar `pnpm vitest run src/modules/auth/auth.service.test.ts` y confirmar fallos por mapeo inexistente.

### Task 2: Tests de ruta (rojo)

**Files:**

- Modify: `src/modules/auth/auth.routes.test.ts`

- [x] Ajustar el mock de `prisma.user.findUnique` para que devuelva usuario solo con `where.id` (login) y `null` en el resto (pre-checks de registro).
- [x] Test: `POST /register` con email duplicado devuelve 409 sin llamar a Better Auth.
- [x] Test: `POST /register` con identificacion duplicada devuelve 409.
- [x] Test: el cuarto `POST /register` en la misma app devuelve 429.
- [x] Assertions de caracterizacion en el 201: solo `data.userId`, sin `password` ni `$argon2`.
- [x] Ejecutar `pnpm vitest run src/modules/auth/auth.routes.test.ts` y confirmar fallos por status inesperado.

### Task 3: Implementacion (verde)

**Files:**

- Modify: `src/modules/auth/auth.service.ts`

- [x] Pre-check `findUnique` por email normalizado y por identificacion; ambos producen `ApiError(409)`.
- [x] Tras `signUpEmail`, verificar que el `userId` devuelto exista en BD; si no, `ApiError(409, 'Email is already registered.')` (cubre el exito sintetico).
- [x] En `catch`, si es `APIError` 422: re-consultar email e identificacion para cubrir la carrera; si no hay conflicto, conservar 422.
- [x] Re-ejecutar los tests de servicio y ruta hasta verde.

### Task 4: Bruno con assertions

**Files:**

- Modify: `bruno/Auth/Register a new user.bru`
- Create: `bruno/Auth/Register duplicate email returns 409.bru`
- Create: `bruno/Auth/Register duplicate identification returns 409.bru`
- Create: `bruno/Auth/Register rate limit returns 429.bru`
- Modify: `README.md` y `CONTEXT.md`

- [x] Pre-request script genera `newUserEmail`/`newUserIdentification` unicos por corrida.
- [x] Post-response del 201 valida status, `data.userId` y ausencia de `$argon2`/`password`.
- [x] Requests de duplicado reutilizan las vars y validan 409.
- [x] Request de rate limit cuenta intentos en runtime var y valida 429 al cuarto sin romper corridas completas.
- [x] `pnpm --dir bruno exec bru run Auth --env local`: 10/10 requests, 7/7 tests.

### Task 5: Verificacion y evidencia

- [x] `pnpm test`: 248 tests, 28 archivos en verde.
- [x] `pnpm run typecheck`, `pnpm run lint`, `pnpm run build`, `pnpm run docs:check` en verde.
- [x] `POST /register` real: 201 con solo `userId`; fila en `users` (`global_role=USER`, `provider_id=credential`) y `accounts.password` con prefijo `$argon2id` y 97 caracteres; `argon2.verify` = true.
- [x] Email duplicado (misma capitalizacion y variante en mayusculas) → 409; identificacion duplicada → 409.
- [x] Cuarto registro dentro del minuto → 429 ("Too many registration attempts.").
- [x] 1.1 marcado con registro de ejecucion en `docs/superpowers/plans/plan-maestro-sipeg-utp.md`.
