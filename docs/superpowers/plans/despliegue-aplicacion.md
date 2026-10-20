# Despliegue de la aplicación Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` (or `subagent-driven-development`) to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Confirm the private secrets, the initial ADMIN and the SMTP transport before executing the affected steps.

**Goal:** Publicar SIPEG UTP en `sipeg-utp.com` con el frontend en Cloudflare Workers, y la API y la observabilidad del VPS OVH expuestas por Cloudflare Tunnel.

**Architecture:** Cloudflare sirve el frontend y termina el HTTPS público. Un contenedor `cloudflared` mantiene la conexión saliente hacia Cloudflare y alcanza la API y Grafana por sus redes Docker; PostgreSQL, Loki, Alloy y el proxy del socket permanecen privados. Todo el backend se administra como un único proyecto Docker Compose.

**Tech Stack:** Cloudflare Workers, DNS, Tunnel y Access; OVH VPS (Ubuntu 24.04 LTS x86-64 como referencia); Docker Engine y Compose; React con Vite y pnpm; Node.js, Express, Prisma, PostgreSQL, Grafana, Loki, Alloy y SMTP.

---

## Configuración definitiva

| Dirección o servicio            | Destino                                             |
| ------------------------------- | --------------------------------------------------- |
| `https://sipeg-utp.com`         | Frontend en Workers Static Assets                   |
| `https://api.sipeg-utp.com`     | Tunnel → `http://api:3000`                          |
| `https://grafana.sipeg-utp.com` | Access → Tunnel → `http://grafana:3000`             |
| PostgreSQL                      | Red Docker `sipeg-utp-prod`, sin puertos publicados |
| Loki, Alloy y proxy del socket  | Red Docker `observability`, sin puertos públicos    |
| Mailpit                         | Solo desarrollo                                     |
| Correo de producción            | Brevo (plan gratuito) por SMTP con STARTTLS         |

API y frontend comparten el dominio registrable `sipeg-utp.com` aunque usen subdominios distintos, por lo que la cookie de refresco usa `SameSite=lax`.

```env
CORS_ORIGIN=https://sipeg-utp.com
AUTH_URL=https://api.sipeg-utp.com
AUTH_JWKS_URL=http://127.0.0.1:3000/api/auth/jwks
AUTH_REFRESH_COOKIE_SAME_SITE=lax
```

El frontend ya usa `credentials: "include"` y expone las rutas `/verify-email` y `/reset-password`.

### Datos aún pendientes (no bloquean las tareas de código)

- Secretos privados de `.env.prod` (se generan durante la ejecución).
- Credenciales del ADMIN inicial.
- Proveedor SMTP resuelto con Brevo y `MAIL_*` completado en `.env.prod`; queda probar la entrega real.

### Supuesto sobre el correo

Hoy solo existe Mailpit, que no entrega a destinatarios externos. La API **no arranca en producción** sin `MAIL_HOST` y `MAIL_FROM`. La tarea 6 resuelve el transporte real; hasta entonces, el despliegue de la API queda condicionado a ese dato. El resto del plan puede avanzar en paralelo.

---

## Archivos que se crearán o modificarán

| Archivo                                                     | Acción y responsabilidad                                                      |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `compose.cloudflare.yaml`                                   | Crear: conector `cloudflared` y ajustes públicos de Grafana                   |
| `compose.prod.yaml`                                         | Modificar: completar variables de API y seed; versionar imágenes de migración |
| `compose.dev.yaml`                                          | Modificar: completar variables configurables conservando los valores locales  |
| `compose.observability.yaml`                                | Revisar: sin cambios funcionales; actualizar el comentario de acceso público  |
| `docs/adr/adr-0007-structured-logging-and-observability.md` | Modificar: registrar la imagen fijada de `cloudflared` en el catálogo         |
| `.env.prod.example`                                         | Crear: plantilla de producción sin secretos                                   |
| `.env.prod`                                                 | Crear en el VPS: variables y secretos privados (ignorado por Git)             |
| `.env.example`                                              | Modificar: documentar variables y corregir la explicación de SameSite         |
| `.gitignore`                                                | Modificar: permitir versionar `.env.prod.example`                             |
| `src/config/env.ts`                                         | Modificar: normalizar variables opcionales vacías                             |
| `src/config/env.test.ts`                                    | Modificar: pruebas de la normalización                                        |
| `src/modules/health/health.controller.ts`                   | Modificar: limitar el tiempo de la consulta al JWKS                           |
| `src/modules/health/health.routes.test.ts`                  | Modificar: pruebas de la consulta exitosa y fallida                           |
| `src/app.test.ts`                                           | Modificar: prueba de caracterización de `trust proxy`                         |
| `src/modules/auth/auth.cookie.ts`                           | Modificar: corregir comentarios sobre SameSite                                |
| `README.md`, `CONTEXT.md`, `AGENTS.md`                      | Modificar: documentar la topología implementada                               |
| `docs/despliegue.md`                                        | Modificar: sustituir la decisión pendiente por la topología elegida           |
| `docs/adr/adr-0012-cloudflare-workers-tunnel-deployment.md` | Crear: registrar la decisión arquitectónica                                   |
| `docs/superpowers/plans/despliegue-aplicacion.md`           | Reemplazado por este plan                                                     |

Los cambios en `README.md` y `CONTEXT.md` deben integrarse con las modificaciones locales existentes; no revertirlas.

---

## Tarea 1: archivo de variables de producción

**Files:**

- Create: `.env.prod.example`
- Create (en el VPS, ignorado): `.env.prod`
- Modify: `.gitignore`, `.env.example`

- [x] **Step 1: Crear `.env.prod.example`**

Contenido completo. Los campos vacíos requieren valor real antes de desplegar, salvo los marcados como opcionales.

```dotenv
# Aplicacion
NODE_ENV=production
PORT=3000
IMAGE_TAG=2026-10-05-r1
APP_VERSION=2026-10-05-r1
DOCS_ENABLED=false

# PostgreSQL
# DATABASE_URL la construye Compose con el host `db`; no se define aqui.
POSTGRES_DB=sipeg_utp
POSTGRES_USER=sipeg
POSTGRES_PASSWORD=''

# Conexiones y ejecucion
DATABASE_POOL_MAX=9
DATABASE_POOL_CONNECTION_TIMEOUT_MS=5000
DATABASE_POOL_IDLE_TIMEOUT_MS=30000
UV_THREADPOOL_SIZE=4

# Origenes
CORS_ORIGIN=https://sipeg-utp.com
TRUSTED_ORIGINS=''

# Autenticacion
AUTH_SECRET=''
AUTH_URL=https://api.sipeg-utp.com
AUTH_ISSUER=https://api.sipeg-utp.com
AUTH_AUDIENCE=https://api.sipeg-utp.com
AUTH_TOKEN_TTL=15m
AUTH_REFRESH_TTL=7d
AUTH_REFRESH_COOKIE_SAME_SITE=lax

# Enlaces enviados por correo
AUTH_EMAIL_VERIFICATION_URL=https://sipeg-utp.com/verify-email
AUTH_PASSWORD_RESET_URL=https://sipeg-utp.com/reset-password
AUTH_EMAIL_VERIFICATION_TTL=24h
AUTH_PASSWORD_RESET_TTL=1h

# Argon2id: parametros actualmente usados por el codigo
AUTH_ARGON2_MEMORY_COST=12288
AUTH_ARGON2_TIME_COST=3
AUTH_ARGON2_PARALLELISM=1

# Logs
LOG_LEVEL=info
LOG_PRETTY=false
LOG_SERVICE_NAME=sipeg-utp-backend
LOG_PSEUDONYMIZATION_KEY=''

# Cloudflare Tunnel
CLOUDFLARE_TUNNEL_TOKEN=''

# Grafana
GRAFANA_PORT=3001
GRAFANA_ADMIN_USER=admin
GRAFANA_ADMIN_PASSWORD=''
GRAFANA_SECRET_KEY=''

# Loki: retencion de produccion
LOKI_CONFIG=config.yaml

# SMTP real de produccion (completar con el proveedor elegido)
MAIL_HOST=''
MAIL_PORT=587
MAIL_SECURE=false
MAIL_USER=''
MAIL_PASSWORD=''
MAIL_FROM='SIPEG UTP <no-reply@sipeg-utp.com>'

# ADMIN inicial: las tres primeras son obligatorias en una base sin ADMIN
SEED_ADMIN_EMAIL=''
SEED_ADMIN_PASSWORD=''
SEED_ADMIN_IDENTIFICATION_NUMBER=''
SEED_ADMIN_FIRST_NAME=Administrador
SEED_ADMIN_LAST_NAME=SIPEG
```

- [x] **Step 2: Documentar cada variable en el propio archivo**

El archivo debe llevar, junto a cada bloque, la instrucción de llenado. Reglas:

