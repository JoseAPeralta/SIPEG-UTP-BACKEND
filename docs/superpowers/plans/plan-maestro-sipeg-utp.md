# Plan Maestro de Implementacion - SIPEG UTP Backend

> **Para agentes:** este es el roadmap global. Antes de ejecutar cada fase, generar su plan detallado con `writing-plans` (TDD, pasos de 2-5 min) y ejecutarlo con `executing-plans`. Cada item es un checklist autodocumentado con su prueba inline.
>
> **Orden logico:** Fases 0-1 (identidad) -> 2 (catalogos, prerrequisito de todo) -> 3-5 (autorizacion, programas, actividades) -> 6-8 (infraestructura transversal, alertas, propuestas) -> 9-11 (asistencia, certificados, reportes) -> 12 (endurecimiento y E2E).

**Objetivo:** Completar el backend REST de SIPEG UTP mediante fases incrementales, verificables y ordenadas por dependencia funcional.

**Arquitectura:** API REST modular con Express y TypeScript, reglas de negocio en servicios, persistencia PostgreSQL mediante Prisma y contratos definidos con Zod/OpenAPI. Las funcionalidades se implementan con TDD y cada fase debe dejar un producto integrado, documentado y comprobable antes de comenzar la siguiente.

**Stack:** Node.js 24, TypeScript, Express 5, Prisma 7, PostgreSQL, Better Auth, JWT EdDSA, Argon2id, Zod, OpenAPI 3.1, Vitest, Supertest y Bruno.

---

## 0. Estado actual

| Area                                                                                                                      | Estado                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Infraestructura: Express, errores, health, entorno, Prisma, Docker, rate limit, Helmet, OpenAPI/Scalar, Bruno y seed      | Implementado; seed dividido en base de produccion (`ensure`) y demo (`sync`), ADR-0005                                                                                                                                                                                                          |
| Autenticacion: login, registro, refresh, logout, verificacion de email, recuperacion de contrasena y cambio de contrasena | Implementados y verificados (1.1-1.7)                                                                                                                                                                                                                                                           |
| Usuarios: `GET/PATCH /users/me`, listado, detalle, creacion y actualizacion admin                                         | `GET/PATCH /users/me` verificado (1.6), `GET /admin/users` verificado (1.8), detalle verificado (1.9), creacion verificada (1.10) y actualizacion verificada (1.11)                                                                                                                             |
| Autorizacion: catalogo, resolucion y delegacion                                                                           | Servicios implementados; endpoints de colaboradores 3.1-3.4, otorgamiento de permisos 3.5, revocacion 3.6, permisos propios 3.7, procedencia de permisos 3.8, vigencia con reloj controlado 3.9 y minimizacion de auditoria 3.10 implementados                                                  |
| Programas: listado con filtros, creacion, actualizacion, consulta, archivado y reactivacion, actividades del programa     | Completada: 4.1-4.7 implementados                                                                                                                                                                                                                                                               |
| Actividades: listado de proximas, consulta, creacion y actualizacion                                                      | Parcial: 5.1-5.4 implementados; faltan 5.5-5.8                                                                                                                                                                                                                                                  |
| Unidades organizativas, carreras y aulas                                                                                  | Implementadas y verificadas (2.A.1-2.A.7, 2.B.1-2.B.3 y 2.C.1-2.C.5); faltan archivos, email, alertas, propuestas, asistencia, certificados y reportes                                                                                                                                          |
| Observabilidad: logs estructurados, pseudonimizacion y auditoria                                                          | Implementados (ADR-0007 y ADR-0008): logs JSON con `requestId`, pseudonimizacion HMAC de actores y 25 acciones de auditoria sobre 11 servicios, con `GET /api/v1/audit-events` y `audit_events` append-only por trigger. Falta la capa de infraestructura (Loki, Alloy, Grafana) y la retencion |
| Archivos, email, alertas, propuestas, asistencia, certificados y reportes                                                 | Pendiente                                                                                                                                                                                                                                                                                       |

Endpoints existentes: `/health`, `/auth/*`, `/users/me`, `/admin/users` (GET/POST), `/admin/users/:id` (GET/PATCH), `/event-programs` y `/event-programs/:id`, `/event-programs/:id/archive`, `/event-programs/:id/reactivate`, `/event-programs/:id/activities`, `/activities` (GET/POST), `/activities/:id` (GET/PATCH/DELETE) y `/activities/:id/cancel`, `/organizational-units` con `POST /organizational-units`, `PATCH /:id`, `POST /:id/deactivate` y `POST /:id/reactivate`, `/careers` con `POST /careers`, `PATCH /:id` y `DELETE /:id`, `/classrooms` con `GET/POST /classrooms`, `GET /classrooms/available`, `GET/PATCH /classrooms/:id` y subrecursos de amenidades y disponibilidad, `GET/POST/PATCH/DELETE /event-programs/:id/collaborators[/:userId]` y `GET/POST/PATCH/DELETE /activities/:id/collaborators[/:userId]`, `POST /event-programs/:id/permissions` y `POST /activities/:id/permissions`, y `DELETE /event-programs/:id/permissions/:permission` y `DELETE /activities/:id/permissions/:permission`, y `GET /users/me/permissions?scope=program|activity&id=`. Los listados de colaboradores exponen `origin` (`LOCAL`/`INHERITED`/`BOTH`) y `effective`, y `GET /users/me/permissions` expone `origin`. La eliminacion fisica de programas no esta expuesta (`405` con `Allow`). La auditoria se consulta en `GET /api/v1/audit-events` (solo `ADMIN`), con paginacion por cursor y filtros por `action`, recurso y scope.

## Definicion de terminado global

Aplicar esta lista al finalizar cada modulo o fase:

- [ ] Crear un plan detallado en `docs/superpowers/plans/YYYY-MM-DD-<modulo>.md` antes de implementar.
- [ ] Aplicar TDD: prueba que falla por la razon esperada, implementacion minima y pruebas en verde.
- [ ] Mantener el modulo en `src/modules/<modulo>/` con schemas Zod, servicio, controlador, rutas y documentacion OpenAPI.
- [ ] Mantener Prisma fuera de controladores y rutas.
- [ ] Agregar permisos nuevos al catalogo canonico y al seed cuando corresponda.
- [ ] Ejecutar `pnpm test`.
- [ ] Ejecutar `pnpm run typecheck`.
- [ ] Ejecutar `pnpm run lint`.
- [ ] Ejecutar `pnpm run build`.
- [ ] Ejecutar `pnpm run docs:generate` y `pnpm run docs:check` cuando cambie el contrato HTTP.
- [ ] Actualizar la coleccion Bruno y restaurar el script de captura de tokens del login.
- [ ] Actualizar seed, `.env.example`, README, CONTEXT, AGENTS y ADRs cuando corresponda.
- [ ] Confirmar que respuestas y logs no contienen hashes, tokens, secretos, CVs ni detalles internos.
- [ ] Validar params, query, body y archivos antes de ejecutar reglas de negocio.

---

## Fase 0 - Revision de cimientos

**Objetivo:** confirmar que la base tecnica es estable antes de ampliar el dominio.

- [x] **0.1 Verificar calidad base.** Ejecutar tests, typecheck, lint y build; registrar el baseline de cobertura.
- [x] **0.2 Revisar health y apagado ordenado.** Confirmar que `/api/v1/health` responde correctamente y que `server.ts` cierra HTTP y Prisma sin perder solicitudes.
- [x] **0.3 Revisar seguridad global.** Confirmar CORS explicito, Helmet, rate limit global y `DOCS_ENABLED=false` en produccion.
- [x] **0.4 Revisar migraciones y seed.** Ejecutar `pnpm prisma:migrate:status` y correr `pnpm prisma:seed` dos veces; el segundo pase no debe duplicar datos.
- [x] **0.5 Revisar OpenAPI.** Confirmar Scalar, `/api/openapi.json` y `pnpm run docs:check` sin drift.
- [x] **0.6 Definir estructura modular.** Decidir si se migran controllers y routes de actividades/programas al patron autocontenido de auth/users o si se documenta la coexistencia.

**Criterio de salida:** todos los comandos de calidad estan en verde, el seed es idempotente y el contrato OpenAPI no tiene drift.

**Registro de ejecucion (2026-09-19):**

- [x] Calidad base: 238 tests en 28 archivos con `typecheck`, `lint` y `build` en verde. Cobertura baseline registrada sin thresholds: statements 85.41%, branches 78.13%, functions 85.16%, lines 86.07%.
- [x] Health: `GET /api/v1/health` responde 200 con `authJwksReachable: true`. Apagado verificado con `node dist/server.js` + SIGTERM (`SIGTERM received. Shutting down gracefully.`). `server.ts` ahora cierra conexiones inactivas y registra errores de listen con `exit(1)` (commit `f88f271`).
- [x] Seguridad: CORS allowlist y headers de Helmet cubiertos por 3 tests nuevos (commit `5e63446`). Rate limit generico diferido a fases 8, 9 y 12.
- [x] Migraciones: 9 aplicadas, `Database schema is up to date`. Seed ejecutado dos veces con conteos identicos (30 usuarios, 10 unidades, 24 carreras, 15 programas, 24 actividades, 13 ponentes, 10 aulas, 35 asistencias con 27 check-in, 27 certificados, 4 propuestas, 37 alertas); sin duplicados.
- [x] OpenAPI: `docs:generate` sin diff y `docs:check` en verde; Scalar y `/api/openapi.json` verificados en vivo.
- [x] Estructura modular normalizada en el commit `a873e51` (0.6).

Hallazgos abiertos:

- `F0-A`: `env.ts` valida `CORS_ORIGIN` como CSV, pero `app.ts` y `auth.ts` lo usan como origen unico. Es fail-closed; alinear validacion y parseo.
- `F0-C`: no existe limiter generico para rutas no-auth; se cubre con limiters especificos en fases 8 y 9 y uno general en Fase 12.

---

## Fase 1 - Identidad, sesiones y gestion de usuarios

**Depende de:** Fase 0.

**Entregable:** ciclo completo de cuenta y administracion segura de usuarios.

### Revision de funcionalidades existentes

- [x] **1.1 Registrar usuario - `POST /api/v1/auth/register`.** Probar que se insertan filas en `users` y `accounts`; `accounts.password` comienza con `$argon2id$` y `argon2.verify` devuelve `true`; nunca se almacena texto plano ni se devuelve el hash; email o identificacion duplicados producen 409; el rol inicial forzado es `USER` y los campos de privilegios se rechazan; el cuarto registro dentro de la ventana limitada produce 429.
- [x] **1.2 Iniciar sesion - `POST /api/v1/auth/login`.** Probar que credenciales validas devuelven access token EdDSA y refresh token, y crean una sesion; credenciales invalidas producen 401 sin revelar si existe el email; el limite de cinco intentos por minuto produce 429.
- [x] **1.3 Renovar sesion - `POST /api/v1/auth/refresh`.** Probar que se entrega un nuevo par de tokens, el refresh anterior deja de funcionar y tokens vencidos o revocados producen 401.
- [x] **1.4 Cerrar sesion - `POST /api/v1/auth/logout`.** Probar que se elimina la sesion correspondiente y que un usuario desactivado no puede usar su access token.
- [x] **1.5 Verificar email y recuperar contrasena.** Probar expiracion de tokens, respuestas que no revelan si un email existe, rate limit y revocacion de sesiones despues de restablecer la contrasena.
- [x] **1.6 Consultar y actualizar perfil - `GET/PATCH /api/v1/users/me`.** Probar aislamiento por usuario, validacion de unidad/carrera y ausencia de `password`, `accounts` y `name` interno.

### Funcionalidades nuevas

- [x] **1.7 Cambiar contrasena - `POST /api/v1/auth/change-password`.** Exigir autenticacion, contrasena actual y nueva contrasena de 12-128 caracteres; revocar las demas sesiones. Probar contrasena actual incorrecta y uso posterior de sesiones revocadas.
- [x] **1.8 Listar usuarios - `GET /api/v1/admin/users`.** Solo ADMIN; agregar paginacion, busqueda y filtros por rol, estado, unidad y carrera. Probar USER -> 403 y ausencia de campos sensibles.
- [x] **1.9 Consultar usuario - `GET /api/v1/admin/users/:id`.** Solo ADMIN; devolver DTO seguro y 404 para identificador inexistente.
- [x] **1.10 Crear usuario administrativo - `POST /api/v1/admin/users`.** Crear `users` y `accounts` con Argon2id, forzar rol `USER` y rechazar roles de entrada; validar conflictos de email e identificacion.
- [x] **1.11 Actualizar usuario - `PATCH /api/v1/admin/users/:id`.** Permitir rol, estado, unidad y carrera; exigir una cuenta ya activa para promoverla a `ADMIN` y separar reactivacion de promocion; al desactivar, eliminar sesiones; impedir que el ultimo ADMIN sea degradado o desactivado e impedir autodesactivacion. Verificado con TDD en esquema (5 pruebas), servicio (12), ruta (10) y contrato (2); verificacion real con revocacion de sesiones y 409 de auto-proteccion; Bruno `Admin` 14/14 requests y 15/15 tests.

**Registro de ejecucion (2026-09-19 - 1.1):**

- [x] Plan detallado en `docs/superpowers/plans/2026-09-19-fase-1-1-registro-usuario.md` con ciclo TDD (rojo verificado para 409 de email/identificacion y exito sintetico sin persistir).
- [x] Hallazgo: con `autoSignIn: false`, Better Auth responde 201 sintetico (userId inexistente) a emails duplicados; `registerUser` ahora pre-valida email normalizado e identificacion, y verifica la persistencia del `userId` devuelto. El 422 restante se traduce a 409 re-consultando BD. OpenAPI ya documentaba 409, sin cambios de contrato.
- [x] Pruebas: `pnpm test` 248 tests en verde; `typecheck`, `lint`, `build`, `docs:check` en verde.
- [x] Verificacion real: 201 con solo `userId`; `users.global_role=USER`; `accounts.provider_id=credential`; `accounts.password` prefijo `$argon2id` (97 chars) con `argon2.verify=true`; email duplicado (misma y distinta capitalizacion) 409; identificacion duplicada 409; cuarto intento por minuto 429.
- [x] Bruno: `Auth/Register a new user` con pre-request y assertions, mas requests de duplicado y rate limit; `bru run Auth --env local` 10/10 requests y 7/7 tests.

**Registro de ejecucion (2026-09-19 - 1.2):**

- [x] Plan detallado en `docs/superpowers/plans/2026-09-19-fase-1-2-login-usuario.md` con ciclo TDD (rojo de JWKS enmascarado como 401, luego verde).
- [x] Hallazgo: el catch de `loginWithPassword` normalizaba el `ApiError('User not found.')` interno a 401 generico, pero tambien convertia en 401 un fallo legitimo de JWKS (`ApiError(500)`). Se agrego el passthrough `if (error instanceof ApiError) throw error;` en `throwBetterAuthError` y el mensaje interno paso a `'Invalid credentials.'`. Sin cambio de contrato.
- [x] Pruebas: `pnpm test` 266 tests en 29 archivos en verde; `typecheck`, `lint`, `build`, `format:check`, `docs:check` en verde (sin diff en `openapi.json`).
- [x] Verificacion real (stack Docker dev con codigo recargado): login del admin responde 200 `tokenType=Bearer`; JWT `alg=EdDSA`, `sub=seed_user_admin`, `role=ADMIN`, `iss/aud=http://localhost:3000`; fila en `sessions` ligada al `userId` del admin con TTL de 7 dias; password incorrecta y email inexistente responden 401 con cuerpos identicos `"Invalid email or password"`; login con email en mayusculas responde 200; sexto intento por minuto (IP aislada) responde 429.
- [x] Bruno: assertions en `Auth/Log in with email and password` y nuevos `Auth/Login wrong password returns 401`, `Auth/Login unknown email returns 401` y `Auth/Login rate limit returns 429`; `bru run Auth --env local` 13/13 requests y 12/12 tests.
- [x] Hallazgo `F1-A` (diferido a 1.4/1.11): Better Auth no valida `isActive` en login; un usuario desactivado puede emitir tokens nuevos, pero `authenticate` bloquea su uso con 403. Decidir en 1.4 si el login debe rechazarlo y eliminar la sesion recien creada.
- [x] Nota operativa: `tsx watch` dentro del contenedor no siempre detecta cambios del bind mount; tras editar `src/` conviene `docker compose -f compose.dev.yaml restart api`.

**Registro de ejecucion (2026-09-19 - 1.3):**

- [x] Plan detallado en `docs/superpowers/plans/2026-09-19-fase-1-3-refresh-sesion.md` con ciclo TDD (rojo de rotacion, expiracion y carrera; luego verde).
- [x] Implementacion: `refreshAccessToken` valida `expiresAt`, firma el access token EdDSA y reemplaza `sessions.token` con `updateMany` atomico (`where: { token, expiresAt: { gt: now } }`). El token anterior deja de existir; si la carrera pierde (`count !== 1`) responde 401. La rotacion conserva `createdAt` y `expiresAt` de la sesion (sin sliding).
- [x] Pruebas: `pnpm test` 271 tests en 29 archivos en verde; `typecheck`, `lint`, `build`, `format:check`, `docs:check` en verde (sin diff en `openapi.json`).
- [x] Verificacion real (stack Docker dev recargado): login -> refresh rota 32->43 caracteres, mismo `session.id`, mismo `createdAt`/`expiresAt`, token anterior 401 y token nuevo 200; access token `alg=EdDSA`; sesion vencida insertada en BD responde 401 `Refresh token has expired.`; logout elimina la fila y el token revocado responde 401 `Refresh token is invalid.`
- [x] Bruno: assertions en `Auth/Refresh the access token` y `Auth/Log out and revoke the refresh token`, mas `Auth/Refresh reused token returns 401`; `bru run Auth --env local` 14/14 requests y 15/15 tests.
- [x] Hallazgo `F1.3-A` (diferido a 1.4): `AUTH_REFRESH_TTL` esta documentado en `.env.example`, README y AGENTS, pero `src/lib/auth.ts` hardcodea 7 dias. Cablearlo al crear sesiones.
- [x] Hallazgo `F1.3-B` (diferido a 1.4): la rotacion mantiene la expiracion absoluta; decidir si el producto quiere sliding (extender la sesion en cada refresh).

**Registro de ejecucion (2026-09-19 - 1.4):**

- [x] Plan detallado en `docs/superpowers/plans/2026-09-19-fase-1-4-logout-sesion.md` con ciclo TDD (rojo de login/refresh inactivos y del conversor TTL; luego verde).
- [x] Implementacion: `src/utils/ttl.ts` compartido (`parseTtlToMilliseconds`/`parseTtlToSeconds`); `loginWithPassword` y `refreshAccessToken` rechazan cuentas inactivas con 401 generico y eliminan la sesion involucrada; `src/lib/auth.ts` usa `expiresIn: parseTtlToSeconds(AUTH_REFRESH_TTL)` y `disableSessionRefresh: true`; ambos compose inyectan `AUTH_REFRESH_TTL`; `.env.example` documentado.
- [x] Pruebas: `pnpm test` 288 tests en 29 archivos en verde en la fase (hoy 30 archivos por el trabajo concurrente de 1.5); `typecheck`, `lint`, `build`, `format:check` y `docs:check` verdes; `openapi.json` sin drift.
- [x] Verificacion real: logout con dos sesiones revoca solo la indicada (401 en la revocada, 200 en la otra); cuenta inactiva responde 403 con access token previo, 401 en refresh y login, sin sesiones nuevas (usuario demo restaurado con `trap`); `AUTH_REFRESH_TTL=2h` produce una sesion de 7200 s y el contenedor se restauro a `7d`.
- [x] Bruno: nuevo `Auth/Logout revoked token returns 401` y pre-request `revokedRefreshToken`; la reutilizacion del token revocado responde 401 y `bru run Auth --env local` cierra 15/15 requests y 16/16 tests.
- [x] Hallazgos cerrados: `F1-A` (login/refresh de inactivos con revocacion), `F1.3-A` (`AUTH_REFRESH_TTL` cableado) y `F1.3-B` (expiracion absoluta sin sliding).
- [x] Desviacion: el request nuevo agotaba `loginRateLimit` en la corrida completa (5/min) y `Login unknown email` recibia 429; se aislo con `X-Forwarded-For` para que `Login rate limit returns 429` siga siendo el sexto intento del bucket compartido.

