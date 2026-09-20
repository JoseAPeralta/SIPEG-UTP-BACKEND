# SIPEG UTP Backend

Backend REST API para SIPEG UTP. Este repositorio contiene solo el backend Node.js/TypeScript; el frontend debe consumir la API por HTTP desde otro repositorio o carpeta.

## Requisitos

- Node.js 24.21.x LTS (ver `.node-version`).
- pnpm 12.4.2 (via corepack).
- Docker con Compose v2 para los entornos contenerizados.
- PostgreSQL 18 (contenedor `postgres:18.6-alpine` o instancia externa).

## Instalacion

```bash
corepack enable
pnpm install
```

Configura las variables de entorno usando `.env.example` como referencia.

## Entornos con Docker

El proyecto usa dos archivos Compose independientes: uno de desarrollo y uno de produccion.

| Entorno    | Archivo             | Uso                                                                         |
| ---------- | ------------------- | --------------------------------------------------------------------------- |
| Desarrollo | `compose.dev.yaml`  | Hot reload, migraciones, PostgreSQL y Mailpit publicados en loopback.       |
| Produccion | `compose.prod.yaml` | Imagen runtime minima, sin puertos de base de datos, secretos obligatorios. |

### Desarrollo

```bash
docker compose -f compose.dev.yaml up --build
```

- La API queda disponible en `http://localhost:3000/api/v1/health`.
- El codigo en `src/` y `prisma/` se monta como volumen: los cambios se recargan con `tsx watch`.
- Un servicio one-shot `migrate` aplica `prisma migrate deploy` antes de arrancar la API.
- PostgreSQL se expone solo en `127.0.0.1:${POSTGRES_PORT:-5432}` para uso local.
- Mailpit recibe los correos de identidad por SMTP y expone su bandeja solo en `http://127.0.0.1:${MAILPIT_PORT:-8025}`.

Para crear una migracion nueva durante el desarrollo:

```bash
docker compose -f compose.dev.yaml exec api pnpm run prisma:migrate:dev
```

Detener el entorno:

```bash
docker compose -f compose.dev.yaml down
```

Evita `down -v` salvo que quieras destruir los datos locales: elimina el volumen de PostgreSQL.

### Produccion

1. Crea un archivo `.env.prod` (no se versiona) con secretos reales. Usa la seccion de produccion de `.env.example` como guia.
2. En el primer despliegue sobre una base vacia define el ADMIN inicial en `.env.prod` (`SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_ADMIN_IDENTIFICATION_NUMBER`); el seed base falla si no existe ningun ADMIN y no hay bootstrap configurado.
3. Levanta el stack:

```bash
docker compose -f compose.prod.yaml --env-file .env.prod up -d --build
```

- El servicio `migrate` aplica las migraciones pendientes y termina; luego el servicio one-shot `seed` carga el catalogo base institucional y el ADMIN inicial; la API solo arranca si ambos finalizan correctamente.
- El seed base es idempotente y no sobrescribe datos existentes: puedes re-ejecutarlo con `docker compose -f compose.prod.yaml --env-file .env.prod run --rm seed`.
- La base de datos no publica puertos al host; solo es accesible por la red interna de Compose.
- `DATABASE_URL` se construye automaticamente con host `db` a partir de `POSTGRES_DB`, `POSTGRES_USER` y `POSTGRES_PASSWORD`; no la definas en `.env.prod`.
- Las variables obligatorias de Compose son: `CORS_ORIGIN`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `AUTH_SECRET`, `AUTH_URL`, `AUTH_EMAIL_VERIFICATION_URL`, `AUTH_PASSWORD_RESET_URL`, `MAIL_HOST` y `MAIL_FROM`.
- Si `POSTGRES_PASSWORD` contiene caracteres especiales (`@ : / ? # %`), codificalos en porcentaje o usa solo caracteres alfanumericos.
- `IMAGE_TAG` permite etiquetar la imagen de la API (por defecto `latest`).
- La API se detiene con `stop_grace_period: 15s`, mayor que el timeout interno de apagado ordenado.

Detener el entorno:

```bash
docker compose -f compose.prod.yaml --env-file .env.prod down
```

#### Nota sobre PostgreSQL 18 y datos existentes

La imagen de PostgreSQL 18 guarda los datos en `/var/lib/postgresql` (cluster en `/var/lib/postgresql/18/docker`), no en `/var/lib/postgresql/data`. La configuracion anterior montaba el volumen en la ruta vieja, por lo que esos datos pueden estar en un volumen anonimo.

