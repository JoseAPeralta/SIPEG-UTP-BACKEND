# Contexto Del Proyecto

## Producto

SIPEG UTP es una plataforma de gestion de eventos academicos. Este repositorio contiene solo el backend REST API; el frontend React vivira en un repositorio o carpeta separada y consumira este backend mediante HTTP.

El backend debe soportar usuarios, autenticacion, permisos, programas de eventos, actividades, asistencia, certificados, aulas, registro de ponentes, reportes y estadisticas.

## Alcance Del Backend

- Exponer endpoints REST versionados, preferiblemente bajo `/api/v1`.
- Reimplementar autenticacion y autorizacion desde 0 (estado actual: sin auth).
- Persistir datos con Prisma.
- Validar entradas del cliente antes de llegar a reglas de negocio.
- Centralizar errores y respuestas JSON.
- Mantener reglas de negocio en servicios, no en controladores ni rutas.
- Proteger rutas privadas y flujos sensibles con permisos.
- Preparar contratos estables para que el frontend separado los consuma.
- No incluir paginas, componentes, estado global, rutas de navegador, Vite, React, Chakra UI ni codigo browser-only.

## Estado Actual Del Repositorio

- El repositorio puede estar en estado inicial de scaffold.
- Si faltan `src/`, `prisma/`, `tsconfig.json`, scripts de pnpm o `.env.example`, deben crearse solo cuando la tarea lo requiera.
- Las convenciones en `AGENTS.md` describen la arquitectura objetivo y deben aplicarse incrementalmente.
- No se deben agregar dependencias, modulos vacios o placeholders solo para aparentar estructura.

## Stack Objetivo

- Node.js 24.x LTS o la ultima version LTS activa disponible.
- TypeScript.
- Express.
- Prisma ORM.
- Autenticacion y autorizacion: pendiente de reimplementar desde 0 (sin modulo `auth` ni middlewares de auth/authorize en el estado actual).
- pnpm como package manager.

## Lenguaje De Dominio

### Usuario

Persona que usa la plataforma. Puede ser asistente, colaborador, organizador, administrador o ponente segun sus permisos en cada programa de eventos o actividad.

### Unidad Organizativa

Catalogo unico de unidades de la universidad (`organizational_units`). Se distingue por `type` (`UnitType`): `FACULTY` (unidad academica usada para clasificar usuarios, carreras y programas de eventos) o `SUBDIRECTORATE` (unidad administrativa como las subdirecciones). Cada unidad tiene un programa de eventos predeterminado permanente, que debe estar activo mientras la unidad lo este, y puede registrar opcionalmente un encargado (`head_id`) que apunta a un usuario. Los codigos siguen prefijos por tipo (`FIC`, `FIE`, ..., `SUB-ACAD`, `SUB-ADMIN`) para permitir filtros por prefijo. La convencion queda documentada en `docs/adr/adr-0003-unified-organizational-units.md`.

### Carrera

Programa academico asociado a un usuario y a una unidad organizativa de tipo facultad. Se usa para segmentacion, reportes y comunicaciones. El catalogo no usa `isActive` (ADR-0006): toda carrera es seleccionable. `unit_id` es opcional; una carrera sin unidad es global y se siembra una unica carrera global `Otros` (`OTROS`), seleccionable con cualquier facultad. `OTROS` no se elimina, no cambia de codigo y debe permanecer global; una carrera con usuarios asociados no puede cambiar de unidad y solo se elimina (`DELETE`, `204`) cuando no tiene usuarios. Gestion exclusiva de `ADMIN`; lectura publica.

### Permiso De Colaboracion

Capacidad asignada a un usuario para colaborar en un programa de eventos o en una actividad. Los permisos del programa se heredan por defecto en todas sus actividades y pueden complementarse con permisos locales.

### Programa De Eventos