**Registro de ejecucion (2026-09-19 - 1.5):**

- [x] Plan detallado en `docs/superpowers/plans/2026-09-19-fase-1-5-verificacion-email-reset-password.md` con las 6 tareas cerradas y evidencia de cierre.
- [x] Implementacion: `src/lib/email.ts` (Nodemailer, TLS 1.2 minimo, `requireTLS` en produccion, credenciales opcionales), plantillas con enlaces escapados en `src/modules/auth/auth.email.ts`, callbacks no bloqueantes en `src/lib/auth.ts` (`requireEmailVerification`, `sendOnSignUp`, `autoSignInAfterVerification: false`, `revokeSessionsOnPasswordReset: true`, TTLs desde entorno) y errores genericos para tokens invalidos/vencidos sin reflejarlos.
- [x] Limites independientes por IP: forgot y reset 3/min, verificacion 5/min; el flujo interno de Better Auth quedo corregido a `/request-password-reset`.
- [x] `F0-B` resuelto: migracion `20260920041816_add_jwks_metadata` (`expires_at`, `alg`, `crv`); `createJwk` persiste `null` explicito para `exactOptionalPropertyTypes`.
- [x] Entorno: Mailpit `axllent/mailpit:v1.27.8` solo en desarrollo con UI en loopback, SMTP obligatorio en produccion y variables `MAIL_*`/`AUTH_*` documentadas en `.env.example` y compose.
- [x] Pruebas: 78 en la suite dirigida de 1.5; `pnpm test` 321 en 32 archivos; `typecheck`, `lint`, `build`, `format:check`, `docs:check` y `migrate:status` (11 migraciones) en verde.
- [x] Verificacion real con PostgreSQL y Mailpit: verificacion 200 y token vencido 400 generico; mismo 200 para email existente e inexistente; cuarta solicitud de reset por minuto 429; reset valido 200 y vencido 400; ambos refresh tokens del usuario revocados y sesion de otro usuario intacta; Argon2id conservado verificando la nueva password; password anterior 401 y nueva 200; el access JWT previo sigue valido hasta su TTL corto. Filas temporales eliminadas.
- [x] Bruno: `bru run Auth --env local` con 17/17 requests y 21/21 tests, incluidos anti-enumeracion y los limites de login, registro, forgot/reset y verificacion.
- [x] Notas: se elimino un test duplicado/huerfano en `auth.routes.test.ts` que rompia el parseo; la suite completa convivio con el trabajo concurrente de 1.6 y cerro 321/321. Sin commit: el usuario no lo solicito.

**Registro de ejecucion (2026-09-19 - 1.6):**

- [x] Plan detallado en `docs/superpowers/plans/2026-09-19-fase-1-6-perfil-usuario.md` con las 6 tareas cerradas.
- [x] Pruebas de ruta (9 nuevas, 12 en el archivo): dos tokens con `sub` distinto devuelven su propio perfil; `PATCH` escribe solo `where: { id: <sub> }`; respuestas sin `name`, `accounts`, `password`, `passwordHash` ni `emailVerified`; mass assignment (`globalRole`, `isActive`, `email`, `id` ajenos) se descarta y solo persiste `firstName`; body vacio o solo con claves desconocidas -> 400; unidad inactiva -> 400; carrera de otra unidad -> 400; perfil ausente tras autenticar -> 404.
- [x] Pruebas de esquema (6 nuevas, 11 en el archivo): `userProfileSchema` recorta campos internos de Better Auth; `updateProfileSchema` rechaza body vacio/desconocido, recorta claves no permitidas y hace trim de nombres.
- [x] Contrato: `PATCH /users/me` documenta 409 (carrera global `Otros` ausente) con rojo previo en `openapi.test.ts`; `docs:generate` y `docs:check` sin drift.
- [x] Bruno: assertions en `Users/Get` y `Users/Update`, request `Users/Update profile with an unknown unit returns 400` y variables `profileFirstName`/`profileLastName`/`unknownUnitId`; `bru run Auth --env local` 17/17 requests y 21/21 tests; `bru run Users --env local --env-var token=...` 3/3 requests y 5/5 tests. El script de captura de tokens del login queda intacto.
- [x] Verificacion real (stack Docker, admin + organizador.fic): perfiles aislados y sin campos sensibles; `PATCH` con `globalRole`/`isActive`/`email`/`id` ajenos responde 200 conservando rol `USER` en respuesta y BD; admin intacto tras el `PATCH` del organizador; unidad/carrera inexistente 400; nombres del organizador restaurados y filas temporales eliminadas; sin tokens en logs.
- [x] Calidad: `pnpm test` 321 en 32 archivos, `typecheck`, `lint`, `build`, `format:check` y `docs:check` en verde.
- [x] Nota operativa: las runtime vars de Bruno (`token` capturado por el login) no cruzan carpetas en una misma invocacion (`bru run Auth Users`); usar `--env-var token=...` o ejecutar carpetas por separado.
- [x] Sin commit: el usuario no lo solicito.

**Registro de ejecucion (2026-09-19 - 1.7):**

- [x] Plan detallado en `docs/superpowers/plans/2026-09-19-fase-1-7-cambio-password.md` con TDD (rojos de esquema, servicio y ruta verificados; 6 fallos 404 antes de montar el endpoint).
- [x] Contrato: `POST /api/v1/auth/change-password` con `authenticate -> changePasswordRateLimit -> validate`; body `currentPassword`, `newPassword` (12-128) y `refreshToken`; 200 vacio, 400 `Current password is incorrect.` / `Refresh token is invalid.`, 401/403 y 429.
- [x] Implementacion: `changePassword` verifica `accounts.password` con Argon2id, hashea la nueva y en una transaccion actualiza el hash y elimina `sessions` del usuario distintas de la actual (la sesion identificada por el `refreshToken` del body). Limiter dedicado de 5/min por usuario. `openapi.json` regenerado sin drift.
- [x] Pruebas nuevas: esquema (4), servicio (4) y ruta (6); `pnpm test` 357 en 32 archivos; `typecheck`, `lint`, `build`, `format:check` y `docs:check` en verde.
- [x] Verificacion real (Docker dev, usuario temporal verificado via Mailpit y eliminado al final): contrasena actual incorrecta 400 sin cambiar el hash; cambio 200; refresh de la sesion revocada 401 y de la actual 200; login con la contrasena anterior 401 y con la nueva 200; hash `$argon2id$v=19$m=19456,t=2,p=1$` distinto al anterior; 2 sesiones vivas (actual rotada + login nuevo) y filas revocadas eliminadas; logs sin hashes ni tokens.
- [x] Bruno: `Auth/Change password without a token returns 401` (seq 10) y `Auth/Change password with a wrong current password returns 400` (seq 11); corrida limpia `bru run Auth --env local` 19/19 requests y 24/24 tests.
- [x] Desviacion: la verificacion E2E inicial excedio el `loginRateLimit` compartido por login y refresh; se ajusto a comprobar el hash por BD y esperar la ventana de 60 s. Dos corridas Bruno dentro del mismo minuto reutilizan buckets y fallan con 429/401; la corrida limpia posterior quedo en verde.
- [x] Sin commit: el usuario no lo solicito.

**Registro de ejecucion (2026-09-19 - 1.8):**

- [x] Plan detallado en `docs/superpowers/plans/2026-09-19-fase-1-8-listar-usuarios.md` con ciclo TDD rojo/verde en esquemas (5 pruebas), servicio (4), ruta (7) y contrato OpenAPI (2).
- [x] Implementacion: `listUsersQuerySchema` (`.strict()`, `isActive` booleano real, `page`/`limit` 1-50), componentes `AdminUser`/`PaginatedUsers`, `adminUserSelect` sin `name`/`accounts`/`password`/`emailVerified` y `GET /api/v1/admin/users` con `authenticate -> requireAdmin -> validate -> controlador`.
- [x] Pruebas: `pnpm test` 346 pruebas en 32 archivos en verde; suite dirigida `src/modules/users src/docs` 82 en 6 archivos.
- [x] Verificacion real (stack Docker, seed demo): admin 200 `total=45` sin campos sensibles; `USER -> 403`; filtros contrastados con psql (`globalRole=ADMIN -> 1`, `unitId=seed_unit_fic -> 17`, `q=arosemena -> 1`, `isActive=true -> 45`); `limit=51 -> 400`. Script temporal eliminado.
- [x] Bruno: `bru run Admin --env local` 4/4 requests y 5/5 tests; carpeta `Admin` propia porque las runtime vars no cruzan carpetas.
- [x] Contrato: `docs:generate` y `docs:check` sin drift; tag `Admin` y parametros de query documentados.
- [x] Calidad: `pnpm test`, `build`, formato de los archivos tocados y `docs:check` en verde. `typecheck` y `lint` globales fallan unicamente por el trabajo concurrente de 1.7 (`src/modules/auth/auth.service.test.ts`, `src/modules/auth/auth.schemas.test.ts`); eslint dirigido al modulo `users` pasa.
- [x] Sin commit: el usuario no lo solicito.

**Registro de ejecucion (2026-09-20 - 1.9):**

- [x] Plan detallado en `docs/superpowers/plans/2026-09-20-fase-1-9-consultar-usuario.md` con ciclo TDD rojo/verde en esquema (3 pruebas), servicio (3), ruta (7) y contrato OpenAPI (3).
- [x] Implementacion: `adminUserParamsSchema` (trim, 1-100 caracteres), `getUserById` reutilizando `adminUserSelect` con `404 User not found.`, `GET /api/v1/admin/users/:id` con `authenticate -> requireAdmin -> validate(params) -> controlador -> servicio` y `AdminUser` reutilizado en OpenAPI (sin componentes nuevos).
- [x] Pruebas: `pnpm test` 372 en 32 archivos en verde; suite dirigida `src/modules/users src/docs` 96 en 6 archivos; `typecheck`, `lint`, `build`, `format:check` y `docs:check` en verde.
- [x] Verificacion real (stack Docker, seed demo): admin 200 `id=seed_user_org-fic isActive=true` sin `$argon2`/`passwordHash`/`accounts`/`emailVerified`; `USER -> 403`; id inexistente 404 `User not found.`; id de solo espacios 400. Contrastado con psql (fila existe = 1, inexistente = 0). Script temporal eliminado.
- [x] Bruno: `Admin/Get user by id` (seq 5) y `Admin/Get unknown user returns 404` (seq 6) con `targetUserId`/`unknownUserId`; `bru run Admin --env local` 6/6 requests y 7/7 tests.
- [x] Contrato: `docs:generate` y `docs:check` sin drift; operacion, path param `id` y respuestas 400/401/403/404 documentadas.
- [x] Documentacion: README y CONTEXT describen el detalle administrativo y sus errores.
- [x] Sin commit: el usuario no lo solicito.

**Registro de ejecucion (2026-09-20 - 1.10):**

- [x] Plan detallado en `docs/superpowers/plans/2026-09-20-fase-1-10-crear-usuario-admin.md` con TDD rojo/verde en esquema (7 pruebas), servicio (13), ruta (8) y contrato (2).
- [x] Implementacion: `createUserSchema` estricto (`AdminUserCreate`, defaults `USER`/activo), `POST /api/v1/admin/users` con `authenticate -> requireAdmin -> validate -> controlador`, `createUser` con pre-chequeos normalizados de email/identificacion, transaccion `users` + `accounts` con `hashPassword` (Argon2id), re-chequeo post-carrera (`P2002 -> 409`) y `emailVerified=false` + `auth.api.sendVerificationEmail` tolerante a fallos.
- [x] Refactor: `resolveOrganizationAssignment` extraido de `updateProfile` y reutilizado por creacion y actualizacion (1.11 lo reutiliza); reglas de unidad/carrera/`OTROS` sin cambios y pruebas 1.6 intactas.
- [x] Pruebas: 1.10 suma 30 (7+13+8+2); `pnpm test` 492 en 35 archivos en verde; suite dirigida `src/modules/users src/docs` 160 en 6 archivos.
- [x] Verificacion real (Docker dev + Mailpit): 401/403; 201 con DTO seguro; `accounts.provider_id=credential` y `argon2.verify=true` sobre `$argon2id$`; `email_verified=false` con rol/estado/unidad/carrera; email duplicado 409; identificacion duplicada 409; unidad invalida 400; login sin verificar 403; verificacion por token de Mailpit 200 y login 200; filas temporales eliminadas (count 0) y 404 posterior.
- [x] Bruno: `Admin/Create user` (seq 7), `Create duplicate user returns 409` (8), `Create user as USER returns 403` (9) y `Create user without a token returns 401` (10); `bru run Admin --env local` 10/10 requests y 11/11 tests.
- [x] Contrato: `docs:generate` y `docs:check` sin drift; operacion, 201/400/401/403/409 y componente `AdminUserCreate`.
- [x] Documentacion: README y CONTEXT describen creacion, verificacion obligatoria y conflictos.
- [x] Hallazgos: `F1.10-A` `sendVerificationEmail` aplica un piso constante de 500 ms (anti-enumeracion); `F1.10-B` el token de verificacion es un JWT firmado, no una fila en `verification`; `F1.10-C` no hay endpoint de reenvio de verificacion (diferido).
- [x] Concurrencia: 1.11 y 2.A editaron el mismo modulo en paralelo; se restauro el import de `createUserSchema` que 1.11 dejo fuera y se corrigio `snapshot['id']` (TS4111 sin cambio de comportamiento) en su helper de pruebas. Gates globales finales en verde: `pnpm test` 492 en 35 archivos, `typecheck`, `lint`, `build`, `format:check` y `docs:check`.
- [x] Sin commit: el usuario no lo solicito.

**Registro de ejecucion (2026-09-20 - 1.11):**

- [x] Plan detallado en `docs/superpowers/plans/2026-09-20-fase-1-11-actualizar-usuario.md` con ciclo TDD rojo/verde en esquema (5 pruebas), servicio (12), ruta (10) y contrato OpenAPI (2).
- [x] Implementacion: `updateAdminUserSchema` (rol/estado/unidad/carrera; body vacio o solo con claves desconocidas -> 400), `updateAdminUser(actorId, targetId, input)` que reutiliza `resolveOrganizationAssignment` (extraido por 1.10), rechaza autodesactivacion y autodegradacion con `409`, protege al ultimo admin activo con `count` y ejecuta `user.update` + `session.deleteMany` en una `$transaction`; ruta `PATCH /api/v1/admin/users/:id` con `authenticate -> requireAdmin -> validate -> controlador -> servicio`.
- [x] Pruebas: suite dirigida `src/modules/users src/docs` 160 en 6 archivos; `pnpm test` 492 en 35 archivos en verde; `typecheck`, `lint`, `build`, `format:check` y `docs:check` en verde.
- [x] Verificacion real (stack Docker dev, seed demo, usuario `organizador.fie`): `USER -> 403`; id inexistente 404; body vacio/desconocido 400; `unitId: null` fuerza `OTROS` y luego se restaura unidad/carrera originales; unidad/carrera inexistente y carrera de otra unidad 400; promover/degradar a otro admin 200; autodesactivacion y autodegradacion 409 sin perder acceso; desactivacion 200 con access 403, refresh 401, login 401 y `sessions = 0` en psql; reactivacion 200 y login 200 con estado final `USER | t`. Script temporal eliminado.
- [x] Bruno: `Admin/Update user` (seq 7), `Update unknown user returns 404` (8), `Update own account returns 409` (9) y `Update user as USER returns 403` (10) con variable `adminUserId`; `bru run Admin --env local` 14/14 requests y 15/15 tests (incluye los requests de 1.10).
- [x] Contrato: `docs:generate` y `docs:check` sin drift; operacion `PATCH`, path param `id`, body y respuestas 200/400/401/403/404/409; se reutilizan `AdminUser` y `adminUserSelect` sin componentes nuevos.
- [x] Documentacion: README y CONTEXT describen el endpoint, sus invariantes y la revocacion de sesiones.
- [x] Nota operativa: la corrida Bruno agoto el rate limit de login por IP y el check de login de cuenta desactivada respondio 429 en el primer intento; reintentado tras la ventana de 60 s respondio 401.
- [x] Hallazgo `F1.11-A`: la guarda del ultimo admin activo es defensa en profundidad inalcanzable via API (el actor siempre es un admin activo; la auto-proteccion responde antes cuando el objetivo es el mismo), queda cubierta por pruebas unitarias y protege refactors futuros.
- [x] Concurrencia: 1.10 y 2.A convivieron en el mismo modulo y arbol; el helper de organizacion extraido por 1.10 se reutilizo en 1.11. Sin commit: el usuario no lo solicito.
- [x] Concurrencia al cierre: la sesion 2.B (carreras) incorporo despues 62 pruebas (554 en 38 archivos) y dejo pendientes un `TS4111` y formato en sus propios archivos; los gates dirigidos de 1.11 (`src/modules/users src/docs` y eslint) quedaron en verde.

**Registro de endurecimiento (2026-09-26 - roles iniciales):**

- [x] Registro publico: `registerSchema` es estricto, rechaza campos de rol/estado/permisos, Better Auth mantiene `globalRole` como `input: false` con `defaultValue=USER` y `POST /api/auth/sign-up/email` queda bloqueado para conservar una unica via publica.
- [x] Creacion administrativa: `AdminUserCreate` ya no acepta `globalRole`; `createUser` escribe `USER` explicitamente como defensa en profundidad y conserva `isActive` configurable.
- [x] Promocion: `PATCH /api/v1/admin/users/:id` solo permite `USER -> ADMIN` cuando la cuenta ya esta activa y la peticion no la desactiva; reactivacion y promocion son operaciones separadas.
- [x] TDD: 16 fallos esperados antes de implementar; suite dirigida 232/232 y suite completa 1011/1011 en 46 archivos. `typecheck`, `lint`, `build` y `docs:check` en verde; formato dirigido en verde. `format:check` global conserva un unico fallo previo y ajeno en `actualizacion_tesis.md`.

**Criterio de salida:** flujo register -> login -> refresh -> logout -> reset completo, administracion de usuarios probada, OpenAPI y Bruno actualizados.

---

## Fase 2 - Catalogos institucionales

**Depende de:** Fase 1.

**Entregable:** unidades, carreras y aulas administrables como base de programas y actividades.

- [x] **2.0 Seed base de produccion.** Separar la data institucional estable (permisos, unidades, programas predeterminados, carreras y aulas) y el ADMIN inicial via `SEED_ADMIN_*` en `prisma/seed.base.ts` (modo `ensure`: crea solo lo que falta, nunca sobrescribe ediciones). El seed demo queda en `prisma/seed.ts` (modo `sync`, solo desarrollo). La API depende de un servicio one-shot `seed` en `compose.prod.yaml`. Ver `docs/adr/adr-0005-production-baseline-seed.md` y `docs/superpowers/plans/2026-09-19-seed-base-produccion.md`.
- [x] **2.0.a Verificacion.** `prisma/seed/base.seed.test.ts` (10 pruebas con Prisma fake); seed base real dos veces en BD desechable con conteos identicos (10 unidades, 25 carreras `24 + Otros`, 10 programas predeterminados, 10 aulas, 19 permisos, 1 ADMIN) y mutaciones preservadas; permisos faltantes recreados; seed demo idempotente; imagen `migrate` ejecuta `migrate deploy` y `prisma/seed.base.ts` en Docker.

### 2.A Unidades organizativas