| Variable                                                 | Instrucción                                                                                                                                                                                                   |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                                               | Mantener `production`. Compose también lo fija en los servicios.                                                                                                                                              |
| `PORT`                                                   | Mantener `3000`: controla el puerto de loopback del host; el puerto interno de la API sigue siendo `3000`.                                                                                                    |
| `IMAGE_TAG`                                              | Identificador único de la versión desplegada. Actualizarlo en cada publicación; no reutilizar una etiqueta para código distinto.                                                                              |
| `APP_VERSION`                                            | Identificador de la versión visible en logs. Puede coincidir con `IMAGE_TAG`.                                                                                                                                 |
| `DOCS_ENABLED`                                           | Mantener `false`. Usar `true` solo para publicar OpenAPI/Scalar.                                                                                                                                              |
| `POSTGRES_DB`, `POSTGRES_USER`                           | Conservar una instalación nueva con `sipeg_utp`/`sipeg`. Si ya hay volumen, conservar los valores existentes.                                                                                                 |
| `POSTGRES_PASSWORD`                                      | Generar con `openssl rand -hex 32`. El hexadecimal evita problemas de codificación en la URL de Compose. Si el volumen ya existe, conservar la contraseña vigente: cambiarla aquí no la cambia en PostgreSQL. |
| `DATABASE_POOL_*`, `UV_THREADPOOL_SIZE`, `AUTH_ARGON2_*` | Valores actuales del proyecto (`9`, `5000`, `30000`, `4`, `12288`, `3`, `1`). Ajustar solo con criterio de recursos.                                                                                          |
| `CORS_ORIGIN`                                            | `https://sipeg-utp.com`, sin ruta ni barra final.                                                                                                                                                             |
| `TRUSTED_ORIGINS`                                        | Vacío en este despliegue. Si se autoriza otro origen, URL completa; varios separados por comas sin espacios.                                                                                                  |
| `AUTH_SECRET`                                            | Secreto independiente con `openssl rand -hex 32`. Estable entre despliegues.                                                                                                                                  |
| `AUTH_URL`, `AUTH_ISSUER`, `AUTH_AUDIENCE`               | `https://api.sipeg-utp.com`, sin sufijo `/api`. Los tres con el mismo valor.                                                                                                                                  |
| `AUTH_TOKEN_TTL`, `AUTH_REFRESH_TTL`                     | `15m` y `7d`.                                                                                                                                                                                                 |
| `AUTH_REFRESH_COOKIE_SAME_SITE`                          | `lax`: frontend y API comparten el sitio `sipeg-utp.com` por HTTPS. Workers no implica `none`.                                                                                                                |
| `AUTH_EMAIL_VERIFICATION_URL`, `AUTH_PASSWORD_RESET_URL` | Rutas del frontend; su origen debe coincidir con `CORS_ORIGIN`.                                                                                                                                               |
| `LOG_PSEUDONYMIZATION_KEY`                               | Secreto independiente con `openssl rand -hex 32`. Estable para conservar la correlación de pseudónimos.                                                                                                       |
| `CLOUDFLARE_TUNNEL_TOKEN`                                | Token completo del túnel `sipeg-produccion`. Solo en `.env.prod`.                                                                                                                                             |
| `GRAFANA_ADMIN_USER`, `GRAFANA_ADMIN_PASSWORD`           | Usuario administrativo y contraseña independiente. La contraseña solo se aplica al inicializar un volumen vacío de Grafana.                                                                                   |
| `GRAFANA_SECRET_KEY`                                     | `openssl rand -hex 32`. Estable entre reinicios.                                                                                                                                                              |
| `LOKI_CONFIG`                                            | `config.yaml` (retención de producción).                                                                                                                                                                      |
| `MAIL_HOST`                                              | Host SMTP del proveedor, sin esquema ni puerto.                                                                                                                                                               |
| `MAIL_PORT`, `MAIL_SECURE`                               | `587` + `false` para STARTTLS; `465` + `true` para TLS implícito. Confirmar con el proveedor.                                                                                                                 |
| `MAIL_USER`, `MAIL_PASSWORD`                             | Credenciales SMTP; se configuran juntas.                                                                                                                                                                      |
| `MAIL_FROM`                                              | Remitente autorizado. Usar el propuesto solo tras verificar el dominio y autorizar ese remitente.                                                                                                             |
| `SEED_ADMIN_EMAIL`                                       | Correo real del administrador inicial.                                                                                                                                                                        |
| `SEED_ADMIN_PASSWORD`                                    | **12–20 caracteres**. `openssl rand -hex 10` genera 20.                                                                                                                                                       |
| `SEED_ADMIN_IDENTIFICATION_NUMBER`                       | Identificación real y única.                                                                                                                                                                                  |
| `SEED_ADMIN_FIRST_NAME`, `SEED_ADMIN_LAST_NAME`          | Nombre y apellido, o los valores propuestos.                                                                                                                                                                  |

Después de confirmar que el ADMIN existe, retirar la contraseña de bootstrap y dejar vacías las tres variables iniciales; el seed conservará el ADMIN existente.

- [x] **Step 3: Permitir versionar la plantilla de producción**

En `.gitignore`, tras la línea `!.env.example`, agregar:

```gitignore
!.env.prod.example
```

`.env` y `.env.*` siguen ignorados. `.dockerignore` ya excluye `.env.*`; no requiere cambios.

- [x] **Step 4: Corregir `.env.example`**

Reemplazar el comentario de `AUTH_REFRESH_COOKIE_SAME_SITE` para no asociar Cloudflare Workers con `none`:

```env
# Donde se sirve el frontend respecto de la API. Determina el atributo SameSite de
# la cookie HttpOnly que lleva el refresh token.
#   lax    -> API y frontend comparten dominio registrable (api.sipeg-utp.com y
#             sipeg-utp.com, o ambos en localhost). Es el valor por defecto fuera
#             de produccion.
#   none   -> el frontend esta en OTRO dominio registrable (otro sitio), no solo
#             otro subdominio. Exige HTTPS y validar el Origin en el servidor.
# Un frontend en Cloudflare Workers bajo el mismo dominio registrable usa lax.
```

Agregar asimismo, en la sección de desarrollo, la variable del conector (comentada y sin valor real):

```env
# Cloudflare Tunnel, requerido al usar compose.cloudflare.yaml.
# CLOUDFLARE_TUNNEL_TOKEN=""
```

- [x] **Step 5: Crear el archivo privado en el VPS**

```bash
cp .env.prod.example .env.prod
chmod 600 .env.prod
```

- [x] **Step 6: Generar secretos y completar campos**

Ejecutar cuatro veces y asignar cada resultado a una variable distinta:

```bash
openssl rand -hex 32
```

Cubren `POSTGRES_PASSWORD`, `AUTH_SECRET`, `LOG_PSEUDONYMIZATION_KEY` y `GRAFANA_SECRET_KEY`. Generar aparte la contraseña de Grafana y la del ADMIN.

- [x] **Step 7: Verificación**

```bash
git check-ignore .env.prod
git status --short
```

Esperado: `git check-ignore` imprime `.env.prod`; el archivo no aparece en `git status`. `.env.prod.example` sí queda visible.

---

## Tarea 2: ajustes de código en la API

### 2.1 Normalizar variables opcionales vacías

**Files:** Modify `src/config/env.ts`, `src/config/env.test.ts`.

Contexto: `AUTH_ISSUER`, `AUTH_AUDIENCE` y `TRUSTED_ORIGINS` rechazaban `''`, pero las plantillas de entorno y las interpolaciones de Compose pueden entregarlas vacías. Deben comportarse como ausentes.

- [x] **Step 1: Escribir la prueba que falla**

En `src/config/env.test.ts` agregar:

```ts
describe('env optional empty strings', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  const stubBase = (): void => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('AUTH_SECRET', 'a'.repeat(32));
    vi.stubEnv('CORS_ORIGIN', 'http://localhost:5173');
    vi.stubEnv('AUTH_PASSWORD_RESET_URL', 'http://localhost:5173/reset-password');
  };

  it('treats empty AUTH_ISSUER, AUTH_AUDIENCE and TRUSTED_ORIGINS as undefined', async () => {
    stubBase();
    vi.stubEnv('AUTH_ISSUER', '');
    vi.stubEnv('AUTH_AUDIENCE', '');
    vi.stubEnv('TRUSTED_ORIGINS', '');

    const { env } = await importEnv();

    expect(env.AUTH_ISSUER).toBeUndefined();
    expect(env.AUTH_AUDIENCE).toBeUndefined();
    expect(env.TRUSTED_ORIGINS).toBeUndefined();
  });
});
```

- [x] **Step 2: Verificar que falla**

Run: `pnpm exec vitest run src/config/env.test.ts -t "optional empty strings"`
Expected: FAIL con `Invalid environment configuration`.

- [x] **Step 3: Aplicar la normalización**

En `src/config/env.ts` reemplazar por el preprocesador existente:

```ts
    AUTH_ISSUER: optionalNonEmptyString,
    AUTH_AUDIENCE: optionalNonEmptyString,
```

y

