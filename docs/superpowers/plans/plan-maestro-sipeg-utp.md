# Plan Maestro de Implementacion - SIPEG UTP Backend

> **Para agentes:** este es el roadmap global. Antes de ejecutar cada fase, generar su plan detallado con `writing-plans` (TDD, pasos de 2-5 min) y ejecutarlo con `executing-plans`. Cada item es un checklist autodocumentado con su prueba inline.
>
> **Orden logico:** Fases 0-1 (identidad) -> 2 (catalogos, prerrequisito de todo) -> 3-5 (autorizacion, programas, actividades) -> 6-8 (infraestructura transversal, alertas, propuestas) -> 9-11 (asistencia, certificados, reportes) -> 12 (endurecimiento y E2E).

**Objetivo:** Completar el backend REST de SIPEG UTP mediante fases incrementales, verificables y ordenadas por dependencia funcional.

**Arquitectura:** API REST modular con Express y TypeScript, reglas de negocio en servicios, persistencia PostgreSQL mediante Prisma y contratos definidos con Zod/OpenAPI. Las funcionalidades se implementan con TDD y cada fase debe dejar un producto integrado, documentado y comprobable antes de comenzar la siguiente.

**Stack:** Node.js 24, TypeScript, Express 5, Prisma 7, PostgreSQL, Better Auth, JWT EdDSA, Argon2id, Zod, OpenAPI 3.1, Vitest, Supertest y Bruno.

---

## 0. Estado actual

| Area                                                                                                                      | Estado                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Infraestructura: Express, errores, health, entorno, Prisma, Docker, rate limit, Helmet, OpenAPI/Scalar, Bruno y seed      | Implementado; seed dividido en base de produccion (`ensure`) y demo (`sync`), ADR-0005                                                                              |
| Autenticacion: login, registro, refresh, logout, verificacion de email, recuperacion de contrasena y cambio de contrasena | Implementados y verificados (1.1-1.7)                                                                                                                               |
| Usuarios: `GET/PATCH /users/me`, listado, detalle, creacion y actualizacion admin                                         | `GET/PATCH /users/me` verificado (1.6), `GET /admin/users` verificado (1.8), detalle verificado (1.9), creacion verificada (1.10) y actualizacion verificada (1.11) |
| Autorizacion: catalogo, resolucion y delegacion                                                                           | Servicios implementados; endpoints de colaboradores 3.1-3.2 implementados; faltan 3.3-3.10                                                                          |
| Programas: listado, creacion y actualizacion                                                                              | Parcial                                                                                                                                                             |
| Actividades: listado de proximas y creacion                                                                               | Parcial                                                                                                                                                             |
| Unidades organizativas, carreras y aulas                                                                                  | Implementadas y verificadas (2.A.1-2.A.7, 2.B.1-2.B.3 y 2.C.1-2.C.5); faltan archivos, email, alertas, propuestas, asistencia, certificados, reportes y auditoria   |
| Archivos, email, alertas, propuestas, asistencia, certificados, reportes y auditoria                                      | Pendiente                                                                                                                                                           |

Endpoints existentes: `/health`, `/auth/*`, `/users/me`, `/admin/users` (GET/POST), `/admin/users/:id` (GET/PATCH), `/event-programs`, `/activities`, `/organizational-units` con `POST /organizational-units`, `PATCH /:id`, `POST /:id/deactivate` y `POST /:id/reactivate`, `/careers` con `POST /careers`, `PATCH /:id` y `DELETE /:id`, `/classrooms` con `GET/POST /classrooms`, `GET /classrooms/available`, `GET/PATCH /classrooms/:id` y subrecursos de amenidades y disponibilidad, y `GET/POST /event-programs/:id/collaborators` y `GET/POST /activities/:id/collaborators`.

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