- [x] **2.A.1 Listar unidades - `GET /api/v1/organizational-units`.** Mostrar activas por defecto con filtro por `type`, busqueda y paginacion.
- [x] **2.A.2 Consultar unidad - `GET /api/v1/organizational-units/:id`.** Incluir carreras y programa predeterminado.
- [x] **2.A.3 Crear unidad - `POST /api/v1/organizational-units`.** Solo ADMIN; crear unidad y programa default ACTIVE dentro de una transaccion. Probar que un fallo no deja una unidad sin programa y que un codigo duplicado produce 409.
- [x] **2.A.4 Actualizar unidad - `PATCH /api/v1/organizational-units/:id`.** Solo ADMIN; editar nombre, descripcion y encargado activo; mantener `code` y `type` inmutables.
- [x] **2.A.5 Desactivar unidad - `POST /api/v1/organizational-units/:id/deactivate`.** Rechazar si el programa default tiene actividades programadas o en curso; documentar y ejecutar atomicamente el tratamiento del programa default.
- [x] **2.A.6 Reactivar unidad - `POST /api/v1/organizational-units/:id/reactivate`.** Reactivar unidad y programa default existente en una sola transaccion; probar rollback completo ante fallos.
- [x] **2.A.7 Mantener la invariante del programa default.** No permitir archivarlo mientras la unidad permanezca activa.

**Registro de ejecucion (2026-09-20 - 2.A):**

- [x] Plan detallado en `docs/superpowers/plans/2026-09-20-fase-2-a-unidades-organizativas.md` con ciclo TDD rojo/verde en esquemas (14 pruebas), servicio (25), rutas (19) y contrato OpenAPI (3).
- [x] Implementacion: modulo `src/modules/organizational-units/` autocontenido (tipos, esquemas, servicio, controlador, rutas y OpenAPI) montado en `src/routes.ts`. Lecturas publicas con `isActive=true` por defecto; gestion exclusiva de `ADMIN`.
- [x] 2.A.3: creacion transaccional unidad + programa predeterminado `ACTIVE` con nombre `Programa de Eventos - <unidad>`; `code` normalizado a mayusculas y unico (pre-check + traduccion de `P2002`); `headId` validado como usuario activo. La prueba de fallo verifica que ambas escrituras viven en una sola transaccion.
- [x] 2.A.5: desactivacion rechaza `SCHEDULED`/`ONGOING` del programa predeterminado con `409`; la transaccion actualiza primero la unidad y luego archiva el programa (`archivedAt`), orden exigido por el trigger de BD y fijado con `invocationCallOrder`.
- [x] 2.A.6: reactivacion actualiza solo `organizational_units.is_active`; el trigger `organizational_units_reactivate_default_program` restaura el programa existente en la misma transaccion.
- [x] 2.A.7: verificacion SQL directa contra PostgreSQL rechaza archivar el default de FIC con la unidad activa (`a default event program cannot be archived while its owner is active`).
- [x] Pruebas: `pnpm test` 492 en 35 archivos en verde (58 del modulo: 14 esquemas + 25 servicio + 19 rutas; 3 del contrato OpenAPI; 23 en `src/docs`).
- [x] Verificacion real (stack Docker dev, seed demo): 39/39 checks E2E con admin y USER; listado publico con filtros, detalle con carreras/encargado y sin PII, 201/409/404/400/403, ciclo desactivar/reactivar con `ARCHIVED`/`ACTIVE`, FIC bloqueado con `409`. Contraste psql y limpieza de unidades `TMP-*` con el trigger `event_programs_prevent_delete` deshabilitado en una transaccion (10 unidades y 10 programas predeterminados restaurados).
- [x] Bruno: nueva carpeta `Organizational_Units` con 14 requests y 15 tests (`bru run Organizational_Units --env local` en verde), mas variables `unitId`/`unitHeadId` en `bruno/environments/local.bru`.
- [x] Contrato: `docs:generate` y `docs:check` sin drift; 6 operaciones nuevas, tag `Organizational Units` y componentes `OrganizationalUnitSummary`/`OrganizationalUnitDetail`/`OrganizationalUnitHead`/`OrganizationalUnitCareer`/`DefaultEventProgram`/`PaginatedOrganizationalUnits`.
- [x] Calidad: `build`, `lint` y `docs:check` en verde; `typecheck` y `format:check` globales fallan solo por el trabajo concurrente de 1.10/1.11 (archivo y plan ajenos). Gates dirigidos en verde.
- [x] Documentacion: README y CONTEXT describen el catalogo, la gestion ADMIN y el ciclo desactivar/reactivar.
- [x] Notas: sin migraciones, variables de entorno ni permisos nuevos (decision 7: catalogos solo ADMIN). Renombrar una unidad no sincroniza el nombre del programa predeterminado. Sin commit: el usuario no lo solicito.

### 2.B Carreras

- [x] **2.B.1 Listar carreras - `GET /api/v1/careers`.** Filtro por unidad, busqueda y paginacion. Sin `isActive`: toda carrera del catalogo es seleccionable.
- [x] **2.B.2 Crear y actualizar carreras.** Solo ADMIN; `unitId` opcional (carreras globales como `Otros`); validar que la unidad sea FACULTY y este activa cuando se indique; codigo duplicado produce 409.
- [x] **2.B.3 Eliminar carreras.** Sin `isActive` no hay desactivacion: `DELETE` permitido solo si la carrera no tiene usuarios asociados; con usuarios responde 409. Ver `docs/adr/adr-0006-career-catalog-without-active-flag.md`.

**Registro de ejecucion (2026-09-20 - 2.B):**

- [x] Plan detallado en `docs/superpowers/plans/2026-09-20-fase-2-b-carreras.md` con ciclo TDD rojo/verde en esquemas (14 pruebas), servicio (28), rutas (20) y contrato OpenAPI (3 nuevas; 28 en `src/docs`).
- [x] Implementacion: modulo `src/modules/careers/` autocontenido (tipos, esquemas, servicio, controlador, rutas y OpenAPI) montado en `src/routes.ts`; `GET /api/v1/careers` publico y `POST`/`PATCH`/`DELETE` con `authenticate -> requireAdmin`.
- [x] 2.B.1: paginacion offset (`page`/`limit` 1-50) y busqueda `q` en nombre/codigo; `unitId=<id>` devuelve las carreras de la facultad mas las globales (`unitId: null`), `unitId=global` solo las globales; sin `isActive` y con filtros combinados via `AND` para evitar colisiones de claves `OR`.
- [x] 2.B.2: `unitId` opcional/null; unidad inexistente 404, no `FACULTY` 400 (`Careers can only belong to a faculty.`), inactiva 400; `code` normalizado a mayusculas, unico y con pre-check + traduccion de `P2002` a 409.
- [x] 2.B.3 y protecciones confirmadas: `DELETE` 204 sin usuarios y 409 `Career has associated users.` con conteo dentro de la transaccion; la carrera global `OTROS` no se elimina (409), no cambia de codigo y debe permanecer global; cambiar de unidad una carrera con usuarios asociados responde 409.
- [x] Pruebas: `pnpm test` 557 en 38 archivos en verde (62 del modulo: 14 esquemas + 28 servicio + 20 rutas; 3 pruebas nuevas del contrato).
- [x] Verificacion real (stack Docker dev, seed demo): 26/26 checks E2E con admin y USER; listado publico, filtros por unidad/global/busqueda, 201/409/404/400/403, protecciones de `OTROS` y de carreras con usuarios, `DELETE` 204 y limpieza por psql (25 carreras, `OTROS` global con nombre `Otros` restaurado).
- [x] Bruno: nueva carpeta `Careers` con 12 requests y 13 tests (`bru run Careers --env local` en verde) y variables `careerId`/`otrosCareerId`/`newCareerId`/`newCareerCode`/`unknownCareerId` en `bruno/environments/local.bru`.
- [x] Contrato: `docs:generate` y `docs:check` sin drift; 4 operaciones nuevas, tag `Careers` y componentes `CareerUnit`/`CareerSummary`/`PaginatedCareers`.
- [x] Documentacion: README y CONTEXT describen el catalogo, el filtro unidad+globales, las protecciones y el `DELETE` 204.
- [x] Notas: sin migraciones, variables de entorno ni permisos nuevos (decision 7: catalogos solo ADMIN). Desviacion menor en Bruno: `bru.getVar` no lee variables de environment dentro de los tests, se usan codigos del seed (`FIC`) en las assertions. Sin commit: el usuario no lo solicito.

### 2.C Aulas

- [x] **2.C.1 Listar aulas - `GET /api/v1/classrooms`.** Filtros por tipo, capacidad minima, amenidades y estado; paginacion.
- [x] **2.C.2 Crear y actualizar aulas.** Solo ADMIN; validar tipo, capacidad mayor que cero, edificio y piso.
- [x] **2.C.3 Gestionar amenidades.** Agregar y quitar amenidades sin duplicados; validar formato y longitud.
- [x] **2.C.4 Gestionar ventanas de disponibilidad.** Validar `dayOfWeek` 1-7, `startTime < endTime` y ausencia de solapes; un solape produce 409.
- [x] **2.C.5 Consultar aulas disponibles - `GET /api/v1/classrooms/available`.** Filtrar por fecha, hora y capacidad; considerar ventanas y actividades SCHEDULED/ONGOING en `America/Panama`; actividades CANCELLED no bloquean.

**Registro de ejecucion (2026-09-20 - 2.C):**

- [x] Plan detallado en `docs/superpowers/plans/2026-09-20-fase-2-c-aulas.md` con ciclo TDD rojo/verde en la utilidad de dia ISO (3 pruebas), esquemas (24), servicio (23), rutas (18) y contrato OpenAPI (3 nuevas; 31 en `src/docs`).
- [x] Implementacion: modulo `src/modules/classrooms/` autocontenido (tipos, esquemas, servicio, controlador, rutas y OpenAPI) montado en `src/routes.ts`; lecturas publicas y gestion exclusiva de `ADMIN`. Sin migraciones, variables de entorno ni permisos nuevos (decision 7: catalogos solo ADMIN).
- [x] 2.C.1: `GET /classrooms` con `isActive=true` por defecto, filtros `type`, `minCapacity`, `amenity` (case-insensitive) e `isActive`, paginacion offset 1-50 y amenidades en el resumen.
- [x] 2.C.2: `POST`/`PATCH /classrooms` validan nombre (1-50), tipo, capacidad positiva hasta 100000, edificio (50) y piso (-5..100); body estricto y no vacio; `PATCH isActive=false` responde `409` si hay actividades `SCHEDULED`/`ONGOING`. Se agrego `GET /classrooms/:id` con `amenities` y `availability` para la superficie de lectura.
- [x] 2.C.3: `POST`/`DELETE /classrooms/:id/amenities[/:amenity]` normalizan espacios, limitan a 50 con formato de letras/numeros/espacios/guiones, rechazan duplicados case-insensitive con `409` y eliminan con casing distinto al almacenado.
- [x] 2.C.4: `POST`/`DELETE /classrooms/:id/availability[/:id]` validan `dayOfWeek` ISO 1-7, `startTime < endTime` y solapes con `409` (intervalos semiabiertos: 07:00-12:00 y 12:00-17:00 conviven); la traduccion de `P2002` cubre la carrera.
- [x] 2.C.5: `GET /classrooms/available` exige `date`/`startTime`/`endTime`, acepta `minCapacity`/`type`/`amenity`, deriva el dia ISO de la fecha institucional, exige cobertura de ventana y excluye actividades `SCHEDULED`/`ONGOING` con solape horario (mismo criterio que la exclusion GiST `activities_classroom_no_overlap`); `DRAFT`, `COMPLETED` y `CANCELLED` no bloquean.
- [x] Utilidad: `getInstitutionalDayOfWeek` en `src/utils/date.ts` con pruebas de lunes, sabado, domingo e independencia de zona horaria.
- [x] Pruebas: `pnpm test` 628 en 41 archivos en verde; `typecheck`, `lint`, `build`, `format:check` y `docs:check` en verde.
- [x] Verificacion real (stack Docker dev, seed demo): 37/37 checks E2E con admin y USER sobre un aula temporal; CRUD, normalizacion y `409` de amenidad duplicada con casing distinto, `409` de solape y adyacencia aceptada, `available` el sabado 2026-10-03 excluye `lab-electronica` por actividad `SCHEDULED`, incluye `lab-redes`, una actividad `CANCELLED` movida temporalmente a 2026-10-05 no bloquea `aula-101`, una actividad que inicia al terminar el intervalo no bloquea `auditorio`, filtros de disponibilidad y `409` al desactivar `lab-electronica`. Contraste psql y limpieza total (10 aulas, 24 amenidades, 105 ventanas; fecha de la actividad cancelada restaurada).
- [x] Bruno: nueva carpeta `Classrooms` con 19 requests y 19 tests (`bru run Classrooms --env local` en verde) y variables `classroomId`/`newClassroomId`/`unknownClassroomId`/`availabilityId` en `bruno/environments/local.bru`.
- [x] Contrato: `docs:generate` y `docs:check` sin drift; 9 operaciones nuevas, tag `Classrooms` y componentes `ClassroomSummary`/`ClassroomDetail`/`ClassroomAvailability`/`PaginatedClassrooms`/`CreateClassroom`/`UpdateClassroom`/`AddClassroomAmenity`/`AddClassroomAvailability`.
- [x] Documentacion: README y CONTEXT describen el catalogo, la gestion ADMIN, la convencion `dayOfWeek` ISO, el tratamiento de solapes y disponibilidad.
- [x] Notas: la sesion concurrente de 2.B dejo `src/routes.ts` con `careersRoutes` montado sin import; se restauro el import para mantener el arbol compilable. Sin commit: el usuario no lo solicito.

**Criterio de salida:** creacion transaccional unidad+programa demostrada en BD y disponibilidad de aulas cubierta con pruebas de fronteras y solapes.

---

## Fase 3 - API de autorizacion por colaboracion

**Depende de:** Fases 1 y 2.

**Entregable:** exponer los servicios existentes de delegacion y permisos mediante API segura.

- [x] **3.1 Listar colaboradores.** Crear `GET /event-programs/:id/collaborators` y `GET /activities/:id/collaborators`, protegidos por `permission:grant` en el scope.
- [x] **3.2 Agregar colaborador.** Crear `POST .../collaborators`; materializar permisos `ROLE_DEFAULT`; probar que un actor no puede otorgar permisos que no posee.
- [x] **3.3 Cambiar rol.** Crear `PATCH .../collaborators/:userId`; reemplazar `ROLE_DEFAULT` y preservar `OVERRIDE`.
- [x] **3.4 Eliminar colaborador.** Crear `DELETE .../collaborators/:userId`; impedir que el scope quede sin un actor capaz de delegar.
- [x] **3.5 Otorgar permiso.** Crear `POST .../permissions`; validar subconjunto y atenuacion temporal; un envelope acotado no puede crear grants ilimitados.
- [x] **3.6 Revocar permiso.** Crear `DELETE .../permissions/:permission`; no revocar herencia del programa desde una actividad; devolver 409 claro.
- [x] **3.7 Consultar permisos propios.** Crear `GET /api/v1/users/me/permissions?scope=program|activity&id=` con envelopes temporales.
- [x] **3.8 Exponer procedencia de permisos.** En detalles privados mostrar `inherited`, `local` y `effective`. Ver registro de ejecucion.
- [x] **3.9 Ignorar permisos vencidos sin borrarlos.** Probar con reloj controlado.
- [x] **3.10 Minimizar auditoria expuesta.** No devolver `grantedById` ni `grantedAt` salvo a actores autorizados.

**Registro de ejecucion (2026-09-20 - 3.1/3.2):**

- [x] Plan detallado en `docs/superpowers/plans/2026-09-20-fase-3-1-3-2-colaboradores.md` con ciclo TDD rojo/verde en servicio (7 pruebas nuevas), esquemas (7), rutas (13) y contrato OpenAPI (2).
- [x] Implementacion: `listCollaborators` y `addCollaborator` (retorna DTO) en `delegation.service.ts`; `authorization.schemas.ts`/`controller.ts`/`routes.ts`/`openapi.ts`; montaje en `src/routes.ts`; DTO `Collaborator`/`CollaboratorPermission`/`CollaboratorList`.
- [x] Decisiones: modulo `authorization` extendido; `GET` devuelve permisos locales con `source`/`validFrom`/`validUntil` sin `grantedById`/`grantedAt` (3.10); listado solo local del scope (herencia en 3.8); `POST` a programa `ARCHIVED` responde `409`.
- [x] Guardas nuevas: 404 si el programa no existe (antes `addCollaborator` producia una violacion de FK) y 409 si esta `ARCHIVED`; el rol asignado se valida contra los envelopes del actor (subconjunto) y el body es estricto.
- [x] Pruebas: `pnpm test` 656 en 43 archivos en verde; `typecheck`, `lint`, `build`, `format:check`, `docs:generate` y `docs:check` en verde.
- [x] Verificacion real (stack Docker dev, seed demo): `org-fisc` lista `seed_program_congreso-cit` con 17 permisos incluido `permission:grant` `OVERRIDE`; actividad lista solo `seed_user_editor`; head 403 en su programa default sin grant; head agrega `seed_user_visor` como VIEWER (201) y psql confirma 1 colaboracion + 5 filas `ROLE_DEFAULT` con `granted_by_id = seed_user_org-fisc`; duplicado 409, rol invalido 400, archivado 409, programa inexistente 404; limpieza total verificada.
- [x] Bruno: nueva carpeta `Collaborators` con 14 requests y 15 tests (`bru run Collaborators --env local` en verde) y variables `collaboratorsProgramId`/`collaboratorsActivityId`/`archivedProgramId`/`unknownProgramId`.
- [x] Contrato: 4 operaciones nuevas, tag `Collaborators` y componentes `Collaborator`/`CollaboratorPermission`/`CollaboratorList`; `openapi.json` regenerado sin drift.
- [x] Documentacion: README y CONTEXT describen los endpoints, el subconjunto simetrico y el rechazo de programas archivados. Sin migraciones, variables de entorno ni permisos nuevos.
- [x] Hallazgo `F3.2-A`: la carrera `findFirst` + `create` de `addCollaborator` puede producir `P2002` (500) si dos peticiones simultaneas agregan al mismo usuario; diferido. Sin commit: el usuario no lo solicito.

**Registro de ejecucion (2026-09-20 - 3.3):**

- [x] Plan detallado en `docs/superpowers/plans/2026-09-20-fase-3-3-cambiar-rol.md` con ciclo TDD rojo/verde en servicio (6 pruebas nuevas/actualizadas), esquemas (6), rutas (9) y contrato OpenAPI (2).
- [x] Implementacion: `updateCollaboratorRole` ahora devuelve `CollaboratorDetail`, carga el programa del scope (`404`/`409 Archived event programs cannot be modified.`), valida subconjunto simetrico bidireccional y relee el colaborador dentro de la transaccion (`findUniqueOrThrow` con `collaboratorSelect`) tras actualizar rol, borrar `ROLE_DEFAULT` y recrearlos; los `OVERRIDE` quedan intactos.
- [x] Decisiones confirmadas con el usuario: `PATCH` responde `200` con el DTO (consistente con `POST` 3.2) y la guarda simetrica cubre los `ROLE_DEFAULT` que se eliminan (`403 Cannot remove a collaborator with permissions you do not hold.`), alineada con `removeCollaborator` y ADR-0001.
- [x] Rutas `PATCH /api/v1/event-programs/:id/collaborators/:userId` y `PATCH /api/v1/activities/:id/collaborators/:userId` con `authenticate -> requirePermission(PERMISSION_GRANT, scope) -> validate -> controlador`; body estricto `{ role }` y params `id`/`userId` recortados (1-100).
- [x] Pruebas: `pnpm test` 676 en 43 archivos en verde; `typecheck`, `lint`, `format:check`, `build`, `docs:generate` y `docs:check` en verde.
- [x] Verificacion real (stack Docker dev, seed demo, usuario temporal): `PATCH` VIEWER -> EDITOR 200 con 11 `ROLE_DEFAULT` y `OVERRIDE` `report:export` (ventana 30 dias, `granted_by_id = seed_user_org-fisc`) intacto en DTO y psql; colaborador desconocido 404, rol invalido 400, sin token 401, programa archivado 409; head sin grant en su programa default 403 y head con grant en `seed_program_congreso-cit` cambia VIEWER -> EDITOR 200 (11 defaults); limpieza total (`collaborations=16`, `collaboration_permissions=238`, 0 usuarios temporales).
- [x] Bruno: 8 requests nuevos en `Collaborators` (re-login admin/head, update 200, 404, 400, 401, 409 y 403); `bru run Collaborators --env local` 22/22 requests y 23/23 tests en verde.
- [x] Contrato: 2 operaciones `PATCH` nuevas con params `id`/`userId`, body `{ role }` y respuestas 200/400/401/403/404/409; `openapi.json` regenerado sin drift y test de contrato actualizado.
- [x] Documentacion: README y CONTEXT describen el PATCH, el reemplazo/preservacion y las guardas. Sin migraciones, variables de entorno ni permisos nuevos.
- [x] Hallazgo `F3.3-A` (diferido): los `ROLE_DEFAULT` se materializan sin atenuacion temporal; un actor con envelope acotado puede crear defaults ilimitados via rol. Se aborda con los grants explicitos de 3.5. Sin commit: el usuario no lo solicito.