```ts
    TRUSTED_ORIGINS: optionalNonEmptyString,
```

- [x] **Step 4: Verificar que pasa**

Run: `pnpm exec vitest run src/config/env.test.ts`
Expected: PASS.

### 2.2 Limitar el tiempo de la consulta al JWKS

**Files:** Modify `src/modules/health/health.controller.ts`, `src/modules/health/health.routes.test.ts`.

Contexto: la consulta a `/api/auth/jwks` no tenía timeout; durante el arranque podía colgar el health check. El límite debe ser menor que los 5 s del `HEALTHCHECK` de Docker.

- [x] **Step 1: Escribir la prueba que falla**

En `src/modules/health/health.routes.test.ts`, añadir al `afterEach` existente:

```ts
vi.unstubAllGlobals();
```

y agregar el caso:

```ts
it('reports authJwksReachable false and probes with a 3-second timeout when JWKS is unreachable', async () => {
  process.env['NODE_ENV'] = 'test';
  process.env['AUTH_SECRET'] = 'a'.repeat(32);
  process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test';
  process.env['AUTH_URL'] = 'http://localhost:3000';
  vi.resetModules();
  vi.doMock('../../lib/auth.js', () => ({
    auth: {
      options: { baseURL: 'http://localhost:3000' },
      api: {
        signInEmail: vi.fn(),
        signUpEmail: vi.fn(),
        getToken: vi.fn(),
        getSession: vi.fn(),
        signOut: vi.fn(),
        verifyEmail: vi.fn(),
        requestPasswordReset: vi.fn(),
        resetPassword: vi.fn(),
      },
    },
  }));
  vi.doMock('../../config/prisma.js', () => ({ getPrismaClient: () => ({}) }));
  const timeoutSpy = vi.spyOn(AbortSignal, 'timeout');
  const fetchMock = vi.fn().mockRejectedValue(new Error('aborted'));
  vi.stubGlobal('fetch', fetchMock);

  const { app } = await import('../../app.js');
  const response = await request(app).get('/api/v1/health').expect(200);

  expect(response.body.data.authJwksReachable).toBe(false);
  expect(fetchMock).toHaveBeenCalledWith(
    'http://localhost:3000/api/auth/jwks',
    expect.objectContaining({ signal: expect.any(AbortSignal) }),
  );
  expect(timeoutSpy).toHaveBeenCalledWith(3_000);
});
```

- [x] **Step 2: Verificar que falla**

Run: `pnpm exec vitest run src/modules/health/health.routes.test.ts`
Expected: FAIL porque `fetch` se llamó sin opciones.

- [x] **Step 3: Añadir el timeout**

En `src/modules/health/health.controller.ts`:

```ts
const checkJwks = async (): Promise<boolean> => {
  try {
    const url = new URL('/api/auth/jwks', env.AUTH_URL).toString();
    const response = await fetch(url, { signal: AbortSignal.timeout(3_000) });
    return response.ok;
  } catch {
    return false;
  }
};
```

- [x] **Step 4: Verificar que pasa**

Run: `pnpm exec vitest run src/modules/health/health.routes.test.ts src/app.test.ts`
Expected: PASS. El contrato OpenAPI no cambia (`pnpm run docs:check` debe seguir en verde).

### 2.3 Caracterizar `trust proxy`

**Files:** Modify `src/app.test.ts`.

Contexto: `trust proxy = 1` confía en el salto del socket (`cloudflared`) y toma de `X-Forwarded-For` la dirección más a la derecha. Cloudflare escribe o añade al final la IP de quien se conecta a su frontera (cliente o proxy previo), no la IP del edge de Cloudflare. Se mantiene el valor numérico `1` para esta topología. La verificación real de la cadena y de la agrupación por IP se hace contra la API pública (tarea 9).

- [x] **Step 1: Agregar la prueba**

En `src/app.test.ts`, dentro de `describe('security middleware', ...)`:

```ts
it('trusts exactly one proxy hop so req.ip uses X-Forwarded-For', async () => {
  const { app } = await loadApp();

  expect(app.get('trust proxy')).toBe(1);
});
```

- [x] **Step 2: Verificar**

Run: `pnpm exec vitest run src/app.test.ts`
Expected: PASS.

- [x] **Step 3: Corregir documentación derivada**

En `docs/despliegue.md` y `README.md`, ajustar la afirmación de que cualquier segundo proxy rompe necesariamente el rate limiting: lo que importa es que la IP seleccionada de `X-Forwarded-For` esté controlada por la frontera confiable y represente al cliente esperado.

---

## Tarea 3: completar `compose.prod.yaml`

**File:** Modify `compose.prod.yaml`.

- [x] **Step 1: Completar el bloque `environment` de `api`**

Reemplazar por la lista siguiente, conservando `DATABASE_URL`, puertos, `depends_on`, `restart`, `logging` y `security_opt` existentes:

```yaml
environment:
  NODE_ENV: production
  PORT: 3000
  DATABASE_URL: postgresql://${POSTGRES_USER:?POSTGRES_USER is required}:${POSTGRES_PASSWORD:?POSTGRES_PASSWORD is required}@db:5432/${POSTGRES_DB:?POSTGRES_DB is required}?schema=public
  DATABASE_POOL_MAX: ${DATABASE_POOL_MAX:-9}
  DATABASE_POOL_CONNECTION_TIMEOUT_MS: ${DATABASE_POOL_CONNECTION_TIMEOUT_MS:-5000}
  DATABASE_POOL_IDLE_TIMEOUT_MS: ${DATABASE_POOL_IDLE_TIMEOUT_MS:-30000}
  UV_THREADPOOL_SIZE: ${UV_THREADPOOL_SIZE:-4}
  CORS_ORIGIN: ${CORS_ORIGIN:?CORS_ORIGIN is required}
  TRUSTED_ORIGINS: ${TRUSTED_ORIGINS:-}
  AUTH_SECRET: ${AUTH_SECRET:?AUTH_SECRET is required}
  AUTH_URL: ${AUTH_URL:?AUTH_URL is required}
  AUTH_ISSUER: ${AUTH_ISSUER:-${AUTH_URL}}
  AUTH_AUDIENCE: ${AUTH_AUDIENCE:-${AUTH_URL}}
  AUTH_TOKEN_TTL: ${AUTH_TOKEN_TTL:-15m}
  AUTH_REFRESH_TTL: ${AUTH_REFRESH_TTL:-7d}
  AUTH_REFRESH_COOKIE_SAME_SITE: '${AUTH_REFRESH_COOKIE_SAME_SITE:?Set it in production. Use lax or strict when the API and the frontend share a site, and none when they are on different sites.}'
  AUTH_EMAIL_VERIFICATION_URL: ${AUTH_EMAIL_VERIFICATION_URL:?AUTH_EMAIL_VERIFICATION_URL is required}
  AUTH_PASSWORD_RESET_URL: ${AUTH_PASSWORD_RESET_URL:?AUTH_PASSWORD_RESET_URL is required}
  AUTH_EMAIL_VERIFICATION_TTL: ${AUTH_EMAIL_VERIFICATION_TTL:-24h}
  AUTH_PASSWORD_RESET_TTL: ${AUTH_PASSWORD_RESET_TTL:-1h}
  AUTH_ARGON2_MEMORY_COST: ${AUTH_ARGON2_MEMORY_COST:-12288}
  AUTH_ARGON2_TIME_COST: ${AUTH_ARGON2_TIME_COST:-3}
  AUTH_ARGON2_PARALLELISM: ${AUTH_ARGON2_PARALLELISM:-1}
  MAIL_HOST: ${MAIL_HOST:?MAIL_HOST is required}
  MAIL_PORT: ${MAIL_PORT:-587}
  MAIL_SECURE: ${MAIL_SECURE:-false}
  MAIL_USER: ${MAIL_USER:-}
  MAIL_PASSWORD: ${MAIL_PASSWORD:-}
  MAIL_FROM: ${MAIL_FROM:?MAIL_FROM is required}
  DOCS_ENABLED: '${DOCS_ENABLED:-false}'
  LOG_LEVEL: ${LOG_LEVEL:-info}
  LOG_PRETTY: 'false'
  LOG_SERVICE_NAME: ${LOG_SERVICE_NAME:-sipeg-utp-backend}
  APP_VERSION: ${APP_VERSION:-1.0.0}
  LOG_PSEUDONYMIZATION_KEY: ${LOG_PSEUDONYMIZATION_KEY:?LOG_PSEUDONYMIZATION_KEY is required}
```

- [x] **Step 2: Pasar Argon2 al seed**

En el bloque `seed.environment`, tras `SEED_ADMIN_LAST_NAME`, agregar:

```yaml
AUTH_ARGON2_MEMORY_COST: ${AUTH_ARGON2_MEMORY_COST:-12288}
AUTH_ARGON2_TIME_COST: ${AUTH_ARGON2_TIME_COST:-3}
AUTH_ARGON2_PARALLELISM: ${AUTH_ARGON2_PARALLELISM:-1}
```