Unidad organizadora que agrupa actividades. Pertenece exactamente a una unidad organizativa. Cada unidad tiene un programa predeterminado permanente creado automaticamente; su condicion predeterminada y unidad propietaria son inmutables. Un administrador del sitio puede crear programas adicionales con fechas, etiqueta y banner. Los programas se archivan y no se eliminan fisicamente, aunque esten vacios.

### Actividad

Evento individual que pertenece obligatoriamente a un programa de eventos. Tiene nombre, tipo, ponentes, aula, fecha, hora, equipamiento requerido, banner, colaboradores y permisos. Una actividad puede tener varios ponentes a traves del catalogo `speakers`.

El termino "evento" puede usarse de forma coloquial, pero el nombre oficial del recurso, del modelo y del endpoint es **actividad** (`activities`). No existe un recurso `/events`.

### Asistente Registrado

Usuario inscrito o esperado en una actividad. Puede recibir notificaciones cuando la actividad se modifica, cancela o elimina.

### Registro De Asistencia

Evidencia de presencia en una actividad. Cada inscripcion (`activity` × `user`) tiene un `code` unico de validacion; el `method` (`QR`/`MANUAL`) registra como se valido. Ver `docs/adr/adr-0004-attendance-checkin-codes.md`.

### Certificado

Documento generado a partir de la asistencia. Puede generarse automaticamente o desde la lista de asistencia.

### Aula

Espacio disponible para actividades. Tiene tipo, horarios disponibles, dias disponibles, capacidad maxima y amenidades.

### Amenidad De Aula

Recurso disponible en un aula, como proyector, escritorios, mesas, smart board o pizarra.

### Ponente

Persona que propone o imparte una actividad. Vive en el catalogo `speakers` con nombre, email y organizacion opcionales; puede vincularse a una cuenta de usuario (`userId`) pero no es obligatorio registrarse en la plataforma. El flujo de propuestas captura ademas CV, duracion aproximada, tipo de charla, titulo, contenido, fecha de envio y programa de eventos al que aplica.

### Reporte

Vista o exportacion con metricas de programas, actividades, asistencia y certificados. Puede exportarse a Excel o PDF si el backend implementa exportacion.

### Estadistica

Indicador resumido para seguimiento operativo: asistencia total, ocupacion de aulas, certificados generados, programas activos y actividades disponibles o pasadas.

## Modulos Esperados Del Backend

### Autenticacion Y Usuarios