Si tienes datos que conservar, haz un backup antes de recrear los contenedores:

```bash
docker ps
docker exec <contenedor-db-anterior> pg_dumpall -U sipeg > backup.sql
```

Luego restaura `backup.sql` en el nuevo volumen antes de levantar la API. El nombre del proyecto y del volumen tambien cambian (`sipeg-utp-dev` / `sipeg-utp-prod`).

## Scripts

- `pnpm run dev`: inicia el servidor en modo desarrollo con `tsx watch`.
- `pnpm run build`: compila TypeScript hacia `dist/` sin incluir `*.test.ts`.
- `pnpm run start`: ejecuta el build compilado.
- `pnpm run typecheck`: valida tipos sin emitir archivos.
- `pnpm run lint`: ejecuta ESLint.
- `pnpm run lint:fix`: aplica fixes disponibles de ESLint.
- `pnpm run format`: formatea con Prettier.
- `pnpm run format:check`: valida formato con Prettier.
- `pnpm test`: ejecuta Vitest.
- `pnpm run docs:generate`: regenera `openapi.json` desde los schemas Zod.
- `pnpm run docs:check`: falla si `openapi.json` esta desactualizado (usar en CI).
- `pnpm run api:collection:import`: regenera destructivamente la coleccion Bruno desde `openapi.json`.
- `pnpm run api:run`: ejecuta toda la coleccion Bruno contra el environment `local`; puede modificar datos.
- `pnpm run api:run:smoke`: ejecuta unicamente el health check de Bruno.
- `pnpm run prisma:validate`: valida `prisma/schema.prisma`.
- `pnpm run prisma:format`: formatea `prisma/schema.prisma`.
- `pnpm run prisma:generate`: genera Prisma Client en `src/generated/prisma` sin conectarse a la base de datos.
- `pnpm run prisma:migrate:dev`: crea y aplica migraciones de desarrollo; requiere una `DATABASE_URL` valida.
- `pnpm run prisma:migrate:deploy`: aplica migraciones pendientes; usado por el servicio `migrate` en Docker.
- `pnpm run prisma:migrate:status`: reporta el estado de las migraciones.
- `pnpm run prisma:seed`: siembra el catalogo de permisos y los datos de prueba completos (solo desarrollo; idempotente).
- `pnpm run prisma:seed:base`: siembra el catalogo base de produccion (unidades, programas predeterminados, carreras, aulas y permisos) y el ADMIN inicial; crea solo lo que falta.

## API Inicial

```http
GET /api/v1/health
```

Respuesta esperada:

```json
{
  "success": true,
  "message": "Service is healthy.",
  "data": {
    "status": "ok",
    "service": "sipeg-utp-backend",
    "environment": "development",
    "authJwksReachable": true
  }
}
```

## Documentacion De API

El contrato OpenAPI 3.1 se genera desde los schemas Zod (`src/**/*.schemas.ts`) con `zod-openapi`, de modo que validacion y documentacion no se desincronizan.

- UI interactiva (Scalar): `http://localhost:3000/api/docs`.
- Especificacion JSON: `http://localhost:3000/api/openapi.json`.
- Ambas rutas estan detras de `DOCS_ENABLED` (habilitadas por defecto fuera de `NODE_ENV=production`).

El documento se versiona como `openapi.json` en la raiz:

```bash
pnpm run docs:generate   # regenera openapi.json
pnpm run docs:check      # falla si openapi.json esta desactualizado
```

Regla de flujo: al cambiar rutas, schemas de validacion o responses, ejecuta `pnpm run docs:generate` y commitea `openapi.json` junto al cambio. Los nombres de componentes (`UserProfile`, `PaginatedActivities`, ...) provienen de `.meta({ id })` y son parte del contrato: renombrarlos es un cambio incompatible para el frontend.

### Cliente HTTP con Bruno

La coleccion completa en `bruno/` se genera desde `openapi.json`, se agrupa por tags y se versiona como archivos `.bru`. El environment `local` apunta a `http://localhost:3000`; hay tres requests de login por rol (`Auth/Log in with email and password - admin`, `- user` y `- head`) y todos guardan `data.accessToken`/`data.refreshToken` en las mismas variables de runtime (`token`/`refreshToken`), de modo que el ultimo login ejecutado define el rol con el que corren los endpoints privados.

