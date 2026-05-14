# SIPEG UTP Backend

Backend REST API para SIPEG UTP. Este repositorio contiene solo el backend Node.js/TypeScript; el frontend debe consumir la API por HTTP desde otro repositorio o carpeta.

## Requisitos

- Node.js 24.x o superior.
- npm 11.x o superior.
- PostgreSQL sera necesario cuando se implementen modulos con persistencia.

## Instalacion

```bash
npm install
```

Configura las variables de entorno usando `.env.example` como referencia. Por ahora el servidor puede iniciar sin `DATABASE_URL` porque no se conecta a una base de datos al arrancar.

## Docker

Para levantar el backend junto con PostgreSQL en local:

```bash
docker compose up --build
```

La API queda disponible en `http://localhost:3000/api/v1/health`. PostgreSQL se expone solo en `127.0.0.1:${POSTGRES_PORT:-5432}` para uso local.

Antes de usarlo fuera de desarrollo local, configura secretos reales en `.env` y no uses los valores por defecto de `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` ni `POSTGRES_PASSWORD`.

Comandos utiles:

```bash
docker compose down
docker compose down -v
```

## Scripts

- `npm run dev`: inicia el servidor en modo desarrollo con `tsx watch`.
- `npm run build`: compila TypeScript hacia `dist/` sin incluir `*.test.ts`.
- `npm run start`: ejecuta el build compilado.
- `npm run typecheck`: valida tipos sin emitir archivos.
- `npm run lint`: ejecuta ESLint.
- `npm run lint:fix`: aplica fixes disponibles de ESLint.
- `npm run format`: formatea con Prettier.
- `npm run format:check`: valida formato con Prettier.
- `npm test`: ejecuta Vitest.
- `npm run prisma:validate`: valida `prisma/schema.prisma`.
- `npm run prisma:format`: formatea `prisma/schema.prisma`.
- `npm run prisma:generate`: genera Prisma Client en `src/generated/prisma` sin conectarse a la base de datos.
- `npm run prisma:migrate:dev`: crea y aplica migraciones de desarrollo; requiere una `DATABASE_URL` valida.

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
npm run prisma:generate
```