- Proveedor de auth modular con env vars **library-agnostic** (`AUTH_*`). Internamente usa Better Auth 1.7.x + plugin JWT.
- Password hashing: **Argon2id** con parametros OWASP (`t=2, m=19 MiB, p=1`).
- API privada 100% stateless: access tokens JWT EdDSA Ed25519 validados contra JWKS cacheado (vida 15 min).
- Refresh tokens = sesiones nativas del proveedor (`AUTH_REFRESH_TTL`, 7 dias por defecto), con expiracion absoluta y revocacion server-side inmediata.
- Flujos en `/api/v1/auth/*`: login, register, refresh, logout, verify-email, forgot-password, reset-password, change-password.
- `POST /auth/register` responde `201` con solo `userId`; email duplicado (normalizado a minusculas) o identificacion duplicada responden `409`. Con `autoSignIn: false` Better Auth devuelve un exito sintetico para emails existentes, por eso el servicio pre-valida en BD y verifica la persistencia del usuario creado.
- `POST /api/v1/auth/login` autentica contra el proveedor, crea la sesion y firma un access token JWT EdDSA; credenciales invalidas o una cuenta desactivada responden `401` con el mensaje generico `Invalid email or password`, y una sesion creada para una cuenta desactivada se elimina; limite de 5 intentos por minuto por IP.
- `POST /api/v1/auth/refresh` rota el refresh token: valida que la sesion exista, no este vencida y pertenezca a una cuenta activa, firma un access token EdDSA nuevo y reemplaza `sessions.token` de forma atomica. El refresh anterior deja de funcionar; un token vencido, revocado o de una cuenta desactivada responde `401`. La rotacion conserva la expiracion absoluta de la sesion.
- `POST /api/v1/auth/logout` elimina solo la sesion identificada por el refresh token y es idempotente. No revoca el JWT ya emitido; los access tokens permanecen stateless hasta vencer.
- El registro envia un correo de verificacion y el login exige `emailVerified=true`. Los tokens de verificacion duran `AUTH_EMAIL_VERIFICATION_TTL` (24 h por defecto), no crean una sesion al verificarse y tienen limite de 5 intentos/min por IP.
- `forgot-password` responde el mismo 200 para emails existentes e inexistentes. El token de reset dura `AUTH_PASSWORD_RESET_TTL` (1 h), es de un solo uso y el reset revoca todas las sesiones del usuario. Los JWT ya emitidos pueden seguir validos hasta `AUTH_TOKEN_TTL`.
- `POST /api/v1/auth/change-password` exige Bearer token, `currentPassword`, `newPassword` (12-128) y el `refreshToken` de la sesion actual: verifica la contrasena actual con Argon2id, actualiza `accounts.password` y revoca en una transaccion todas las sesiones del usuario excepto la actual. Un refresh token ajeno o una contrasena actual incorrecta responden `400`; limite de 5 intentos/min por usuario.
- `authenticate` consulta el usuario en BD en cada request privada y responde `403 Account is disabled.` si fue desactivado, aunque el JWT todavia sea criptograficamente valido.
- Handler del proveedor montado en `/api/auth/*splat` para flujos raw si el frontend los necesita.
- Middlewares: `authenticate` (carga `req.user`) y `authorize` (`requireRole`, `requireAdmin`, `requireOwnership`, `requirePermission`).
- `GET /api/v1/admin/users` es exclusivo de `ADMIN` (un `USER` recibe `403`): lista usuarios con paginación offset, búsqueda `q` insensible en nombre, apellido, email o identificación y filtros `globalRole`, `isActive`, `unitId` y `careerId`. El `select` excluye `name`, `accounts`, `password`, `passwordHash` y `emailVerified`.
- `GET /api/v1/admin/users/{id}` es exclusivo de `ADMIN`: devuelve el mismo DTO seguro de un usuario y responde `404 User not found.` para un identificador inexistente; un id vacío o de solo espacios responde `400`.
- `POST /api/v1/admin/users` es exclusivo de `ADMIN`: crea `users` + `accounts` en una transacción con Argon2id, acepta `globalRole`/`isActive` y valida unidad/carrera con las mismas reglas que el perfil. El email se normaliza, los duplicados de email o identificación responden `409` y el correo se crea sin verificar; `auth.api.sendVerificationEmail` envia el enlace y el login responde `403` hasta verificar.
- `PATCH /api/v1/admin/users/{id}` es exclusivo de `ADMIN`: permite `globalRole`, `isActive`, `unitId` y `careerId`; reutiliza la validación de unidad/carrera de `PATCH /users/me`; al desactivar ejecuta `user.update` + `session.deleteMany` en una transacción; autodesactivación y autodegradación responden `409`, igual que degradar o desactivar al último administrador activo.
- Rate limit por endpoint sensible (login 5/min, register 3/min, forgot/reset 3/min cada uno, verify-email 5/min y change-password 5/min por usuario).
- Correo de identidad mediante Nodemailer/SMTP con TLS 1.2 minimo. Mailpit captura correo local en `127.0.0.1:8025`; produccion exige `MAIL_HOST` y `MAIL_FROM`. Errores y logs no contienen destinatarios, enlaces ni tokens.
- Variables de auth: `AUTH_SECRET` (requerido), `AUTH_URL`, `AUTH_EMAIL_VERIFICATION_URL`, `AUTH_PASSWORD_RESET_URL`; opcionales `AUTH_ISSUER`, `AUTH_AUDIENCE`, `AUTH_TOKEN_TTL`, `AUTH_REFRESH_TTL`, `AUTH_EMAIL_VERIFICATION_TTL`, `AUTH_PASSWORD_RESET_TTL`.
- Documentacion detallada: `AGENTS.md` y `docs/adr/adr-0001-time-aware-collaboration-authorization.md`.