**Registro de ejecucion (2026-09-20 - 3.4):**

- [x] Plan detallado en `docs/superpowers/plans/2026-09-20-fase-3-4-eliminar-colaborador.md` con ciclo TDD rojo/verde en servicio (10 pruebas nuevas/actualizadas), esquemas (3), rutas (7) y contrato OpenAPI (2).
- [x] Decisiones confirmadas con el usuario: `DELETE` responde `204` sin cuerpo (precedente `DELETE /careers/:id`), programa `ARCHIVED` responde `409` (consistente con `POST`/`PATCH`) y la guarda de ultimo delegador es invariante para todos, incluido `ADMIN` (precedente del ultimo admin en 1.11).
- [x] Implementacion: `removeCollaborator` carga el programa del scope (`404`/`409`), mantiene la guarda simetrica existente y agrega `assertScopeKeepsDelegator`; `isGrantActive` se exporto desde `authorization.service.ts` con parametro estructural para reutilizar la semantica de ventanas. La guarda solo se evalua si el objetivo puede delegar (`permission:grant` vigente o `globalRole=ADMIN` con cuenta activa).
- [x] Semantica de "capaz de delegar": colaborador activo del scope con `permission:grant` vigente en `now` o `globalRole=ADMIN`; en actividades cuentan las colaboraciones heredadas del programa (`OR`) y un ADMIN global que no colabora no cuenta. Mensaje `409 Cannot remove the last collaborator able to delegate in this scope.`
- [x] Rutas `DELETE /api/v1/event-programs/:id/collaborators/:userId` y `DELETE /api/v1/activities/:id/collaborators/:userId` con `authenticate -> requirePermission(PERMISSION_GRANT, scope) -> validate(collaboratorUserParamsSchema) -> controlador`; esquema de params compartido con el `PATCH`.
- [x] Pruebas: `pnpm test` en verde (global con el trabajo concurrente de detalle de actividades; se restauro en `src/docs/openapi.test.ts` la entrada `GET /api/v1/activities/{id}` que esa sesion dejo fuera de `expectedOperations`); `typecheck`, `lint`, `build`, `format:check`, `docs:generate` y `docs:check` en verde.
- [x] Verificacion real (stack Docker dev, seed demo, usuario temporal A): alta VIEWER 201 con 5 `ROLE_DEFAULT`; `DELETE` admin 204 con cascada total en psql; segundo `DELETE` 404, sin token 401, head sin grant en su programa default 403, archivado 409; `DELETE` de `seed_user_org-fisc` en `congreso-cit` 409 con admin y con head (fila intacta); con `OVERRIDE` manual de `permission:grant`, head borra a A 204 (head sigue como delegador); alta/baja en la actividad 201/204; limpieza total (`collaborations=16`, `collaboration_permissions=238`, 0 usuarios temporales).
- [x] Bruno: 9 requests nuevos en `Collaborators` (delete 403 sin grant, re-login admin, delete 204, repetido 404, 401, archivado 409, ultimo delegador 409, alta/baja en actividad); `bru run Collaborators --env local` 31/31 requests y 32/32 tests en verde.
- [x] Contrato: 2 operaciones `DELETE` nuevas con params `id`/`userId` y respuestas 204/400/401/403/404/409; `openapi.json` regenerado sin drift y test de contrato actualizado.
- [x] Documentacion: README y CONTEXT describen el DELETE, la cascada, la guarda del ultimo delegador y el 409 de archivado. Sin migraciones, variables de entorno ni permisos nuevos.
- [x] Hallazgo `F3.4-A` (diferido): dos `DELETE` concurrentes de delegadores distintos pueden pasar ambos la guarda y dejar el scope sin delegador (misma familia que `F3.2-A`); requeriria aislamiento serializable. Sin commit: el usuario no lo solicito.

**Registro de ejecucion (2026-09-20 - 3.5):**

- [x] Plan detallado en `docs/superpowers/plans/2026-09-20-fase-3-5-otorgar-permiso.md` con ciclo TDD rojo/verde en servicio (4 pruebas nuevas y 3 actualizadas), esquemas (6), rutas (8) y contrato OpenAPI (2 operaciones + 1 prueba).
- [x] Decisiones confirmadas con el usuario: solo 3.5 (3.6 va en su propia sesion por la regla de herencia) y `POST .../permissions` responde `200` con el `Collaborator` actualizado (el upsert refleja el estado final de los grants locales, sin distinguir creacion de reemplazo).
- [x] Implementacion: `grantPermission` devuelve `CollaboratorDetail` (upsert + re-lectura con `collaboratorSelect` dentro de `$transaction`), agrega `loadScopeProgram` (`404 Event program not found.`) y la guarda `409 Archived event programs cannot be modified.`, consistentes con 3.1-3.4; `grantPermissionSchema` con `permission` contra el catalogo y ventanas ISO 8601 opcionales/nullable transformadas a `Date`; controlador y rutas `POST /api/v1/event-programs/:id/permissions` y `POST /api/v1/activities/:id/permissions` con `authenticate -> requirePermission(PERMISSION_GRANT, scope) -> validate -> controlador`.
- [x] Pruebas: `pnpm test` 762 en 44 archivos en verde; suites dirigidas `src/modules/authorization src/modules/event-programs src/modules/activities` 259 en 11 archivos; `typecheck`, `lint`, `build`, `docs:generate` y `docs:check` en verde; `format:check` global solo reporta los planes concurrentes de 4.2 y 5.2 y todos los archivos de 3.5 pasan.
- [x] Verificacion real (stack Docker dev, seed demo, usuario temporal): 18/18 checks E2E con admin y head; grant acotado `report:export` 200 y re-grant reemplaza la ventana sin duplicar; permiso desconocido 400; colaborador inexistente 404; archivado 409; sin token 401; grant de actividad 200; head otorga `permission:grant` dentro de su envelope 200 (psql `granted_by_id=seed_user_org-fisc`), sin ventana 403 `Grant window starts before the delegator grant.`, fuera del envelope 403 `Grant window exceeds the delegator grant.` y head sin grant en su programa default 403. Limpieza total y conteos restaurados (`collaborations=16`, `collaboration_permissions=238`, `users=59`).
- [x] Bruno: 13 requests nuevos en `Collaborators` (setup, grant 200, re-grant, 400, 404, 409, 401, login head, grant acotado 200, 403 sin ventana, 403 fuera de ventana, re-login admin y limpieza 204); `bru run Collaborators --env local` 44/44 requests y 45/45 tests en verde. Los logins nuevos usan `X-Forwarded-For` propio porque la carpeta ya consume el bucket de 5/min por IP.
- [x] Contrato: 2 operaciones `POST` nuevas con params `id`, body `{ userId, permission, validFrom?, validUntil? }` y respuestas 200/400/401/403/404/409; `openapi.json` regenerado sin drift y prueba de contrato actualizada.
- [x] Documentacion: README y CONTEXT describen el POST, el upsert, la atenuacion temporal y las guardas. Sin migraciones, variables de entorno ni permisos nuevos.
- [x] Hallazgo `F3.5-A` (diferido): un grant con ventana totalmente pasada se acepta si el actor tiene envelope (el resolver lo ignora); no se agrega validacion extra en 3.5. Sin commit: el usuario no lo solicito.

**Registro de ejecucion (2026-09-21 - 3.6):**

- [x] Plan detallado en `docs/superpowers/plans/2026-09-21-fase-3-6-revocar-permiso.md` con ciclo TDD rojo/verde en servicio (12 pruebas nuevas y 2 actualizadas), esquemas (5), rutas (8) y contrato OpenAPI (2 operaciones + 1 prueba).
- [x] Decisiones confirmadas con el usuario: el DELETE borra solo grants locales y responde `204` sin cuerpo; si no hay fila local y el permiso esta heredado activo desde el programa (scope de actividad) responde `409 Cannot revoke a permission inherited from the event program.`; si hay fila local se elimina aunque el permiso siga vigente por herencia (ADR-0001 NEG-001, sin `DENY` local); se aplica la invariante de ultimo delegador (`409 Cannot revoke the last delegation permission in this scope.`) incluyendo al objetivo si conserva `permission:grant` heredado; el usuario objetivo viaja en `?userId=`.
- [x] Implementacion: `revokePermission` agrega `loadScopeProgram` (404/409), selecciona la colaboracion local con su fila del permiso, resuelve la herencia activa con `isGrantActive` y ejecuta `deleteMany` con 404; helper `assertRevokeKeepsDelegator` que escanea las colaboraciones del scope (programa + actividad) y excluye solo la colaboracion local del objetivo; `revokePermissionSchema` (params `id`/`permission` contra el catalogo, query `userId` estricta); controlador y rutas `DELETE /api/v1/event-programs/:id/permissions/:permission` y `DELETE /api/v1/activities/:id/permissions/:permission` con `authenticate -> requirePermission(PERMISSION_GRANT, scope) -> validate -> controlador`.
- [x] Pruebas: `pnpm test` 870 en 44 archivos en verde; suite dirigida `src/modules/authorization src/modules/event-programs src/modules/activities` 345 en 11 archivos; `typecheck`, `lint`, `build` y `docs:check` en verde; `openapi.json` regenerado sin drift.
- [x] Verificacion real (stack Docker dev, seed demo): 35/35 checks E2E con admin y head; revocacion de `ROLE_DEFAULT` y de `OVERRIDE` 204 con psql (4 y 0 filas), repetido 404, permiso desconocido/`userId` en blanco o ausente 400, colaborador desconocido 404, archivado 409, sin token 401, head sin grant en su programa default 403; herencia `report:export` de `seed_user_org-fisc` en `fisc-charla-ia` 409 con la fila del programa intacta; revocacion local de `activity:read` de `seed_user_editor` en la actividad 204 conservando la herencia del programa (fila restaurada); ultimo delegador `permission:grant` de `congreso-cit` 409 con la fila intacta; ciclo de actividad 201/204/204/204; conteos restaurados (`collaborations=16`, `collaboration_permissions=238`, `users=59`). Script temporal eliminado.
- [x] Bruno: 16 requests nuevos en `Collaborators` (seq 46-61) con setup, revocacion de default y override 204, listado posterior sin el permiso, 404/400/404/401/409/409/409, ciclo de actividad y limpieza; `bru run Collaborators --env local` 60/60 requests y 61/61 tests en verde. Una corrida previa fallo con `socket hang up` porque `tsx watch` reinicio la API durante la ejecucion; la segunda corrida quedo limpia.
- [x] Contrato: 2 operaciones `DELETE` nuevas con params `id`/`permission` (enum del catalogo) y query `userId`, respuestas 204/400/401/403/404/409; `openapi.json` regenerado sin drift y prueba de contrato actualizada.
- [x] Documentacion: README y CONTEXT describen el DELETE, la herencia 409, la semantica local+herencia y el ultimo delegador. Sin migraciones, variables de entorno ni permisos nuevos.
- [x] Hallazgo `F3.6-A` (diferido): la comprobacion de ultimo delegador y el `deleteMany` no comparten transaccion; dos revocaciones concurrentes de delegadores distintos pueden pasar la guarda (misma familia que `F3.4-A`), requeriria aislamiento serializable. Sin commit: el usuario no lo solicito.
- [x] Concurrencia: 3.7 y 4.3 editaron los mismos archivos de `authorization`, `src/docs` y el plan maestro en paralelo; `format:check` global solo reporta sus archivos (`authorization.schemas.ts`, `authorization.routes.test.ts`, `openapi.test.ts` en el bloque 3.7) y sus planes; todos los archivos de 3.6 pasan.

**Registro de ejecucion (2026-09-21 - 3.7):**

- [x] Plan detallado en `docs/superpowers/plans/2026-09-21-fase-3-7-permisos-propios.md` con ciclo TDD rojo/verde en servicio (6 pruebas nuevas), esquemas (6), rutas (6) y contrato OpenAPI (2; 39 en `src/docs`).
- [x] Decisiones confirmadas con el usuario: respuesta plana `{ scope: { type, id }, permissions: [{ name, validFrom, validUntil }] }` con permisos efectivos unidos (la procedencia llega en 3.8); `404` si el scope no existe y `200` con lista (posiblemente vacia) si existe aunque sea `DRAFT`/`ARCHIVED`; endpoint en el modulo `authorization` con tag `Collaborators`.
- [x] Implementacion: `OwnPermissionsScope`/`OwnPermissionEnvelope`/`OwnPermissions` en `authorization.types.ts`; `listOwnPermissions` en `authorization.service.ts` (resuelve el scope, valida programa inexistente con `404 Event program not found.` porque `resolveScope` solo valida actividades, reutiliza `getPermissionEnvelopes` y mapea a ISO 8601 ordenado por nombre); `ownPermissionsQuerySchema` estricto (`scope` enum, `id` 1-100 recortado) y componentes `OwnPermission`/`OwnPermissions`; `GET /api/v1/users/me/permissions` con `authenticate -> validate -> controlador -> servicio` (sin `requirePermission`: cualquier autenticado lee sus propios permisos).
- [x] Pruebas: `pnpm test` 870 en 44 archivos (incluye el trabajo concurrente de 3.6 y 4.3); suite dirigida `src/modules/authorization src/modules/users src/docs` 336 en 11 archivos; `typecheck`, `lint`, `build` y `docs:check` en verde; `format:check` global solo reporta el plan concurrente de 4.3; `openapi.json` regenerado sin drift.
- [x] Verificacion real (stack Docker dev, seed demo): 28/28 checks con admin, head, editor, visor y estudiante; admin 19 permisos sin limite; head `congreso-cit` con `permission:grant` acotado `[2026-09-20, 2026-11-19]` contrastado con psql; head `fisc_default` 16 defaults `ORGANIZER`; editor en la actividad `fisc-charla-ia` 11 defaults + `certificate:generate` con la ventana del programa; visor `fct_default` sin `report:export` y la fila vencida sigue en BD (ignorada sin borrarse, anticipo de 3.9); estudiante lista vacia; `scope=team`/`id` ausente/`id` en blanco 400; programa y actividad inexistentes 404; sin token y token invalido 401; sin `grantedById`/`grantedAt`/`source`; conteos intactos (16 colaboraciones, 238 permisos) = cero escrituras. Script temporal eliminado.
- [x] Bruno: nueva carpeta `My_Permissions` (6 requests, 6 tests) con login propio del head por `X-Forwarded-For`; `bru run My_Permissions --env local` 6/6 requests y 6/6 tests. Carpeta separada para no colisionar con los seq 46-61 de la sesion concurrente de 3.6.
- [x] Contrato: operacion `GET` con bearer, query params `scope`/`id`, respuestas 200/400/401/404 y componentes `OwnPermission`/`OwnPermissions`; `openapi.json` sin drift.
- [x] Documentacion: README, CONTEXT y AGENTS describen el endpoint, la union de herencia, la minimizacion de auditoria y los 400/404. Sin migraciones, variables de entorno ni permisos nuevos.
- [x] Hallazgos: `F3.7-A` la guarda de programa inexistente vive en `listOwnPermissions` (no en `resolveScope`) para no cambiar la semantica de `requirePermission` (403) ante programas inexistentes; `F3.7-B` `getPermissionEnvelopes` re-resuelve el scope de actividad para no-admin (doble lookup por PK), consistente con `delegation.service`.
- [x] Concurrencia: 3.6 y 4.3 editaron los mismos archivos de `authorization` y `src/docs` en paralelo; se uso una carpeta Bruno propia, edits con anclas unicas y re-lectura antes de cada edicion. Sin commit: el usuario no lo solicito.

**Registro de ejecucion (2026-09-21 - 3.8):**

- [x] Plan detallado en `docs/superpowers/plans/2026-09-21-fase-3-8-procedencia-permisos.md` con ciclo TDD rojo/verde en el servicio de autorizacion (3 pruebas nuevas y 3 actualizadas), el servicio de delegacion (4 nuevas y 2 actualizadas), esquemas (4) y contrato OpenAPI (2).
- [x] Decisiones confirmadas con el usuario: alcance en los dos listados de colaboradores y en `GET /users/me/permissions`; DTO con `origin` + `effective` y solo grants vigentes (los vencidos siguen en BD); respuestas de mutacion sin cambios (mantienen el `Collaborator` con grants locales).
- [x] Implementacion: `PermissionOrigin` (`LOCAL`/`INHERITED`/`BOTH`), `CollaboratorListPermissionDetail`/`CollaboratorListDetail` y `origin` en `OwnPermissionEnvelope`; `resolvePermissionEntries` en `authorization.service.ts` fusiona local+heredado conservando procedencia, filtra por vigencia y resuelve `source` (prefiere el `OVERRIDE` local activo); `getPermissionProvenance` reemplaza el mapeo de `listOwnPermissions`; `listCollaborators` resuelve programa+actividad y calcula la procedencia por colaborador.
- [x] Hallazgos corregidos durante la fase: `source` caia a `ROLE_DEFAULT` en permisos heredados con `OVERRIDE` del programa (se propago `source` en la herencia y se priorizo el `OVERRIDE` activo); el listado de una actividad duplicaba al colaborador que tambien colabora en el programa (el `OR` traia la colaboracion del programa como registro local; ahora la primera consulta es solo del scope y la herencia se resuelve en memoria).
- [x] Contrato: componentes `CollaboratorListDetail`/`CollaboratorListPermission` (sin renombrar `Collaborator`/`CollaboratorPermission`, que quedan para mutaciones) y `origin` en `OwnPermission`; descripciones de listado y permisos propios actualizadas; `openapi.json` regenerado sin drift.
- [x] Pruebas: suites dirigidas `src/modules/authorization src/docs` 228 en 8 archivos en verde; `typecheck`, `build` y `docs:check` en verde.
- [x] Bruno: `List program collaborators` verifica `origin: LOCAL`, envelope y ausencia de auditoria; `List activity collaborators` verifica `INHERITED`, `BOTH` y `effective`; `My_Permissions` verifica `origin` en program y activity; `bru run Collaborators --env local` 60/60 requests y 62/62 tests, `bru run My_Permissions --env local` 6/6 requests y 7/7 tests.
- [x] Verificacion real (stack Docker dev, seed demo, usuario temporal `e2e-3-8@utp.ac.pa` VIEWER en la actividad y ORGANIZER en el programa): listado de la actividad con `BOTH` en los 5 defaults locales (`program:read`, `activity:read`, `certificate:read`, `proposal:read`, `report:view`) e `INHERITED` en `certificate:generate`, `program:update` y `report:export`, sin `permission:grant` (no es default de rol) y sin `grantedById`/`grantedAt`; `OVERRIDE` local vencido insertado por SQL omitido de la respuesta y conservado en BD (anticipo de 3.9); `/users/me/permissions` del head (programa, todo `LOCAL`) y del editor (actividad, `LOCAL`/`INHERITED`/`BOTH`); listado de programa con `origin: LOCAL` en todos; limpieza total y conteos baseline restaurados (16 colaboraciones, 238 permisos, 63 usuarios).
- [x] Documentacion: README, CONTEXT y AGENTS describen la procedencia, el envelope fusionado y la omision de grants no vigentes. Sin migraciones, variables de entorno ni permisos nuevos.
- [x] Hallazgos `F3.8-A`: `BOTH` es inalcanzable via `/users/me/permissions` con el modelo aditivo actual (un permiso de un usuario viene de una colaboracion local o del programa, no de ambas filas a la vez); queda reservado en el contrato y cubierto por las pruebas del listado. `F3.8-B`: `permission:grant` no puede ser `ROLE_DEFAULT` de ningun rol, asi que la procedencia heredada de un delegado real proviene siempre de un `OVERRIDE`. Sin commit: el usuario no lo solicito.