- [x] **1.1 Registrar usuario - `POST /api/v1/auth/register`.** Probar que se insertan filas en `users` y `accounts`; `accounts.password` comienza con `$argon2id$` y `argon2.verify` devuelve `true`; nunca se almacena texto plano ni se devuelve el hash; email o identificacion duplicados producen 409; el rol inicial es `USER`; el cuarto registro dentro de la ventana limitada produce 429.
- [x] **1.2 Iniciar sesion - `POST /api/v1/auth/login`.** Probar que credenciales validas devuelven access token EdDSA y refresh token, y crean una sesion; credenciales invalidas producen 401 sin revelar si existe el email; el limite de cinco intentos por minuto produce 429.
- [x] **1.3 Renovar sesion - `POST /api/v1/auth/refresh`.** Probar que se entrega un nuevo par de tokens, el refresh anterior deja de funcionar y tokens vencidos o revocados producen 401.
- [x] **1.4 Cerrar sesion - `POST /api/v1/auth/logout`.** Probar que se elimina la sesion correspondiente y que un usuario desactivado no puede usar su access token.
- [x] **1.5 Verificar email y recuperar contrasena.** Probar expiracion de tokens, respuestas que no revelan si un email existe, rate limit y revocacion de sesiones despues de restablecer la contrasena.
- [x] **1.6 Consultar y actualizar perfil - `GET/PATCH /api/v1/users/me`.** Probar aislamiento por usuario, validacion de unidad/carrera y ausencia de `password`, `accounts` y `name` interno.

### Funcionalidades nuevas

- [x] **1.7 Cambiar contrasena - `POST /api/v1/auth/change-password`.** Exigir autenticacion, contrasena actual y nueva contrasena de 12-128 caracteres; revocar las demas sesiones. Probar contrasena actual incorrecta y uso posterior de sesiones revocadas.
- [x] **1.8 Listar usuarios - `GET /api/v1/admin/users`.** Solo ADMIN; agregar paginacion, busqueda y filtros por rol, estado, unidad y carrera. Probar USER -> 403 y ausencia de campos sensibles.
- [x] **1.9 Consultar usuario - `GET /api/v1/admin/users/:id`.** Solo ADMIN; devolver DTO seguro y 404 para identificador inexistente.
- [x] **1.10 Crear usuario administrativo - `POST /api/v1/admin/users`.** Crear `users` y `accounts` con Argon2id; validar conflictos de email e identificacion.
- [x] **1.11 Actualizar usuario - `PATCH /api/v1/admin/users/:id`.** Permitir rol, estado, unidad y carrera; al desactivar, eliminar sesiones; impedir que el ultimo ADMIN sea degradado o desactivado e impedir autodesactivacion. Verificado con TDD en esquema (5 pruebas), servicio (12), ruta (10) y contrato (2); verificacion real con revocacion de sesiones y 409 de auto-proteccion; Bruno `Admin` 14/14 requests y 15/15 tests.

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
- [ ] **3.3 Cambiar rol.** Crear `PATCH .../collaborators/:userId`; reemplazar `ROLE_DEFAULT` y preservar `OVERRIDE`.
- [ ] **3.4 Eliminar colaborador.** Crear `DELETE .../collaborators/:userId`; impedir que el scope quede sin un actor capaz de delegar.
- [ ] **3.5 Otorgar permiso.** Crear `POST .../permissions`; validar subconjunto y atenuacion temporal; un envelope acotado no puede crear grants ilimitados.
- [ ] **3.6 Revocar permiso.** Crear `DELETE .../permissions/:permission`; no revocar herencia del programa desde una actividad; devolver 409 claro.
- [ ] **3.7 Consultar permisos propios.** Crear `GET /api/v1/users/me/permissions?scope=program|activity&id=` con envelopes temporales.
- [ ] **3.8 Exponer procedencia de permisos.** En detalles privados mostrar `inherited`, `local` y `effective`.
- [ ] **3.9 Ignorar permisos vencidos sin borrarlos.** Probar con reloj controlado.
- [ ] **3.10 Minimizar auditoria expuesta.** No devolver `grantedById` ni `grantedAt` salvo a actores autorizados.

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

**Criterio de salida:** tests de rutas con ADMIN, ORGANIZER, EDITOR y VIEWER cubren subconjunto simetrico, atenuacion, herencia y no ampliacion de scope.

---

