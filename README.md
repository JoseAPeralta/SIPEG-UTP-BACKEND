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
| Desarrollo | `compose.dev.yaml`  | Hot reload, migraciones automaticas, PostgreSQL publicado en loopback.      |
| Produccion | `compose.prod.yaml` | Imagen runtime minima, sin puertos de base de datos, secretos obligatorios. |

### Desarrollo

```bash
docker compose -f compose.dev.yaml up --build
```

- La API queda disponible en `http://localhost:3000/api/v1/health`.
- El codigo en `src/` y `prisma/` se monta como volumen: los cambios se recargan con `tsx watch`.
- Un servicio one-shot `migrate` aplica `prisma migrate deploy` antes de arrancar la API.
- PostgreSQL se expone solo en `127.0.0.1:${POSTGRES_PORT:-5432}` para uso local.

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
2. Levanta el stack:

```bash
docker compose -f compose.prod.yaml --env-file .env.prod up -d --build
```

- El servicio `migrate` aplica las migraciones pendientes y termina; la API solo arranca si finaliza correctamente.
- La base de datos no publica puertos al host; solo es accesible por la red interna de Compose.
- `DATABASE_URL` se construye automaticamente con host `db` a partir de `POSTGRES_DB`, `POSTGRES_USER` y `POSTGRES_PASSWORD`; no la definas en `.env.prod`.
- Las variables obligatorias de Compose son: `CORS_ORIGIN`, `POSTGRES_DB`, `POSTGRES_USER` y `POSTGRES_PASSWORD`.
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
- `pnpm run prisma:seed`: siembra el catalogo de permisos y los datos de prueba completos (idempotente).

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

La coleccion completa en `bruno/` se genera desde `openapi.json`, se agrupa por tags y se versiona como archivos `.bru`. El environment `local` apunta a `http://localhost:3000`; el request de login usa el usuario administrador del seed y guarda `data.accessToken`/`data.refreshToken` en variables de runtime para los endpoints privados.

En el cliente visual de Bruno, despues de abrir la coleccion `bruno/` debes seleccionar el environment `local` en el selector superior derecho; por defecto queda en `No Environment`. Sin esa seleccion `{{baseUrl}}` no se resuelve y los requests fallan con `getaddrinfo ENOTFOUND {{baseurl}}`. Los scripts `pnpm run api:run*` no necesitan ese paso porque pasan `--env local`.

```bash
pnpm run api:run:smoke # seguro: solo GET /api/v1/health
pnpm run api:run       # coleccion completa; contiene operaciones que modifican datos
```

`pnpm run api:collection:import` sobrescribe la coleccion: despues de reimportar hay que restaurar el script post-response de `Auth/Log in with email and password.bru`. No guardes tokens ni credenciales reales en archivos versionados; usa un archivo `*.private.bru`, ignorado por Git, o variables proporcionadas en runtime. El login tiene limite de 5 intentos por minuto.

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
- Refresh tokens: sesiones server-side (7 dias) con revocacion inmediata.
- Endpoints principales (`/api/v1/auth/*`):
  - `POST /auth/login` — devuelve access token + refresh token.
  - `POST /auth/refresh` — emite nuevo access token.
  - `POST /auth/logout` — invalida el refresh token.
  - `POST /auth/register` — crea cuenta; envia email de verificacion.
  - `POST /auth/verify-email` — confirma email.
  - `POST /auth/forgot-password` / `reset-password` — recuperacion.
- Rutas privadas: `Authorization: Bearer <accessToken>`.
- Variables de entorno (sin prefijo del proveedor):
  - `AUTH_SECRET` (requerido, generar con `openssl rand -base64 32`)
  - `AUTH_URL` (default `http://localhost:3000`)
  - `AUTH_TOKEN_TTL` (default `15m`)
  - `AUTH_REFRESH_TTL` (default `7d`)
  - Opcionales: `AUTH_ISSUER`, `AUTH_AUDIENCE`, `AUTH_ARGON2_*`

### Usuarios

- `POST /auth/register` acepta `unitId` (unidad organizativa) y `careerId` (carrera) opcionales.
- `GET /api/v1/users/me` devuelve `unit` y `career` (objetos `{ id, name, code }`).
- `PATCH /api/v1/users/me` acepta `firstName`, `lastName`, `unitId` y `careerId`.
- El claim `unitId` viaja en el access token JWT; la coherencia carrera-unidad se valida en el servicio.
- Las unidades organizativas se modelan en `organizational_units` con `type` (`FACULTY` o `SUBDIRECTORATE`) y un `head` (encargado) opcional. Ver `docs/adr/adr-0003-unified-organizational-units.md`.

### Actividades

- `GET /api/v1/activities` es publico y devuelve las proximas actividades: actividades `SCHEDULED`/`ONGOING` de programas `ACTIVE` con `date >= hoy` (zona institucional `America/Panama`).
- Paginacion offset: `?page` (default 1) y `?limit` (default 20, maximo 50). Respuesta `data = { items, page, limit, total, totalPages }`.
- `POST /api/v1/activities` (privado) crea una actividad dentro de un programa `ACTIVE`. Requiere el permiso `activity:create` en el programa (o rol `ADMIN`), queda en estado `DRAFT` y devuelve un DTO sin codigos.
- Cuerpo de creacion: `name`, `type`, `date` (`YYYY-MM-DD`), `startTime`/`endTime` (`HH:mm`) y `eventProgramId` (obligatorio); opcionales `description`, `maxCapacity`, `bannerUrl`, `classroomId`, `speakerId` y `equipment[]`.
- Cada item incluye `eventProgram` (programa de eventos) y `organizationalUnit`; la lista no expone codigos de check-in.
- Los codigos de check-in (`code`) viven en `attendance` (uno por inscripcion, unico global) y no en la actividad. Ver `docs/adr/adr-0004-attendance-checkin-codes.md`.
- Terminologia: "evento" se usa coloquialmente, pero el nombre oficial del recurso es **actividad** (`/activities`). La ruta `/events` fue retirada.

## Datos De Prueba (Seed)

`pnpm run prisma:seed` carga un conjunto completo e idempotente de datos de prueba
(re-ejecutable sin duplicar ni borrar nada):

- 6 facultades y 4 subdirecciones, cada una con su programa predeterminado y encargado.
- 24 carreras oficiales distribuidas por facultad.
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

## Estructura Base

```txt
src/
|-- app.ts
|-- server.ts
|-- config/
|   |-- env.ts
|   `-- prisma.ts
|-- controllers/
|   |-- activities.controller.ts
|   `-- health.controller.ts
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
|   `-- users/
|-- routes/
|   |-- activities.routes.ts
|   |-- health.routes.ts
|   `-- index.ts
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

- `src/routes/health.routes.ts`
- `src/routes/health.routes.test.ts`
- `src/routes/activities.routes.ts`
- `src/routes/activities.routes.test.ts`

## Configuracion

El unico archivo de ejemplo que se mantiene es `.env.example`.

## Prisma

Prisma queda configurado para PostgreSQL, pero el backend no inicializa Prisma al arrancar. El cliente se crea solo cuando algun modulo llama `getPrismaClient()`.

`DATABASE_URL` puede quedarse vacio mientras no haya modulos con persistencia. `prisma.config.ts` usa un placeholder local para permitir `prisma validate` y `prisma generate` sin conectarse a una base de datos real. Los comandos de migracion y las operaciones reales con Prisma si requeriran una URL de base de datos valida.

Prisma genera el cliente en `src/generated/prisma`. Ese directorio esta ignorado por Git y debe regenerarse cuando cambie el schema.

```bash
pnpm run prisma:generate
```