**Registro de ejecucion (2026-09-21 - 3.9):**

- [x] Plan detallado en `docs/superpowers/plans/2026-09-21-fase-3-9-permisos-vencidos.md` con 6 tareas cerradas. Item de verificacion: sin cambios de produccion; `isGrantActive` y todos los caminos de decision ya filtraban por vigencia y no existia borrado automatico de grants vencidos.
- [x] Reloj controlado: `vi.useFakeTimers({ toFake: ['Date'] })` introducido en el repo. Fronteras de `isGrantActive` (`validUntil` exclusivo, `validFrom` inclusivo); `getEffectivePermissions` y `listOwnPermissions` con `now` por defecto a traves de `T0`, `T0 + 1h` y `T0 + 2h`; `listCollaborators` y la guarda de ultimo delegador de `removeCollaborator` con el reloj del sistema; y `GET /event-programs/:id/collaborators` (403 al vencer `permission:grant`) y `GET /users/me/permissions` (omision de vencidos/futuros) con el resolutor real (`loadAppWithRealAuthorization`, antes mockeado) y fake Date.
- [x] Sin borrado: los mocks Prisma de los tres archivos aseveran que `collaborationPermission.create/update/deleteMany` (y `upsert/createMany`) nunca se llaman durante las lecturas con grants vencidos.
- [x] No-vacuidad: con `isGrantActive` forzado a `true` fallaron 7 pruebas de autorizacion, 7 de delegacion y exactamente las 2 nuevas de rutas; restaurado y verde.
- [x] Pruebas: suite dirigida `src/modules/authorization` 183 en 5 archivos (176 antes; 7 nuevas); `pnpm test` 925 en 45 archivos en verde (913/44 antes; las otras 5 pruebas y el archivo nuevo son de la sesion concurrente de `methodNotAllowed`); `typecheck`, `lint`, `build`, `format:check` y `docs:check` en verde.
- [x] Verificacion real (stack Docker dev, seed demo): baseline 238 filas; `/users/me/permissions` de `visor` en `seed_program_fct_default` omite el `OVERRIDE` vencido de `report:export` y el listado de colaboradores de admin lo confirma con `effective: true` y sin `grantedById`/`grantedAt`; ciclo futuro con `editor` (VIEWER + `report:export` con `validFrom` manana) ignorado en la respuesta y persistido (244 filas), revertido con `DELETE` 204; `permission:grant` vencido insertado por SQL produce 403 en el listado como `visor` y la fila permanece; limpieza total (238 filas, 0 colaboraciones temporales, fila historica intacta) y logs sin errores.
- [x] Contrato: sin cambios (`openapi.json` sin drift) y sin requests Bruno nuevos; las respuestas de mutacion conservan los grants locales segun la decision 3.8 #3.
- [x] Hallazgo `F3.9-A` (diferido, ya registrado como `F3.5-A`): una ventana totalmente pasada se acepta al otorgar y queda ignorada por el resolver; 3.9 no agrega validacion adicional.
- [x] Sin commit: el usuario no lo solicito.

**Registro de ejecucion (2026-09-21 - 3.10):**

- [x] Plan detallado en `docs/superpowers/plans/2026-09-21-fase-3-10-minimizar-auditoria.md` con pruebas de caracterizacion (4 en delegacion, 1 en autorizacion y 2 en rutas) y no-vacuidad rompiendo temporalmente los mappers (`toCollaboratorDetail`/`toCollaboratorListDetail`/map de `listOwnPermissions`), con rojos observados y restauracion verificada por `grep`.
- [x] Decision confirmada con el usuario: nunca exponer `grantedById`/`grantedAt`, ni a `ADMIN`; sin cambios de DTOs, `select`, migraciones, dependencias ni variables de entorno.
- [x] Pruebas nuevas: filas con auditoria en `listCollaborators`, `addCollaborator`, `updateCollaboratorRole`, `grantPermission` y `listOwnPermissions` no la propagan al DTO; los `select` no la solicitan; control positivo de escritura (`create.data`, `createMany.data`, `upsert.create`); rutas con servicios reales: `GET /users/me/permissions` (resolutor real) y `POST /event-programs/:id/collaborators` (nuevo loader `loadAppWithRealDelegation` y `PrismaMock` extendido).
- [x] Contrato: nota "Audit fields (`grantedById`, `grantedAt`) are never returned." en `addDescription`, `updateDescription`, `grantDescription` y `ownPermissionsDescription`; `openapi.json` regenerado sin drift y `docs:check` en verde.
- [x] Bruno: `My_Permissions` agrega la asercion de ausencia en programa y actividad (`bru run My_Permissions --env local` 6/6 requests y 9/9 tests); `Collaborators` sigue en 60/60 requests y 62/62 tests.
- [x] Verificacion real (stack Docker dev, seed demo): ciclo `POST` colaborador 201 -> `POST` permiso `report:export` 200 -> `PATCH` rol EDITOR 200 con `seed_user_visor` en `seed_program_congreso-cit`; ninguna respuesta (incluido `/users/me/permissions` del objetivo) expone `grantedById`/`grantedAt`; psql confirma 12 filas con `granted_by_id=seed_user_admin` y `granted_at` no nulo (0 nulos) y el `OVERRIDE` preservado; `DELETE` 204 y conteos baseline restaurados (16 colaboraciones, 238 permisos); script temporal en `/tmp` eliminado y logs sin tokens ni passwords.
- [x] Hallazgo `F3.10-A` (diferido, bug preexistente fuera de 3.10): `PATCH .../collaborators/:userId` responde 500 (`P2002` en `collaboration_permissions_pkey`) cuando un permiso `ROLE_DEFAULT` fue convertido a `OVERRIDE` por un grant y el rol nuevo vuelve a incluir ese permiso; reproducible con VIEWER -> grant `report:view` -> EDITOR y no cubierto por los mocks. Requiere decision sobre `skipDuplicates` o semantica equivalente.
- [x] Gates: `pnpm test` 987 en 45 archivos en verde (7 pruebas nuevas de 3.10), `pnpm run typecheck`, `pnpm run lint`, `pnpm run build`, `pnpm run docs:check` y `format:check` de los archivos propios en verde (quedan sin formatear planes ajenos de 4.3 y 5.3).
- [x] Sin commit: el usuario no lo solicito.

**Criterio de salida:** tests de rutas con ADMIN, ORGANIZER, EDITOR y VIEWER cubren subconjunto simetrico, atenuacion, herencia y no ampliacion de scope.

---

## Fase 4 - Programas de eventos

**Depende de:** Fases 2 y 3.

**Entregable:** ciclo completo crear -> actualizar -> archivar -> reactivar.

- [x] **4.1 Consultar programa - `GET /api/v1/event-programs/:id`.** Para programas ACTIVE, incluir unidad, etiqueta, fechas y conteo de actividades.
- [x] **4.2 Revisar creacion y actualizacion.** Mantener `isDefault` y `organizationalUnitId` inmutables; validar `startDate <= endDate`; un programa ARCHIVED no es editable.
- [x] **4.3 Archivar programa - `POST /api/v1/event-programs/:id/archive`.** Rechazar programas adicionales con actividades SCHEDULED/ONGOING y programas default cuya unidad este activa; guardar `archivedAt`; comportamiento idempotente.
- [x] **4.4 Reactivar programa - `POST /api/v1/event-programs/:id/reactivate`.** Solo adicionales archivados; validar rango de fechas.
- [x] **4.5 Completar filtros.** Permitir que ADMIN filtre estados no publicos; mantener listado publico limitado a ACTIVE.
- [x] **4.6 Listar actividades del programa - `GET /api/v1/event-programs/:id/activities`.** Agregar filtros y paginacion. Ver registro de ejecucion.
- [x] **4.7 Prohibir eliminacion fisica.** No exponer `DELETE` de programas; documentar 404/405. Ver registro de ejecucion.

**Registro de ejecucion (2026-09-20 - 4.1):**

- [x] Plan detallado en `docs/superpowers/plans/2026-09-20-fase-4-1-consultar-programa.md` con ciclo TDD rojo/verde en middleware (5 pruebas), esquemas (7), servicio (6), rutas (5) y contrato OpenAPI (1 nueva; 33 en `src/docs`).
- [x] Implementacion: middleware `optionalAuthenticate` (nuevo; sin header continua anonimo, token invalido/vencido 401, cuenta desactivada 403, reutiliza `extractBearerToken`/`loadActiveUser`); `getEventProgramById(id, viewer)` con un unico `activity.groupBy` por estado; `activityCount.visible` = `SCHEDULED`+`ONGOING`+`COMPLETED` y `total`/`byStatus` (cinco estados con ceros) solo con `program:read` vigente o `ADMIN`; DTO `EventProgramPublicDetail` y componente `EventProgramActivityCount`; `eventProgramIdSchema`/`eventProgramParamsSchema` reutilizado por el PATCH.
- [x] Pruebas: `pnpm test` 743 en 44 archivos en verde al cierre (728 antes de que la sesion concurrente de 3.4 sumara las suyas); `typecheck`, `lint`, `build`, `docs:generate` y `docs:check` en verde; `format:check` global solo reporta `src/modules/authorization/delegation.service.ts` de la sesion concurrente de 3.4.
- [x] Verificacion real (stack Docker dev, seed demo): anonimo `seed_program_fic_default` 200 con `activityCount.visible=2` y sin `total`/`byStatus` (psql: 1 `SCHEDULED` + 1 `COMPLETED` + 1 `CANCELLED`); admin 200 con `total=3` y desglose exacto; `organizador.fisc` 200 con desglose en `congreso-cit` (3 `SCHEDULED`); `visor.eventos` (VIEWER) con desglose en `fct_default` y solo `visible` en `fic_default` sin colaboracion; `estudiante01` solo `visible`; `foro-ipe` (`ARCHIVED`) y `feria-tec` (`DRAFT`) 404 incluso con token admin; id desconocido 404; id en blanco 400; token invalido 401. Sin escrituras ni limpieza.
- [x] Bruno: 5 requests nuevos de lectura mas login admin propio de la carpeta; `bru run Event_Programs --env local` 9/9 requests y 6/6 tests (la primera corrida dio ECONNRESET por el reinicio de `tsx watch`; la segunda quedo limpia).
- [x] Contrato: `openapi.json` regenerado sin drift; operacion GET publica sin `security`, params `id`, respuestas 200/400/401/403/404 y componentes `EventProgramPublicDetail`/`EventProgramActivityCount`.
- [x] Documentacion: README y CONTEXT describen el endpoint, la semantica del conteo y la auth opcional fail-closed. Sin migraciones, variables de entorno ni permisos nuevos.
- [x] Notas: `exactOptionalPropertyTypes` exigio `total?: number | undefined` en el tipo; en la prueba de ruta `ApiError` debe importarse despues de `loadApp` para compartir la instancia tras `vi.resetModules()`. La sesion concurrente de 3.4 reescribio `src/docs/openapi.test.ts` y perdio la linea `GET /api/v1/event-programs/{id}` del listado esperado; se restauro sin tocar sus operaciones DELETE. Sin commit: el usuario no lo solicito.

**Registro de ejecucion (2026-09-20 - 4.2):**

- [x] Plan detallado en `docs/superpowers/plans/2026-09-20-fase-4-2-revisar-creacion-actualizacion.md` con ciclo TDD rojo/verde en esquema (2 pruebas nuevas), rutas (2), servicio (6 nuevas y 1 obsoleta eliminada) y contrato OpenAPI (1 ampliada).
- [x] Hallazgo de la revision: la API contradecia tres constraints/triggers reales de PostgreSQL y tres caminos terminaban en 500. Se corrigieron: `event_programs_metadata_check` exigia `label`/`banner_url` NOT NULL en adicionales; `updateEventProgram` permitia fechas en programas predeterminados; y no se pre-validaban las fechas que excluyen actividades del trigger `validate_event_program_transition`.
- [x] Migracion `20260920235034_relax_event_program_metadata_check`: rojo SQL verificado (`BEGIN; INSERT ... label NULL ...; ROLLBACK;` viola la CHECK), luego verde con el mismo INSERT; `label` y `banner_url` quedan como metadatos opcionales. 12 migraciones aplicadas y `Database schema is up to date!`.
- [x] Implementacion: `status: z.literal('ACTIVE')` opcional en `updateEventProgramSchema` (unico cambio de estado permitido); `updateEventProgram` carga `isDefault`, rechaza fechas en predeterminados con 400, activa solo desde `DRAFT` (409 en otro estado), pre-chequea con `activity.count` las actividades fuera del rango (409) y persiste `status: ACTIVE`; `isDefault` y `organizationalUnitId` siguen rechazados por el body estricto (400).
- [x] Pruebas: modulo `event-programs` 74 (65 antes); suite dirigida `src/modules/event-programs src/docs` 120 en 6 archivos; `pnpm test` 812 en 44 archivos; `typecheck`, `lint`, `build` y `docs:check` en verde.
- [x] Verificacion real (stack Docker dev, seed demo): 20/20 checks con admin y USER. Create sin label/banner 201 `DRAFT` con psql `false|DRAFT|NULL|NULL`; renombrar 200; activar 200 `ACTIVE` (psql) y reactivar 409; extender fechas 200 (psql 2026-12-02/06); `isDefault`, `organizationalUnitId` y `status: ARCHIVED` 400; sin token 401; USER 403; `seed_program_fic_default` con fechas 400; `seed_program_congreso-cit` con `startDate` 2026-10-06 409 y fechas psql intactas (2026-10-05/09); `seed_program_foro-ipe` 409. Programa temporal eliminado con `event_programs_prevent_delete` deshabilitado en una transaccion (16 programas, 11 predeterminados: conteos restaurados).
- [x] Bruno: 5 requests nuevos en `Event_Programs` (fechas en predeterminado 400, archivado 409, activar no-draft 409, status invalido 400 y fechas que excluyen actividades 409) mas `defaultProgramId`/`activeProgramId`; `bru run Event_Programs --env local` 14/14 requests y 11/11 tests.
- [x] Contrato: `openapi.json` regenerado sin drift; descripcion del PATCH documenta la transicion DRAFT -> ACTIVE, el 400 de predeterminados y el 409 de actividades excluidas; test de contrato verifica `status` en el body.
- [x] Documentacion: README, CONTEXT y AGENTS describen la publicacion DRAFT -> ACTIVE, las guardas de fechas y los metadatos opcionales.
- [x] Hallazgos: `F4.2-A` el trigger `protect_event_program_identity` solo protege `organizational_unit_id` en programas predeterminados (en adicionales la inmutabilidad es solo de API); `F4.2-B` carrera entre el pre-chequeo de fechas y un alta concurrente de actividad (el trigger de BD queda como ultima linea).
- [x] Nota: `format:check` global falla solo por `src/modules/activities/activities.routes.ts` y `docs/superpowers/plans/2026-09-20-fase-5-2-actualizar-actividad.md` de la sesion concurrente 5.2; los archivos de 4.2 quedan formateados. Sin commit: el usuario no lo solicito.

**Registro de ejecucion (2026-09-21 - 4.3):**

- [x] Plan detallado en `docs/superpowers/plans/2026-09-21-fase-4-3-archivar-programa.md` con ciclo TDD rojo/verde en servicio (6 pruebas), rutas (6) y contrato OpenAPI (1 nueva), mas las suites previas intactas.
- [x] Implementacion: `archiveEventProgram(id)` carga el programa con su unidad (`eventProgramArchiveSelect`), responde `404` si no existe, corta la idempotencia si ya esta `ARCHIVED` (sin `update` ni conteo), rechaza predeterminados con unidad activa (`409`) y adicionales con actividades `SCHEDULED`/`ONGOING` (`409`), y persiste `update { status: 'ARCHIVED', archivedAt: new Date() }`; ruta `POST /api/v1/event-programs/:id/archive` con `authenticate -> requirePermission(program:archive, { eventProgramId }) -> validate(params) -> controlador`.
- [x] Decisiones: idempotencia con `200` sin mover `archivedAt`; DTO reutiliza `EventProgramDetail` sin exponer `archivedAt`; `program:archive` ya existia en el catalogo y no esta en ningun `ROLE_DEFAULT`, por lo que solo `ADMIN` o un `OVERRIDE` explicito archivan; sin migraciones, dependencias, variables de entorno ni permisos nuevos.
- [x] Pruebas: `src/modules/event-programs` 86 (28 servicio + 29 rutas + 29 esquemas); suite dirigida `src/modules/event-programs src/docs` 134 en 6 archivos; `pnpm test` 857 en 44 archivos con 8 fallos y 2 archivos rojos ajenos al modulo (`src/docs/openapi.test.ts` y `src/modules/authorization/authorization.schemas.test.ts`, fase 3.6/3.7 en curso); los dos archivos pasan aislados con el codigo de 4.3.
- [x] Verificacion real (stack Docker dev, seed demo, script temporal eliminado): 17/17 checks. Programa temporal `DRAFT` archivado 200 con `archived_at=2026-09-21 05:10:05.898+00`; segundo archivado 200 con la misma marca; `GET` publico 404; `POST /activities` en el programa archivado 400 `Activities can only be created in an active event program.`; segundo programa activado con una actividad `DRAFT` tambien se archiva (`DRAFT` no bloquea); `congreso-cit` con 3 `SCHEDULED` 409 y psql `ACTIVE`; `fic_default` 409 `A default event program cannot be archived while its organizational unit is active.`; id desconocido 404; sin token 401; USER 403; `foro-ipe` ya archivado 200 conservando `archived_at` original. Limpieza total y conteos restaurados (`16|11`).
- [x] Bruno: 6 requests nuevos en `Event_Programs` (idempotente 200, 409 por actividades, 409 predeterminado, 401, login de usuario con `X-Forwarded-For` y 403); `bru run Event_Programs --env local` 20/20 requests y 17/17 tests.
- [x] Contrato: `openapi.json` regenerado sin drift; operacion `POST`, path param `id`, respuestas 200/400/401/403/404/409 y componente `EventProgramDetail` reutilizado; prueba de contrato nueva en `src/docs/openapi.test.ts`.
- [x] Documentacion: README y CONTEXT describen el endpoint, las guardas, la idempotencia y el efecto en `GET`/`POST /activities`.
- [x] Gates: `typecheck`, `lint`, `build` y `docs:check` en verde; `format:check` global solo reporta archivos de la sesion concurrente 3.6/3.7 (`authorization.schemas.ts`, `authorization.routes.test.ts`, `openapi.test.ts` en su bloque de revocacion) y sus planes; todos los archivos de 4.3 y la carpeta Bruno quedan formateados.
- [x] Hallazgo `F4.3-A`: carrera entre el pre-chequeo de actividades y el `update` (el trigger `validate_event_program_transition` queda como ultima linea, mismo criterio que `F4.2-B`); sin traduccion del error de trigger a `409`.
- [x] Sin commit: el usuario no lo solicito.

**Registro de ejecucion (2026-09-21 - 4.4):**