En el cliente visual de Bruno, despues de abrir la coleccion `bruno/` debes seleccionar el environment `local` en el selector superior derecho; por defecto queda en `No Environment`. Sin esa seleccion `{{baseUrl}}` no se resuelve y los requests fallan con `getaddrinfo ENOTFOUND {{baseurl}}`. Los scripts `pnpm run api:run*` no necesitan ese paso porque pasan `--env local`.

```bash
pnpm run api:run:smoke # seguro: solo GET /api/v1/health
pnpm run api:run       # coleccion completa; contiene operaciones que modifican datos
```

`pnpm run api:collection:import` sobrescribe la coleccion: despues de reimportar hay que restaurar el script post-response y las assertions de `Auth/Log in with email and password - admin.bru`, `Auth/Log in with email and password - user.bru` y `Auth/Log in with email and password - head.bru` (los tres capturan `token`/`refreshToken`), y ademas reordenar los requests de las carpetas `Admin`, `Careers`, `Classrooms` y `Organizational_Units` (el login de head debe quedar antes de los requests que esperan 403 y capturar la misma variable compartida). El folder `Sessions` (separado de `Auth` para no agotar el limite de 5 logins/min por IP) contiene su propio `Sessions/Log in as admin.bru` y los flujos de refresh/logout. Los scripts/assertions de `Sessions/Refresh the access token.bru` y `Sessions/Log out and revoke the refresh token.bru`, y los scripts/assertions de `Auth/Register a new user.bru`, `Auth/Register duplicate email returns 409.bru`, `Auth/Register duplicate identification returns 409.bru`, `Auth/Register rate limit returns 429.bru`, `Auth/Login wrong password returns 401.bru`, `Auth/Login unknown email returns 401.bru`, `Auth/Login rate limit returns 429.bru`, `Sessions/Refresh reused token returns 401.bru` y `Sessions/Logout revoked token returns 401.bru` tambien se restauran. No guardes tokens ni credenciales reales en archivos versionados; usa un archivo `*.private.bru`, ignorado por Git, o variables proporcionadas en runtime. El login tiene limite de 5 intentos por minuto.

Flujo de registro (fase 1.1) en Bruno: ejecuta `Auth/Register a new user` (genera `newUserEmail` y `newUserIdentification` en runtime, espera 201 y valida que no se filtre el hash), luego `Auth/Register duplicate email returns 409` y `Auth/Register duplicate identification returns 409`. Para el limite de tasa, espera a una ventana limpia y envia `Auth/Register rate limit returns 429` cuatro veces en menos de un minuto: el cuarto intento responde 429. El registro tiene limite de 3 intentos por minuto por IP.

Flujo de login (fase 1.2) en Bruno: `Auth/Log in with email and password - admin` valida 200, captura los tokens y comprueba `alg=EdDSA` y ausencia de `$argon2`; `Auth/Log in with email and password - user` y `Auth/Log in with email and password - head` repiten el login con el usuario regular y el organizador del seed, respectivamente, y reemplazan `token`/`refreshToken` para probar la autorizacion de cada rol. `Auth/Login wrong password returns 401` y `Auth/Login unknown email returns 401` verifican el mismo 401 generico (`Invalid email or password`), sin revelar si el correo existe. El login tiene limite de 5 intentos por minuto por IP: invoca `Auth/Login rate limit returns 429` seis veces en una ventana limpia; el sexto responde 429. Espera 60 segundos entre corridas completas de `Auth`.

Flujo de refresh y logout (fases 1.3-1.4) en Bruno, en el folder `Sessions`: `Sessions/Log in as admin` captura `token`/`refreshToken`; `Sessions/Refresh the access token` usa el refresh token capturado, espera 200, comprueba que el refresh token rota (nuevo distinto al anterior) y que el access token es EdDSA, y actualiza las variables de runtime. `Sessions/Refresh reused token returns 401` reenvia el token anterior a la rotacion; `Sessions/Log out and revoke the refresh token` revoca el token vigente y `Sessions/Logout revoked token returns 401` demuestra que ya no puede renovarse. La sesion conserva una expiracion absoluta configurada por `AUTH_REFRESH_TTL`.

El `opencode.json` del proyecto registra el MCP oficial `@usebruno/mcp`, fijado a un commit porque todavia no se publica en npm, y lo limita a la coleccion `bruno/`. Reinicia opencode despues de cambiar esa configuracion. El agente debe inspeccionar el request antes de ejecutar POST/PATCH/DELETE y no ejecutar requests contra produccion sin aprobacion explicita. Si MCP no esta disponible, los scripts pnpm anteriores son el fallback.

