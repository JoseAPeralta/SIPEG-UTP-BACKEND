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
- Los secretos son obligatorios: Compose falla si falta `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, `CORS_ORIGIN`, `POSTGRES_DB`, `POSTGRES_USER` o `POSTGRES_PASSWORD`.
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
- `pnpm run prisma:validate`: valida `prisma/schema.prisma`.
- `pnpm run prisma:format`: formatea `prisma/schema.prisma`.
- `pnpm run prisma:generate`: genera Prisma Client en `src/generated/prisma` sin conectarse a la base de datos.
- `pnpm run prisma:migrate:dev`: crea y aplica migraciones de desarrollo; requiere una `DATABASE_URL` valida.
- `pnpm run prisma:migrate:deploy`: aplica migraciones pendientes; usado por el servicio `migrate` en Docker.
- `pnpm run prisma:migrate:status`: reporta el estado de las migraciones.

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
    "environment": "development"
  }
}
```

### Registro de usuarios

```http
POST /api/v1/auth/register
```

Body esperado:

```json
{
  "nombre": "Juan",
  "apellido": "Perez",
  "cedula": "8-123-4567",
  "correo": "juan.perez@example.com",
  "contrasenia": "Password123"
}
```

La cedula acepta formatos panamenos de provincia y tipos especiales como `E`, `N`, `PE`, `AV` y `PI`.

Respuesta esperada:

```json
{
  "success": true,
  "message": "User created successfully.",
  "data": {
    "user": {
      "id": "ck...",
      "nombre": "Juan",
      "apellido": "Perez",
      "cedula": "8-123-4567",
      "correo": "juan.perez@example.com"
    },
    "accessToken": "jwt..."
  }
}
```

El backend guarda solo el hash de la contrasenia y nunca devuelve `passwordHash` ni `contrasenia`. `JWT_ACCESS_SECRET` debe estar configurado para emitir el token de acceso.

## Estructura Base

```txt
src/
|-- app.ts
|-- server.ts
|-- config/
|   |-- env.ts
|   `-- prisma.ts
|-- controllers/
|   `-- health.controller.ts
|-- models/
|   `-- health.model.ts
|-- routes/
|   |-- index.ts
|   |-- health.routes.ts
|   `-- health.routes.test.ts
|-- middlewares/
|   |-- error.middleware.ts
|   `-- notFound.middleware.ts
`-- utils/
    |-- ApiError.ts
    |-- asyncHandler.ts
    `-- response.ts
```

## Tests

Los tests se mantienen al lado del archivo que validan usando el patron `*.test.ts`.

Ejemplos:

- `src/routes/health.routes.ts`
- `src/routes/health.routes.test.ts`
- `src/controllers/example.controller.ts`
- `src/controllers/example.controller.test.ts`

## Configuracion

El unico archivo de ejemplo que se mantiene es `.env.example`.

## Prisma

Prisma queda configurado para PostgreSQL, pero el backend no inicializa Prisma al arrancar. El cliente se crea solo cuando algun modulo llama `getPrismaClient()`.

`DATABASE_URL` puede quedarse vacio mientras no haya modulos con persistencia. `prisma.config.ts` usa un placeholder local para permitir `prisma validate` y `prisma generate` sin conectarse a una base de datos real. Los comandos de migracion y las operaciones reales con Prisma si requeriran una URL de base de datos valida.

Prisma genera el cliente en `src/generated/prisma`. Ese directorio esta ignorado por Git y debe regenerarse cuando cambie el schema.

```bash
pnpm run prisma:generate
```