- [x] Plan detallado en `docs/superpowers/plans/2026-09-21-fase-4-4-reactivar-programa.md` con ciclo TDD rojo/verde en catalogo (1 prueba), servicio (9), rutas (7) y contrato OpenAPI (1 nueva).
- [x] Implementacion: `reactivateEventProgram(id)` con guardas `404` / `409` predeterminado / `409` no archivado / `400` fechas incoherentes y `update { status: 'ACTIVE', archivedAt: null }`; select `eventProgramLifecycleSelect` (renombrado desde `eventProgramArchiveSelect`) reutilizado con archive; ruta `POST /api/v1/event-programs/:id/reactivate` con `authenticate -> requirePermission(program:reactivate, scope) -> validate(params) -> controlador`.
- [x] Decisiones confirmadas con el usuario: destino `ACTIVE` validando solo coherencia de fechas (sin regla de vencimiento), permiso nuevo `program:reactivate` fuera de `ROLE_DEFAULTS` (solo ADMIN u OVERRIDE), `409` para cualquier estado distinto de `ARCHIVED` sin idempotencia y sin guarda de unidad activa.
- [x] Pruebas: `src/modules/event-programs` 113 en 3 archivos (incluye el trabajo concurrente de 4.5); suite dirigida `src/modules/event-programs src/modules/authorization/permissions.test.ts src/docs` 166 en 7 archivos; `pnpm test` 911 en 44 archivos en verde (la primera corrida completa reporto 6 fallos flaky en `src/modules/authorization/authorization.service.test.ts` de la sesion concurrente 3.7/3.8, que pasa aislado y en la segunda corrida); `typecheck`, `lint`, `build` y `docs:check` en verde.
- [x] Verificacion real (stack Docker dev, seed base, script temporal eliminado): 14/14 checks. `program:reactivate` en `permissions` (20 permisos); temporal `DRAFT` -> reactivar 409 `Only archived event programs can be reactivated.`; archivado 200 con `archived_at=2026-09-21 05:33:52.359+00`; reactivacion 200 `ACTIVE` con psql `ACTIVE|NULL`; `GET` publico 200; segundo intento 409; `fic_default` 409 `Only additional event programs can be reactivated.`; `congreso-cit` 409; desconocido 404; sin token 401; USER y `organizador.fisc` (ORGANIZER) 403. Limpieza de todos los `TMP-F4.4%` (incluido el residuo de Bruno) y conteos restaurados (`16|11`).
- [x] Bruno: 8 requests nuevos en `Event_Programs` (preparar DRAFT, archivar, reactivar 200, predeterminado 409, activo 409, desconocido 404, 401 y 403 con `userToken`); `bru run Event_Programs --env local` 28/28 requests y 25/25 tests.
- [x] Contrato: `openapi.json` regenerado sin drift; operacion `POST`, path param `id`, respuestas 200/400/401/403/404/409 y componente `EventProgramDetail` reutilizado; enums de permisos con `program:reactivate`; la regeneracion incluyo ademas los cambios de contrato de las sesiones concurrentes 3.7/3.8.
- [x] Documentacion: README y CONTEXT describen el endpoint, sus guardas y la ausencia de idempotencia.
- [x] Nota de concurrencia: la sesion 4.5 (filtros) edito `event-programs.service.test.ts` en paralelo; `format:check` global solo reporta archivos ajenos (`docs/superpowers/plans/2026-09-21-fase-4-3-archivar-programa.md`, `docs/superpowers/plans/2026-09-21-fase-4-5-completar-filtros.md`, `src/modules/authorization/authorization.schemas.ts` y `.test.ts`); los archivos de 4.4 quedan formateados.
- [x] Sin migraciones, dependencias ni variables de entorno nuevas. Sin commit: el usuario no lo solicito.

**Registro de ejecucion (2026-09-21 - 4.5):**

- [x] Plan detallado en `docs/superpowers/plans/2026-09-21-fase-4-5-completar-filtros.md` con ciclo TDD rojo/verde en esquemas (3 pruebas nuevas/actualizadas), servicio (6), rutas (3) y contrato OpenAPI (2).
- [x] Implementacion: `status` en `listEventProgramsQuerySchema` (`DRAFT|ACTIVE|COMPLETED|CANCELLED|ARCHIVED|ALL`), `listEventPrograms(query, viewer)` que solo honra el filtro para `ADMIN` (anonimos y `USER` reciben `ACTIVE` con `200` silencioso; `ALL` omite la restriccion) y `optionalAuthenticate` en `GET /event-programs` con `req.user ?? null` en el controlador.
- [x] Decisiones confirmadas con el usuario: default `ACTIVE` para todos, silencio para no-admin (sin `403`), solo `ADMIN` ve estados no publicos, sin permisos, migraciones ni variables de entorno nuevas.
- [x] Pruebas: `src/modules/event-programs` 113 en 3 archivos (31 esquemas + 43 servicio + 39 rutas); suite dirigida `src/modules/event-programs src/docs` 165 en 6 archivos; `pnpm test` 911 en 44 archivos en verde; `typecheck`, `lint`, `build` y `docs:check` en verde; `format:check` global solo reporta archivos de sesiones ajenas (`docs/superpowers/plans/2026-09-21-fase-4-3-archivar-programa.md`, `src/modules/authorization/authorization.schemas.ts` y `.test.ts` de 3.7/3.8).
- [x] Verificacion real (stack Docker dev, seed demo, script temporal eliminado, solo lectura): 15/15 checks. Baseline psql `ACTIVE=14 DRAFT=1 COMPLETED=1 ARCHIVED=1 TOTAL=17` (incluye residuos ajenos: unidad temporal de 2.A y `TMP-F4.4 programa reactivable` de la corrida Bruno de 4.4). Anonimo y `USER` con `status=DRAFT`/`ARCHIVED`/`ALL` responden 200 con el listado `ACTIVE` y el total de psql; admin sin `status` sigue en `ACTIVE`; admin `DRAFT=1` (`feria-tec`), `ARCHIVED=1` (`foro-ipe`) y `ALL=17` contrastados con psql; combinacion `COMPLETED + seed_unit_fic` devuelve `semana-ic`; `status=PENDING` 400 para anonimo y admin; `unitType=CAMPUS` sigue 400; Bearer invalido 401; `ALL` conserva paginacion (`items=5 total=17`). Cero escrituras.
- [x] Bruno: 4 requests nuevos en `Event_Programs` (admin `status=DRAFT`, anonimo `status=ARCHIVED`, `status=PENDING` 400 y token invalido 401) mas el parametro opcional `~status` en el listado existente; `bru run Event_Programs --env local` 32/32 requests y 29/29 tests en verde (incluye los requests de 4.3 y 4.4).
- [x] Contrato: `openapi.json` regenerado sin drift; parametro `status`, respuestas 400/401/403 y `security` ausente en el `GET` publico; descripcion documenta que el filtro solo aplica a `ADMIN`.
- [x] Documentacion: README y CONTEXT describen el filtro, el silencio para no-admin y los 400/401/403.
- [x] Nota de concurrencia: 4.4 edito los mismos archivos del modulo en paralelo; se re-leyeron los archivos antes de cada edicion, 4.5 no toco `reactivateEventProgram` ni el catalogo de permisos, y la corrida E2E derivo los conteos de psql en lugar de fijarlos. Sin commit: el usuario no lo solicito.

**Registro de ejecucion (2026-09-21 - 4.6):**

- [x] Plan detallado en `docs/superpowers/plans/2026-09-21-fase-4-6-listar-actividades-programa.md` con ciclo TDD rojo/verde en esquemas (13 pruebas), servicio (10), rutas (9) y contrato OpenAPI (1 nueva + listado de operaciones).
- [x] Implementacion en el modulo `activities` (reutiliza `activitySelect`/`toActivityListItem`; la ruta anidada se declara en `activities.routes.ts`, precedente de `authorization`): `programActivitySelect = { ...activitySelect, status: true }`, `toProgramActivityItem`, y `listEventProgramActivities(id, query, viewer)` que carga el programa (`404`), resuelve `activity:read` en el scope con `getEffectivePermissions`, responde `404` si el programa no esta `ACTIVE` y no hay permiso, decide el conjunto de estados y aplica `type`/`q`/rango de fechas con paginacion offset.
- [x] Decisiones confirmadas con el usuario: programa no `ACTIVE` visible solo para `ADMIN`/`activity:read`; publico ve `SCHEDULED`+`ONGOING`+`COMPLETED` (cuadra con `activityCount.visible`); filtro `status` (incl. `ALL`) solo para autorizados y silencio para el resto; item nuevo `EventProgramActivityItem` con `status` y componente `PaginatedEventProgramActivities`; filtros `status`, `type`, `q`, `dateFrom`, `dateTo`. Sin migraciones, permisos, dependencias ni variables de entorno nuevas.
- [x] Pruebas: `src/modules/activities` 146 en 3 archivos (58 esquemas + 56 servicio + 32 rutas); suite dirigida `src/modules/activities src/docs` 200 en 6 archivos; `pnpm test` 958 en 45 archivos en verde; `typecheck`, `lint`, `build` y `docs:check` en verde.
- [x] Verificacion real (stack Docker dev, seed demo, script temporal eliminado, solo lectura): 17/17 checks. psql `seed_program_fic_default` `SCHEDULED=2 COMPLETED=1 CANCELLED=1`; anonimo `total=3` con solo estados publicos, cada item con `status` y sin `qrCode`/`manualCode`; anonimo `status=DRAFT` devuelve el set publico (silencio); admin sin filtro `total=4` (cinco estados), admin `status=CANCELLED=1` y `status=ALL` contrastados con psql; `foro-ipe` anonimo 404 y admin 200; programa desconocido 404; `status=PENDING` y rango invertido 400; Bearer invalido 401; rango sin resultados 200 con `totalPages=0`. Cero escrituras.
- [x] Bruno: 6 requests nuevos en `Activities` (anonimo, admin con `status=SCHEDULED`, archivado anonimo 404, archivado admin 200, status invalido 400 y token invalido 401); `bru run Activities --env local` 22/22 requests y 20/20 tests.
- [x] Contrato: operacion publica sin `security`, params `id` + `page`/`limit`/`status`/`type`/`q`/`dateFrom`/`dateTo`, respuestas 200/400/401/404 y componentes `EventProgramActivityItem`/`PaginatedEventProgramActivities`; `openapi.json` regenerado sin drift.
- [x] Documentacion: README y CONTEXT describen visibilidad, estados publicos, filtro `status` solo autorizado, rango de fechas inclusivo y 404 de programas no activos.
- [x] Hallazgo `F4.6-A`: `zod-openapi` exige un `ZodObject` en cada entrada de `requestParams`; pasar `query.shape` (objeto plano) rompe la generacion. Se pasa `eventProgramActivitiesQuerySchema` y el refinamiento `dateFrom <= dateTo` vive en `listEventProgramActivitiesQuerySchema`.
- [x] Nota de concurrencia: la sesion 4.7 avanzo en paralelo sobre `event-programs` (middleware 405, rutas y contrato); los gates globales se corrieron despues de ambos cambios y quedaron en verde. `format:check` global solo reporta `docs/superpowers/plans/2026-09-21-fase-4-3-archivar-programa.md` (sesion ajena, ya reportado por 4.4/4.5/4.7). El residuo `Actividad temporal fase 5.2` en `fic_default` proviene de la corrida de la carpeta `Activities` (5.1/5.2), no de 4.6.
- [x] Sin commit: el usuario no lo solicito.

**Registro de ejecucion (2026-09-21 - 4.7):**

- [x] Plan detallado en `docs/superpowers/plans/2026-09-21-fase-4-7-prohibir-eliminacion-fisica.md` con ciclo TDD rojo/verde en middleware (1 prueba), rutas (3) y contrato OpenAPI (1 prueba nueva + listado de operaciones).
- [x] Decisiones confirmadas con el usuario: `405` explicito solo para `DELETE` (PUT/POST conservan 404), header `Allow` (`GET, POST` en la coleccion y `GET, PATCH` en el item), sin autenticacion en la guarda y documentacion en OpenAPI, Bruno, README y CONTEXT.
- [x] Implementacion: middleware `methodNotAllowed(allowedMethods)` que fija `Allow` y propaga `ApiError(405, 'Method not allowed.')`; `.delete()` al final del router de `event-programs` para `/event-programs` (`GET, POST`) y `/event-programs/:id` (`GET, PATCH`); operaciones `DELETE` en OpenAPI con respuesta `405` sin `security`; sin migraciones, permisos ni variables de entorno nuevas.
- [x] Pruebas: `src/modules/event-programs` 116 en 3 archivos; `src/middlewares/methodNotAllowed.middleware.test.ts` 1; `src/docs/openapi.test.ts` 43; `pnpm test` 925 en 45 archivos en verde; `typecheck`, `lint`, `build` y `docs:check` en verde; `format:check` global solo reporta `docs/superpowers/plans/2026-09-21-fase-4-3-archivar-programa.md` (sesion ajena, ya reportado en 4.4/4.5); `openapi.json` regenerado sin drift.
- [x] Verificacion real (stack Docker dev, seed demo, script temporal eliminado): 13/13 checks. `DELETE /event-programs/seed_program_foro-ipe` 405 con `Allow: GET, PATCH` y cuerpo `Method not allowed.`; con token admin sigue 405; con token invalido 405 (la guarda no evalua auth); id desconocido 405 (sin oraculo de existencia); `DELETE /event-programs` 405 con `Allow: GET, POST` (sin token y con admin); `DELETE /event-programs/seed_program_congreso-cit/collaborators/anything` 401 (la subruta no se ve afectada); el trigger `event_programs_prevent_delete` bloqueo el `DELETE` directo en un bloque `DO` con excepcion capturada; conteo `event_programs` 18 -> 18. Cero escrituras.
- [x] Bruno: 2 requests nuevos en `Event_Programs` (seq 33-34) con asserts de 405 y cuerpo de error; `bru run Event_Programs --env local` 34/34 requests y 31/31 tests en verde.
- [x] Contrato: 2 operaciones `DELETE` prohibidas documentadas (respuesta 405, sin `security` y con path param `id` en el item) y listado de operaciones actualizado; `openapi.json` regenerado sin drift.
- [x] Documentacion: README y CONTEXT describen el 405, el header `Allow`, la ausencia de autenticacion en la guarda y los triggers de BD.
- [x] Sin commit: el usuario no lo solicito.

**Criterio de salida:** transiciones invalidas rechazadas, `archivedAt` correcto y ninguna actividad creable en programas archivados.

---

## Fase 5 - Actividades

**Depende de:** Fase 4 y disponibilidad de aulas de Fase 2.

**Entregable:** ciclo de vida completo con validacion de calendario, aula y permisos.

- [x] **5.1 Consultar actividad - `GET /api/v1/activities/:id`.** Incluir ponentes, aula, equipamiento, programa, conteo de inscritos (`enrolledCount`) y presentes (`checkedInCount`). Ver registro de ejecucion.
- [x] **5.2 Actualizar actividad - `PATCH /api/v1/activities/:id`.** Requerir `activity:update`; validar transiciones y rechazar edicion de COMPLETED/CANCELLED. Ver registro de ejecucion.
- [x] **5.3 Cancelar actividad - `POST /api/v1/activities/:id/cancel`.** Requerir `activity:cancel`; admitir motivo opcional; no cancelar una actividad completada. Ver registro de ejecucion.
- [x] **5.4 Definir eliminacion.** Recomendacion: permitir `DELETE` solo para DRAFT sin asistencia; documentar la regla de retencion. Ver registro de ejecucion.
- [ ] **5.5 Validar aula y horario.** Exigir `endTime > startTime`, ventana disponible, ausencia de solape, capacidad del aula suficiente, speakers validos y equipamiento sin duplicados.
- [ ] **5.6 Completar filtros.** Proximas, pasadas, programa, unidad, tipo de unidad, tipo de actividad, aula, rango de fechas y estado; paginacion.
- [ ] **5.7 Resolver estados temporales.** Decidir si ONGOING/COMPLETED se derivan al leer o mediante job; documentar con ADR si se usa scheduler.
- [ ] **5.8 Revisar creacion existente.** Aplicar todas las validaciones anteriores a `POST /activities`.

**Criterio de salida:** solapes de aula producen 409, colaboracion horizontal incorrecta produce 403 y cambios de aula/horario mantienen disponibilidad consistente.

**Registro de ejecucion (2026-09-20 - 5.1):**

- [x] Plan detallado en `docs/superpowers/plans/2026-09-20-fase-5-1-consultar-actividad.md` con ciclo TDD rojo/verde en esquemas (7 pruebas), servicio (12), ruta (6) y contrato OpenAPI (1 nueva con aserciones de conteos).
- [x] Implementacion: `activityParamsSchema` (trim 1-100), `ActivityDetail` extendido con `enrolledCount` y `checkedInCount` (compartido con `POST`, que devuelve `0/0`), `getActivityById(id, viewer?)` con `_count.attendance` + `attendance.count({ checkedInAt: not null })` y visibilidad publica/privada.
- [x] Decisiones confirmadas con el usuario: anonimo ve actividades no `DRAFT` de programas `ACTIVE` (incluye `COMPLETED`/`CANCELLED`); Bearer opcional de `ADMIN` o `activity:read` en el scope ve todo; sin visibilidad `404`; token invalido `401`. Se incluye `checkedInCount` ademas de `enrolledCount`.
- [x] Concurrencia: la sesion de 4.1 ya habia creado `src/middlewares/optionalAuthenticate.middleware.ts` (con `extractBearerToken`/`loadActiveUser` exportados); 5.1 reutiliza ese middleware y descarto una variante duplicada en `authenticate.middleware.ts`.
- [x] Pruebas: `pnpm exec vitest run --testTimeout=20000` 743 en 44 archivos en verde (con el timeout default de 5s algunos archivos ajenos expiraban por la carga de la sesion concurrente y pasaban en aislamiento; suites dirigidas `src/modules/activities src/middlewares` 97 y `src/modules/activities src/docs` 118 en verde); `typecheck`, `lint`, `build`, `format:check` y `docs:check` en verde; `openapi.json` regenerado sin drift.
- [x] Verificacion real (stack Docker dev, seed demo): `seed_activity_fic-charla-puentes` publico 200 con `COMPLETED`, `enrolledCount=6` y `checkedInCount=4` contrastados con psql; `CANCELLED` publico 200; desconocida 404; id en blanco 400; header malformado 401; DRAFT creado como admin con conteos `0/0`, anonimo 404, usuario sin permiso 404, admin 200 y head ORGANIZER de FIC 200 por `activity:read`; actividades temporales eliminadas.
- [x] Bruno: nueva carpeta `Activities` con login admin, `Get an activity`, `Create a draft activity`, `Get a draft activity anonymously returns 404`, `Get a draft activity as admin` y `Get an unknown activity returns 404`; `bru run Activities --env local` 8/8 requests y 6/6 tests.
- [x] Contrato: operacion `GET /api/v1/activities/{id}` publica con path param `id`, respuestas 200/400/401/404 y descripcion de la variante privada; `ActivityDetail` expone ambos conteos.
- [x] Documentacion: README y CONTEXT describen el detalle, la visibilidad y los conteos. Sin migraciones, variables de entorno ni permisos nuevos.
- [x] Sin commit: el usuario no lo solicito.

**Registro de ejecucion (2026-09-20 - 5.2):**

- [x] Plan detallado en `docs/superpowers/plans/2026-09-20-fase-5-2-actualizar-actividad.md` con ciclo TDD rojo/verde en esquemas (9 pruebas), servicio (22), rutas (7) y contrato OpenAPI (2).
- [x] Decisiones confirmadas con el usuario: `status` opcional con `DRAFT <-> SCHEDULED` (publicar/despublicar); `ONGOING`/`COMPLETED`/`CANCELLED` no asignables (400 Zod) y edicion de `COMPLETED`/`CANCELLED` 409; validacion completa de aula/horario en 5.2 con helper reutilizable para 5.5/5.8; `speakers`/`equipment` reemplazan la lista completa (`[]` limpia) reutilizando `connectOrCreate` y vinculacion de usuarios de `POST`.
- [x] Implementacion: `updateActivitySchema` estricto y no vacio (`eventProgramId` inmutable), `PATCH /api/v1/activities/:id` con `authenticate -> requirePermission(activity:update, { activityId }) -> validate -> controlador`; `updateActivity(id, input)` con guardas 404/409, transiciones validadas, rango de programa no-default, aula existe/activa, ventana 409, solape 409 (excluye la propia actividad), capacidad 400 y traduccion de la violacion GiST `23P01`/`activities_classroom_no_overlap`; `buildSpeakerCreates` extraido de `createActivity` sin cambio de contrato.
- [x] Desviacion menor: la validacion de reserva tambien se dispara cuando cambia `maxCapacity` (necesario para validar capacidad del aula con aula y horario sin cambios).
- [x] Pruebas: `pnpm test` 812 en 44 archivos en verde (5.2 suma 40; el total incluye el trabajo concurrente de 3.5 y 4.2); `typecheck`, `lint`, `build`, `format:check` y `docs:check` en verde; `openapi.json` regenerado sin drift.
- [x] Verificacion real (stack Docker dev, seed demo, script temporal eliminado): 409 de `COMPLETED`/`CANCELLED`; 404 desconocida; 401 sin token; 403 `estudiante01`; 400 de `status: ONGOING` y de `eventProgramId`; draft creado, edicion de nombre/descripcion/equipo/ponentes con reuso de ponente por email sin duplicar catalogo; publicacion con aula libre 200 + `status=SCHEDULED` persistido; solape 409 manteniendo el segundo draft en `DRAFT`; ventana 409; capacidad del aula 400; despublicacion 200; DRAFT sin validacion de reserva. Limpieza psql hasta el baseline del seed (24 actividades, 13 ponentes, 35 asistencias; la actividad temporal dejada por Bruno tambien se elimino).
- [x] Bruno: 8 requests nuevos en `Activities` (login usuario, update, status invalido 400, publicar, completada 409, sin token 401, desconocida 404 y 403) mas `userToken`; `bru run Activities --env local` 16/16 requests y 14/14 tests.
- [x] Contrato: operacion `PATCH` con bearer, path param, body estricto y respuestas 200/400/401/403/404/409; `ActivityDetail` reutilizado. Documentacion: README y CONTEXT. Sin migraciones, variables de entorno ni permisos nuevos.
- [x] Nota operativa: la corrida Bruno crea un draft nuevo en cada ejecucion (la limpieza se hizo por psql, igual que en 5.1). Sin commit: el usuario no lo solicito.