- [x] **Step 3: Versionar la imagen compartida**

Cambiar en `migrate` y en `seed`:

```yaml
image: sipeg-utp-backend:migrate-${IMAGE_TAG:?IMAGE_TAG is required}
```

- [x] **Step 4: Actualizar comentarios**

Reemplazar el comentario de `api.ports` que menciona un "proxy TLS del host": el cliente público previsto es Cloudflare Tunnel (`cloudflared`), que llega a `api:3000` por la red `sipeg-utp-prod` sin usar el puerto de loopback; ese bind queda para comprobaciones desde el host.

- [x] **Step 5: Validar**

El comando directo contra `.env.prod.example` falla con razón: los secretos y `MAIL_HOST` siguen vacíos porque dependen de las tareas 6-8. Para validar la interpolación sin guardar secretos en archivos, inyectar valores ficticios solo en el proceso:

```bash
POSTGRES_PASSWORD=validation-only \
AUTH_SECRET=validation-only-not-for-production \
LOG_PSEUDONYMIZATION_KEY=validation-only-not-for-production \
MAIL_HOST=smtp.example.invalid \
docker compose -f compose.prod.yaml --env-file .env.prod.example config --quiet
```

Expected: código `0`. Ajustar únicamente variables obligatorias ausentes; no imprimir secretos.

---

## Tarea 4: revisar `compose.dev.yaml`

**File:** Modify `compose.dev.yaml`.

- [x] **Step 1: Completar variables configurables de `api.environment`**

Agregar tras las variables de auth existentes:

```yaml
AUTH_ISSUER: ${AUTH_ISSUER:-${AUTH_URL:-http://localhost:3000}}
AUTH_AUDIENCE: ${AUTH_AUDIENCE:-${AUTH_URL:-http://localhost:3000}}
AUTH_TOKEN_TTL: ${AUTH_TOKEN_TTL:-15m}
AUTH_REFRESH_COOKIE_SAME_SITE: ${AUTH_REFRESH_COOKIE_SAME_SITE:-lax}
TRUSTED_ORIGINS: ${TRUSTED_ORIGINS:-}
DOCS_ENABLED: '${DOCS_ENABLED:-true}'
AUTH_ARGON2_MEMORY_COST: ${AUTH_ARGON2_MEMORY_COST:-12288}
AUTH_ARGON2_TIME_COST: ${AUTH_ARGON2_TIME_COST:-3}
AUTH_ARGON2_PARALLELISM: ${AUTH_ARGON2_PARALLELISM:-1}
```

- [x] **Step 2: Conservar los valores locales**

No cambiar `MAIL_HOST: mailpit`, `MAIL_PORT: 1025`, `MAIL_SECURE: 'false'`, el bind `127.0.0.1:${PORT:-3000}` ni el volumen de `postgres`.

- [x] **Step 3: Corregir comentario de acceso local**

En el comentario de `api.ports`, sustituir "proxy TLS del host" por el escenario de desarrollo (`http://localhost:3000` desde el navegador).

- [x] **Step 4: Verificar que desarrollo sigue funcionando**

La plantilla deja `AUTH_SECRET` vacio y `LOG_PSEUDONYMIZATION_KEY` sin definir. Validarla con valores ficticios solo en el proceso; para levantar el stack, usar el `.env` local con sus secretos existentes.

Run:

```bash
AUTH_SECRET=validation-only-not-for-production \
LOG_PSEUDONYMIZATION_KEY=validation-only-not-for-production \
docker compose -f compose.dev.yaml --env-file .env.example config --quiet
docker compose -f compose.dev.yaml config --quiet
docker compose -f compose.dev.yaml up -d --build
docker compose -f compose.dev.yaml ps
pnpm run api:run:smoke
```

Expected: ambos `config` en `0`; `api` en ejecucion, `db` y `mailpit` saludables; health `200` con `authJwksReachable: true`; registro y recuperación capturados en Mailpit (`http://127.0.0.1:8025`). La imagen `dev` no declara `HEALTHCHECK`: la disponibilidad de la API se comprueba por HTTP. Detener después si no se necesita:

```bash
docker compose -f compose.dev.yaml down
```

---

## Tarea 5: crear `compose.cloudflare.yaml`

**Files:** Create `compose.cloudflare.yaml`; Modify `compose.observability.yaml`, `docs/adr/adr-0007-structured-logging-and-observability.md`.

- [x] **Step 1: Crear el overlay**

```yaml
services:
  cloudflared:
    image: cloudflare/cloudflared:2026.9.3@sha256:072c067d25ccbe61d46e18f0d0723255f2bb5304f7317caa95b27031520ff92c
    command: ['tunnel', '--no-autoupdate', 'run']
    environment:
      TUNNEL_TOKEN: ${CLOUDFLARE_TUNNEL_TOKEN:?CLOUDFLARE_TUNNEL_TOKEN is required}
    restart: unless-stopped
    logging:
      driver: local
      options:
        max-size: '20m'
        max-file: '5'
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    networks:
      - sipeg-utp-prod
      - observability

  grafana:
    environment:
      GF_SERVER_DOMAIN: grafana.sipeg-utp.com
      GF_SERVER_ROOT_URL: https://grafana.sipeg-utp.com/
      GF_SERVER_PROTOCOL: http
      GF_SECURITY_COOKIE_SECURE: 'true'
```

Notas:

- Las redes `sipeg-utp-prod` y `observability` las declaran los overlays base; no se redefinen aquí.
- El conector no publica puertos y arranca independientemente de la API. Con la corrección de JWKS interno, el health y el verificador no dependen del túnel; la ruta pública se comprueba externamente.
- `GF_SERVER_*` se aplica solo a Grafana y no afecta a desarrollo.
- Registrar la imagen en el catálogo del ADR-0007 y actualizar el comentario de acceso público de Grafana y el comando de producción en `compose.observability.yaml`.

- [x] **Step 2: Verificar tag y digest**

Run:

```bash
docker buildx imagetools inspect cloudflare/cloudflared:2026.9.3@sha256:072c067d25ccbe61d46e18f0d0723255f2bb5304f7317caa95b27031520ff92c
docker buildx imagetools inspect cloudflare/cloudflared:2026.9.3
```

Expected: imprime el manifiesto y el tag coincide con el digest fijado. Si la referencia no existe, elegir una versión publicada y fijar tag y digest conjuntamente (política del ADR-0007).

- [x] **Step 3: Verificación de formato**

Run:

```bash
pnpm exec prettier compose.cloudflare.yaml compose.observability.yaml docs/adr/adr-0007-structured-logging-and-observability.md --check
```

Expected: sin diferencias.

- [x] **Step 4: Verificar la configuración combinada**

Usar únicamente valores ficticios en el proceso para los campos obligatorios vacíos de la plantilla:

```bash
POSTGRES_PASSWORD=validation-only \
AUTH_SECRET=validation-only-not-for-production \
LOG_PSEUDONYMIZATION_KEY=validation-only-not-for-production \
MAIL_HOST=smtp.example.invalid \
GRAFANA_ADMIN_PASSWORD=validation-only \
GRAFANA_SECRET_KEY=validation-only-not-for-production \
CLOUDFLARE_TUNNEL_TOKEN=validation-only \
docker compose -f compose.prod.yaml -f compose.observability.yaml -f compose.cloudflare.yaml --env-file .env.prod.example config --quiet
```

Expected: código `0`. Comprobar también la configuración resuelta sin imprimir secretos: redes, comando y restricciones del conector; fusión de las cuatro variables públicas de Grafana; rechazo del token vacío. La conexión real del túnel se verifica en las tareas 7 y 8.

---

## Tarea 6: resolver el correo de producción

**Files:** Modify `.env.prod` (privado). Documentar en `README.md`.

- [x] **Step 1: Comprobar la restricción de red**

Confirmar que el VPS puede abrir conexiones SMTP salientes al proveedor elegido. Los VPS OVH en **Local Zone** bloquean todo el SMTP saliente. Si aplica, resolver el transporte (proveedor por HTTPS/API o VPS en centro de datos normal) antes de continuar.

- [x] **Step 2: Elegir y verificar el proveedor**

Obtener host, puerto, modalidad TLS y credenciales; verificar `sipeg-utp.com`; publicar los registros SPF y DKIM indicados por el proveedor y una política DMARC inicial (`v=DMARC1; p=none`).

- [x] **Step 3: Completar `MAIL_*`**

Editar `.env.prod`:

```env
MAIL_HOST=HOST_SMTP_REAL
MAIL_PORT=587
MAIL_SECURE=false
MAIL_USER=USUARIO_SMTP_REAL
MAIL_PASSWORD=CONTRASENA_SMTP_REAL
MAIL_FROM='SIPEG UTP <no-reply@sipeg-utp.com>'
```

- [x] **Step 4: Probar la entrega real**

