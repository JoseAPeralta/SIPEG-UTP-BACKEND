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

El despliegue usa un archivo base por entorno y dos overlays. Produccion combina
`compose.prod.yaml`, `compose.observability.yaml` y `compose.cloudflare.yaml`.

| Entorno                 | Archivo                      | Uso                                                                                     |
| ----------------------- | ---------------------------- | --------------------------------------------------------------------------------------- |
| Desarrollo              | `compose.dev.yaml`           | Hot reload, migraciones, PostgreSQL y Mailpit publicados en loopback.                   |
| Produccion (base)       | `compose.prod.yaml`          | Imagen runtime minima, sin puertos de base de datos, secretos obligatorios.             |
| Observabilidad          | `compose.observability.yaml` | Overlay con Loki, Alloy, Grafana y el proxy de socket; se combina con dev o produccion. |
| Cloudflare (produccion) | `compose.cloudflare.yaml`    | Overlay con `cloudflared` y el dominio publico de Grafana.                              |

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

1. Crea un archivo `.env.prod` (no se versiona) con secretos reales. Usa `.env.prod.example` como guia y deja el archivo con permisos `600`.
2. En el primer despliegue sobre una base vacia define el ADMIN inicial en `.env.prod` (`SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_ADMIN_IDENTIFICATION_NUMBER`); el seed base falla si no existe ningun ADMIN y no hay bootstrap configurado.
3. Valida la configuracion sin imprimir secretos:

```bash
docker compose \
  -f compose.prod.yaml \
  -f compose.observability.yaml \
  -f compose.cloudflare.yaml \
  --env-file .env.prod \
  config --quiet
```

4. Levanta el stack:

```bash
docker compose \
  -f compose.prod.yaml \
  -f compose.observability.yaml \
  -f compose.cloudflare.yaml \
  --env-file .env.prod \
  up -d --build
```

Dominios publicados:

| Hostname                | Destino               | Proteccion                    |
| ----------------------- | --------------------- | ----------------------------- |
| `sipeg-utp.com`         | Worker Static Assets  | Publico                       |
| `api.sipeg-utp.com`     | `http://api:3000`     | Publico; CORS y rate limiting |
| `grafana.sipeg-utp.com` | `http://grafana:3000` | Cloudflare Access + login     |

- El servicio `migrate` aplica las migraciones pendientes y termina; luego el servicio one-shot `seed` carga el catalogo base institucional y el ADMIN inicial; la API solo arranca si ambos finalizan correctamente.
- El seed base es idempotente y no sobrescribe datos existentes: puedes re-ejecutarlo con `docker compose -f compose.prod.yaml -f compose.observability.yaml -f compose.cloudflare.yaml --env-file .env.prod run --rm seed`.
- La base de datos no publica puertos al host; solo es accesible por la red interna de Compose.
- `cloudflared` publica la API y Grafana por Cloudflare Tunnel. No se abren puertos HTTP/HTTPS entrantes en el VPS; la API y Grafana solo se atan a `127.0.0.1` para diagnostico desde el host.
- `api.sipeg-utp.com` no usa Access porque sus clientes usan Bearer tokens. `grafana.sipeg-utp.com` exige Access (team `sipeg`) y despues el login de Grafana.
- `AUTH_JWKS_URL` usa el loopback del contenedor (`http://127.0.0.1:3000/api/auth/jwks`) para evitar challenges de Bot Fight Mode. `AUTH_URL`, `AUTH_ISSUER` y `AUTH_AUDIENCE` siguen siendo `https://api.sipeg-utp.com`.
- `AUTH_REFRESH_COOKIE_SAME_SITE=lax` porque API y frontend comparten el dominio registrable. La cookie `sipeg-refresh` es `HttpOnly`, `Secure`, host-only y `Path=/api/v1/auth`.
- `DATABASE_URL` se construye automaticamente con host `db` a partir de `POSTGRES_DB`, `POSTGRES_USER` y `POSTGRES_PASSWORD`; no la definas en `.env.prod`.
- Las variables obligatorias de Compose son: `CORS_ORIGIN`, `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, `AUTH_SECRET`, `AUTH_URL`, `AUTH_REFRESH_COOKIE_SAME_SITE`, `AUTH_EMAIL_VERIFICATION_URL`, `AUTH_PASSWORD_RESET_URL`, `MAIL_HOST`, `MAIL_FROM`, `LOG_PSEUDONYMIZATION_KEY`, `GRAFANA_ADMIN_PASSWORD`, `GRAFANA_SECRET_KEY`, `CLOUDFLARE_TUNNEL_TOKEN` e `IMAGE_TAG`.
- Si `POSTGRES_PASSWORD` contiene caracteres especiales (`@ : / ? # %`), codificalos en porcentaje o usa solo caracteres alfanumericos.
- `IMAGE_TAG` es obligatoria: etiqueta la imagen de la API y no tiene default, para que un despliegue posterior no sobrescriba sin querer la imagen verificada. Usa una version explicita, por ejemplo `2026-10-20-r1`. La imagen se construye localmente y no admite digest, porque un digest solo existe en un registro; el tag es el unico control de reproducibilidad. Ver `docs/adr/adr-0007-structured-logging-and-observability.md` (IMP-003).
- El correo de produccion usa Brevo: `smtp-relay.brevo.com:587`, STARTTLS (`MAIL_SECURE=false`) y remitente `SIPEG UTP <no-reply@sipeg-utp.com>`.
- Despues de confirmar el ADMIN, vaciar `SEED_ADMIN_PASSWORD`, `SEED_ADMIN_EMAIL` y `SEED_ADMIN_IDENTIFICATION_NUMBER` en `.env.prod`; el seed conserva el ADMIN existente.
- La API se detiene con `stop_grace_period: 15s`, mayor que el timeout interno de apagado ordenado.
- Rendimiento por defecto para un servidor de 4 vCPU: `DATABASE_POOL_MAX=9` (`2 x vCPU + 1`, por instancia; la suma de `pool x instancias` no debe superar `max_connections` de Postgres), `UV_THREADPOOL_SIZE=4` y Argon2id `m=12288 KiB, t=3, p=1` (configuracion minima OWASP de 12 MiB con pico de 48 MiB a 4 hilos). Todos son configurables por entorno.
- La topologia completa, las decisiones y los pendientes operativos estan en `docs/despliegue.md` y `docs/adr/adr-0012-cloudflare-workers-tunnel-deployment.md`.

Detener el entorno:

```bash
docker compose \
  -f compose.prod.yaml \
  -f compose.observability.yaml \
  -f compose.cloudflare.yaml \
  --env-file .env.prod \
  down
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
- `pnpm run prisma:cleanup:dev`: purga los residuos de actividades que dejan las corridas de Bruno y las verificaciones. Ver `docs/er-diagram/ER-design-justification.md` seccion 4.4 para por que hace falta deshabilitar triggers.
- `pnpm run prisma:purge:audit`: purga los eventos de `audit_events` que superan la retencion de 365 dias. Procedimiento manual y auditado; ver "Purgar auditoria por antiguedad" mas abajo.

### Purgar residuos de desarrollo

La regla de retencion prohibe borrar fisicamente una actividad que no sea `DRAFT` de un programa `ACTIVE`, y el trigger `activities_prevent_delete` lo aplica tambien al `DELETE` directo por SQL. Por eso los residuos de una corrida de Bruno (por ejemplo la actividad que los tests de cancelacion dejan en `CANCELLED`) no se pueden limpiar con un `DELETE` normal.

El script simula por defecto y solo borra con `--apply`:

```bash
pnpm run prisma:cleanup:dev -- --pattern='Actividad temporal%'
pnpm run prisma:cleanup:dev -- --pattern='Actividad temporal%' --apply
```

Reglas de seguridad que aplica:

- **Simulacion por defecto.** Sin `--apply` solo imprime el plan, las razones por las que conserva cada actividad y los conteos.
- **Nunca en produccion.** Se niega a correr con `NODE_ENV=production` salvo `SEED_ALLOW_PRODUCTION=true`, igual que el seed demo.
- **Nunca por accidente.** Rechaza un patron que no coincide con nada (`no-match`), que dejaria todo lo que coincide retenido (`all-retained`) o que alcanzaria todas las actividades de la base (`pattern-too-broad`).
- **Nunca con historia.** Conserva cualquier actividad con asistencia o alertas, que es lo que la retencion protege.
- **Triggers siempre rehabilitados.** El borrado deshabilita `activities_prevent_delete` y `event_programs_prevent_delete` dentro de una transaccion y los vuelve a habilitar en el `finally`, incluso si el borrado falla.

El patron acepta sintaxis `LIKE` de PostgreSQL, con `%` y `_`.

### Purgar auditoria por antiguedad

`audit_events` es append-only: los triggers `audit_events_prevent_mutation` y `audit_events_prevent_truncate` rechazan cualquier `UPDATE`, `DELETE` o `TRUNCATE`, incluso por SQL directo. La retencion ratificada es de **365 dias** (ADR-0008) y se aplica con un procedimiento manual, nunca automatico:

```bash
# Simulacion: imprime conteos y rango, no escribe nada
pnpm run prisma:purge:audit