**Registro de ejecucion (2026-09-21 - 5.3):**

- [x] Plan detallado en `docs/superpowers/plans/2026-09-21-fase-5-3-cancelar-actividad.md` con ciclo TDD rojo/verde en esquemas (5 pruebas con cambio de payload), servicio (9), rutas (7) y contrato OpenAPI (1 prueba + listado de operaciones). Preflight de concurrencia: la sesion 4.6 habia cerrado y `src/modules/activities src/docs` quedaba en 200 pruebas verdes antes de tocar el modulo.
- [x] Migracion `20260921063412_add_activity_cancel_reason`: columna `activities.cancel_reason VARCHAR(500)` nullable. Rojo SQL verificado (`ERROR: column "cancel_reason" does not exist`) y verde con `UPDATE ... ; ROLLBACK;`; 13 migraciones aplicadas y `Database schema is up to date!`.
- [x] Decisiones confirmadas con el usuario: migracion + `cancelReason` expuesto en `ActivityDetail` (no en listados); cancelable desde `DRAFT`/`SCHEDULED`/`ONGOING`, `COMPLETED` 409 y repetido 200 idempotente sin pisar el motivo; programa no `ACTIVE` 409 consistente con el `PATCH` de 5.2.
- [x] Implementacion: `cancelActivityBodySchema`/`cancelActivitySchema` (body opcional con `reason` recortado 1-500, `.strict()`), `POST /api/v1/activities/:id/cancel` con `authenticate -> requirePermission(activity:cancel, { activityId }) -> validate -> controlador` y `cancelActivity(id, reason?)` con orden `404 -> COMPLETED 409 -> CANCELLED 200 sin escritura -> programa no ACTIVE 409 -> update { status: 'CANCELLED', cancelReason: reason ?? null }`; `activityDetailSelect`/`ActivityDetailRecord`/`toActivityDetail` extendidos con `cancelReason`. `activity:cancel` ya existia en el catalogo y es default de `ORGANIZER`: sin migracion de permisos ni seed.
- [x] Pruebas: suite dirigida `src/modules/activities src/docs` 222 en 6 archivos (200 antes; +22 de 5.3); `pnpm test` 987 en 45 archivos en verde (965 antes); `typecheck`, `lint`, `build` y `docs:check` en verde; `format:check` global solo reporta `docs/superpowers/plans/2026-09-21-fase-4-3-archivar-programa.md` (sesion ajena, ya reportado por 4.4/4.5/4.7/4.6).
- [x] Verificacion real (stack Docker dev, seed demo, script temporal en `/tmp`): 26/26 checks con admin y `estudiante01`. Cancelar A `SCHEDULED` con motivo `"  Aula liberada por mantenimiento  "` 200 y psql `CANCELLED|Aula liberada por mantenimiento`; repetir con otro motivo 200 conservando el original en respuesta y psql; `seed_activity_fic-charla-puentes` (`COMPLETED`) 409; programa temporal archivado 409 con la actividad `DRAFT|NULL` intacta; id desconocido 404; id en blanco, clave desconocida 400; sin token 401; `estudiante01` 403; **liberacion de aula**: A y B en `aula-101` el lunes 2026-12-21 09:00-11:00, publicar B con A `SCHEDULED` 409, cancelar A y publicar B 200. Limpieza total: 24 actividades del seed, 0 residuos (incluidas las dos `Actividad temporal fase 5.2` de corridas Bruno previas) y programa temporal eliminado con el trigger `event_programs_prevent_delete` deshabilitado en transaccion.
- [x] Bruno: 7 requests nuevos en `Activities` (seq 17-23) para cancelar 200 con motivo recortado, repetido 200 conservando motivo, `COMPLETED` 409, 401, `userToken` 403, desconocida 404 y clave desconocida 400; `bru run Activities --env local` 29/29 requests y 27/27 tests en verde.
- [x] Contrato: operacion `POST /api/v1/activities/{id}/cancel` con bearer, path param, body opcional `{ reason }` y respuestas 200/400/401/403/404/409; `ActivityDetail` expone `cancelReason`; `openapi.json` regenerado sin drift y prueba de contrato actualizada.
- [x] Documentacion: README y CONTEXT describen el endpoint, el permiso `ORGANIZER`, el motivo persistido, la idempotencia, los 409 y la liberacion del aula. Sin variables de entorno nuevas.
- [x] Hallazgos: `F5.3-A` la cancelacion no notifica a los inscritos (se conectara en 12.1 con `AlertType.ACTIVITY_CANCELLED`); `F5.3-B` no se audita quien cancela (12.2); `F5.3-C` una actividad `DRAFT` en un programa archivado queda incancelable por el 409 de programa (decision de congelamiento); la idempotencia se evalua antes del estado del programa, asi que repetir la cancelacion de una actividad ya cancelada responde 200 aunque su programa se haya archivado despues.
- [x] Observacion: `bruno/Activities/Create an activity.bru` y `List upcoming activities.bru` siguen con el cuerpo vacio y sin tests que dejo un `api:collection:import` destructivo previo (no forma parte de 5.3); la carpeta aporta 29 requests pero solo 27 tests por esos dos stubs.
- [x] Concurrencia: 4.6 cerro antes de empezar; se releyeron los archivos antes de editar y se conservaron sus cambios (`listEventProgramActivities`, `eventProgramActivitiesQuerySchema`, path `/event-programs/{id}/activities`). Sin commit: el usuario no lo solicito.

**Registro de ejecucion (2026-09-27 - 5.4):**

- [x] Plan detallado en `docs/superpowers/plans/2026-09-27-fase-5-4-eliminar-actividad.md` con ciclo TDD rojo/verde en catalogo de permisos (1), servicio (16), rutas (6) y contrato OpenAPI (1). Baseline previo registrado antes de tocar codigo: `pnpm test` 1198/7 skip en 55 archivos, `typecheck`, `lint`, `build` y `docs:check` en verde.
- [x] Decisiones confirmadas con el usuario: permiso dedicado `activity:delete` (no reutilizar `activity:cancel`, no limitar a `ADMIN`), default de `ORGANIZER` unicamente, programa no `ACTIVE` responde `409`, cualquier referencia retenida bloquea y la respuesta exitosa es `204` sin cuerpo.
- [x] Migracion `20260927184500_add_activity_delete_permission_and_retention_guard`: alta idempotente de `activity:delete` con id determinista, backfill del default `ROLE_DEFAULT` para las 16 colaboraciones `ORGANIZER` (`granted_by_id = NULL` por ser backfill del sistema) y trigger `activities_prevent_delete` (`BEFORE DELETE`) que exige `DRAFT` y programa `ACTIVE`, bloqueando el programa padre con `FOR UPDATE` para serializar contra un archivado concurrente. Sin cambios en `schema.prisma`.
- [x] Implementacion: `deleteActivity(id, auditContext?)` con guardas `404 -> no DRAFT 409 -> programa no ACTIVE 409 -> asistencia 409 -> alertas 409` y, dentro de una transaccion, un `deleteMany` condicional (`id`, `status: DRAFT`, `eventProgram.status: ACTIVE`, `attendance: { none: {} }`, `alerts: { none: {} }`) seguido de `writeAuditEvent` con la accion `activity.deleted`. Un `count !== 1`, un `P2003`/`23503` o el rechazo del trigger se traducen a `409 The activity changed while it was being deleted. Retry the request.`; `DELETE /api/v1/activities/:id` con `authenticate -> requirePermission(activity:delete, { activityId }) -> validate -> controlador` y `204` sin cuerpo.
- [x] Pruebas: suite dirigida `src/modules/activities src/docs` 263 en 6 archivos y `src/modules/authorization` 205 en 5; `pnpm test` 1222 en 55 archivos en verde (+24 sobre el baseline); `typecheck`, `lint`, `build`, `docs:generate` y `docs:check` en verde.
- [x] Verificacion real (stack Docker dev, seed demo, scripts temporales en `/tmp` y eliminados al final): 40/40 checks. `COMPLETED` -> `409 Only DRAFT activities can be deleted.`; draft limpio con equipo, ponente y colaboracion local -> `204` con cuerpo vacio, `GET` posterior `404`, y en psql `equipment 1->0`, `speakers 1->0`, `collabs 1->0` con la ficha del catalogo de ponentes intacta (`links=0`), confirmando la cascada y la conservacion del ponente; sin token `401`, `estudiante01` `403`, id inexistente `404`, id en blanco `400`; organizador de FIC con el permiso heredado del programa crea y borra su propio draft (`204`); asistencia presente `409` y la fila de `attendance` sobrevive; alerta presente `409` y la de `alerts` sobrevive; draft en programa `ARCHIVED` `409`; el `DELETE` directo por SQL de una `COMPLETED` y de la del programa archivado es rechazado por el trigger; tras reactivar el programa, el mismo draft borra con `204`. Auditoria: filas `activity.deleted` presentes con `changes {"before": {"status": "DRAFT"}}` y `activity_exists = 0` (el evento sobrevive al recurso); sin hashes, tokens ni secretos en los logs recientes.
- [x] Bruno: 7 requests nuevos en `Activities` (seq 24-30: crear draft eliminable, 401, 403, 409 por estado, 404, borrado `204` y `GET` posterior `404`) mas la variable `deletableActivityId`; `bru run Activities --env local` 36/36 requests y 34/34 tests en verde.
- [x] Contrato: operacion `DELETE /api/v1/activities/{id}` con bearer, path param `id`, sin request body, respuestas 204/400/401/403/404/409 y descripcion que enuncia la regla de retencion; el enum de permisos suma `activity:delete`; `openapi.json` regenerado sin drift.
- [x] Documentacion: README y CONTEXT describen la eliminacion, la regla de retencion, el trigger y el evento de auditoria; el catalogo base pasa de 19 a 20 claves. Sin variables de entorno nuevas.
- [x] Hallazgos: `F5.4-A` el trigger `activities_prevent_delete` tambien bloquea la purga manual por SQL de actividades no `DRAFT` (por ejemplo la limpieza de los borradores que dejo Bruno en 5.2), lo que obliga a deshabilitarlo dentro de una transaccion para limpiar residuos en desarrollo, igual que `event_programs_prevent_delete`; `F5.4-B` la eliminacion fisica no notifica a los inscritos porque un draft eliminable no tiene asistencia (misma dependencia que 12.1 cubre para cancelacion), asi que no se abrio un hueco de notificacion; `F5.4-C` `certificates.attendance_id` sigue en `ON DELETE RESTRICT`, pero es inalcanzable via API porque toda asistencia ya bloquea el borrado; `F5.4-D` la carrera entre lectura y escritura se cubre con `deleteMany` condicional mas traduccion de `P2003`/`23503` y el trigger, sin necesidad de reintentos.
- [x] Notas operativas: la imagen `sipeg-utp-backend:dev` estaba construida antes de que el trabajo concurrente de observabilidad agregara `pino`, por lo que el contenedor no arrancaba (`Cannot find package 'pino'`); se reconstruyo con `docker compose -f compose.dev.yaml build api`. Los fixtures de verificacion exigieron `AlertType.ACTIVITY_CANCELLED` (no `PROPOSAL_*`) para una alerta con `activity_id`, `start_date`/`end_date` y `created_by_id` de ADMIN para un programa adicional, y crear el draft mientras el programa sigue `ACTIVE` antes de archivarlo (el trigger `validate_activity_program` no permite insertar en un programa archivado). `format:check` global conserva 12 fallos, todos del trabajo concurrente de auditoria/observabilidad mas `actualizacion_tesis.md` que ya venia fallando desde 1.11; los dos archivos de 5.4 quedan formateados. Sin commit: el usuario no lo solicito.

**Problemas abiertos y cierre de Fase 5 (2026-09-27):**

Hallazgos de 5.4 que **no** requieren accion en esta fase:

- [x] `F5.4-B` la eliminacion fisica no notifica a los inscritos: enrutado a 12.1 con `AlertType.ACTIVITY_CANCELLED`, igual que `F5.3-A`. Una actividad eliminable no tiene asistencia, asi que no existen destinatarios que notificar y no se abrio un hueco.
- [x] `F5.4-C` `certificates.attendance_id` en `ON DELETE RESTRICT` es inalcanzable por API porque toda asistencia ya bloquea el borrado. Reevaluar en Fase 9 (asistencia) y Fase 10 (certificados) solo si alguna vez se permite purgar asistencia.
- [x] `F5.4-D` la carrera entre lectura y escritura queda cerrada por diseno: `deleteMany` condicional mas traduccion de `P2003`/`23503` y el trigger. No se requieren reintentos.
- [x] `F5.4-A` identificado: el trigger tambien bloquea la purga manual por SQL de actividades no `DRAFT`. Pasa a `P1` porque bloquea el cierre.

Pendientes accionables al cierre de la fase:

- [x] **P1 Procedimiento de purga de residuos en desarrollo.** Origen: `F5.4-A`. Resuelto el 2026-09-28. Creado `prisma/scripts/cleanup-dev-activities.ts` con el patron de `prisma/seed.base.ts` (`dotenv/config`, `PrismaPg` y `PrismaClient` generado) y el guard de produccion de `prisma/seed/helpers.ts`, ejecutable con `pnpm run prisma:cleanup:dev`. Simula por defecto y solo borra con `--apply`; el patron acepta sintaxis `LIKE` y se elige con `--pattern=`. Se niega a correr con `NODE_ENV=production` salvo `SEED_ALLOW_PRODUCTION=true`, rechaza los patrones que no coinciden con nada (`no-match`), que dejan todo retenido (`all-retained`) o que alcanzan toda la tabla (`pattern-too-broad`), y conserva cualquier actividad con asistencia o alertas. El borrado deshabilita `activities_prevent_delete` y `event_programs_prevent_delete` dentro de una transaccion y los rehabilita en el `finally`, incluso si el borrado falla. La logica de decision (`resolveCleanupScope` y `planDevCleanup`) esta probada con 12 pruebas TDD en `prisma/scripts/cleanup-dev-activities.test.ts`. Verificado en la base real: un residuo `CANCELLED` de la API y un `DRAFT` de programa archivado se purgaron (42 a 40 actividades), los tres triggers quedaron con `tgenabled = 'O'` y el trigger volvio a rechazar el borrado de una `COMPLETED`. Procedimiento documentado en el README bajo `Purgar residuos de desarrollo`.
- [x] **P2 Coleccion Bruno: 2 requests sin `tests` y 6 `seq` duplicados.** Bloquea el cierre. `bruno/Activities/Create an activity.bru` (seq 8) y `bruno/Activities/List upcoming activities.bru` (seq 2) quedaron de un `api:collection:import` destructivo con cuerpos de ejemplo vacios y sin bloque `tests`, por lo que pasan en verde sin comprobar nada: el primero en realidad responde 400 con 13 errores de validacion. Resuelto el 2026-09-28. `Create an activity` ahora lleva el payload completo real (descripcion, `SEMINAR`, `maxCapacity`, un ponente y dos elementos de equipo), tres `tests` que afirman 201, el alta del ponente en el catalogo, la normalizacion del equipo y los conteos `0/0`, y captura `fullPayloadActivityId` para que el request de cierre lo borre. `List upcoming activities` afirma 200, la forma de la pagina y que nunca expone un `DRAFT` ni codigos de check-in. Los seis `seq` duplicados quedaron desduplicados: set de listados 17-22, cancelaciones 23-29, borrados 30-36 y el nuevo request de cierre en 37, de modo que la carpeta tiene 37 `seq` unicos y ascendentes. Verificacion: `bru run Activities --env local` con 37 requests y 37 tests en verde.
- [x] **P3 Coleccion Bruno idempotente.** Cerrado el 2026-09-28 por decision del usuario: se acepta el residuo inevitable en lugar de cambiar la regla de retencion. El texto original de la accion se conserva abajo sin reescribir, y su ejecucion literal se sustituye por el cierre con limitacion documentada.
  - **Justificacion del cierre, la accion prescrita no es ejecutable.** El borrador del seq 3 recorre `DRAFT -> SCHEDULED -> CANCELLED` durante la misma corrida: lo publica `Publish a draft activity` (seq 12) y lo cancelan `Cancel a scheduled activity` (ahora seq 23) y `Cancel an already cancelled activity returns 200` (seq 24). Al terminar en `CANCELLED`, el borrado por API responde 409 y el trigger `activities_prevent_delete` lo rechaza por SQL, asi que el request de cierre que se pedia fallaria. Ademas el residuo es inevitable: una sola actividad tiene que servir las aserciones de `DRAFT`, `SCHEDULED` y `CANCELLED`, asi que no existe un payload que deje la carpeta en cero. Eliminarlo exigiria cambiar la regla de producto, no ajustar la coleccion.
  - **Lo que si se implemento:** el request `Delete the full payload activity` (seq 37) borra por API con assert 204 la actividad de `Create an activity`, que queda `DRAFT` y si es elegible, de modo que esa ruta no deja actividad residual; y `folder.bru` documenta los dos residuos que si quedan. **Verificado en seis corridas consecutivas:** la carpeta deja exactamente una actividad `CANCELLED` y un ponente huerfano en el catalogo por corrida.
  - **Costo aceptado:** una actividad `CANCELLED`, que `P1` purga con `pnpm run prisma:cleanup:dev -- --pattern='Actividad temporal%' --apply`, y un ponente huerfano que `P1` no toca porque se niega a modificar el catalogo y la retencion de 5.4 exige conservar la ficha al borrar la actividad; ese se borra a mano con `DELETE FROM speakers WHERE email='ana.prueba@utp.ac.pa'`. Eliminar el residuo `CANCELLED` de raiz requiere una purga por antiguedad o un endpoint administrativo, que es una decision de producto fuera del alcance de la Fase 5.
- [x] **P4 Deuda de `format:check`.** No bloquea. Resuelta el 2026-09-28, con el trabajo concurrente ya cerrado. `pnpm run format:check` quedo verde en todo el repositorio por primera vez. Ese dia se formatearon los 11 archivos restantes del trabajo de observabilidad (`docs/superpowers/plans/logging-y-auditoria.md`, `src/config/logger.ts` y `.test.ts`, `src/server.ts` y `.test.ts`, `src/lib/auth.test.ts` y los middlewares `authenticate`, `error`, `rateLimit` (servicio y pruebas) y `requestLogger`), mas `actualizacion_tesis.md` un dia antes. Nota operativa: `logging-y-auditoria.md` no es idempotente en una sola pasada, necesito tres aplicaciones de `prettier --write` para converger; con una unica pasada el archivo sigue en rojo. Ademas se anadio `silent` al catalogo de `LOG_LEVEL` y se fijo `LOG_LEVEL=silent` en la configuracion de Vitest, de modo que la suite dejo de volcar logs JSON en la salida del reporte.
- [ ] **P5 Imagen de desarrollo al dia.** No bloquea. `pino ^10.3.1` esta correctamente declarado en `dependencies`; el fallo de arranque fue una imagen construida antes del trabajo concurrente. Accion: reconstruir y verificar el stack desde el arbol actual al cerrar la fase. Verificacion: `docker compose -f compose.dev.yaml build api` y `up -d` arrancan un contenedor sano con `GET /api/v1/health` en 200 y `authJwksReachable: true`.
  - **Pendiente por bloqueo de entorno (2026-09-28).** El rebuild no se pudo ejecutar: se perdio el montaje de Docker Desktop en WSL (`/mnt/wsl/docker-desktop/` desaparecio, dejando colgando el symlink `/usr/bin/docker`), asi que no hay demonio al que pedirle un build. Queda abierto en vez de marcado por dos razones: el rebuild es la unica forma de probar que la imagen es reproducible, y `package.json` no cambio de dependencias en este trabajo, asi que solo se agrego el script `prisma:cleanup:dev`. Evidencia que si se tiene: el contenedor en ejecucion habia servido este mismo arbol con `GET /api/v1/health` en 200 y la carpeta Bruno en 37/37, de modo que el riesgo original (imagen sin `pino`) no se reproduce. Reanudar con `docker compose -f compose.dev.yaml build api` cuando Docker Desktop vuelva.