## Fase 4 - Programas de eventos

**Depende de:** Fases 2 y 3.

**Entregable:** ciclo completo crear -> actualizar -> archivar -> reactivar.

- [ ] **4.1 Consultar programa - `GET /api/v1/event-programs/:id`.** Para programas ACTIVE, incluir unidad, etiqueta, fechas y conteo de actividades.
- [ ] **4.2 Revisar creacion y actualizacion.** Mantener `isDefault` y `organizationalUnitId` inmutables; validar `startDate <= endDate`; un programa ARCHIVED no es editable.
- [ ] **4.3 Archivar programa - `POST /api/v1/event-programs/:id/archive`.** Rechazar programas adicionales con actividades SCHEDULED/ONGOING y programas default cuya unidad este activa; guardar `archivedAt`; comportamiento idempotente.
- [ ] **4.4 Reactivar programa - `POST /api/v1/event-programs/:id/reactivate`.** Solo adicionales archivados; validar rango de fechas.
- [ ] **4.5 Completar filtros.** Permitir que ADMIN filtre estados no publicos; mantener listado publico limitado a ACTIVE.
- [ ] **4.6 Listar actividades del programa - `GET /api/v1/event-programs/:id/activities`.** Agregar filtros y paginacion.
- [ ] **4.7 Prohibir eliminacion fisica.** No exponer `DELETE` de programas; documentar 404/405.

**Criterio de salida:** transiciones invalidas rechazadas, `archivedAt` correcto y ninguna actividad creable en programas archivados.

---

## Fase 5 - Actividades

**Depende de:** Fase 4 y disponibilidad de aulas de Fase 2.

**Entregable:** ciclo de vida completo con validacion de calendario, aula y permisos.

- [ ] **5.1 Consultar actividad - `GET /api/v1/activities/:id`.** Incluir ponentes, aula, equipamiento, programa y conteo de inscritos.
- [ ] **5.2 Actualizar actividad - `PATCH /api/v1/activities/:id`.** Requerir `activity:update`; validar transiciones y rechazar edicion de COMPLETED/CANCELLED.
- [ ] **5.3 Cancelar actividad - `POST /api/v1/activities/:id/cancel`.** Requerir `activity:cancel`; admitir motivo opcional; no cancelar una actividad completada.
- [ ] **5.4 Definir eliminacion.** Recomendacion: permitir `DELETE` solo para DRAFT sin asistencia; documentar la regla de retencion.
- [ ] **5.5 Validar aula y horario.** Exigir `endTime > startTime`, ventana disponible, ausencia de solape, capacidad del aula suficiente, speakers validos y equipamiento sin duplicados.
- [ ] **5.6 Completar filtros.** Proximas, pasadas, programa, unidad, tipo de unidad, tipo de actividad, aula, rango de fechas y estado; paginacion.
- [ ] **5.7 Resolver estados temporales.** Decidir si ONGOING/COMPLETED se derivan al leer o mediante job; documentar con ADR si se usa scheduler.
- [ ] **5.8 Revisar creacion existente.** Aplicar todas las validaciones anteriores a `POST /activities`.

**Criterio de salida:** solapes de aula producen 409, colaboracion horizontal incorrecta produce 403 y cambios de aula/horario mantienen disponibilidad consistente.

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
- [ ] **10.4 Listar certificados propios - `GET /users/me/certificates`.** Paginacion y filtros.
- [ ] **10.5 Generar codigo seguro.** Unico, no secuencial y no adivinable.
- [ ] **10.6 Notificar emision.** Crear alerta y correo `CERTIFICATE_ISSUED`.

**Criterio de salida:** sin check-in produce 409, regeneracion no duplica, acceso ajeno produce 403 y codigos no se repiten.

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

- [ ] **12.1 Notificar cambios de actividades.** Conectar `notifyAttendees` a modificar, cancelar o eliminar una actividad mediante asistencia, alertas y email.
- [ ] **12.2 Auditar acciones sensibles.** Archivar programa, cancelar/eliminar actividad, modificar permisos, exportar reportes y emitir certificados.
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