### Autorizacion Por Colaboracion

- Catalogo de permisos `recurso:accion` y defaults por rol en `src/modules/authorization/permissions.ts`.
- Colaboraciones por programa o actividad; herencia aditiva programa a actividad; `ADMIN` con bypass total.
- Resolutor de permisos efectivos y envelopes temporales en `authorization.service.ts`.
- Vigencia por permiso (`validFrom`/`validUntil`); grants vencidos se ignoran sin borrarse.
- `permission:grant` habilita delegar; invariante de subconjunto simetrico y atenuacion temporal en `delegation.service.ts`.
- Sin `DENY` local: un permiso heredado del programa no se revoca en la actividad.
- El catalogo se siembra con `pnpm prisma:seed:base` en produccion y `pnpm prisma:seed` en desarrollo.

### Unidades Organizativas

- `GET /api/v1/organizational-units` y `GET /api/v1/organizational-units/{id}` son publicos; el listado muestra solo activas salvo `isActive=false`, con paginacion, filtro `type` y busqueda `q` por nombre o codigo. El detalle incluye `careers` y `defaultProgram`.
- Gestion exclusiva de `ADMIN`: crear (unidad + programa predeterminado `ACTIVE` en una transaccion; `code` unico insensible a mayusculas y normalizado), actualizar `name`/`description`/`headId` (`code` y `type` inmutables), desactivar y reactivar.
- Desactivar exige que el programa predeterminado no tenga actividades `SCHEDULED`/`ONGOING` (`409`); en la misma transaccion la unidad pasa a inactiva y el programa se archiva (la unidad debe quedar inactiva antes de archivar por el trigger de BD). Reactivar delega en el trigger la restauracion del programa predeterminado existente.
- `headId` solo admite usuarios activos; `null` lo elimina. El encargado se expone solo como `{ id, firstName, lastName }`.

### Programas De Eventos Y Actividades

- `GET /api/v1/event-programs` es publico y devuelve programas `ACTIVE` con paginacion y filtros opcionales por unidad organizativa, tipo de unidad y busqueda en nombre o etiqueta.
- `PATCH /api/v1/event-programs/:id` (privado) actualiza parcialmente `name`, `description`, `label`, `bannerUrl`, `startDate` y `endDate`; requiere `program:update` en el scope del programa (o rol `ADMIN`) y rechaza programas `ARCHIVED` con `409`.
- `GET /api/v1/activities` es publico y devuelve proximas actividades: actividades `SCHEDULED`/`ONGOING` de programas `ACTIVE`, con `date >= hoy` en la zona institucional.
- Paginacion offset: `?page` (default 1) y `?limit` (default 20, maximo 50). Respuesta `data = { items, page, limit, total, totalPages }`; la lista no expone codigos de check-in.
- `POST /api/v1/activities` (privado) crea actividades en estado `DRAFT` dentro de un programa `ACTIVE`, con permiso `activity:create` o rol `ADMIN`; acepta `speakers[]` inline sin exigir cuenta.
- Las respuestas exponen `speakers` (array de `{ id, firstName, lastName }`) en lugar del antiguo `speaker` unico.
- Los codigos de check-in (`code`) viven en `attendance` (uno por inscripcion, unico global), no en la actividad. Ver `docs/adr/adr-0004-attendance-checkin-codes.md`.
- Crear automaticamente un programa predeterminado permanente al crear una unidad organizativa.
- Permitir que solo el administrador del sitio cree programas adicionales.
- Asociar cada programa exactamente a una unidad organizativa (`organizationalUnitId`).
- Crear actividades unicamente dentro de un programa activo.
- Asociar colaboradores y permisos a programas y actividades.
- Exponer permisos heredados del programa junto con los permisos locales de la actividad.
- Archivar programas en lugar de eliminarlos fisicamente.
- Bloquear el archivado de programas adicionales con actividades programadas o en curso.
- Mantener activo el programa predeterminado mientras su unidad organizativa siga activa.
- Reactivar una unidad y su programa predeterminado existente dentro de la misma transaccion.
- Filtrar actividades por disponibilidad, historial, unidad organizativa y programa.
- Soportar notificaciones antes de modificar, cancelar o eliminar actividades cuando exista servicio de email.