### Consumir el contrato desde el frontend

El frontend vive en otro repositorio y puede generar tipos con `openapi-typescript`.

Estrategia A (artefacto versionado, recomendada):

```bash
pnpm dlx openapi-typescript ../SIPEG-UTP-BACKEND/openapi.json -o src/api/schema.d.ts
```

Estrategia B (endpoint en vivo, requiere el backend levantado):

```bash
pnpm dlx openapi-typescript http://localhost:3000/api/openapi.json -o src/api/schema.d.ts
```

Cliente tipado opcional con `openapi-fetch`:

```ts
import createClient from 'openapi-fetch';

import type { paths } from './api/schema';

const api = createClient<paths>({ baseUrl: 'http://localhost:3000' });

const { data, error } = await api.GET('/api/v1/activities', {
  params: { query: { page: 1, limit: 20 } },
});
```

Las rutas de `/api/auth/*` pertenecen al proveedor de autenticacion (Better Auth) y no forman parte del contrato documentado; el contrato publico es `/api/v1/*`.

### Auth

- Password hashing con **Argon2id** (parametros OWASP: `t=2, m=19 MiB, p=1`).
- Access tokens: JWT EdDSA Ed25519 (15 min) validados contra JWKS cacheado.
- Refresh tokens: sesiones server-side (`AUTH_REFRESH_TTL`, 7 dias por defecto), expiracion absoluta y revocacion inmediata.
- Endpoints principales (`/api/v1/auth/*`):
  - `POST /auth/login` — devuelve access token EdDSA + refresh token; credenciales invalidas o cuenta desactivada responden 401 generico (`Invalid email or password`) sin revelar si el correo existe; una cuenta no verificada responde 403; limite de 5 intentos/min por IP.
  - `POST /auth/refresh` — rota el refresh token y emite un nuevo par; el token anterior queda invalido y tokens expirados, revocados o de cuentas desactivadas responden 401.
  - `POST /auth/logout` — invalida solo el refresh token enviado; es idempotente. El access token ya emitido sigue stateless hasta vencer.
  - `POST /auth/register` — crea una cuenta no verificada y envia un enlace de verificacion con vigencia `AUTH_EMAIL_VERIFICATION_TTL` (24 h por defecto).
  - `POST /auth/verify-email` — confirma el email; tokens invalidos o vencidos responden 400 generico y el limite es 5 intentos/min por IP.
  - `POST /auth/forgot-password` — siempre responde el mismo 200 exista o no el email; limite independiente de 3 solicitudes/min por IP.
  - `POST /auth/reset-password` — consume un token de un solo uso con vigencia `AUTH_PASSWORD_RESET_TTL` (1 h por defecto), actualiza el hash Argon2id y revoca todas las sesiones del usuario; tiene otro limite independiente de 3 intentos/min por IP.
  - `POST /auth/change-password` — requiere Bearer token, contrasena actual y nueva de 12-128 caracteres, mas el `refreshToken` de la sesion actual; actualiza el hash Argon2id y revoca todas las demas sesiones conservando la actual; limite de 5 intentos/min por usuario.
- Los access tokens ya emitidos son stateless y pueden conservar validez hasta `AUTH_TOKEN_TTL`: tras un reset se revocan todos los refresh tokens del usuario y tras un cambio de contrasena se revocan todos menos el de la sesion actual.
- La entrega usa SMTP con TLS 1.2 minimo y no registra destinatarios, enlaces ni tokens. Desarrollo usa Mailpit; produccion requiere `MAIL_HOST` y `MAIL_FROM`, con `MAIL_USER`/`MAIL_PASSWORD` opcionales pero inseparables.
- Rutas privadas: `Authorization: Bearer <accessToken>`. `authenticate` recarga el usuario desde la BD y responde 403 si la cuenta fue desactivada, incluso con un JWT aun vigente.
- Variables de entorno (sin prefijo del proveedor):
  - `AUTH_SECRET` (requerido, generar con `openssl rand -base64 32`)
  - `AUTH_URL` (default `http://localhost:3000`)
  - `AUTH_TOKEN_TTL` (default `15m`)
  - `AUTH_REFRESH_TTL` (default `7d`)
  - `AUTH_EMAIL_VERIFICATION_URL`, `AUTH_PASSWORD_RESET_URL`
  - `AUTH_EMAIL_VERIFICATION_TTL` (default `24h`), `AUTH_PASSWORD_RESET_TTL` (default `1h`)
  - `MAIL_HOST`, `MAIL_PORT`, `MAIL_SECURE`, `MAIL_FROM`; `MAIL_USER`/`MAIL_PASSWORD` opcionales
  - Opcionales: `AUTH_ISSUER`, `AUTH_AUDIENCE`, `AUTH_ARGON2_*`