- [ ] **P6 La fase sigue abierta.** Bloquea el cierre. El criterio de salida de Fase 5 (solapes de aula en 409, colaboracion horizontal incorrecta en 403 y consistencia de disponibilidad al cambiar aula u horario) depende de 5.5 y 5.8, que estan pendientes. Accion: implementar 5.5, 5.6, 5.7 y 5.8 con planes separados y luego correr los gates de cierre. Verificacion: solape 409, capacidad 400, ventana 409 y `POST /api/v1/activities` cubierto por las mismas validaciones, con `pnpm test`, `typecheck`, `lint`, `build`, `format:check`, `docs:check`, `prisma:validate`, `prisma:migrate:status` y las carpetas Bruno tocadas en verde.

---

## Fase 6 - Infraestructura de archivos y correo

**Depende de:** Fase 1.

**Entregable:** subida segura de CV/imagenes y servicio de email configurable.

- [ ] **6.1 Decidir almacenamiento.** Crear ADR; opcion inicial recomendada: disco local fuera de rutas ejecutables con nombres aleatorios; alternativa S3-compatible.
- [ ] **6.2 Implementar subida segura.** Limite de tamano, allowlist MIME/extension, magic bytes, nombres aleatorios, proteccion path traversal y acceso privado a CV.
- [ ] **6.3 Crear endpoints de archivos.** `POST /api/v1/uploads/cv` y `POST /api/v1/uploads/images` con autenticacion o rate limit estricto segun el flujo.
- [ ] **6.4 Implementar email.** SMTP configurable y modo desarrollo; plantillas de verificacion, reset, propuesta, actividad y certificado.
- [ ] **6.5 Documentar variables.** Agregar `MAIL_*` y `UPLOAD_*`/`STORAGE_*` a `.env.example` y validarlas al arrancar.

**Criterio de salida:** MIME falso, exceso de tamano y traversal son rechazados; CV no accesible por URL publica; logs sin tokens.

---

## Fase 7 - Alertas

**Depende de:** Fase 1.

**Entregable:** bandeja in-app y servicio reutilizable para eventos de dominio.

- [ ] **7.1 Listar alertas - `GET /api/v1/alerts`.** Solo propias, paginacion y filtros `isRead`/`type`.
- [ ] **7.2 Marcar alertas.** Crear `PATCH /alerts/:id/read` y `POST /alerts/read-all`.
- [ ] **7.3 Crear helper interno.** Implementar `createAlert` reutilizable dentro de transacciones.
- [ ] **7.4 Aislar usuarios.** Consultar o modificar alertas ajenas debe producir 404.

**Criterio de salida:** aislamiento por usuario y rollback conjunto entre accion de dominio y alerta comprobados.

---

## Fase 8 - Ponentes y propuestas

**Depende de:** Fases 4, 6 y 7.

**Entregable:** formulario publico con CV, versionado inmutable, revision y feedback.

- [ ] **8.1 Enviar propuesta - `POST /api/v1/speaker-proposals`.** Publico con rate limit y CV; crear/reutilizar Speaker por email, propuesta PENDING y version 1; programa no ACTIVE produce 409.
- [ ] **8.2 Listar propuestas - `GET /api/v1/speaker-proposals`.** Requerir `proposal:read` en scope; filtros por estado, fecha y programa.
- [ ] **8.3 Consultar propuesta - `GET /api/v1/speaker-proposals/:id`.** Autor mediante mecanismo anonimo seguro o colaborador autorizado.
- [ ] **8.4 Actualizar propuesta - `PATCH /api/v1/speaker-proposals/:id`.** Crear `ProposalVersion` incremental sin modificar versiones anteriores; documentar autenticacion anonima en ADR.
- [ ] **8.5 Agregar feedback - `POST /api/v1/speaker-proposals/:id/feedback`.** Requerir `proposal:feedback`; texto o imagen obligatorios.
- [ ] **8.6 Resolver propuesta - `PATCH /api/v1/speaker-proposals/:id/status`.** Requerir `proposal:review`; permitir transiciones PENDING -> APPROVED/REJECTED.
- [ ] **8.7 Consultar versiones - `GET /api/v1/speaker-proposals/:id/versions`.** Historial inmutable y ordenado.
- [ ] **8.8 Emitir alertas y correos.** Notificar submit, update, feedback y respuesta.
- [ ] **8.9 Administrar catalogo de ponentes.** Listar ponentes y permitir vincular `userId` con autorizacion.

**Criterio de salida:** version 1 permanece intacta tras una actualizacion, CV invalido es rechazado, revision sin permiso produce 403 y programa archivado produce 409.

---

## Fase 9 - Asistencia

**Depende de:** Fase 5.

**Referencia:** `docs/adr/adr-0004-attendance-checkin-codes.md`.

- [ ] **9.1 Inscribirse - `POST /api/v1/activities/:id/attendance`.** Generar codigo unico global criptograficamente aleatorio; validar actividad disponible; duplicado `(activityId,userId)` produce 409.
- [ ] **9.2 Realizar check-in - `POST /api/v1/activities/:id/attendance/check-in`.** Validar codigo, actividad, usuario y metodo QR/MANUAL; segundo check-in produce 409.
- [ ] **9.3 Check-in asistido.** Permitir a quien tenga `attendance:checkin` validar codigos de terceros en su scope.
- [ ] **9.4 Listar asistencia - `GET /api/v1/activities/:id/attendance`.** Requerir `attendance:manage`; paginacion y filtros inscrito/presente.
- [ ] **9.5 Cancelar inscripcion - `DELETE /api/v1/attendance/:id`.** Dueño antes del check-in o staff autorizado; certificado existente produce 409.
- [ ] **9.6 Consultar asistencia propia - `GET /api/v1/users/me/attendance`.** Mostrar inscripciones e historial.
- [ ] **9.7 Resolver asistentes sin cuenta.** Decidir si el registro manual exige User o admite invitados; documentar modelo si cambia.
- [ ] **9.8 Proteger check-in.** Rate limit especifico y prohibicion de loguear codigos.
- [ ] **9.9 Auditar validacion.** Registrar quien valida, metodo y tiempos UTC.

**Criterio de salida:** codigo de otra actividad es rechazado, doble check-in no modifica datos, actividad cancelada/finalizada no acepta asistencia y se prueban permisos horizontales.

---

## Fase 10 - Certificados

**Depende de:** Fases 6, 7 y 9.

**Entregable:** emision individual/masiva, descarga protegida y deduplicacion.

- [ ] **10.1 Generar certificados.** Crear `POST /attendance/:id/certificate` y `POST /activities/:id/certificates`; requerir check-in y `certificate:generate`; evitar duplicados por `attendanceId`.
- [ ] **10.2 Definir generacion automatica.** Decidir job al completar actividad o generacion on-demand; documentar.
- [ ] **10.3 Consultar/descargar certificado - `GET /certificates/:id`.** Solo dueño o actor con `certificate:read`; archivo privado.
- [x] **10.4 Listar certificados propios - `GET /users/me/certificates`.** Paginacion offset (`page`/`limit`, maximo 50) y filtros `eventProgramId`, `activityId` e `issuedFrom`/`issuedTo` en calendario institucional. Aislamiento estructural por `attendance.userId`; sin `pdfUrl` ni `attendanceId` hasta 10.3.
- [ ] **10.5 Generar codigo seguro.** Unico, no secuencial y no adivinable.
- [ ] **10.6 Notificar emision.** Crear alerta y correo `CERTIFICATE_ISSUED`.

**Criterio de salida:** sin check-in produce 409, regeneracion no duplica, acceso ajeno produce 403 y codigos no se repiten.

**Registro de ejecucion (2026-09-29 - 10.4):**

- [x] Plan detallado en `docs/superpowers/plans/2026-09-29-fase-10-4-listar-certificados.md` con ciclo TDD rojo/verde en utilidades de fecha (4), schemas (11), servicio (14), rutas (11) y contrato OpenAPI (2). Baseline previo registrado antes de tocar codigo: `pnpm test` 1311 pruebas / 7 skip en 59 archivos en verde, con trabajo concurrente de logging sin commitear en `feat/logging-observability` que no se toco.
- [x] Decisiones confirmadas con el usuario: modulo nuevo `src/modules/certificates/` (no dentro de `users`, siguiendo el precedente de `authorization.routes.ts:142` que ya es dueno de `/users/me/permissions`); filtros `eventProgramId`, `activityId` e `issuedFrom`/`issuedTo`; y NO exponer `pdfUrl` ni un booleano de disponibilidad, porque el seed escribe rutas placeholder sin archivo detras y el almacenamiento es Fase 6 y la descarga 10.3.
- [x] Implementacion: `getInstitutionalDayRange(dateKey)` en `src/utils/date.ts` resuelve el offset de `America/Panama` con `Intl.DateTimeFormat` y `timeZoneName: 'longOffset'` (parsea `GMT-05:00`) en vez de hardcodear el offset, y devuelve `{ start, endExclusive }` con `endExclusive` 24 h exactas despues porque Panama no aplica horario de verano (ADR-0002). `certificates.schemas.ts` valida la query con `.strict()`, `z.iso.date()` (que rechaza `2026-02-30`) y un `.refine()` de orden con `path: ['issuedTo']`; `certificateSummarySchema` y `paginatedMyCertificatesSchema` llevan `.meta({ id })` para el contrato. `listMyCertificates(userId, query)` en el servicio con `select` explicito, orden `issuedAt desc, id asc` y `Promise.all([findMany, count])`. `GET /api/v1/users/me/certificates` con `authenticate -> validate -> controlador`. Sin migracion, sin permisos nuevos, sin auditoria y sin rate limit.
- [x] Pruebas: suite dirigida `src/modules/certificates` 36 en 3 archivos y `src/docs` 52; `pnpm test` 1349 en 60 archivos en verde (+38 sobre el baseline); `typecheck`, `lint`, `build` y `docs:check` en verde.
- [x] Verificacion real (stack Docker dev reconstruido, `GET /api/v1/health` 200 con `authJwksReachable: true`): el listado de `estudiante01@utp.ac.pa` devuelve `total: 3`, coincidente con el conteo de psql, ordenado de forma descendente y sin `pdfUrl` ni `attendanceId` en el JSON. Filtros: `eventProgramId=seed_program_fic_default` y `=seed_program_fisc_default` 1 cada uno, `activityId=seed_activity_fic-charla-puentes` 1, `issuedFrom=2026-08-26&issuedTo=2026-09-07` 3, `issuedFrom=2026-09-01` 1, rango que excluye todo `200` con `total: 0`, `page=2&limit=1` pagina correcta y `limit=50` 3. Errores: `limit=51`, `limit=0`, `page=0`, `page=abc`, `issuedFrom=2026-02-30`, `issuedFrom=26-08-2026`, rango invertido, `userId=`, `status=` y `activityId` en blanco responden `400` con el campo y el mensaje correctos; sin `Authorization` y con token invalido responden `401`. Aislamiento: los listados de `estudiante01` y `estudiante05` no se intersectan, `userId` en la query responde `400` y `ADMIN` obtiene `total: 0` sobre su propia cuenta y `400` al intentar pedir ajenos.
- [x] Limite de dia institucional probado contra la API real: se inserto temporalmente un certificado emitido `2026-09-08T02:00:00Z` (21:00 del 07 de septiembre en Panama) y la API lo archivo bajo `issuedTo=2026-09-07` y `issuedFrom=2026-09-07&issuedTo=2026-09-07`, mientras que `issuedFrom=2026-09-08` lo excluyo. Una implementacion con medianoche UTC lo habria contado en el dia 8. La fila se elimino despues y el conteo de certificados quedo en 33, igual al previo. El seed no tiene ningun certificado emitido entre 00:00Z y 05:00Z, asi que sin esta fila la prueba no habria discriminado.
- [x] Plan de consulta: `EXPLAIN` sobre la base real muestra que con las tablas pequenas el optimizador elige secuencial, pero forzando `enable_seqscan = off` aparecen `Bitmap Index Scan on attendance_user_id_checked_in_at_idx` y `Index Scan using certificates_attendance_id_key`, que son los indices ya existentes. No hace falta migracion para 10.4; un indice sobre `certificates.issued_at` solo se justificaria con volumen real, que llega con la Fase 9.
- [x] Bruno: carpeta `Certificates` con 8 requests (`seq` 1-8: login como estudiante con certificados, listado, filtro por programa, filtro por actividad, rango de emision, paginacion, filtro desconocido 400 y sin token 401) mas las variables `certificateEventProgramId` y `certificateActivityId`; `bru run Certificates --env local` con 8/8 requests y 17/17 tests en verde. El listado publica `myCertificateCount` para que las pruebas de filtro asserten que estrechan el total sin codificar el numero.
- [x] Contrato: operacion `GET /api/v1/users/me/certificates` con tag `Certificates`, bearer, seis parametros de query documentados y respuestas 200/400/401; componentes `CertificateSummary`, `CertificateActivity`, `CertificateEventProgram` y `PaginatedMyCertificates`; una prueba de contrato afirma que el resumen no documenta `pdfUrl` ni `attendanceId`; `openapi.json` regenerado sin drift.
- [x] Documentacion: README y CONTEXT describen el endpoint, los filtros, el aislamiento, la ausencia de `pdfUrl` y el helper de zona institucional. Sin variables de entorno nuevas.
- [x] Hallazgos: `F10.4-A` los codigos del seed (`seed_cert_03_01`) son secuenciales y adivinables; pertenece a 10.5 y el listado solo los muestra a su dueno. `F10.4-B` el listado no puede ofrecer descarga porque no hay almacenamiento (Fase 6) ni endpoint (10.3), y `pdfUrl` del seed apunta a rutas inexistentes; por eso no se expone ningun campo de archivo. `F10.4-C` el seed demo no se puede reejecutar sobre una base sembrada dias atras: las fechas de los programas adicionales se calculan con offsets desde `now`, asi que al重现char las fechas las actividades existentes quedan fuera del rango y el trigger `event_programs_validate_transition` rechaza el `UPDATE` con `event program dates cannot exclude existing activities`. Es previo a 10.4 y no lo introduce este trabajo, pero bloquea repetir el seed en una base de desarrollo antigua; la verificacion se hizo contra los datos ya sembrados. `F10.4-D` la carpeta `Users` de Bruno no tiene request de login y depende del token que deja otra carpeta, asi que `bru run Users` aislado falla con 401; es previo y la carpeta `Certificates` se hizo autocontenida con su propio login para no depender del orden.
- [x] Sin commit: el usuario no lo solicito.

---

## Fase 11 - Reportes y estadisticas

**Depende de:** Fases 9 y 10.

**Entregable:** metricas protegidas y exportacion opcional.

- [ ] **11.1 Reporte de asistencia - `GET /api/v1/reports/attendance`.** Filtros por programa, actividad, unidad y rango; datos agregados.
- [ ] **11.2 Estadisticas por scope.** Crear `/reports/programs/:id/statistics` y `/reports/activities/:id/statistics` con inscritos, presentes, tasa y ocupacion.
- [ ] **11.3 Resumen general - `GET /reports/overview`.** Programas activos, actividades proximas/pasadas y certificados emitidos.
- [ ] **11.4 Decidir exportacion.** Si entra en alcance, implementar XLSX/PDF con `report:export`, limite de filas, rate limit y ADR de librerias.
- [ ] **11.5 Minimizar PII.** Reportes agregados por defecto; nombres y datos identificables solo con permiso en scope.

**Criterio de salida:** cifras coinciden con datos conocidos del seed, scope horizontal probado, exportaciones no filtran PII y consultas cumplen el objetivo de rendimiento.

---

## Fase 12 - Notificaciones, auditoria y endurecimiento final

- [ ] **12.1 Notificar cambios de actividades.** Conectar `notifyAttendees` a modificar, cancelar o eliminar una actividad mediante asistencia, alertas y email. Cubre `F5.3-A` y `F5.4-B`.
- [ ] **12.2 Auditar acciones sensibles.** Parcialmente cubierto por el trabajo de observabilidad (ADR-0008): 25 acciones sobre 11 servicios, con `GET /api/v1/audit-events` y `audit_events` append-only por trigger. Ya auditado: archivar, publicar y reactivar programa; cancelar, eliminar, publicar y despublicar actividad; los cinco casos de permisos y cambio de rol; activacion, desactivacion, cambio de rol y creacion de usuarios; activacion y desactivacion de unidades, carreras y aulas; y los eventos de sesion de `auth`. Pendiente para cerrar 12.2: **exportar reportes** y **emitir certificados**, que dependen de las Fases 11 y 10 respectivamente. Pendiente en el plan de observabilidad: ratificar la retencion de 365 dias y definir el procedimiento de purga (T13.1 y T13.2), que requiere deshabilitar el trigger `audit_events_prevent_mutation` en transaccion.
- [ ] **12.3 Revisar OWASP API Top 10.** Cubrir BOLA/BFLA, mass assignment, rate limiting, headers, uploads y errores sin detalles internos.
- [ ] **12.4 Cerrar contrato HTTP.** Regenerar OpenAPI, comprobar drift y ejecutar la coleccion Bruno completa en un entorno local seguro.
- [ ] **12.5 Ejecutar E2E documentado.** Registro -> login -> unidad -> programa -> actividad -> propuesta -> asistencia -> certificado -> reporte.
- [ ] **12.6 Ejecutar cierre tecnico.** Tests, cobertura, typecheck, lint, build, migraciones, seed, documentacion, variables y ADRs.

**Criterio de salida:** recorrido E2E completo, controles de seguridad verificados, documentacion sincronizada y todos los comandos de calidad en verde.

---

## Decisiones pendientes

| #   | Decision                                            | Fase | Recomendacion inicial                                      |
| --- | --------------------------------------------------- | ---- | ---------------------------------------------------------- |
| 1   | Storage de archivos: disco o S3                     | 6    | Disco local seguro con ADR                                 |
| 2   | Proveedor SMTP/email                                | 6    | SMTP configurable; desarrollo en modo log                  |
| 3   | Identidad anonima del ponente para editar propuesta | 8    | Token secreto y temporal enviado por email                 |
| 4   | Crear actividad al aprobar propuesta                | 8    | No automatico; accion manual posterior                     |
| 5   | Eliminar o cancelar actividad                       | 5    | DELETE solo para DRAFT sin asistencia                      |
| 6   | Estados ONGOING/COMPLETED: derivados o job          | 5    | Derivarlos al leer para evitar scheduler inicial           |
| 7   | Catalogos solo ADMIN o permisos delegables          | 2    | Solo ADMIN inicialmente                                    |
| 8   | Exportacion Excel/PDF dentro del alcance            | 11   | Confirmar antes de agregar dependencias                    |
| 9   | Unificar ubicacion de controllers/routes            | 0    | Migrar gradualmente a modulos autocontenidos               |
| 10  | Bootstrap del primer ADMIN en produccion            | 2    | Resuelto: seed base `ensure` con `SEED_ADMIN_*` (ADR-0005) |

## Orden resumido

`0 cimientos -> 1 identidad/usuarios -> 2 catalogos -> 3 delegacion -> 4 programas -> 5 actividades -> 6 archivos/email -> 7 alertas -> 8 propuestas -> 9 asistencia -> 10 certificados -> 11 reportes -> 12 endurecimiento/E2E`