Con la API en ejecución (tarea 8), registrar una cuenta de prueba con un buzón externo y confirmar la recepción del correo de verificación. Un mensaje visible solo en Mailpit no prueba la entrega.

- [ ] **Step 5: Alertas de Grafana (opcional en esta fase)**

Configurar el SMTP de Grafana y un contact point Email; enviar una notificación de prueba. El túnel web no transporta SMTP.

### Progreso de la tarea 6 (2026-10-10)

Realizado hasta ahora:

- **Step 1 completado.** El VPS está en la región **Beauharnois (BHS)**, no en una Local Zone. Desde ahí, `openssl s_client -starttls smtp` contra `smtp-relay.brevo.com:587` estableció TLS 1.3 y el certificado validó con `Verified peername: smtp-relay.brevo.com`. Las conexiones SMTP salientes funcionan.
- **Step 2 completado.** Proveedor elegido: **Brevo (plan gratuito)**, host `smtp-relay.brevo.com`, puerto `587` con STARTTLS (`MAIL_SECURE=false`). Dominio `sipeg-utp.com` autenticado; publicados en Cloudflare los registros de validación de Brevo (código TXT, DKIM y DMARC `v=DMARC1; p=none; rua=mailto:rua@dmarc.brevo.com`), más los CNAME de marca de enlaces e imágenes. Remitente `SIPEG UTP <no-reply@sipeg-utp.com>` autorizado. Clave SMTP generada; la IP pública del VPS quedó autorizada en Brevo.
- **Step 3 completado.** `.env.prod` contiene `MAIL_HOST`, `MAIL_PORT=587`, `MAIL_SECURE=false`, `MAIL_USER`, `MAIL_PASSWORD` y `MAIL_FROM` sin campos vacíos. Se verificó su presencia sin imprimir la clave.
- **Step 4 completado.** Registro con un buzón externo, recepción real del correo de verificación por Brevo y verificación de email; confirmado en la tarea 9.

Pendiente:

- **Step 5:** SMTP de Grafana, opcional y atado al plan `2026-10-07-endurecimiento-vps.md`. No se ejecutó en este despliegue.

---

## Tarea 7: configurar Cloudflare

**Ubicación:** panel de Cloudflare.

### Workers (frontend)

- [x] **Step 1: Variable de build**

En el proyecto `sipeg-utp-frontend`: **Settings → Build → Build variables and secrets**, definir:

```env
VITE_API_BASE_URL=https://api.sipeg-utp.com
```

- [x] **Step 2: Confirmar build y deploy**

| Ajuste         | Valor                       |
| -------------- | --------------------------- |
| Build command  | `pnpm run build`            |
| Deploy command | `pnpm exec wrangler deploy` |

- [x] **Step 3: Dominio y redeploy**

Asociar `sipeg-utp.com` como dominio personalizado del Worker, lanzar un build nuevo y verificar la carga directa y la recarga de `/verify-email` y `/reset-password`.

### Tunnel y Access

- [x] **Step 4: Aplicación Access**

Crear una aplicación self-hosted para `grafana.sipeg-utp.com`, con política **Allow** limitada a los correos administradores. Anotar Team Name y Application AUD.

- [x] **Step 5: Rutas publicadas**

En `Networking → Tunnels → sipeg-produccion → Routes`:

| Hostname                | Tipo | Service URL           | Path  |
| ----------------------- | ---- | --------------------- | ----- |
| `api.sipeg-utp.com`     | HTTP | `http://api:3000`     | Vacío |
| `grafana.sipeg-utp.com` | HTTP | `http://grafana:3000` | Vacío |

Path vacío incluye `/api/v1/*` y `/api/auth/jwks`. Activar **Protect with Access** solo en Grafana.

- [x] **Step 6: DNS y caché**

Confirmar los CNAME `api` y `grafana` hacia `<UUID>.cfargotunnel.com` con proxy activado; verificar certificados y **Always Use HTTPS**; crear una regla **Bypass cache** para ambos hostnames:

```text
(http.host eq "api.sipeg-utp.com") or (http.host eq "grafana.sipeg-utp.com")
```

Mantener Access y los desafíos interactivos fuera del tráfico normal de la API, incluido su JWKS.

### Progreso de la tarea 7 (2026-10-10)

Realizado:

- **Steps 1-3 completados.** Proyecto `sipeg-utp-frontend` con `VITE_API_BASE_URL=https://api.sipeg-utp.com`, build `pnpm run build`, deploy `pnpm exec wrangler deploy` y `sipeg-utp.com` asociado como dominio personalizado del Worker.
- **Step 4 completado.** Aplicación Access self-hosted para `grafana.sipeg-utp.com` con política **Allow** limitada a correos administradores. Team name: `sipeg`.
- **Step 5 completado.** Rutas publicadas `api.sipeg-utp.com` → `http://api:3000` y `grafana.sipeg-utp.com` → `http://grafana:3000`, con `Protect with Access` activo solo en Grafana. El AUD debe confirmarse con Enter para que quede como etiqueta; sin esa confirmación el panel rechaza el guardado.
- **Step 6 completado.** DNS de `api` y `grafana` resuelve a IPs de Cloudflare, con proxy activo. **Always Use HTTPS** activo en la zona. Regla de caché `Bypass cache - API y Grafana` desplegada con la expresión de los dos hostnames; el formulario no mostraba «Place at» y el orden se gestiona en la lista de reglas.

Verificaciones realizadas:

- `http://api.sipeg-utp.com` y `http://grafana.sipeg-utp.com` responden `301` hacia HTTPS.
- Certificado TLS válido en ambos: `CN=sipeg-utp.com`, SAN `*.sipeg-utp.com`, emitido por Google Trust Services.
- `https://grafana.sipeg-utp.com` responde `302` hacia `https://sipeg.cloudflareaccess.com/cdn-cgi/access/login/...`, lo que confirma la aplicación Access y el team name.
- `https://api.sipeg-utp.com` responde `530` sin redirección a Access. Es el error esperado mientras el conector no corre en el VPS y confirma que la API no está detrás de Access.

Pendiente para la tarea 8:

- Confirmar `200` en `/api/v1/health` y `/api/auth/jwks`.
- Confirmar `cf-cache-status: BYPASS` o `DYNAMIC` en las respuestas de API y Grafana.
- Probar en navegador que un correo autorizado entra y uno no autorizado queda bloqueado por Access.

---

## Tarea 8: desplegar y consolidar el conector en el VPS

**Ubicación:** directorio del backend en el VPS.

- [x] **Step 1: Preparar el directorio**

Confirmar la revisión a desplegar, respaldar PostgreSQL si ya hay datos y verificar que Docker arranca al boot:

```bash
sudo systemctl is-enabled docker
```

Si no está habilitado:

```bash
sudo systemctl enable --now docker
```

- [x] **Step 2: Diagnosticar el contenedor que reaparece**

```bash
sudo docker ps -a --format 'table {{.ID}}\t{{.Image}}\t{{.Status}}\t{{.Names}}'
sudo docker compose ls
```

Para cada conector identificado:

```bash
sudo docker inspect ID_DEL_CONTENEDOR \
  --format 'restart={{.HostConfig.RestartPolicy.Name}} labels={{json .Config.Labels}}'
```

Aclaración: una política de reinicio reinicia el **mismo** contenedor y no crea uno nuevo al eliminarlo. Si aparece otro ID, es otra ejecución (por ejemplo, varios `docker run` acumulados) o un supervisor que lo recrea; si los labels muestran `com.docker.compose.project`, se recrea desde Compose y debe bajarse con `docker compose ... down`.

- [x] **Step 3: Retirar los conectores manuales**

```bash
sudo docker rm -f $(sudo docker ps -aq --filter ancestor=cloudflare/cloudflared:latest)
```

Si existe un servicio de host, desactivarlo para no duplicar conectores:

```bash
sudo systemctl disable --now cloudflared
```

- [x] **Step 4: Validar la configuración**

```bash
sudo docker compose \
  -f compose.prod.yaml \
  -f compose.observability.yaml \
  -f compose.cloudflare.yaml \
  --env-file .env.prod \
  config --quiet
```

Expected: código `0`, sin imprimir secretos.

- [x] **Step 5: Construir y levantar**

```bash
sudo docker compose \
  -f compose.prod.yaml \
  -f compose.observability.yaml \
  -f compose.cloudflare.yaml \
  --env-file .env.prod \
  up -d --build
```

- [x] **Step 6: Revisar servicios**

```bash
sudo docker compose \
  -f compose.prod.yaml \
  -f compose.observability.yaml \
  -f compose.cloudflare.yaml \
  --env-file .env.prod \
  ps -a
```

Expected: `db` saludable; `migrate` y `seed` terminados con código `0`; `api`, observabilidad y `cloudflared` en ejecución; túnel **Healthy** en Cloudflare. Cerrar y reabrir SSH no debe interrumpir nada.

### Resultado de la tarea 8 (2026-10-20)

**Completada.**