### Usuarios

- `POST /auth/register` acepta `unitId` (unidad organizativa) y `careerId` (carrera) opcionales.
- `GET /api/v1/users/me` devuelve `unit` y `career` (objetos `{ id, name, code }`).
- `PATCH /api/v1/users/me` acepta `firstName`, `lastName`, `unitId` y `careerId`. `unitId` admite `null` para la opción "Otro" (sin unidad): en ese caso la carrera queda forzada a la carrera global `Otros`; una carrera distinta produce 400 y la ausencia de `Otros` en la base produce 409.
- `GET /api/v1/admin/users` (solo `ADMIN`, responde `403` a `USER`) lista usuarios con paginación offset (`page`/`limit`, máximo 50), búsqueda `q` insensible a mayúsculas en nombre, apellido, email o identificación y filtros `globalRole`, `isActive`, `unitId` y `careerId`. No expone `name`, `accounts`, `password`, `passwordHash` ni `emailVerified`.
- `GET /api/v1/admin/users/{id}` (solo `ADMIN`) devuelve el DTO administrativo seguro de un usuario y responde `404` para un identificador inexistente; tampoco expone `name`, `accounts`, `password`, `passwordHash` ni `emailVerified`.
- `POST /api/v1/admin/users` (solo `ADMIN`) crea la cuenta y su credencial Argon2id en una transacción, acepta `globalRole` e `isActive` (defaults `USER` y `true`) y valida conflictos de email e identificación (`409`). El correo queda sin verificar (`emailVerified=false`) y se envia el enlace de verificación; la cuenta no puede iniciar sesion hasta verificarlo.
- `PATCH /api/v1/admin/users/{id}` (solo `ADMIN`) actualiza `globalRole`, `isActive`, `unitId` y `careerId`; al desactivar revoca todas las sesiones del usuario; no permite autodesactivación ni autodegradación y protege al último administrador activo (409). Devuelve el mismo DTO seguro y responde 400/404.
- La carrera `Otros` (`unitId` nulo) es global y se puede elegir con cualquier unidad; al cambiar a una unidad real se conserva. Ya no existe desactivación de carreras (`isActive` fue eliminado). Ver `docs/adr/adr-0006-career-catalog-without-active-flag.md`.
- El claim `unitId` viaja en el access token JWT; la coherencia carrera-unidad se valida en el servicio (solo para carreras con unidad propia).
- Las unidades organizativas se modelan en `organizational_units` con `type` (`FACULTY` o `SUBDIRECTORATE`) y un `head` (encargado) opcional. Ver `docs/adr/adr-0003-unified-organizational-units.md`.

### Unidades Organizativas

- `GET /api/v1/organizational-units` es público y devuelve solo unidades activas por defecto; `isActive=false` lista las inactivas. Acepta paginación offset (`page`/`limit`, máximo 50), filtro `type` (`FACULTY`/`SUBDIRECTORATE`) y búsqueda `q` en nombre o código.
- `GET /api/v1/organizational-units/{id}` es público e incluye `careers` y `defaultProgram` (`{ id, name, status }`), además del encargado (`head`) expuesto solo como `{ id, firstName, lastName }`.
- `POST /api/v1/organizational-units` (solo `ADMIN`) crea la unidad y su programa de eventos predeterminado `ACTIVE` en una sola transacción; el `code` se normaliza a mayúsculas, admite letras, números y guiones, y un duplicado responde `409`. `headId` debe ser un usuario activo (`404` si no existe, `400` si está inactivo).
- `PATCH /api/v1/organizational-units/{id}` (solo `ADMIN`) permite `name`, `description` y `headId`; `code` y `type` son inmutables y cualquier campo desconocido responde `400`.
- `POST /api/v1/organizational-units/{id}/deactivate` (solo `ADMIN`) rechaza con `409` si el programa predeterminado tiene actividades `SCHEDULED`/`ONGOING`; en caso de éxito desactiva la unidad y archiva el programa en una transacción. Un segundo intento responde `409`.
- `POST /api/v1/organizational-units/{id}/reactivate` (solo `ADMIN`) reactiva la unidad y restaura su programa predeterminado existente en la misma transacción (trigger `organizational_units_reactivate_default_program`).