# Purga real: exige respaldo y atribucion
pnpm run prisma:purge:audit -- --apply \
  --operator=sistemas \
  --archive=/var/backups/sipeg/audit-2026-09-30.ndjson.gz
```

Reglas de seguridad que aplica:

- **Simulacion por defecto.** Sin `--apply` no escribe nada.
- **El respaldo no es opcional.** `--apply` exige `--archive`, y la ruta se rechaza si cae dentro del proyecto: un respaldo de auditoria en el repo acabaria en un commit. El archivo es un NDJSON comprimido con las filas exactas que se eliminan.
- **La purga es atribuible.** `--apply` exige `--operator`, y **no puede ser un correo**: el validador de la bitacora prohibe la arroba. Usa un identificador institucional.
- **Por lotes transaccionales.** Cada lote abre su transaccion, deshabilita ambos triggers, borra y los rehabilita en el `finally`. Los triggers nunca quedan abiertos entre transacciones, asi que una interrupcion a la mitad deja la tabla igual de inmutable.
- **La purga deja huella.** Escribe un evento `audit.purged` con el operador, el conteo y el corte, **despues** de rehabilitar los triggers. Sin eso, una intervencion sobre el historico no seria detectable desde el historico.
- **Corte en UTC.** El corte se calcula sobre `occurred_at`, que es `Timestamptz`. No pasa por `src/utils/date.ts`, que es para fechas de calendario de negocio.
- **Flags disponibles:** `--retention-days` (por defecto 365), `--batch-size` (por defecto 10000).

Ejecutalo con la misma `DATABASE_URL` que la aplicacion. **No hay endpoint HTTP** para purgar: la bitacora es de solo lectura, y exponer una operacion que destruye evidencia lo contradiria.

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

`pnpm run api:collection:import` sobrescribe la coleccion: despues de reimportar hay que restaurar el script post-response y las assertions de `Auth/Log in with email and password - admin.bru`, `Auth/Log in with email and password - user.bru` y `Auth/Log in with email and password - head.bru` (los tres capturan `token`/`refreshToken`), y ademas reordenar los requests de las carpetas `Admin`, `Careers`, `Classrooms` y `Organizational_Units` (el login de head debe quedar antes de los requests que esperan 403 y capturar la misma variable compartida). La carpeta `Certificates` es autocontenida: su propio `Certificates/Log in as a student with certificates.bru` captura `token`/`refreshToken` con un `X-Forwarded-For` propio, asi que no depende del orden ni agota el limite de logins de otra carpeta. El folder `Sessions` (separado de `Auth` para no agotar el limite de 5 logins/min por email+IP) contiene su propio `Sessions/Log in as admin.bru` y los flujos de refresh/logout. Los scripts/assertions de `Sessions/Refresh the access token.bru` y `Sessions/Log out and revoke the refresh token.bru`, y los scripts/assertions de `Auth/Register a new user.bru`, `Auth/Register duplicate email returns 409.bru`, `Auth/Register duplicate identification returns 409.bru`, `Auth/Register rate limit returns 429.bru`, `Auth/Login wrong password returns 401.bru`, `Auth/Login unknown email returns 401.bru`, `Auth/Login rate limit returns 429.bru`, `Sessions/Refresh reused token returns 401.bru` y `Sessions/Logout revoked token returns 401.bru` tambien se restauran. No guardes tokens ni credenciales reales en archivos versionados; usa un archivo `*.private.bru`, ignorado por Git, o variables proporcionadas en runtime. El login tiene limite de 5 intentos por minuto.

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

El unico endpoint del proveedor de autenticacion (Better Auth) expuesto es `GET /api/auth/jwks`, que consumen la verificacion de tokens y el health check. Todo lo demas bajo `/api/auth/*` responde `404`, de modo que el contrato publico es `/api/v1/*` y toda operacion sensible pasa por sus rate limiters.

### Auth

- Password hashing con **Argon2id** (parametros OWASP: `t=2, m=19 MiB, p=1`).
- Access tokens: JWT EdDSA Ed25519 (15 min) validados contra JWKS cacheado.
- El verificador y el health consultan `AUTH_JWKS_URL`. En Docker el default es
  `http://127.0.0.1:3000/api/auth/jwks`, dentro del contenedor de la API, para que
  Bot Fight Mode u otros challenges del edge no bloqueen la validacion de tokens.
  `AUTH_URL`, issuer y audience conservan la URL publica. Fuera de Compose, si
  `AUTH_JWKS_URL` falta o esta vacia, se usa `/api/auth/jwks` relativo a `AUTH_URL`.
  `authJwksReachable` indica acceso al endpoint configurado; la ruta publica y el
  tunel se verifican por separado.
- Refresh tokens: sesiones server-side (`AUTH_REFRESH_TTL`, 7 dias por defecto), expiracion absoluta y revocacion inmediata. Viajan en la cookie `sipeg-refresh` (`HttpOnly`, `Path=/api/v1/auth`, host-only, `Secure` en produccion) y **no** en el cuerpo de la respuesta: asi la sesion se comparte entre pestanas y un XSS no puede leer la credencial. Ver `docs/adr/adr-0009-refresh-token-cookie-httponly.md`.
- Endpoints principales (`/api/v1/auth/*`):
  - `POST /auth/login` — devuelve el access token EdDSA en el cuerpo y el refresh token en la cookie `sipeg-refresh`; credenciales invalidas o cuenta desactivada responden 401 generico (`Invalid email or password`) sin revelar si el correo existe; una cuenta no verificada responde 403; limite de 5 intentos/min por IP.
  - `POST /auth/refresh` — lee la cookie `sipeg-refresh`, rota la sesion, emite un access token nuevo en el cuerpo y devuelve la cookie rotada; el token anterior queda invalido y tokens expirados, revocados o de cuentas desactivadas responden 401. Limite por sesion, no por IP.
  - `POST /auth/logout` — invalida la sesion de la cookie y la borra; responde 200 incluso sin cookie o si la sesion ya no existe. Si falla la revocacion en el servidor, responde 500 y conserva la cookie para reintentar. El access token ya emitido sigue stateless hasta vencer; las otras pestanas deben descartar su estado local para reflejar el cierre inmediatamente.
  - `refresh` y `logout` aceptan peticiones sin cuerpo; la credencial se envia solo en la cookie. `login`, `refresh` y `logout` incluyen `Cache-Control: no-store`.
  - En un mismo perfil del navegador, la cookie se comparte entre pestanas y no se aisla por puerto: APIs en `localhost` con el mismo nombre y path pueden sobrescribirla aunque usen puertos distintos. `localhost` y `127.0.0.1` son hosts distintos. Usa `credentials: "include"` y un host consistente; para probar cuentas independientes, usa perfiles separados. Borrar el estado local no revoca la sesion: hay que completar `POST /auth/logout`.
  - `POST /auth/register` — crea una cuenta no verificada con rol `USER`, rechaza campos de rol, estado o permisos y envia un enlace de verificacion con vigencia `AUTH_EMAIL_VERIFICATION_TTL` (24 h por defecto). Es la unica via de registro: las rutas nativas del proveedor no estan expuestas.
  - `POST /auth/verify-email` — confirma el email; tokens invalidos o vencidos responden 400 generico y el limite es 5 intentos/min por IP.
  - `POST /auth/forgot-password` — siempre responde el mismo 200 exista o no el email; limite independiente de 3 solicitudes/min por IP. El origin de `AUTH_PASSWORD_RESET_URL` debe estar en `CORS_ORIGIN` o `TRUSTED_ORIGINS`; si no coincide, la app no arranca.
  - `POST /auth/reset-password` — consume un token de un solo uso con vigencia `AUTH_PASSWORD_RESET_TTL` (1 h por defecto), actualiza el hash Argon2id y revoca todas las sesiones del usuario; tiene otro limite independiente de 3 intentos/min por IP.
  - `POST /auth/change-password` — requiere Bearer token, contrasena actual y nueva de 12-20 caracteres, mas la cookie `sipeg-refresh` de la sesion actual; actualiza el hash Argon2id y revoca todas las demas sesiones conservando la actual; limite de 5 intentos/min por usuario.
- Los access tokens ya emitidos son stateless y pueden conservar validez hasta `AUTH_TOKEN_TTL`: tras un reset se revocan todos los refresh tokens del usuario y tras un cambio de contrasena se revocan todos menos el de la sesion actual.
- La entrega usa SMTP con TLS 1.2 minimo y no registra destinatarios, enlaces ni tokens. Desarrollo usa Mailpit; produccion requiere `MAIL_HOST` y `MAIL_FROM`, con `MAIL_USER`/`MAIL_PASSWORD` opcionales pero inseparables.
- `login`, `refresh`, `logout` y `change-password` exigen que el `Origin`, si viene, este en `CORS_ORIGIN`/`TRUSTED_ORIGINS`; si no, responden 403 y registran `security.cors.denied`. Es la defensa CSRF que exige una cookie. Las peticiones sin `Origin` (curl, Postman, Bruno) se permiten.
- Rutas privadas: `Authorization: Bearer <accessToken>`. `authenticate` recarga el usuario desde la BD y responde 403 si la cuenta fue desactivada, incluso con un JWT aun vigente.
- Variables de entorno (sin prefijo del proveedor):
  - `AUTH_SECRET` (requerido, generar con `openssl rand -base64 32`)
  - `AUTH_URL` (default `http://localhost:3000`)
  - `AUTH_JWKS_URL` (HTTP(S), opcional; default Docker `http://127.0.0.1:3000/api/auth/jwks`)
  - `AUTH_TOKEN_TTL` (default `15m`)
  - `AUTH_REFRESH_COOKIE_SAME_SITE` (`lax|strict|none`, default `lax`; **obligatoria en produccion**): `lax`/`strict` si la API y el frontend comparten sitio, `none` si estan en sitios distintos, lo que exige HTTPS real
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
- `POST /api/v1/admin/users` (solo `ADMIN`) crea la cuenta con rol fijo `USER` y su credencial Argon2id en una transacción; acepta `isActive` (default `true`) y rechaza cualquier campo de rol. Valida conflictos de email e identificación (`409`). El correo queda sin verificar (`emailVerified=false`) y se envia el enlace de verificación; la cuenta no puede iniciar sesion hasta verificarlo.
- `PATCH /api/v1/admin/users/{id}` (solo `ADMIN`) actualiza `globalRole`, `isActive`, `unitId` y `careerId`. Solo permite promover a `ADMIN` una cuenta que ya este activa y no admite promoverla y desactivarla en la misma petición; una cuenta inactiva debe reactivarse primero. Al desactivar revoca todas las sesiones del usuario; no permite autodesactivación ni autodegradación y protege al último administrador activo (409). Devuelve el mismo DTO seguro y responde 400/404.
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

- `GET /api/v1/event-programs` es publico y devuelve programas con estado `ACTIVE`, ordenados por nombre. Acepta el filtro `status` (cualquier estado o `ALL`), pero solo los `ADMIN` lo aplican: anonimos y `USER` siempre reciben el listado `ACTIVE` aunque envien otro estado, sin error. Un `status` invalido responde `400`, un Bearer invalido `401` y una cuenta desactivada `403`.
- Paginacion offset: `?page` (default 1) y `?limit` (default 20, maximo 50). Respuesta `data = { items, page, limit, total, totalPages }`.
- Filtros opcionales: `organizationalUnitId`, `unitType` (`FACULTY` o `SUBDIRECTORATE`) y `q`, que busca sin distinguir mayusculas en el nombre y la etiqueta.
- `GET /api/v1/event-programs/:id` es publico y solo devuelve programas `ACTIVE`; otro estado o un id inexistente responde `404`. Incluye `activityCount.visible` con las actividades `SCHEDULED`, `ONGOING` y `COMPLETED` (excluye `DRAFT` y `CANCELLED`) contadas por su estado efectivo derivado al leer.
- El detalle acepta un Bearer opcional: `ADMIN` o un colaborador con `program:read` vigente en el scope reciben ademas `activityCount.total` y `activityCount.byStatus` (los cinco estados, tambien derivados con la fecha y hora institucionales). Un token presente pero invalido o vencido responde `401`.
- `PATCH /api/v1/event-programs/:id` (privado) actualiza parcialmente `name`, `description`, `label`, `bannerUrl`, `startDate` y `endDate`. Requiere el permiso `program:update` en el scope del programa (o rol `ADMIN`); los programas `ARCHIVED` responden `409`. Acepta `status: "ACTIVE"` para publicar un programa `DRAFT` (cualquier otro estado actual `409`); los programas predeterminados no admiten fechas (`400`) y las fechas que dejarian actividades fuera del rango responden `409`. `isDefault` y `organizationalUnitId` son inmutables (`400`).
- `POST /api/v1/event-programs/:id/archive` (privado) archiva un programa y registra `archivedAt`. Requiere el permiso `program:archive` en el scope del programa (o rol `ADMIN`; ningun rol de colaboracion lo incluye por defecto). Responde `409` si el programa es predeterminado y su unidad sigue activa o si el programa es adicional y tiene actividades con estado efectivo `SCHEDULED`/`ONGOING` (publicadas que aun no terminan); las que ya terminaron no bloquean. Repetir la operacion sobre un programa ya archivado responde `200` sin cambiar `archivedAt`. Ver `docs/adr/adr-0010-read-time-activity-status-derivation.md`.
- `POST /api/v1/event-programs/:id/reactivate` (privado) reactiva un programa adicional `ARCHIVED` y lo devuelve a `ACTIVE`, limpiando `archivedAt`. Requiere el permiso `program:reactivate` en el scope del programa (o rol `ADMIN`; ningun rol de colaboracion lo incluye por defecto). Responde `409` si el programa es predeterminado (su reactivacion es la de la unidad), si no esta `ARCHIVED`, y `400` si sus fechas son incoherentes. No hay idempotencia: repetir la operacion sobre un programa ya `ACTIVE` responde `409`.
- `GET /api/v1/event-programs/:id/activities` es publico y devuelve las actividades del programa con paginacion (`?page`, `?limit`) y filtros `type`, `q`, `dateFrom` y `dateTo` (rango inclusivo; `dateFrom > dateTo` responde `400`). El publico recibe `SCHEDULED`, `ONGOING` y `COMPLETED`; el filtro `status` (o `ALL`) solo aplica a `ADMIN` o colaboradores con `activity:read` en el programa, que ademas pueden ver programas no `ACTIVE`, y opera con el estado efectivo. El resto de casos no visibles responde `404`. Cada item incluye el `status` efectivo.
- La eliminacion fisica de programas de eventos no esta expuesta: `DELETE /api/v1/event-programs` y `DELETE /api/v1/event-programs/:id` responden `405 Method Not Allowed` con el header `Allow` (`GET, POST` y `GET, PATCH` respectivamente) sin evaluar autenticacion; usa `POST /api/v1/event-programs/:id/archive`. Los triggers `event_programs_prevent_delete` y `event_programs_prevent_truncate` rechazan cualquier borrado directo en la base de datos.

### Actividades

- `GET /api/v1/activities` es publico y lista las actividades de programas `ACTIVE` con paginacion offset y filtros: `when` (`upcoming` default, `past`, `all`), `eventProgramId`, `organizationalUnitId`, `unitType` (`FACULTY`/`SUBDIRECTORATE`), `type`, `classroomId`, `dateFrom`/`dateTo` (inclusivos, `YYYY-MM-DD`; `dateFrom > dateTo` responde `400`) y `status`. El publico siempre recibe el conjunto `SCHEDULED`/`ONGOING`/`COMPLETED`; solo `ADMIN` puede filtrar `DRAFT`/`CANCELLED` o `status=ALL`, y para el resto el filtro se ignora en silencio (`200`). Tanto el `status` de cada item como el filtro usan el **estado efectivo** derivado al leer con la fecha y hora institucionales (`America/Panama`): `DRAFT`/`CANCELLED` se conservan; una actividad publicada es `SCHEDULED` antes de su inicio, `ONGOING` dentro de `[inicio, fin)` y `COMPLETED` desde su fin. `upcoming` mantiene `date >= hoy` y `past` devuelve `date <= ayer` en la zona institucional `America/Panama` ordenado de mas reciente a mas antiguo (el corte de `when` sigue siendo por fecha de calendario). Un Bearer presente pero invalido o vencido responde `401` y una cuenta desactivada `403`; sin header sigue siendo publico. Ver `docs/adr/adr-0010-read-time-activity-status-derivation.md`.
- Paginacion offset: `?page` (default 1) y `?limit` (default 20, maximo 50). Respuesta `data = { items, page, limit, total, totalPages }`.
- `GET /api/v1/activities/:id` es publico y devuelve el detalle con `speakers`, `classroom`, `equipment`, `eventProgram`, `organizationalUnit`, `enrolledCount` (inscritos) y `checkedInCount` (presentes). El `status` del detalle es el estado efectivo. Los anonimos solo ven actividades no `DRAFT` de programas `ACTIVE`; con Bearer opcional, `ADMIN` o un colaborador con `activity:read` vigente en el scope (programa o actividad) tambien leen `DRAFT` y programas no activos. Un token presente pero invalido o vencido responde `401` y la falta de visibilidad responde `404` para no revelar existencia.
- `POST /api/v1/activities` (privado) crea una actividad dentro de un programa `ACTIVE`. Requiere el permiso `activity:create` en el programa (o rol `ADMIN`), queda en estado `DRAFT` y devuelve un DTO sin codigos con `enrolledCount` y `checkedInCount` en `0`. Si se indica `classroomId`, la creacion aplica las mismas validaciones de agenda que `PATCH`: aula existente/activa (`404`/`400`), capacidad del aula suficiente (`400`), horario dentro de una ventana de disponibilidad (`409`) y ausencia de solape con actividades `SCHEDULED`/`ONGOING` (`409`); un borrador no bloquea el solape.
- `PATCH /api/v1/activities/:id` (privado) actualiza parcialmente una actividad y requiere `activity:update` en el scope de la actividad (o rol `ADMIN`). Acepta `name`, `description`, `type`, `date`, `startTime`, `endTime`, `maxCapacity`, `bannerUrl`, `classroomId`, `status`, `speakers[]` y `equipment[]`; `eventProgramId` es inmutable (body estricto). `status` solo admite `DRAFT <-> SCHEDULED` (publicar/despublicar); `ONGOING`, `COMPLETED` y `CANCELLED` no son asignables. Por estado efectivo, las actividades `COMPLETED`/`CANCELLED` responden `409 Completed or cancelled activities cannot be modified.` y las `ONGOING` responden `409 Ongoing activities cannot be modified.` `speakers`/`equipment` reemplazan la lista completa (`[]` limpia); `equipment` no admite duplicados aunque solo difieran en mayusculas (`400`). Cuando el estado resultante reserva aula (`SCHEDULED`/`ONGOING`), se validan aula activa, ventana de disponibilidad (`409`), solape con otras actividades (`409`) y capacidad del aula (`400`).
- `POST /api/v1/activities/:id/cancel` (privado) cancela una actividad y requiere `activity:cancel` en el scope de la actividad (o rol `ADMIN`); `activity:cancel` es un permiso por defecto de `ORGANIZER`. Acepta un body opcional `{ "reason": string }` recortado de 1-500 caracteres (claves desconocidas o motivo vacio/sobrado responden `400`); el motivo queda en `cancelReason` del detalle. Se puede cancelar desde el estado efectivo `DRAFT`, `SCHEDULED` u `ONGOING`; una actividad efectivamente `COMPLETED` responde `409 Completed activities cannot be cancelled.` y un programa no `ACTIVE` responde `409 Event programs must be active to cancel their activities.` Cancelar una actividad ya `CANCELLED` es idempotente: responde `200` sin sobrescribir el motivo original. Cancelar libera el aula de la actividad (`SCHEDULED`/`ONGOING` la reservaban). Aun no notifica a los inscritos (diferido a la fase 12).
- `DELETE /api/v1/activities/:id` (privado) elimina fisicamente una actividad y requiere el permiso `activity:delete` en el scope de la actividad (o rol `ADMIN`); `activity:delete` es un permiso por defecto de `ORGANIZER` y no lo tienen `EDITOR` ni `VIEWER`. Responde `204` sin cuerpo. **Regla de retencion:** solo se eliminan actividades `DRAFT` de programas `ACTIVE` sin asistencia y sin alertas; cualquier otro caso responde `409` (`Only DRAFT activities can be deleted.`, `Event programs must be active to delete their activities.`, `Activities with attendance records cannot be deleted.`, `Activities with alert records cannot be deleted.`), por lo que una actividad con historia se cancela en lugar de borrarse. Si el recurso cambia entre la validacion y el borrado, la operacion responde `409 The activity changed while it was being deleted. Retry the request.` El equipo, los vinculos de ponentes y las colaboraciones locales se eliminan por cascada, pero la ficha del catalogo de ponentes se conserva. El trigger `activities_prevent_delete` de PostgreSQL rechaza el borrado directo por SQL de estados distintos de `DRAFT` y de programas no `ACTIVE`. Cada borrado escribe un evento `activity.deleted` en `audit_events`, que sobrevive a la eliminacion del recurso.
- Cuerpo de creacion: `name`, `type`, `date` (`YYYY-MM-DD`), `startTime`/`endTime` (`HH:mm`) y `eventProgramId` (obligatorio); opcionales `description`, `maxCapacity`, `bannerUrl`, `classroomId`, `speakers[]` y `equipment[]`. `equipment` no admite duplicados aunque solo difieran en mayusculas (`400`).
- Los ponentes viajan inline en `speakers[]` (`firstName`, `lastName`, `email?`, `organization?`, maximo 10). No requieren cuenta: el servicio reutiliza el ponente del catalogo cuando el email coincide y lo vincula a un usuario si existe una cuenta con ese email.
- Cambio incompatible: las respuestas exponen `speakers` (array) en lugar de `speaker` (objeto o `null`) en `ActivityListItem` y `ActivityDetail`.
- Cada item incluye `eventProgram` (programa de eventos) y `organizationalUnit`; la lista no expone codigos de check-in.
- Los codigos de check-in (`code`) viven en `attendance` (uno por inscripcion, unico global) y no en la actividad. Ver `docs/adr/adr-0004-attendance-checkin-codes.md`.
- Terminologia: "evento" se usa coloquialmente, pero el nombre oficial del recurso es **actividad** (`/activities`). La ruta `/events` fue retirada.

### Colaboradores Por Scope

- `GET /api/v1/event-programs/{id}/collaborators` y `GET /api/v1/activities/{id}/collaborators` (privados) listan las colaboraciones locales del scope: `userId`, identidad (`firstName`, `lastName`, `email`), `role`, `createdAt` y permisos efectivos con procedencia (`name`, `source`, `origin`, `validFrom`, `validUntil`, `effective`). Requieren `permission:grant` en el scope o rol `ADMIN`; no expanden la herencia del programa padre como colaboradores (solo resuelven sus permisos) y no devuelven `grantedById`/`grantedAt`. `origin` es `LOCAL` (grant del scope), `INHERITED` (grant vigente del programa padre) o `BOTH` (ambos); el envelope reportado es la fusión de los grants activos, `effective: true` confirma vigencia y los grants vencidos o futuros se omiten aunque sigan almacenados. `source` refleja la clase del grant activo que aporta el permiso (`ROLE_DEFAULT`/`OVERRIDE`, priorizando el `OVERRIDE` local activo) y cae a `ROLE_DEFAULT` cuando solo viene de defaults.
- `POST` de los mismos paths agrega un colaborador con `{ userId, role }` (`VIEWER`, `EDITOR` u `ORGANIZER`) y materializa los permisos `ROLE_DEFAULT` del rol. Un actor no-admin no puede asignar un rol cuyos defaults no posea (`403`); usuario inexistente `404`, inactivo `400`, duplicado en el scope `409` y programa `ARCHIVED` `409`. Body estricto: rol inválido o claves desconocidas responden `400`.
- `PATCH /api/v1/event-programs/{id}/collaborators/{userId}` y `PATCH /api/v1/activities/{id}/collaborators/{userId}` (privados) cambian el rol con `{ role }`: reemplazan los `ROLE_DEFAULT` por los del rol nuevo y preservan los `OVERRIDE` (incluida su ventana). El actor no puede asignar un rol que exceda sus permisos ni eliminar defaults que no posea (`403`); colaborador inexistente `404` y programa `ARCHIVED` `409`. Responde `200` con el colaborador actualizado.
- `DELETE` de los mismos paths (privados) elimina la colaboración local con `204` y cascada de `collaboration_permissions`. Mismas guardas de permiso y `404`/`409` que el `PATCH`, más la invariante de último delegador: el scope debe conservar al menos un colaborador activo capaz de delegar (`permission:grant` vigente o `globalRole=ADMIN`, incluyendo la herencia del programa en actividades); si se intenta borrar al último responde `409 Cannot remove the last collaborator able to delegate in this scope.`
- `POST /api/v1/event-programs/{id}/permissions` y `POST /api/v1/activities/{id}/permissions` (privados) otorgan o reemplazan un permiso local con `{ userId, permission, validFrom?, validUntil? }` (ventanas ISO 8601 opcionales o `null`) y responden `200` con el colaborador actualizado. El actor solo puede otorgar permisos que posee y la ventana debe quedar dentro de su envelope para ese permiso, así que un delegador acotado no puede crear grants ilimitados; re-otorgar el mismo permiso reemplaza la ventana sin duplicar la fila. Colaborador inexistente `404`, permiso desconocido o ventana inválida `400`, programa inexistente `404` y programa `ARCHIVED` `409`.
- `DELETE /api/v1/event-programs/{id}/permissions/{permission}?userId=` y `DELETE /api/v1/activities/{id}/permissions/{permission}?userId=` (privados) eliminan un permiso local (`ROLE_DEFAULT` u `OVERRIDE`) y responden `204` sin cuerpo. El actor solo puede revocar permisos que posee (`403`), el grant local inexistente responde `404` y las guardas de programa repiten `404`/`409`. En actividades la operación nunca toca la herencia: si el permiso no tiene fila local pero sí herencia activa del programa responde `409 Cannot revoke a permission inherited from the event program.` (se revoca en el programa); si hay fila local se elimina aunque el permiso siga vigente por herencia, porque no existe `DENY` local. Revocar `permission:grant` al último colaborador activo capaz de delegar responde `409 Cannot revoke the last delegation permission in this scope.`
- Respuesta: `data = { items: [...] }` en el listado, `data = Collaborator` en la creación, en la actualización de rol y en el otorgamiento de permisos, y `204` sin cuerpo en las eliminaciones. Ninguna respuesta de este módulo (listados, mutaciones y permisos propios) expone `grantedById` ni `grantedAt`: son columnas internas de auditoría en `collaboration_permissions`. Ver `docs/adr/adr-0001-time-aware-collaboration-authorization.md`.
- `GET /api/v1/users/me/permissions?scope=program|activity&id=` (privado) devuelve los permisos efectivos del usuario autenticado en el scope con su envelope temporal y procedencia (`{ name, origin, validFrom, validUntil }`; `null` = sin límite). `origin` es `LOCAL` (grant del scope pedido), `INHERITED` (grant del programa padre) o `BOTH` (ambos activos). En actividades une los grants locales con los heredados del programa padre; los grants vencidos o futuros se ignoran y no se devuelven. `ADMIN` recibe el catálogo completo con envelopes ilimitados y `origin: LOCAL`. `scope` inválido o `id` ausente `400`; programa o actividad inexistente `404`.
- `GET /api/v1/users/me/scopes` (privado, paginado) descubre los scopes donde el usuario autenticado tiene al menos un permiso efectivo vigente, incluidos estados no públicos. Query estricta `type?=program|activity`, `page>=1` (default 1) y `limit` 1..50 (default 20), inválidos `400`; orden determinista `name ASC, id ASC`. Un `USER` recibe solo sus colaboraciones directas (el ítem de programa cubre sus actividades y una actividad aparece solo si tiene colaboración local allí; sus `permissions` unen igualmente la herencia como `INHERITED`/`BOTH`). `ADMIN` recibe todo el catálogo de programas y actividades con el catálogo completo de permisos como `LOCAL` e ilimitado. Cada ítem expone `type`, `id`, `name`, `status` (efectivo en actividades, almacenado en programas), `eventProgram` (padre para actividades, `null` para programas), `organizationalUnit` y `permissions`. Sin scopes responde página vacía, nunca `404`; `401` sin token o token inválido y `403` cuenta inactiva. No expone `grantedById`, `grantedAt` ni emails. Detalle en `docs/adr/adr-0011-user-scope-discovery.md`.

### Aulas

- `GET /api/v1/classrooms` es público y devuelve solo aulas activas por defecto; `isActive=false` lista las inactivas. Paginación offset (`page`/`limit`, máximo 50) y filtros `type` (`LABORATORY`/`CLASSROOM`/`CONFERENCE_ROOM`), `minCapacity` y `amenity` (insensible a mayúsculas).
- `GET /api/v1/classrooms/{id}` es público e incluye `amenities` y las ventanas semanales `availability` (`dayOfWeek` ISO 1-7, `startTime`/`endTime` en `HH:mm`, `period` opcional).
- `GET /api/v1/classrooms/available` es público y exige `date` (`YYYY-MM-DD`), `startTime` y `endTime`; acepta `minCapacity`, `type` y `amenity`. Devuelve las aulas activas cuya ventana cubre el intervalo en el día institucional solicitado y que no están reservadas por actividades con estado efectivo `SCHEDULED`/`ONGOING`; las que ya terminaron (efectivo `COMPLETED`), `DRAFT` y `CANCELLED` no bloquean.
- `POST /api/v1/classrooms` y `PATCH /api/v1/classrooms/{id}` (solo `ADMIN`) gestionan `name`, `type`, `capacity` (> 0), `building` y `floor`; el PATCH admite `isActive` y rechaza con `409` desactivar un aula con actividades efectivamente `SCHEDULED`/`ONGOING`. Un body vacío o con claves desconocidas responde `400`.
- `POST /api/v1/classrooms/{id}/amenities` y `DELETE /api/v1/classrooms/{id}/amenities/{amenity}` (solo `ADMIN`) agregan y quitan amenidades; el alta normaliza espacios, conserva el formato original, rechaza duplicados sin distinguir mayúsculas con `409` y el borrado también es insensible a mayúsculas.
- `POST /api/v1/classrooms/{id}/availability` y `DELETE /api/v1/classrooms/{id}/availability/{availabilityId}` (solo `ADMIN`) gestionan ventanas semanales; se exige `startTime < endTime` y un solape con otra ventana del mismo día responde `409` (las ventanas adyacentes, como 07:00-12:00 y 12:00-17:00, conviven).
- Las mutaciones devuelven el detalle completo del aula. La consistencia de reservas se apoya también en la restricción de exclusión `activities_classroom_no_overlap` de PostgreSQL.

### Certificados

- `GET /api/v1/users/me/certificates` (privado) lista los certificados del usuario autenticado, del más reciente al más antiguo. Cada item trae `id`, `code`, `issuedAt` (instante UTC), la actividad (`id`, `name`, `date`, `type`) y el programa de eventos (`id`, `name`).
- Acepta paginación offset (`page`/`limit`, máximo 50) y filtros `eventProgramId`, `activityId` e `issuedFrom`/`issuedTo` (`YYYY-MM-DD`). El rango de emisión se interpreta en la zona institucional `America/Panama`: `issuedFrom` es inclusivo desde la medianoche del día y `issuedTo` cubre el día completo. `issuedFrom` posterior a `issuedTo` responde `400`.
- El aislamiento es estructural: la consulta se acota al usuario del token y no hay forma de pedir los certificados de otra persona. Un `userId` en la query responde `400` por clave desconocida. Un filtro sin coincidencias responde `200` con `items: []` y `total: 0`; el listado propio nunca responde `404`. `ADMIN` tampoco lista ajenos por esta ruta: es de alcance propio.
- La respuesta NO expone `pdfUrl` ni `attendanceId`. El campo de archivo llega con 10.3, cuando exista el endpoint de descarga y el almacenamiento de la Fase 6; hoy el seed escribe rutas placeholder sin archivo detrás.
- Sin auditoría ni rate limit propio: es una lectura autenticada de datos propios, no una acción administrativa.

### Alertas

- `GET /api/v1/alerts` (privado) lista las alertas del usuario autenticado, de la más reciente a la más antigua, con paginación offset (`page`/`limit`, máximo 50) y filtros `isRead` (`true`/`false`) y `type` (los ocho valores de `AlertType`). La query es estricta: `userId`, `recipientId` u otra clave desconocida responde `400`.
- `GET /api/v1/alerts/{id}` (privado) devuelve una alerta propia. Alerta ajena e inexistente comparten el mismo `404 Alert not found.`, incluso para `ADMIN`: la bandeja es estrictamente propia y nunca revela la existencia de alertas ajenas.
- `PATCH /api/v1/alerts/{id}/read` (privado) marca una alerta propia como leída y devuelve la alerta resultante. Es idempotente: repetir la marca responde `200`. `POST /api/v1/alerts/read-all` (privado) marca todas las no leídas del usuario y responde `{ updatedCount }`; nunca toca a otro destinatario.
- El destino se expone como unión discriminada `target: { kind: 'PROPOSAL' | 'EVENT_PROGRAM' | 'ACTIVITY' | 'CERTIFICATE', id }`; no se exponen `recipientId` ni las columnas FK internas.
- Crear alertas desde acciones de dominio llega en las fases 8, 10 y 12 mediante el helper `createAlert`, que exige un cliente transaccional para confirmar o revertir la alerta junto con la acción de dominio.

## Observabilidad Y Auditoria

El backend emite logs estructurados (JSON de una linea) a stdout/stderr y registra
las mutaciones sensibles en una bitacora durable. El diseno esta decidido en
`docs/adr/adr-0007-structured-logging-and-observability.md` y
`docs/adr/adr-0008-durable-audit-events.md`, y la implementacion paso a paso esta
en `docs/superpowers/plans/logging-y-auditoria.md`.

Modelo operativo objetivo:

```text
API -> stdout JSON -> driver Docker `local` (spool)
    -> Grafana Alloy -> Loki -> Grafana (busqueda, paneles, alertas)

Mutacion sensible -> misma transaccion Prisma -> audit_events (PostgreSQL append-only)
                  -> GET /api/v1/audit-events (solo ADMIN)
```

- Cada respuesta incluye `X-Request-ID` (UUID aceptado o generado); usalo para
  correlacionar un acceso con su error en Grafana.
- Los eventos `access` y `security` usan un logger operativo con nivel minimo
  `info`, independiente de `LOG_LEVEL`: subir el nivel de la aplicacion no puede
  borrar conteos HTTP ni evidencia de autenticacion/autorizacion.
- El access log registra la **plantilla de ruta** (`/api/v1/careers`, no
  `/api/v1/careers/42`) y la captura en el instante en que Express hace match,
  no al final de la respuesta: para toda respuesta que nace dentro de la cadena
  (401, 403, 429, error de validacion) el router ya se desenrollo y `baseUrl`
  vuelve a `''`. Sin esa captura, el mismo endpoint aparecia partido en dos
  series al agregar por ruta. Ver `T10.1a` del plan.
- Etiquetas Loki: `service`, `environment`, `log_type`, `level` y `container`
  (el nombre del servicio Compose). `requestId`, `event`, `route`, `method`,
  `statusCode`, `durationMs`, `outcome`, `requestKind`, `actorId`, IDs de recurso,
  IPs y trace IDs viven en el JSON y en structured metadata, nunca como labels.
  `requestKind` distingue `matched`, `preflight` y `unmatched`; `outcome`
  distingue respuestas `completed` de conexiones `aborted`. Los contenedores que no son JSON
  (por ejemplo `db`) solo llevan `container`.
- Retencion: 30 dias para access/aplicacion/infraestructura y 90 dias para
  `log_type="security"` (produccion); 7 dias en desarrollo. El selector de tiempo
  de los paneles llega hasta 90 dias en produccion porque
  `max_query_length: 2160h` esta alineado con `retention_stream`; sin eso, el
  default de Loki (`30d1h`) rechazaba la consulta y los 90 dias eran datos no
  consultables. Acotar el rango sigue siendo lo correcto para investigar.
- La API funciona aunque Loki este caido: escribe a stdout y el driver `local`
  actua como buffer. La rotacion local (`max-size`/`max-file`) evita agotar disco.
  Los tres compose declaran `x-logging` y lo aplican a cada servicio con
  `logging: *logging`: `local`, `max-size: '20m'`, `max-file: '5'`, o sea 100 MB
  por servicio. Sin eso el driver por defecto (`json-file` sin opciones) no rota
  nunca y, como Alloy reintenta para siempre, una caida de Loki llenaria el disco.
  El spool acota el disco pero no garantiza entrega: pasado ese tope se pierden
  las lineas mas antiguas.
- No se registran cuerpos, cabeceras `Authorization`/`Cookie`, tokens,
  contrasenas, hashes, `DATABASE_URL`, queries Prisma ni datos de CV. Fuera de
  produccion el serializador de errores conserva `message` y `stack` para
  diagnosticar, pero descarta `err.body` y `err.headers`: es lo que
  `body-parser` adjunta al error de un cuerpo invalido, y el pipeline de
  desarrollo tambien ingiere esos logs en Loki.
- Un cuerpo JSON malformado o demasiado grande responde **400** con el sobre
  estandar (`{"success": false, "message": "Malformed request body.", "errors":
[]}`) y **no** emite `http.error.unexpected`: es entrada invalida del cliente,
  no un fallo de la aplicacion. Solo se honra un `status` 4xx entero del error;
  un 5xx adjunto sigue siendo error inesperado con su log `error`. El mensaje de
  la respuesta sale de una tabla cerrada por status y nunca del error, para no
  filtrar nada del cuerpo recibido.

Variables de entorno nuevas (ver `.env.example`):

- `LOG_LEVEL` (default `info`, solo aplicacion/infraestructura), `LOG_PRETTY` (solo desarrollo),
  `LOG_SERVICE_NAME` (default `sipeg-utp-backend`) y `APP_VERSION`.
- `LOG_PSEUDONYMIZATION_KEY` (obligatoria en produccion, minimo 32 caracteres):
  clave HMAC para pseudonimizar email/IP en eventos de seguridad.
- `GRAFANA_ADMIN_PASSWORD` y `GRAFANA_SECRET_KEY` (obligatorias para levantar el
  overlay de observabilidad, sin valor por defecto) y `GRAFANA_PORT` (default
  `3001`, porque la API ya usa `3000` en el host).

`compose.observability.yaml` es un overlay: Loki, `docker-socket-proxy`, Alloy y
Grafana. Loki y Alloy viven en su propia red `observability` y alcanzan los logs
por el socket de Docker, no por la red de la aplicacion. Grafana si esta en esa
red (para consultar a Loki) y es el unico servicio del overlay con puerto
publicado.

```bash
# Desarrollo (retencion de 7 dias):
LOKI_CONFIG=config.dev.yaml \
  docker compose -f compose.dev.yaml -f compose.observability.yaml up -d

# Produccion (30 dias, 90 dias para log_type="security"):
docker compose \
  -f compose.prod.yaml \
  -f compose.observability.yaml \
  -f compose.cloudflare.yaml \
  --env-file .env.prod \
  up -d
```

- `LOKI_CONFIG` elige `observability/loki/config.yaml` (por defecto) o
  `config.dev.yaml`.
- El overlay fuerza `LOG_PRETTY=false` en el servicio `api`: `pino-pretty` no es
  JSON y sin JSON no hay etiquetas. En produccion no cambia nada.
- Grafana se sirve en `https://grafana.sipeg-utp.com` detras de Cloudflare Access
  y de su propio login; para diagnostico desde el VPS queda
  `http://127.0.0.1:3001`. Loki y Alloy no publican puertos. Se entra como el
  usuario admin con `GRAFANA_ADMIN_PASSWORD`. El acceso anonimo y el registro de
  usuarios estan deshabilitados: los logs incluyen eventos
  `log_type="security"`.
- La API tambien va atada a `127.0.0.1:3000` en dev y produccion. En desarrollo la
  alcanza el navegador como `http://localhost:3000`; en produccion el cliente
  publico es Cloudflare Tunnel. `cloudflared` es el salto del socket que Express
  confia con `trust proxy: 1` y Cloudflare escribe la IP del cliente en
  `X-Forwarded-For`. El bind a loopback queda solo para diagnosticos desde el
  host; no se publica en `0.0.0.0`.
- `AUTH_JWKS_URL` apunta al loopback del contenedor de la API para que el
  verificador JWT no dependa del JWKS publico, donde Bot Fight Mode puede
  responder con un challenge. El health mide ese endpoint interno; el JWKS
  publico se comprueba por separado.
- La cadena de proxy ya esta definida, pero la prueba de aislamiento de los
  buckets de rate limiting desde dos redes quedo diferida por decision operativa.
  Debe repetirse antes de ajustar umbrales con trafico real.
- `GRAFANA_ADMIN_PASSWORD` solo se aplica al inicializar un volumen vacio: si el
  volumen `grafana_data` ya existe, cambiar la variable no cambia la contrasena.
  `GRAFANA_SECRET_KEY` debe permanecer igual entre reinicios, o se invalidan las
  sesiones abiertas.
- El datasource Loki se provisiona por archivo desde
  `observability/grafana/provisioning/datasources/loki.yaml`, con UID `loki` para
  que los paneles y las alertas lo referencien de forma estable.
- Los paneles se provisionan por archivo desde
  `observability/grafana/provisioning/dashboards/dashboards.yaml`, que apunta a
  `observability/grafana/dashboards/`. El provider declara la carpeta fija
  `SIPEG UTP` con `folderUid: sipeg-utp` y `allowUiUpdates: false`: el panel se
  edita en el repositorio, no en la UI, y el siguiente arranque manda.
  `updateIntervalSeconds: 30` (no <=10) para que Grafana sondee el directorio en
  vez de depender de eventos de inotify que un bind mount puede no propagar.
  Verificado: guardar un panel nuevo aparece en menos de 45 s **sin reiniciar**
  Grafana.
  - `API Overview` (UID `sipeg-api-overview`):
    `http://127.0.0.1:3001/d/sipeg-api-overview/api-overview`. Trae volumen,
    distribucion por clase de estado, p50/p95 de latencia, frecuencia completa
    por metodo+ruta, preflight/no enrutadas, requests abortados y la cola de
    solicitudes mas recientes. Los selectores de metodo y plantilla de ruta
    permiten investigar una operacion concreta sin registrar IDs ni query strings.
  - `Errors` (UID `sipeg-errors`):
    `http://127.0.0.1:3001/d/sipeg-errors/errors`. Errores inesperados, 5xx por
    ruta, ciclo de vida del proceso, dependencias fallidas (Prisma, correo y
    PostgreSQL) y un buscador por `X-Request-ID`. La bitacora durable de cambios
    sensibles no se ve aqui: se consulta en `GET /api/v1/audit-events`.
  - `Security` (UID `sipeg-security`):
    `http://127.0.0.1:3001/d/sipeg-security/security`. Fallos de login, tokens
    invalidos, denegaciones 403 (por ruta y por motivo), rate limits por
    limitador, actores con mas fallos de login, cambios de contrasena y
    revocacion de sesiones. Los actores aparecen como pseudonimo HMAC.
  - Los paneles se montan en `/etc/grafana/dashboards`, **fuera** de
    `/var/lib/grafana`: ese path es el home del volumen `grafana_data` y anidar
    un bind mount de solo lectura dentro mezclaria configuracion y estado.
  - La carpeta `SIPEG UTP` se identifica por **titulo**, no por UID. El
    provisioning de alertas corre antes que el de paneles y su formato v1 solo
    admite el titulo, de modo que el UID lo genera Grafana; por eso
    `dashboards.yaml` no declara `folderUid`.
- Las alertas se provisionan por archivo desde
  `observability/grafana/provisioning/alerting/rules.yaml`, montado en
  `/etc/grafana/provisioning/alerting`. Un grupo `sipeg-api` en la misma carpeta
  `SIPEG UTP`, evaluado cada minuto contra el datasource `loki`:

  | Regla                     | Condicion                                    | `for` | Explicacion                                                           |
  | ------------------------- | -------------------------------------------- | ----- | --------------------------------------------------------------------- |
  | `sipeg-fatal`             | `app.fatal` o `app.jwks.failed` > 0 en 5 min | `0s`  | muerte del proceso, o arranque sin JWKS (no se pueden firmar tokens)  |
  | `sipeg-unexpected-errors` | `http.error.unexpected` > 5 en 5 min         | `0s`  | fallos que la aplicacion no previo                                    |
  | `sipeg-5xx`               | respuestas 5xx > 10 en 5 min                 | `0s`  | cuenta el access log, incluye los 5xx que no pasan por `errorHandler` |
  | `sipeg-auth-failures`     | `auth.login.failed` > 20 en 5 min            | `0s`  | intentos de login fallidos                                            |
  | `sipeg-rate-limits`       | `rate_limit.exceeded` > 30 en 5 min          | `2m`  | ver la nota de umbral                                                 |
  - Umbral de rate limits **30 y no 10**, con `for: 2m`: los limitadores por IP
    (30/min en login y registro) se agrupan por IP. Con Cloudflare Tunnel,
    `cloudflared` es el salto del socket y Cloudflare escribe o anade al final la
    IP de quien se conecta a su frontera. La prueba de aislamiento entre redes
    quedo diferida; **recalibrar con trafico real** antes de cambiar el umbral.
    Ver `docs/despliegue.md`.
  - `noDataState: OK` y `execErrState: Alerting`: un vector vacio se convierte en
    `0` con `or vector(0)` (cero eventos es correcto), pero **una consulta que
    falla no puede leerse como "todo bien"**: con Loki caido las cinco reglas
    pasan a Alerting.
  - **No hay contact point.** Las alertas se evalúan y se ven en
    `http://127.0.0.1:GRAFANA_PORT/alerting/list`, pero no notifican a nadie.
    Anadir entrega (SMTP) es una fase aparte.
  - **A diferencia de los paneles, las alertas no se releen por sondeo.** Editar
    `rules.yaml` exige recrear el contenedor
    (`docker compose -f compose.dev.yaml -f compose.observability.yaml up -d
--force-recreate grafana`) y revisar `docker compose logs grafana` en busca
    de `finished to provision alerting`. Con `provenance: file` tampoco se
    editan desde la UI.
  - `GET /api/v1/provisioning/alert-rules` **no devuelve** `dashboardUid` ni
    `panelId` aunque esten aplicados; para verlos hay que usar
    `GET /api/v1/provisioning/alert-rules/export`.

#### Verificar el stack de observabilidad

```bash
pnpm run observability:check                    # ventana de 15 min
pnpm run observability:check -- --window 2     # ventana corta
pnpm run observability:check -- --url http://127.0.0.1:3001
```

Habla con la **UI de Grafana** (no con Loki, que no publica puerto) usando
`GRAFANA_ADMIN_USER`/`GRAFANA_ADMIN_PASSWORD`. Imprime `PASS`/`FAIL`/`INFO` por
comprobacion, el remedio de cada fallo y sale con codigo 1 si hay alguno. **Solo
informa: no recrea nada.** 14 comprobaciones:

| Comprobacion             | Que afirma                                                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| `datasource.health`      | el datasource Loki responde `OK`                                                                                                     |
| `alerts.group`           | un unico grupo `sipeg-api`, en la carpeta por titulo y evaluado cada `1m`                                                            |
| `alerts.rules`           | las 5 reglas esperadas estan y no hay duplicadas                                                                                     |
| `alerts.condition`       | cada `condition` apunta a un `refId` declarado                                                                                       |
| `alerts.threshold-ref`   | ninguna etapa de umbral se referencia a si misma (el defecto que dejo passar en silencio el primer `rules.yaml`)                     |
| `alerts.threshold-value` | los cinco umbrales son los declarados: cambiarlos a proposito obliga a actualizar tambien el verificador                             |
| `alerts.query`           | consultas instantaneas contra `loki` y con `or vector(0)`, que es lo que evita el estado `NoData`                                    |
| `alerts.states`          | `noDataState: OK`, `execErrState: Alerting` y los cinco `for`                                                                        |
| `alerts.panel-link`      | cada regla enlaza al panel que la explica (**leido del export**, no del listado de reglas)                                           |
| `rules.health`           | las 5 evaluan con salud `ok`                                                                                                         |
| `rules.state`            | cuantas estan `inactive`/`pending`/`alerting` (**INFO**: que una dispare no es un fallo)                                             |
| `ingest.json-labels`     | la cadena JSON -> Alloy -> Loki esta viva; tolera solo el banner conocido de `tsx watch` y rechaza las demas lineas no estructuradas |
| `dashboards.folder`      | los tres paneles comparten carpeta con las alertas                                                                                   |
| `dashboards.api-traffic` | `API Overview` aplicado conserva la cola de access logs y frecuencia completa por metodo+ruta                                        |

- **`ingest.json-labels` es la que detecta el fallo silencioso del overlay.** Si
  el servicio `api` se levanta sin
  `compose.observability.yaml` corre con `LOG_PRETTY=true`, sus logs no son JSON
  y llegan a Loki sin ninguna etiqueta: los servicios estan arriba, el
  healthcheck en verde y la observabilidad no funciona. El sintoma es un stream
  del contenedor `api` con la etiqueta `container` y nada mas.
- La comprobacion mira una **ventana**, no todo el historico: streams sin
  `service` de hace dias no producen fallos permanentes, y despues de arreglar la
  causa sigue en rojo hasta que la ventana deja de abarcar las lineas viejas
  (`--window 2` acorta la espera). Sin trafico en la ventana es `INFO`, no fallo.
  El banner exacto `$ tsx watch src/server.ts` se inspecciona y tolera; cualquier
  otra linea no estructurada de `api` sigue siendo fallo.
- Editar `rules.yaml` **exige recrear Grafana antes de correr esto**: el
  verificador lee el estado ya aplicado, asi que comprueba lo que esta corriendo,
  no lo que dice el archivo.

- En Grafana, la consulta base en Loki es
  `{service="sipeg-utp-backend", environment="production"}` y la busqueda por
  peticion es `{service="sipeg-utp-backend"} |= "<X-Request-ID>"`, o el filtro
  indexado `| requestId="<X-Request-ID>"` (structured metadata).
- `route`, `method`, `statusCode`, `durationMs`, `outcome` y `requestKind` son
  **structured metadata**, asi que se pueden filtrar y agrupar con
  `| route="/api/v1/careers"` y `sum by (method, route) (...)` sin `| json`.
  Ojo: structured metadata no va en el selector de stream
  (`{service="...", route="..."}` devuelve vacio); va siempre como filtro tras la
  llave, o se agrupa con `by`.
- `event` y `requestId` tambien son structured metadata. `| requestId="<uuid>"`
  devuelve **todas** las lineas de esa peticion (acceso, error y seguridad), que
  es como se correlaciona un 5xx con su causa. Para filtrar por expression,
  `| requestId=~"<regex>"`.
- `log_type` si es una etiqueta real (`access`, `application`, `security`,
  `infrastructure`) y va **dentro** del selector de stream. `logType` es el
  nombre del campo en el JSON y no se puede filtrar.
- Acceso al Docker socket mediante `docker-socket-proxy` de solo lectura, nunca
  montando `/var/run/docker.sock` directamente en Alloy. `POST=0` deja pasar solo
  `GET`/`HEAD`; `NETWORKS=1` es necesario porque Alloy lista redes para resolver
  los nombres de red de cada contenedor.
- `docker compose ... down` sobre el proyecto combinado tambien baja la aplicacion
  y borra sus volumenes: para retirar solo el stack de observabilidad, usa
  `docker compose -f compose.dev.yaml -f compose.observability.yaml rm -sf loki alloy grafana docker-socket-proxy`
  (o `stop`).

#### Grafana no encuentra sus archivos de provisioning (Docker Desktop sobre WSL2)

Sintoma: Loki y Alloy funcionan (`/loki/api/v1/labels` responde, hay streams de
`api` con `service` y `log_type`), pero en Grafana no hay datasource, no hay
paneles y las 5 alertas fallan cada minuto con
`failed to build query 'A': data source not found`. El contenedor de Grafana esta
en verde y su healthcheck pasa.

Causa: los cuatro bind mounts de provisioning de Grafana
(`provisioning/datasources`, `provisioning/dashboards`, `provisioning/alerting` y
`/etc/grafana/dashboards`) quedaron vacios dentro del contenedor. Docker Desktop
los expone a la VM mediante un shim en
`/run/desktop/mnt/host/wsl/docker-desktop-bind-mounts/<distro>/<hash>`, y ese shim
puede dejar de resolver contra la distro de WSL despues de un reinicio de WSL o
del propio Docker Desktop. Grafana arranca igual, lee directorios vacios y no
provisiona nada, sin decir nada en los logs.

Diagnostico:

```bash
docker inspect sipeg-utp-dev-grafana-1 --format '{{range .Mounts}}{{.Source}} -> {{.Destination}}{{println}}{{end}}'
```

Un `Source` bajo `/run/desktop/mnt/host/wsl/` y un `ls` vacio del destino dentro
del contenedor confirman el fallo. Los montajes de `loki`, `alloy` y `api`
pueden no estar afectados, asi que el stack puede verse sano a medias.

Remedio: **recrear** el contenedor, no reiniciarlo. `restart` reestablece el
mismo shim roto y vuelve a dejar los directorios vacios.

```bash
docker compose -f compose.dev.yaml -f compose.observability.yaml up -d --force-recreate grafana
```

Comprobar que los archivos llegaron y que el provisioning corrio:

```bash
docker compose -f compose.dev.yaml -f compose.observability.yaml exec grafana ls -l /etc/grafana/provisioning/datasources
docker compose -f compose.dev.yaml -f compose.observability.yaml logs grafana | grep 'provision'
```

Deben aparecer `inserting datasource from configuration name=Loki uid=loki`,
`finished to provision alerting` y `finished to provision dashboards`. Si ya
existia en la base de Grafana un datasource con la URL vacia, creado desde la UI,
`prune: true` no lo borra (solo limpia los que vienen de un archivo): se borra a
mano con `DELETE /api/datasources/uid/<uid>` o se queda como datasource por
defecto y Explore no muestra nada. Las alertas tardan un ciclo de `1m` en dejar de
mostrar `health=error` de la ultima evaluacion fallida.

- El banner `$ tsx watch src/server.ts` de desarrollo tambien llega sin
  `service`, porque lo escribe `tsx` y no la aplicacion; `observability:check`
  tolera solo esa linea exacta y sigue fallando ante cualquier otra. El logger interno de
  Better Auth esta silenciado a proposito (`logger: { disabled: true }` en
  `src/lib/auth.ts`) por lo mismo: escribia texto plano por stdout y sus lineas
  caian en un stream sin `service` ni `log_type` que no se puede filtrar. El
  detalle de un login fallido lo emite la aplicacion con `auth.login.failed` y
  `logType="security"`.

### Auditoria

- `audit_events` es append-only: una trigger PostgreSQL rechaza `UPDATE`,
  `DELETE` y `TRUNCATE`; la aplicacion no puede borrar registros.
- El catalogo de acciones usa claves como `authorization.permission_granted`,
  `user.role_changed`, `event_program.archived` o `activity.cancelled`.
- Consulta de solo lectura para `ADMIN`: `GET /api/v1/audit-events` con filtros
  `action`, `actorId`, `resourceType`, `resourceId`, `scopeType`, `scopeId`,
  `from`, `to`, cursor y limite maximo 100. No existen endpoints de modificacion
  ni eliminacion.
- Los campos internos `grantedById`/`grantedAt` siguen sin exponerse en HTTP
  (ver `docs/adr/adr-0001-time-aware-collaboration-authorization.md`); la
  bitacora durable es la fuente de historial.
- Retencion ratificada: **365 dias** (ADR-0008, seccion _Retencion Y Purga_). Es
  una decision institucional, no un dato tecnico. La purga es **manual** con
  `pnpm run prisma:purge:audit` y queda registrada como `audit.purged` en la propia
  bitacora. No se automatiza: hacerlo con el rol de la aplicacion permitiria que un
  error de configuracion eliminara evidencia sin revision.

## Datos De Prueba (Seed)

`pnpm run prisma:seed` carga un conjunto completo e idempotente de datos de prueba
(re-ejecutable sin duplicar ni borrar nada):

- 6 facultades y 4 subdirecciones, cada una con su programa predeterminado y encargado.
- 25 carreras: 24 oficiales distribuidas por facultad más la carrera global `Otros` (sin unidad).
- 39 usuarios demo + 23 aulas con amenidades y disponibilidad.
- 8 programas adicionales (activos, completado, archivado y borrador) y 40 actividades con
  los 8 tipos del catálogo (`WORKSHOP`, `SEMINAR`, `TALK`, `CONFERENCE`, `PANEL`, `COURSE`,
  `COMPETITION`, `OTHER`), incluyendo variantes `DRAFT`, `CANCELLED` con motivo, sin aula,
  sin ponentes, sin cupo y con banner, además de colaboraciones con permisos materializados
  y ventanas de vigencia, asistencias, certificados, propuestas con versiones/feedback
  (incluye feedback con imagen) y alertas.

Credenciales demo (password unica `Sipeg2026*UTP`, configurable con `SEED_DEMO_PASSWORD`):

| Rol                           | Email                                                                                                                                                                                                      |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Administrador                 | `admin@utp.ac.pa`                                                                                                                                                                                          |
| Organizadores de facultad     | `organizador.fic@utp.ac.pa` ... `organizador.fcyt@utp.ac.pa`                                                                                                                                               |
| Organizadores de subdireccion | `organizador.sub-acad@utp.ac.pa` ... `organizador.sub-ipe@utp.ac.pa`                                                                                                                                       |
| Editor / visor                | `editor.eventos@utp.ac.pa`, `editor.fii@utp.ac.pa`, `visor.eventos@utp.ac.pa`                                                                                                                              |
| Ponentes                      | `ponente.ana.perez@utp.ac.pa`, `ponente.carlos.rivera@utp.ac.pa`, `ponente.diana.gomez@utp.ac.pa`, `ponente.ivan.morales@utp.ac.pa`, `ponente.lucia.herrera@utp.ac.pa`, `ponente.roberto.mendez@utp.ac.pa` |
| Estudiantes                   | `estudiante01@utp.ac.pa` ... `estudiante19@utp.ac.pa`                                                                                                                                                      |

Notas:

- Los correos y numeros de identificacion son sinteticos (`SEED-*`); no corresponden a personas reales.
- `estudiante19@utp.ac.pa` se siembra inactivo (`isActive: false`) para probar respuestas `401`/`403`.
- El seed aborta si `NODE_ENV=production` salvo que definas `SEED_ALLOW_PRODUCTION=true`.
- Re-ejecutarlo es seguro: usa upserts con IDs determinados `seed_*` y respeta los triggers de la base de datos.

## Datos Base De Produccion (Seed Base)

`pnpm run prisma:seed:base` carga unicamente la data institucional estable y es
seguro en produccion (no requiere `SEED_ALLOW_PRODUCTION`):

- Catalogo de permisos de autorizacion (20 claves `recurso:accion`).
- 10 unidades organizativas (6 facultades + 4 subdirecciones) con sus 10 programas
  de eventos predeterminados.
- 25 carreras: 24 oficiales más la carrera global `Otros` (sin unidad).
- 23 aulas con amenidades y ventanas de disponibilidad.
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
|   |-- alerts/
|   |-- audit/
|   |-- auth/
|   |-- authorization/
|   |-- careers/
|   |-- certificates/
|   |-- classrooms/
|   |-- event-programs/
|   |-- health/
|   |-- organizational-units/
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

Los archivos de ejemplo son `.env.example` para desarrollo y
`.env.prod.example` para produccion. Ninguno contiene secretos reales; `.env.prod`
se crea en el VPS, se mantiene fuera de Git y usa permisos `600`.

## Prisma

Prisma esta configurado para PostgreSQL. El cliente se crea de forma perezosa cuando algun modulo llama `getPrismaClient()`; si el modulo necesita persistencia y `DATABASE_URL` falta, la inicializacion falla.

`DATABASE_URL` es obligatoria para migraciones y operaciones reales de persistencia. `prisma.config.ts` usa un placeholder local solo para permitir `prisma validate` y `prisma generate` sin conectarse a una base de datos real.

Prisma genera el cliente en `src/generated/prisma`. Ese directorio esta ignorado por Git y debe regenerarse cuando cambie el schema.

```bash
pnpm run prisma:generate
```