- Docker ya estaba habilitado al arranque. No había contenedores, volúmenes ni servicio `cloudflared` previos; los Steps 2 y 3 no requirieron eliminaciones.
- La primera publicación detectó el fallo del proxy de socket: `v0.5.0` no podía escribir `/run/haproxy.pid` con `read_only: true` y además arrastraba una regresión de `/version` con HAProxy 3.4.2. Se fijó `v0.4.2` y se añadió `/run` al `tmpfs` (commit `e21c4c4`).
- El seed falló primero porque `SEED_ADMIN_IDENTIFICATION_NUMBER` estaba vacía. Se completó con la identificación real del ADMIN y el seed terminó con código `0`.
- La API, PostgreSQL, Loki, Grafana y el proxy de socket quedaron saludables; Alloy y `cloudflared` en ejecución. `migrate` y `seed` terminaron con código `0`.
- El health público devuelve `authJwksReachable: true`; el JWKS público responde `200` con una clave EdDSA y `cf-cache-status: DYNAMIC`.
- Se confirmó que Bot Fight Mode desafiaba la consulta de Node al JWKS público. La corrección con `AUTH_JWKS_URL` interno quedó desplegada y verificada; ver la sección posterior.
- El login y una petición protegida desde el navegador funcionan tras la corrección.

La etiqueta `2026-10-20-r1` está aplicada y `api`, `migrate` y `seed` la reflejan en `ps -a`.

Pendiente:

- La tarea 9 conserva una verificación diferida de rate limiting; el resto del recorrido funcional está completo.

---

## Tarea 9: verificar el despliegue completo

**Ubicación:** equipo del operador y paneles de los proveedores.

- [x] **Step 1: Pruebas, tipos, lint y build**

```bash
pnpm test
pnpm run typecheck
pnpm run lint
pnpm run build
pnpm run docs:check
```

Expected: todo en verde.

- [x] **Step 2: Endpoints públicos**

```bash
curl -i https://api.sipeg-utp.com/api/v1/health
curl -i https://api.sipeg-utp.com/api/auth/jwks
```

Expected: health `200` con `data.authJwksReachable: true`; JWKS `200` con claves públicas.

Con `AUTH_JWKS_URL` interno, el campo del health acredita solo la accesibilidad del JWKS configurado desde la API. La segunda petición comprueba por separado la ruta pública y las reglas de Cloudflare para ese cliente; un challenge del edge no queda descartado por el health interno.

- [x] **Step 3: CORS**

```bash
curl -i -X OPTIONS \
  https://api.sipeg-utp.com/api/v1/auth/login \
  -H 'Origin: https://sipeg-utp.com' \
  -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: content-type'
```

Expected:

```http
Access-Control-Allow-Origin: https://sipeg-utp.com
Access-Control-Allow-Credentials: true
```

- [ ] **Step 4: Recorrido funcional**

- [x] Registro y recepción real del correo.
- [x] Verificación de email.
- [x] Login, refresh, recarga y segunda pestaña.
- [x] Recuperación y cambio de contraseña.
- [x] Cookie `HttpOnly`, `Secure`, `SameSite=Lax`, host `api.sipeg-utp.com`, `Path=/api/v1/auth`.
- [x] Grafana exige Access y después su login.
- [x] Grafana consulta Loki y muestra logs de la API.
- [ ] Dos clientes de redes distintas no comparten indebidamente los buckets por IP. **Diferida por decisión operativa**; no se probó para no bloquear la IP del operador.
- [x] Reinicio controlado del VPS recupera automáticamente los servicios.
- [x] Desarrollo sigue funcionando con Mailpit.

### Diagnóstico inicial

| Síntoma                                     | Primera revisión                                                                                         |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Error `1033`                                | Conector del túnel desconectado                                                                          |
| Error `502`                                 | Nombre de servicio, puerto interno y redes Docker                                                        |
| Error CORS                                  | `CORS_ORIGIN` frente al origen real del frontend                                                         |
| Health `200`, pero JWKS `false`             | `AUTH_JWKS_URL`, puerto interno y acceso al endpoint configurado; verificar el JWKS público por separado |
| Correo visible en Mailpit, pero no recibido | SMTP de entrega real                                                                                     |
| Error TLS del SMTP                          | STARTTLS, cadena del certificado y `MAIL_HOST`                                                           |
| Alertas visibles en Grafana, pero sin email | SMTP, contact point y política de notificación                                                           |

### Progreso de la tarea 9 (2026-10-20)

Completado:

- **Step 1.** `pnpm test`, typecheck, lint, build y `docs:check` en verde en el equipo del operador.
- **Step 2.** Health público `200` con `authJwksReachable: true`; JWKS público `200` con clave `EdDSA`; `cf-cache-status: DYNAMIC`. El health mide el JWKS interno; la ruta pública se verificó por separado.
- **Step 3.** Preflight CORS `204` con `Access-Control-Allow-Origin: https://sipeg-utp.com` y `Access-Control-Allow-Credentials: true`.
- Registro con buzón externo, recepción real por Brevo y verificación de email.
- Login, refresh, recarga y segunda pestaña.
- Recuperación y cambio de contraseña.
- Cookie `sipeg-refresh` con `HttpOnly`, `Secure`, `SameSite=Lax`, host-only y `Path=/api/v1/auth`.
- Grafana exige Access, permite el login y consulta Loki con logs de la API.
- Reinicio del VPS: los servicios volvieron automáticamente y el health siguió en `200` con `authJwksReachable: true`.
- Desarrollo con Mailpit.

Cierre operativo:

- El recorrido funcional está completo salvo la prueba de aislamiento de buckets de rate limiting.
- **Diferida por decisión operativa:** no se probó desde dos redes para no bloquear la IP del operador. No bloquea el criterio de finalización del despliegue.
- La etiqueta `2026-10-20-r1` está aplicada en `api`, `migrate` y `seed`; el pendiente anterior de imagen quedó resuelto.
- El riesgo residual y la recomendación de repetir la prueba antes de ajustar umbrales están documentados en `docs/despliegue.md` y ADR-0012.

---

## Tarea 10: documentación y ADR

**Files:** Modify `README.md`, `CONTEXT.md`, `AGENTS.md`, `docs/despliegue.md`; Create `docs/adr/adr-0012-cloudflare-workers-tunnel-deployment.md`.

- [x] **Step 1: Registrar el ADR**

Crear `docs/adr/adr-0012-cloudflare-workers-tunnel-deployment.md` siguiendo la plantilla de `docs/adr/`. Debe documentar: Workers para el frontend, Cloudflare Tunnel como frontera pública sin puertos entrantes, `SameSite=lax` por compartir dominio registrable, `trust proxy=1` con `X-Forwarded-For` de Cloudflare, y la separación de redes.

- [x] **Step 2: Actualizar `docs/despliegue.md`**

Sustituir el estado "Abierta" por la topología elegida y marcar las decisiones derivadas resueltas (dominio, `AUTH_REFRESH_COOKIE_SAME_SITE`, saltos de proxy, CORS, `AUTH_URL`, `VITE_API_BASE_URL`, acceso a Grafana).

- [x] **Step 3: Actualizar `README.md` y `CONTEXT.md`**

Documentar el comando de despliegue con los tres archivos Compose, los dominios públicos, la variable de build del frontend y el SMTP finalmente elegido. Integrar sin revertir cambios locales.

- [x] **Step 4: Actualizar `AGENTS.md`**

Ajustar la sección de despliegue/red para reflejar Cloudflare Tunnel y el conector Compose.

- [x] **Step 5: Comprobar formato**

```bash
pnpm exec prettier README.md CONTEXT.md AGENTS.md docs/despliegue.md docs/adr/adr-0012-cloudflare-workers-tunnel-deployment.md --check
```

Expected: sin diferencias.

### Resultado de la tarea 10 (2026-10-20)

**Completada.**

- Creado `docs/adr/adr-0012-cloudflare-workers-tunnel-deployment.md` con topología, decisiones, consecuencias, alternativas, implementación y referencias.
- Reescrito `docs/despliegue.md` con el estado final, dominios, decisiones resueltas, Compose, redes, cookies, JWKS, operación, verificación y pendientes.
- Actualizados `README.md`, `CONTEXT.md` y `AGENTS.md` con los dominios, el comando de tres Compose, Cloudflare Tunnel, Access, JWKS interno, Brevo y reglas de red.
- Añadidas notas de vigencia en ADR-0007 (terminación TLS y frontera pública) y ADR-0009 (topología y `SameSite=lax`).
- Actualizados los planes de despliegue y de JWKS interno con la etiqueta `2026-10-20-r1`, el rate limiting diferido y el cierre de la tarea 10.
- `pnpm exec prettier ... --check`, `pnpm run docs:check` y `git diff --check`: correctos. Sin cambios de código.

---

## Criterio de finalización

El despliegue está completo cuando:

- El frontend carga en `https://sipeg-utp.com` y llama a `https://api.sipeg-utp.com`.
- El health público es `200` con `authJwksReachable: true`.
- El túnel sobrevive al cierre de SSH y al reinicio del VPS.
- Grafana está protegido por Access y consulta Loki.
- Desarrollo conserva Mailpit.
- Los correos de identidad llegan a destinatarios reales.

La prueba de aislamiento de buckets de rate limiting entre dos redes quedó
diferida por decisión operativa y documentada como riesgo residual; no forma
parte de este criterio de finalización.

## Fuentes oficiales

- [Cloudflare Tunnel: routing](https://developers.cloudflare.com/tunnel/concepts/routing/).
- [Cloudflare Tunnel: conectividad y puertos salientes](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/).
- [Cloudflare Workers Builds: configuración](https://developers.cloudflare.com/workers/ci-cd/builds/configuration/).
- [Cloudflare Access: aplicación autohospedada](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/).
- [Express detrás de proxies](https://expressjs.com/en/guide/behind-proxies).
- [Docker Compose: interpolación de variables](https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/).
- [OVH: envío de correo y restricciones SMTP](https://docs.ovhcloud.com/en/guides/bare-metal-cloud/dedicated-servers/mail-sending-optimization.md).

---

## Pendientes tras la tarea 1 (2026-10-06)

Estado de `.env.prod`: creado en la máquina local (no en el VPS), con `chmod 600`, ignorado por Git y con estructura idéntica a `.env.prod.example`. Copiarlo al VPS en la tarea 8 **tal cual**, sin regenerar los secretos ya generados.

Secretos generados y reglas de estabilidad:

| Variable                   | Estado                                      | Regla                                                                                                             |
| -------------------------- | ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `POSTGRES_PASSWORD`        | Generado (`openssl rand -hex 32`)           | Solo aplica a un volumen nuevo. Si el VPS ya tiene volumen de PostgreSQL, reemplazarlo por la contraseña vigente. |
| `AUTH_SECRET`              | Generado                                    | Mantener estable entre despliegues.                                                                               |
| `LOG_PSEUDONYMIZATION_KEY` | Generado                                    | Mantener estable para conservar la correlación de pseudónimos.                                                    |
| `GRAFANA_SECRET_KEY`       | Generado                                    | Mantener estable entre reinicios.                                                                                 |
| `GRAFANA_ADMIN_PASSWORD`   | Generado                                    | Solo se aplica al inicializar un volumen vacío de Grafana.                                                        |
| `SEED_ADMIN_PASSWORD`      | Generado (`openssl rand -hex 10`, 20 chars) | Retirar después de confirmar que el ADMIN existe.                                                                 |

Campos aún vacíos en `.env.prod`, con su tarea de resolución:

- `MAIL_HOST`, `MAIL_USER`, `MAIL_PASSWORD` y confirmación de `MAIL_PORT`/`MAIL_SECURE` → tarea 6 (proveedor SMTP real). Sin `MAIL_HOST` la API no arranca en producción.
- `MAIL_FROM` conserva el remitente propuesto; usarlo solo tras verificar el dominio y autorizarlo con el proveedor.
- `CLOUDFLARE_TUNNEL_TOKEN` → tarea 7 (token del túnel `sipeg-produccion`); solo debe existir en `.env.prod`.
- `SEED_ADMIN_EMAIL` y `SEED_ADMIN_IDENTIFICATION_NUMBER` → datos reales del administrador inicial (obligatorios en una base sin ADMIN).
- `TRUSTED_ORIGINS` permanece vacío por decisión de este despliegue.
- `IMAGE_TAG` y `APP_VERSION` quedan en `2026-10-05-r1` como placeholder; actualizarlos en cada publicación sin reutilizar etiquetas para código distinto.

Recordatorio del bootstrap: una vez confirmado el ADMIN en la base, vaciar `SEED_ADMIN_PASSWORD`, `SEED_ADMIN_EMAIL` y `SEED_ADMIN_IDENTIFICATION_NUMBER`; el seed conservará el ADMIN existente. La plantilla versionada es `.env.prod.example`; `.env.prod` debe permanecer fuera de Git.

## Resultado y pendientes tras la tarea 2 (2026-10-06)

**Completada.** Se verificó el fallo de las pruebas antes de aplicar la normalización de variables y el timeout del JWKS.

- `AUTH_ISSUER`, `AUTH_AUDIENCE` y `TRUSTED_ORIGINS` vacíos se normalizan a `undefined`. Las pruebas de configuración tienen un entorno de prueba explícito, incluida la suite de `LOG_LEVEL` que dependía del entorno local.
- La consulta del health check al JWKS usa `AbortSignal.timeout(3_000)`. Las pruebas verifican éxito (`true`), respuestas HTTP fallidas (`false`), error de conexión (`false`), la señal de cancelación y el límite de 3 segundos.
- Se caracterizó `trust proxy = 1` y se corrigió la explicación de `X-Forwarded-For` en README y documentación de despliegue. Los comentarios de SameSite en `env.ts` y `auth.cookie.ts` reflejan que Workers bajo el mismo sitio permite `lax`.
- `.env.example` y `CONTEXT.md` documentan el comportamiento actualizado. El contrato OpenAPI sigue vigente.

Verificaciones realizadas:

- `pnpm exec vitest run src/config/env.test.ts src/modules/health/health.routes.test.ts src/app.test.ts`: 33 pruebas aprobadas.
- `pnpm test`: 73 archivos aprobados, 2 omitidos; 1621 pruebas aprobadas y 9 omitidas.
- `pnpm run typecheck`, `pnpm run lint`, `pnpm run build` y `pnpm run docs:check`: aprobados.
- Prettier sobre los seis archivos TypeScript modificados y `git diff --check`: aprobados.

La primera ejecución de la suite completa, simultánea a tipos, lint y build, encontró dos timeouts de 5 segundos al cargar la aplicación en pruebas de usuarios y autorización. Sus 106 pruebas pasaron al ejecutarlas aisladamente y la repetición de `pnpm test` sin esas comprobaciones concurrentes pasó completa.

Pendientes operativos:

- **Tareas 3 y 4:** completar la propagación de variables en los archivos Compose de producción y desarrollo; la normalización de la API ya acepta los campos opcionales vacíos.
- **Tarea 9:** verificar la cadena real `X-Forwarded-For` y que clientes de redes diferentes no compartan indebidamente los buckets de rate limiting. La prueba local caracteriza la configuración de Express; la comprobación pública requiere el túnel desplegado.
- **Tareas 8 y 9:** comprobar que el health público devuelve `authJwksReachable: true` y que `/api/auth/jwks` es accesible a través del túnel.
- **Integración con base de datos:** se omitieron 9 pruebas de auditoría y alertas porque no hay `AUDIT_TEST_DATABASE_URL` configurada. Para ejecutarlas se necesita una base aislada con las migraciones aplicadas.
- **Tarea 10:** consolidar la documentación de la topología elegida y registrar el ADR. `docs/despliegue.md` conserva el estado general anterior hasta esa actualización; en esta tarea se corrigió su explicación del proxy.

## Resultado y pendientes tras la tarea 3 (2026-10-06)

**Completada.**

- `api.environment` propaga `TRUSTED_ORIGINS`, `AUTH_ISSUER`/`AUTH_AUDIENCE` con fallback a `AUTH_URL`, `AUTH_TOKEN_TTL`, los tres `AUTH_ARGON2_*`, `DOCS_ENABLED=false` y `LOG_PRETTY=false`.
- `seed` recibe los `AUTH_ARGON2_*` para que el hash del ADMIN inicial use los mismos parámetros que la API.
- `migrate` y `seed` comparten `sipeg-utp-backend:migrate-${IMAGE_TAG}`; la API usa `sipeg-utp-backend:${IMAGE_TAG}`.
- El comentario de `api.ports` documenta Cloudflare Tunnel como cliente público (llega a `api:3000` por la red Docker) y deja el loopback para comprobaciones desde el host.

Verificaciones realizadas, sin imprimir secretos:

- `pnpm exec prettier compose.prod.yaml --check`: verde. Se cambió a comilla simple la interpolación de `AUTH_REFRESH_COOKIE_SAME_SITE`, que ya difería antes de esta tarea.
- `docker compose -f compose.prod.yaml --env-file .env.prod.example config --quiet` con valores ficticios inyectados solo al proceso: código `0`.
- Configuración resuelta comprobada: `TRUSTED_ORIGINS` vacío; issuer y audience `https://api.sipeg-utp.com`, con fallback a `AUTH_URL` al vaciarlos; `AUTH_TOKEN_TTL` `15m`; Argon2 `12288/3/1` en `api` y `seed`; `DOCS_ENABLED` y `LOG_PRETTY` en `false`; imágenes `sipeg-utp-backend:2026-10-05-r1`, `sipeg-utp-backend:migrate-2026-10-05-r1` compartida por `migrate` y `seed`; puerto publicado solo en `127.0.0.1:3000`.
- `.env.prod.example` no requirió cambios.

Pendientes:

- **Tareas 4 y 5:** revisar `compose.dev.yaml` y crear `compose.cloudflare.yaml`.
- **Tareas 6-8:** completar SMTP real, configurar Cloudflare y desplegar. Hasta entonces la validación con `.env.prod` seguirá fallando por secretos y `MAIL_HOST` vacíos (esperado).
- **Tarea 10:** documentación y ADR. `compose.prod.yaml` ya refleja la topología.
- `IMAGE_TAG` de `.env.prod` (`2026-10-05-r1`) ahora versiona también las imágenes de `migrate` y `seed`; actualizarlo en cada publicación para no reutilizar una etiqueta con código distinto.

## Resultado y pendientes tras la tarea 4 (2026-10-10)

**Completada.**

- `api.environment` propaga las nueve variables previstas: issuer, audience, TTL de access token, SameSite, origenes adicionales, documentacion y parametros Argon2. Issuer y audience usan `AUTH_URL` como fallback, con `http://localhost:3000` como ultimo default.
- El comentario de `api.ports` describe el acceso local desde el navegador. Se conservaron Mailpit (`mailpit:1025`, sin TLS), el bind `127.0.0.1:${PORT:-3000}:3000` y el volumen de PostgreSQL.
- Se ajusto la verificacion del plan para inyectar valores ficticios al validar `.env.example` y distinguir la disponibilidad HTTP de la API del estado `healthy` de PostgreSQL y Mailpit.

Verificaciones realizadas, sin imprimir secretos ni tokens:

- `pnpm exec prettier compose.dev.yaml --check`: aprobado.
- `docker compose -f compose.dev.yaml --env-file .env.example config --quiet` con `AUTH_SECRET` y `LOG_PSEUDONYMIZATION_KEY` ficticios en el proceso: codigo `0`.
- `docker compose -f compose.dev.yaml config --quiet` con el `.env` local: codigo `0`.
- Configuracion resuelta: defaults de las nueve variables correctos, fallback de issuer/audience a un `AUTH_URL` personalizado y propagacion de valores personalizados para las nueve variables. Se verificaron tambien Mailpit, loopback y el destino del volumen de PostgreSQL.
- `docker compose -f compose.dev.yaml up -d --build`: aprobado. La primera construccion supero el limite de 120 segundos de la herramienta; la repeticion con un limite de 600 segundos termino correctamente.
- Servicios: `migrate` terminado con codigo `0`; `api` en ejecucion; `db` y `mailpit` saludables. Las nuevas variables y la configuracion SMTP se comprobaron dentro del contenedor de la API.
- `pnpm run api:run:smoke`: una solicitud aprobada, health `200`. Una comprobacion HTTP adicional verifico `success: true` y `authJwksReachable: true`.
- Registro con cuenta sintetica de desarrollo: `201` y correo de verificacion capturado en Mailpit. Recuperacion de la misma cuenta: `200` y correo de reset capturado. Ambos enlaces apuntan a `http://localhost:5173`, con las rutas `/verify-email` y `/reset-password` y un token no vacio.
- El stack permanece en ejecucion. La prueba creo una cuenta sintetica y dos mensajes de Mailpit; no se guardaron sus passwords ni tokens en archivos.

Pendientes:

- **Tarea 5:** crear y validar `compose.cloudflare.yaml`.
- **Tareas 6-8:** resolver SMTP real, configurar Cloudflare y desplegar en el VPS.
- **Observabilidad local:** Alloy y el proxy del socket ya estaban detenidos con codigo `127` antes de esta tarea; queda pendiente diagnosticar ese estado.
- **Tareas 9 y 10:** verificar el despliegue publico y consolidar documentacion y ADR.

## Resultado y pendientes tras la tarea 5 (2026-10-10)

**Completada.**

- Creado `compose.cloudflare.yaml`: `cloudflared` con token obligatorio por entorno, reinicio `unless-stopped`, logs locales rotados, `no-new-privileges`, todas las capacidades retiradas y conexión a `sipeg-utp-prod` y `observability`. El conector no publica puertos ni tiene dependencias de arranque.
- Grafana recibe el dominio `grafana.sipeg-utp.com`, URL externa HTTPS, protocolo interno HTTP y cookies `Secure` mediante el nuevo overlay.
- El catálogo de imágenes del ADR-0007 incluye `cloudflared:2026.9.3` y su digest. El comentario de acceso a Grafana y el comando de producción de `compose.observability.yaml` reflejan Tunnel y Access.

Verificaciones realizadas:

- `docker buildx imagetools inspect` por la referencia fijada y por tag: ambos devuelven `sha256:072c067d25ccbe61d46e18f0d0723255f2bb5304f7317caa95b27031520ff92c`, con manifiestos para `linux/amd64` y `linux/arm64`.
- Prettier sobre los dos Compose y el ADR-0007: aprobado. Se corrigió el espaciado de la nueva fila del catálogo tras la primera comprobación.
- Los tres Compose combinados, con `.env.prod.example` y valores ficticios inyectados solo al proceso: `config --quiet` terminado con código `0`.
- Configuración resuelta comprobada: imagen fijada, comando, token, reinicio, rotación de logs, restricciones de seguridad y redes de `cloudflared`; sin puertos publicados ni `depends_on`.
- Se comparó la configuración base de producción y observabilidad con la combinada: el único servicio añadido es `cloudflared` y el único cambio en servicios existentes son las cuatro variables públicas de Grafana. Redes y volúmenes conservados; PostgreSQL sin puertos publicados; API y Grafana siguen ligados al loopback del host.
- Desarrollo con observabilidad sigue validando sin conector ni variables públicas de Grafana. Un token del túnel vacío es rechazado con el error esperado.
- `git diff --check` sobre los archivos versionados modificados: aprobado. No se imprimieron secretos ni se guardaron credenciales de validación en archivos.

Pendientes:

- **Tarea 6:** elegir y verificar el SMTP real de producción.
- **Tareas 7 y 8:** configurar Tunnel y Access, completar el token privado y desplegar; comprobar la conexión real y las rutas públicas con credenciales válidas.
- **Tareas 9 y 10:** verificar el despliegue completo y consolidar la documentación y el ADR de la topología.
- La observabilidad local conserva el pendiente de Alloy y el proxy del socket indicado tras la tarea 4.

## Corrección post-despliegue: JWKS interno (2026-10-19)

El operador confirmó en Security Events que **Bot Fight Mode** aplicaba **Managed Challenge** a `GET /api/auth/jwks` con user-agent `node`. La consulta desde el contenedor devolvía `403` con `cf-mitigated: challenge` en 169 ms, mientras otra petición externa del mismo contenedor devolvía `200`. DNS y salida funcionaban. Bruno obtenía un token al hacer login, pero el verificador no podía descargar las claves para las rutas privadas.

Implementación y verificación local: [plan de JWKS interno](2026-10-19-internal-jwks-url.md).

- [x] Agregar `AUTH_JWKS_URL` opcional, HTTP(S), con vacío equivalente a ausencia y fallback a `/api/auth/jwks` relativo a `AUTH_URL`.
- [x] Compartir la resolución de URL entre el verificador y el health mediante `src/config/auth-jwks.ts`.
- [x] Usar `http://127.0.0.1:3000/api/auth/jwks` por defecto en ambos Compose y en `.env.prod.example`.
- [x] Conservar issuer y audience públicos, algoritmo EdDSA, caché y timeout de health de 3 segundos.
- [x] Reproducir el challenge y verificar la corrección con un servidor HTTP de pruebas aislado. Cubrir fallback, `refresh()` y rechazo de issuer/audience internos.
- [x] Verificar localmente: 39 pruebas focalizadas y 1639 de la suite completa aprobadas (9 de integración omitidas); tipos, lint, build, OpenAPI y Compose correctos. Implementación en el commit `9acc05e`.
- [x] Actualizar el código en el VPS y reconstruir las imágenes de API y migración/seed. Se usó `2026-10-10-r1`; el código nuevo está en ejecución.
- [x] Confirmar en el VPS `authJwksReachable: true` y login seguido de una petición protegida desde el navegador.
- [x] Publicar una etiqueta nueva: `2026-10-20-r1` está aplicada en `api`, `migrate` y `seed`; `ps -a` la refleja.

El health mide el endpoint configurado (loopback en Docker), no el borde público. La ruta pública conserva las reglas de Cloudflare y debe comprobarse externamente. No cambiar `AUTH_URL`, `AUTH_ISSUER` ni `AUTH_AUDIENCE` a loopback. El `.env.prod` existente puede conservarse: Compose aporta el default; si define explícitamente `AUTH_JWKS_URL`, ese valor tiene prioridad y debe revisarse.

Verificación en el VPS:

- Health público: `authJwksReachable: true`.
- JWKS público: `200` con clave `EdDSA` y `cf-cache-status: DYNAMIC`.
- `api` healthy, `migrate` y `seed` con código `0`, observabilidad y `cloudflared` en ejecución.
- Login del ADMIN y petición protegida desde el navegador: correctos.