### Carreras

- `GET /api/v1/careers` es público y devuelve el catálogo completo sin `isActive` (toda carrera es seleccionable). Paginación offset (`page`/`limit`, máximo 50) y búsqueda `q` en nombre o código.
- `unitId=<id>` devuelve las carreras de esa facultad más las globales (`OTROS`); `unitId=global` devuelve solo las globales. La respuesta expone `unit` (`{ id, name, code } | null`).
- `POST /api/v1/careers` y `PATCH /api/v1/careers/{id}` (solo `ADMIN`) permiten `name`, `code`, `description` y `unitId` (opcional; `null` = carrera global). El `code` se normaliza a mayúsculas, es único (duplicado `409`) y la unidad, si se envía, debe ser una facultad activa (`404` si no existe, `400` si no es `FACULTY` o está inactiva).
- La carrera global `Otros` (`OTROS`) es una invariante del sistema: no se puede eliminar, no cambia su código y debe permanecer global; `name` y `description` sí son editables. Una carrera con usuarios asociados no puede cambiar de unidad (`409`).
- `DELETE /api/v1/careers/{id}` (solo `ADMIN`) elimina físicamente una carrera y responde `204`; con usuarios asociados responde `409`. Ver `docs/adr/adr-0006-career-catalog-without-active-flag.md`.

### Programas De Eventos

- `GET /api/v1/event-programs` es publico y devuelve programas con estado `ACTIVE`, ordenados por nombre.
- Paginacion offset: `?page` (default 1) y `?limit` (default 20, maximo 50). Respuesta `data = { items, page, limit, total, totalPages }`.
- Filtros opcionales: `organizationalUnitId`, `unitType` (`FACULTY` o `SUBDIRECTORATE`) y `q`, que busca sin distinguir mayusculas en el nombre y la etiqueta.
- `PATCH /api/v1/event-programs/:id` (privado) actualiza parcialmente `name`, `description`, `label`, `bannerUrl`, `startDate` y `endDate`. Requiere el permiso `program:update` en el scope del programa (o rol `ADMIN`); los programas `ARCHIVED` responden `409`.

### Actividades

- `GET /api/v1/activities` es publico y devuelve las proximas actividades: actividades `SCHEDULED`/`ONGOING` de programas `ACTIVE` con `date >= hoy` (zona institucional `America/Panama`).
- Paginacion offset: `?page` (default 1) y `?limit` (default 20, maximo 50). Respuesta `data = { items, page, limit, total, totalPages }`.
- `POST /api/v1/activities` (privado) crea una actividad dentro de un programa `ACTIVE`. Requiere el permiso `activity:create` en el programa (o rol `ADMIN`), queda en estado `DRAFT` y devuelve un DTO sin codigos.
- Cuerpo de creacion: `name`, `type`, `date` (`YYYY-MM-DD`), `startTime`/`endTime` (`HH:mm`) y `eventProgramId` (obligatorio); opcionales `description`, `maxCapacity`, `bannerUrl`, `classroomId`, `speakers[]` y `equipment[]`.
- Los ponentes viajan inline en `speakers[]` (`firstName`, `lastName`, `email?`, `organization?`, maximo 10). No requieren cuenta: el servicio reutiliza el ponente del catalogo cuando el email coincide y lo vincula a un usuario si existe una cuenta con ese email.
- Cambio incompatible: las respuestas exponen `speakers` (array) en lugar de `speaker` (objeto o `null`) en `ActivityListItem` y `ActivityDetail`.
- Cada item incluye `eventProgram` (programa de eventos) y `organizationalUnit`; la lista no expone codigos de check-in.
- Los codigos de check-in (`code`) viven en `attendance` (uno por inscripcion, unico global) y no en la actividad. Ver `docs/adr/adr-0004-attendance-checkin-codes.md`.
- Terminologia: "evento" se usa coloquialmente, pero el nombre oficial del recurso es **actividad** (`/activities`). La ruta `/events` fue retirada.

### Colaboradores Por Scope