### Asistencia

- Permitir que un mismo registro represente la inscripcion antes del check-in y la presencia despues del check-in.
- Registrar asistencia por actividad.
- Soportar QR y codigos manuales.
- Prevenir duplicados cuando la regla de negocio exija una asistencia unica por usuario y actividad.
- Validar disponibilidad de la actividad antes de aceptar asistencia.
- Mantener auditoria cuando sea necesario.

### Certificados

- Generar certificados a partir de registros de asistencia.
- Evitar duplicados salvo solicitud explicita.
- Guardar metadata del certificado.
- Proteger generacion y descarga con permisos.

### Inventario De Aulas

- `GET /api/v1/classrooms` y `GET /api/v1/classrooms/{id}` son publicos; el listado muestra solo activas salvo `isActive=false`, con paginacion y filtros `type`, `minCapacity` y `amenity`. El detalle incluye `amenities` y `availability`.
- Gestion exclusiva de `ADMIN`: crear, actualizar (`name`, `type`, `capacity`, `building`, `floor`, `isActive`), agregar/quitar amenidades y agregar/quitar ventanas de disponibilidad.
- `dayOfWeek` usa numeracion ISO (1 lunes a 7 domingo); una ventana exige `startTime < endTime` y un solape en el mismo dia responde `409`. Las amenidades duplicadas se rechazan sin distinguir mayusculas.
- Desactivar un aula con actividades `SCHEDULED`/`ONGOING` responde `409`.
- `GET /api/v1/classrooms/available` cruza la ventana semanal del dia institucional con las actividades que reservan aula (`SCHEDULED`/`ONGOING`, igual que la exclusion GiST `activities_classroom_no_overlap`); `DRAFT`, `COMPLETED` y `CANCELLED` no bloquean.
- Administrar aulas, tipos, horarios, dias disponibles, capacidad y amenidades.
- Validar disponibilidad antes de asignar aula a una actividad.
- Exponer filtros para disponibilidad y capacidad.

### Registro De Ponentes

- Permitir que el ponente envie propuestas sin tener una cuenta de usuario; el catalogo `speakers` vincula la cuenta solo cuando existe.
- Recibir propuestas de ponentes asociadas a programas de eventos.
- Capturar datos personales necesarios, CV, duracion aproximada, tipo de charla, titulo y contenido.
- Conservar versiones inmutables cuando el ponente actualice su propuesta.
- Permitir feedback en texto o imagen por colaboradores autorizados del programa.
- Alertar al ponente y a los responsables cuando la propuesta se envia, actualiza o responde.
- Validar y restringir archivos CV por tipo, tamano y destino.
- Reenviar propuestas por email solo si existe servicio configurado.

### Reportes Y Estadisticas

- Exponer numeros de asistencia y participacion.
- Exportar Excel o PDF solo si se implementa soporte de exportacion.
- Proteger reportes con autorizacion.
- Evitar exponer datos personales salvo que el usuario solicitante este autorizado.

## Decisiones De Trabajo