- `GET /api/v1/event-programs/{id}/collaborators` y `GET /api/v1/activities/{id}/collaborators` (privados) listan las colaboraciones locales del scope: `userId`, identidad (`firstName`, `lastName`, `email`), `role`, `createdAt` y permisos locales (`name`, `source`, `validFrom`, `validUntil`). Requieren `permission:grant` en el scope o rol `ADMIN`; no expanden la herencia del programa padre y no devuelven `grantedById`/`grantedAt`.
- `POST` de los mismos paths agrega un colaborador con `{ userId, role }` (`VIEWER`, `EDITOR` u `ORGANIZER`) y materializa los permisos `ROLE_DEFAULT` del rol. Un actor no-admin no puede asignar un rol cuyos defaults no posea (`403`); usuario inexistente `404`, inactivo `400`, duplicado en el scope `409` y programa `ARCHIVED` `409`. Body estricto: rol inválido o claves desconocidas responden `400`.
- Respuesta: `data = { items: [...] }` en el listado y `data = Collaborator` en la creación. Ver `docs/adr/adr-0001-time-aware-collaboration-authorization.md`.

### Aulas

- `GET /api/v1/classrooms` es público y devuelve solo aulas activas por defecto; `isActive=false` lista las inactivas. Paginación offset (`page`/`limit`, máximo 50) y filtros `type` (`LABORATORY`/`CLASSROOM`), `minCapacity` y `amenity` (insensible a mayúsculas).
- `GET /api/v1/classrooms/{id}` es público e incluye `amenities` y las ventanas semanales `availability` (`dayOfWeek` ISO 1-7, `startTime`/`endTime` en `HH:mm`, `period` opcional).
- `GET /api/v1/classrooms/available` es público y exige `date` (`YYYY-MM-DD`), `startTime` y `endTime`; acepta `minCapacity`, `type` y `amenity`. Devuelve las aulas activas cuya ventana cubre el intervalo en el día institucional solicitado y que no están reservadas por actividades `SCHEDULED`/`ONGOING`; actividades `DRAFT`, `COMPLETED` y `CANCELLED` no bloquean.
- `POST /api/v1/classrooms` y `PATCH /api/v1/classrooms/{id}` (solo `ADMIN`) gestionan `name`, `type`, `capacity` (> 0), `building` y `floor`; el PATCH admite `isActive` y rechaza con `409` desactivar un aula con actividades `SCHEDULED`/`ONGOING`. Un body vacío o con claves desconocidas responde `400`.
- `POST /api/v1/classrooms/{id}/amenities` y `DELETE /api/v1/classrooms/{id}/amenities/{amenity}` (solo `ADMIN`) agregan y quitan amenidades; el alta normaliza espacios, conserva el formato original, rechaza duplicados sin distinguir mayúsculas con `409` y el borrado también es insensible a mayúsculas.
- `POST /api/v1/classrooms/{id}/availability` y `DELETE /api/v1/classrooms/{id}/availability/{availabilityId}` (solo `ADMIN`) gestionan ventanas semanales; se exige `startTime < endTime` y un solape con otra ventana del mismo día responde `409` (las ventanas adyacentes, como 07:00-12:00 y 12:00-17:00, conviven).
- Las mutaciones devuelven el detalle completo del aula. La consistencia de reservas se apoya también en la restricción de exclusión `activities_classroom_no_overlap` de PostgreSQL.

## Datos De Prueba (Seed)

`pnpm run prisma:seed` carga un conjunto completo e idempotente de datos de prueba
(re-ejecutable sin duplicar ni borrar nada):

- 6 facultades y 4 subdirecciones, cada una con su programa predeterminado y encargado.
- 25 carreras: 24 oficiales distribuidas por facultad más la carrera global `Otros` (sin unidad).
- 29 usuarios demo + 10 aulas con amenidades y disponibilidad.
- 5 programas adicionales (activo, completado, archivado y borrador), 24 actividades,
  colaboraciones con permisos materializados y ventanas de vigencia, asistencias,
  certificados, propuestas con versiones/feedback y alertas.

Credenciales demo (password unica `Sipeg2026*UTP`, configurable con `SEED_DEMO_PASSWORD`):

| Rol                           | Email                                                                                                                               |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Administrador                 | `admin@utp.ac.pa`                                                                                                                   |
| Organizadores de facultad     | `organizador.fic@utp.ac.pa` ... `organizador.fct@utp.ac.pa`                                                                         |
| Organizadores de subdireccion | `organizador.sub-acad@utp.ac.pa` ... `organizador.sub-ipe@utp.ac.pa`                                                                |
| Editor / visor                | `editor.eventos@utp.ac.pa`, `visor.eventos@utp.ac.pa`                                                                               |
| Ponentes                      | `ponente.ana.perez@utp.ac.pa`, `ponente.carlos.rivera@utp.ac.pa`, `ponente.diana.gomez@utp.ac.pa`, `ponente.ivan.morales@utp.ac.pa` |
| Estudiantes                   | `estudiante01@utp.ac.pa` ... `estudiante12@utp.ac.pa`                                                                               |

Notas:

- Los correos y numeros de identificacion son sinteticos (`SEED-*`); no corresponden a personas reales.
- El seed aborta si `NODE_ENV=production` salvo que definas `SEED_ALLOW_PRODUCTION=true`.
- Re-ejecutarlo es seguro: usa upserts con IDs determinados `seed_*` y respeta los triggers de la base de datos.

## Datos Base De Produccion (Seed Base)

`pnpm run prisma:seed:base` carga unicamente la data institucional estable y es
seguro en produccion (no requiere `SEED_ALLOW_PRODUCTION`):

- Catalogo de permisos de autorizacion (19 claves `recurso:accion`).
- 10 unidades organizativas (6 facultades + 4 subdirecciones) con sus 10 programas
  de eventos predeterminados.
- 25 carreras: 24 oficiales más la carrera global `Otros` (sin unidad).
- 10 aulas con amenidades y ventanas de disponibilidad.
- ADMIN inicial opcional via `SEED_ADMIN_*` (ver `.env.example`).

Reglas del modo base:

- **Crea solo lo que falta.** Si una unidad, carrera, aula o programa
  predeterminado ya existe, no se toca (se preservan renombres, `isActive` y
  `headId` definidos por administradores).
- **Permisos:** siempre se hace `upsert`; el catalogo crece con cada fase y no es
  editable por administradores. No se eliminan permisos.
- **ADMIN inicial:** solo se crea si el email `SEED_ADMIN_EMAIL` no existe. Nunca
  modifica un usuario ni un password existente. Si la base no tiene ningun ADMIN
  y no hay bootstrap configurado, el seed falla con un mensaje claro.
- **No siembra data sintetica:** usuarios demo, ponentes, programas adicionales,
  actividades, colaboraciones, asistencias, certificados, propuestas y alertas
  quedan excluidos.
- **Recomendacion de seguridad:** cambia el password del ADMIN inicial y las
  credenciales `SEED_ADMIN_*` despues del primer inicio de sesion.
- En Docker, el servicio `seed` (`compose.prod.yaml`) ejecuta este seed
  automaticamente despues de `migrate` y antes de la API.

## Estructura Base

```txt
src/
|-- app.ts
|-- server.ts
|-- routes.ts
|-- config/
|   |-- env.ts
|   `-- prisma.ts
|-- docs/
|   |-- openapi.ts
|   |-- schemas.ts
|   `-- generate.ts
|-- lib/
|   |-- auth.ts
|   `-- password.ts
|-- middlewares/
|   |-- authenticate.middleware.ts
|   |-- authorize.middleware.ts
|   |-- error.middleware.ts
|   |-- notFound.middleware.ts
|   |-- rateLimit.middleware.ts
|   `-- validate.middleware.ts
|-- modules/
|   |-- activities/
|   |-- auth/
|   |-- authorization/
|   |-- event-programs/
|   |-- health/
|   `-- users/
|-- types/
`-- utils/

prisma/
|-- schema.prisma
|-- migrations/
|-- seed.ts
`-- seed/
```

La estructura objetivo completa (incluyendo modulos futuros) esta documentada en `AGENTS.md`.

## Tests

Los tests se mantienen al lado del archivo que validan usando el patron `*.test.ts`.

Ejemplos:

- `src/modules/health/health.routes.ts`
- `src/modules/health/health.routes.test.ts`
- `src/modules/activities/activities.routes.ts`
- `src/modules/activities/activities.routes.test.ts`

## Configuracion

El unico archivo de ejemplo que se mantiene es `.env.example`.

## Prisma

Prisma queda configurado para PostgreSQL, pero el backend no inicializa Prisma al arrancar. El cliente se crea solo cuando algun modulo llama `getPrismaClient()`.

`DATABASE_URL` puede quedarse vacio mientras no haya modulos con persistencia. `prisma.config.ts` usa un placeholder local para permitir `prisma validate` y `prisma generate` sin conectarse a una base de datos real. Los comandos de migracion y las operaciones reales con Prisma si requeriran una URL de base de datos valida.

Prisma genera el cliente en `src/generated/prisma`. Ese directorio esta ignorado por Git y debe regenerarse cuando cambie el schema.

```bash
pnpm run prisma:generate
```