- `server.ts` inicia el servidor y gestiona apagado ordenado.
- `app.ts` configura Express, middleware global, rutas, not-found y errores.
- Los modulos de dominio viven bajo `src/modules`.
- Cada modulo es autocontenido: controlador, rutas, schemas, servicio, OpenAPI y pruebas viven bajo `src/modules/<modulo>`; `src/routes.ts` solo agrega y monta los routers.
- Las rutas conectan paths, validacion, middleware y controladores.
- Los controladores manejan HTTP y delegan reglas de negocio.
- Los servicios contienen reglas de negocio y decisiones sensibles.
- Prisma debe usarse desde una instancia centralizada.
- La capa de repositorio se agrega solo cuando la complejidad de datos lo justifique.
- Las respuestas JSON deben ser consistentes.
- Los endpoints que puedan crecer deben tener paginacion y filtros.
- Las reglas ambiguas se resuelven con el comportamiento seguro minimo o con una pregunta corta si bloquean la implementacion.
- La zona horaria institucional es `America/Panama` (UTC-5, sin DST). Los filtros de fecha de negocio se calculan con `src/utils/date.ts`; los instantes de auditoria permanecen en UTC. Detalle en `docs/adr/adr-0002-institutional-timezone-panama.md`.

## Seguridad

- Aplicar practicas alineadas con OWASP API Security Top 10.
- Validar params, query, body y archivos.
- Usar CORS con origenes explicitos.
- No usar `*` en CORS de produccion.
- Agregar rate limiting para login, registro, asistencia QR, codigos manuales, formularios publicos y reportes costosos.
- Usar headers de seguridad cuando corresponda.
- No registrar secretos, contrasenas, tokens, headers `Authorization`, URLs de base de datos ni CVs.
- No exponer stack traces, errores crudos de Prisma, detalles de tokens ni secretos en respuestas.
- Auditar acciones administrativas sensibles cuando el modulo lo requiera.

## Prisma

- Revisar la version real de Prisma antes de copiar patrones de los skills.
- Para Prisma 7 con SQL, considerar `prisma.config.ts`, output explicito del generator y driver adapters.
- Para configuraciones Prisma existentes, seguir el patron actual salvo que el usuario pida migrar.
- Ejecutar `pnpm prisma validate`, `pnpm prisma format` y `pnpm prisma generate` cuando se modifique el schema y Prisma este configurado.
- Crear migraciones con `pnpm prisma migrate dev` cuando haya cambios de schema.
- Usar transacciones para escrituras relacionadas que deban ser atomicas.
- Usar `select` u `omit` para evitar devolver datos sensibles.
- Evitar raw SQL salvo razon concreta y segura.

## TypeScript

- Preferir configuracion estricta al inicializar el proyecto.
- Usar `unknown` para datos externos o no confiables.
- Evitar `any` salvo justificacion clara.
- Preferir interfaces para shapes de objetos y types para uniones o utilidades complejas.
- Mantener tipos cerca del modulo que los usa.
- Usar tipos avanzados solo cuando simplifiquen contratos o eliminen errores reales.

## Testing

- Para features, bugfixes, refactors o cambios de comportamiento, aplicar TDD.
- Escribir primero una prueba que falle por la razon esperada.
- Implementar el cambio minimo para pasar la prueba.
- Probar servicios, middleware y rutas criticas.
- Cubrir autenticacion, autorizacion, validacion y errores esperados.
- Usar base de datos de prueba aislada para pruebas con Prisma.
- Los cambios de documentacion no requieren pruebas automatizadas.

## Skills Instalados Como Referencia

- `writing-plans` y `executing-plans` guian trabajo multi-paso con planes verificables.
- `test-driven-development` define el flujo red-green-refactor.
- `nodejs-backend-patterns` guia estructura Express, middleware, servicios, errores y respuestas.
- `secure-code-guardian` y `api-security-best-practices` guian seguridad, OWASP, auth, validacion, rate limiting y proteccion de datos.
- `prisma-cli`, `prisma-client-api`, `prisma-database-setup` y `prisma-postgres` guian Prisma segun el caso.
- `typescript-expert` y `typescript-advanced-types` guian TypeScript, strictness y contratos tipados.
- `multi-stage-dockerfile` guia Docker si se agrega contenedorizacion.
- `architecture-blueprint-generator` y `create-architectural-decision-record` guian documentacion arquitectonica.
- `git-commit` guia commits convencionales solo cuando el usuario pida commitear.
