# Fase 1.2 - Inicio de sesion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Cerrar el checklist 1.2 del plan maestro: `POST /api/v1/auth/login` devuelve access token EdDSA y refresh token de una sesion persistida, credenciales invalidas responden 401 sin revelar si el email existe, y el sexto intento por minuto responde 429.

**Architecture:** La ruta ya existe (`loginRateLimit -> validate(loginSchema) -> login`). `loginWithPassword` delega en `auth.api.signInEmail` (Better Auth valida Argon2id, crea la fila en `sessions`, devuelve `token` y usuario), carga el usuario desde `users`, firma el JWT EdDSA con la clave privada de `jwks` y devuelve el refresh token con su expiracion leida de `sessions`. El trabajo es de verificacion: pruebas de caracterizacion del contrato, una correccion de mensaje y evidencia real con servidor, BD, JWT y Bruno. No cambia el contrato OpenAPI.

**Tech Stack:** TypeScript, Express 5, Better Auth 1.7.5, Prisma 7, Zod 4, jose 6, Vitest, Supertest, Bruno.

**Hallazgos de partida (2026-09-19):**

- Better Auth `sign-in/email` (`node_modules/better-auth/dist/api/routes/sign-in.mjs:314-340`) normaliza `email.toLowerCase()`, hashea la password aun sin usuario (anti-timing), crea la sesion y responde el **mismo** `APIError` 401 `"Invalid email or password"` para email inexistente, sin password y password incorrecta. `auth.service.ts` lo propaga sin cambios.
- `auth.service.ts:126` responde `401 'User not found.'` cuando el proveedor autentico pero la fila no existe: mensaje distinto e innecesario. Se corrige a `'Invalid credentials.'`.
- No hay pruebas de firma EdDSA/claims, refresh token ligado a sesion persistida, 401 identicos ni 429 del sexto intento.
- Decision del 2026-09-19: **diferir** el bloqueo de login para usuarios `isActive=false` a 1.4/1.11. Better Auth no lo valida, pero `authenticate` ya corta el acceso con 403 y 1.4 cubre el uso del token desactivado. No se amplia el contrato con 403 en 1.2.

---

### Task 1: Pruebas de servicio (rojo controlado)

**Files:**

- Modify: `src/modules/auth/auth.service.test.ts`

- [x] **Step 1: Ampliar imports de jose**

Línea 1 pasar de:

```ts
import { calculateJwkThumbprint, exportJWK, generateKeyPair } from 'jose';
```

a:

```ts
import {
  calculateJwkThumbprint,
  decodeJwt,
  decodeProtectedHeader,
  exportJWK,
  generateKeyPair,
} from 'jose';
```

- [x] **Step 2: Agregar las pruebas de contrato del login**

Insertar despues del test `'login returns tokens on success'` (tras la linea 112):

```ts
it('login signs an EdDSA access token with identity claims', async () => {
  authMock.api.signInEmail.mockResolvedValue({
    token: 'refresh-token',
    redirect: false,
    user: { id: 'u-1' },
  });
  prismaMock.user.findUnique.mockResolvedValue({
    id: 'u-1',
    email: 'a@b.com',
    globalRole: 'USER',
    unitId: null,
    careerId: null,
    isActive: true,
  });
  prismaMock.session.findFirst.mockResolvedValue({
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });

  const { loginWithPassword } = await loadService(authMock, prismaMock);
  const result = await loginWithPassword({ email: 'a@b.com', password: 'strongpass1234' });

  expect(decodeProtectedHeader(result.accessToken).alg).toBe('EdDSA');
  const payload = decodeJwt(result.accessToken);
  expect(payload).toMatchObject({
    sub: 'u-1',
    email: 'a@b.com',
    role: 'USER',
    unitId: null,
    careerId: null,
    isActive: true,
    iss: 'http://localhost:3000',
    aud: 'http://localhost:3000',
  });
  expect(result.accessTokenExpiresAt.getTime()).toBeGreaterThan(Date.now());
  expect(result.accessTokenExpiresAt.getTime()).toBeLessThanOrEqual(
    Date.now() + 15 * 60 * 1000 + 1000,
  );
});

it('login returns the provider session token and reads its expiry from the database', async () => {
  const refreshExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  authMock.api.signInEmail.mockResolvedValue({
    token: 'session-token-1',
    redirect: false,
    user: { id: 'u-1' },
  });
  prismaMock.user.findUnique.mockResolvedValue({
    id: 'u-1',
    email: 'a@b.com',
    globalRole: 'USER',
    unitId: null,
    careerId: null,
    isActive: true,
  });
  prismaMock.session.findFirst.mockResolvedValue({ expiresAt: refreshExpiresAt });

  const { loginWithPassword } = await loadService(authMock, prismaMock);
  const result = await loginWithPassword({ email: 'a@b.com', password: 'strongpass1234' });

  expect(result.refreshToken).toBe('session-token-1');
  expect(result.refreshTokenExpiresAt.getTime()).toBe(refreshExpiresAt.getTime());
  expect(prismaMock.session.findFirst).toHaveBeenCalledWith(
    expect.objectContaining({ where: { token: 'session-token-1' } }),
  );
});

it('login forwards only email and password to the auth provider', async () => {
  authMock.api.signInEmail.mockResolvedValue({
    token: 'refresh-token',
    redirect: false,
    user: { id: 'u-1' },
  });
  prismaMock.user.findUnique.mockResolvedValue({
    id: 'u-1',
    email: 'a@b.com',
    globalRole: 'USER',
    unitId: null,
    careerId: null,
    isActive: true,
  });
  prismaMock.session.findFirst.mockResolvedValue({
    expiresAt: new Date(Date.now() + 86400000),
  });

  const { loginWithPassword } = await loadService(authMock, prismaMock);
  await loginWithPassword({ email: 'a@b.com', password: 'strongpass1234' });

  const call = authMock.api.signInEmail.mock.calls[0]?.[0] as {
    body: Record<string, unknown>;
  };
  expect(call.body).toEqual({ email: 'a@b.com', password: 'strongpass1234' });
});

it('login propagates the provider generic 401 message', async () => {
  const { APIError } = await import('better-auth/api');
  authMock.api.signInEmail.mockRejectedValue(
    new APIError(401, { message: 'Invalid email or password' }),
  );

  const { loginWithPassword } = await loadService(authMock, prismaMock);
  await expect(
    loginWithPassword({ email: 'ghost@b.com', password: 'strongpass1234' }),
  ).rejects.toMatchObject({ statusCode: 401, message: 'Invalid email or password' });
});

it('login maps unexpected provider failures to a generic 401', async () => {
  authMock.api.signInEmail.mockRejectedValue(new Error('socket hang up'));

  const { loginWithPassword } = await loadService(authMock, prismaMock);
  await expect(
    loginWithPassword({ email: 'a@b.com', password: 'strongpass1234' }),
  ).rejects.toMatchObject({ statusCode: 401, message: 'Invalid credentials.' });
});

it('login rejects with a generic message when the provider user is not persisted', async () => {
  authMock.api.signInEmail.mockResolvedValue({
    token: 'refresh-token',
    redirect: false,
    user: { id: 'u-missing' },
  });
  prismaMock.user.findUnique.mockResolvedValue(null);

  const { loginWithPassword } = await loadService(authMock, prismaMock);
  await expect(
    loginWithPassword({ email: 'ghost@b.com', password: 'strongpass1234' }),
  ).rejects.toMatchObject({ statusCode: 401, message: 'Invalid credentials.' });
});
```

- [x] **Step 3: Verificar el rojo esperado**

Run: `pnpm vitest run src/modules/auth/auth.service.test.ts`
Expected: 1 test en rojo (`login rejects with a generic message when the provider user is not persisted`) porque el servicio aun responde `'User not found.'`; el resto en verde. Si falla otra prueba, corregir la prueba antes de tocar produccion.

### Task 2: Pruebas de ruta (caracterizacion)

**Files:**

- Modify: `src/modules/auth/auth.routes.test.ts`

- [x] **Step 1: Ampliar imports de jose**

Linea 1:

```ts
import { calculateJwkThumbprint, decodeProtectedHeader, exportJWK, generateKeyPair } from 'jose';
```

- [x] **Step 2: Reforzar el test de exito existente**

Reemplazar `'POST /login returns tokens on valid credentials'` (lineas 120-133) por:

```ts
it('POST /login returns an EdDSA access token and the provider refresh token', async () => {
  authMock.api.signInEmail.mockResolvedValue({
    token: 'refresh-token',
    redirect: false,
    user: { id: 'u-1' },
  });
  const app = await loadApp(authMock);
  const response = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: 'a@b.com', password: 'strongpass1234' })
    .expect(200);

  const accessToken = response.body.data.accessToken as string;
  expect(response.body.success).toBe(true);
  expect(response.body.data.refreshToken).toBe('refresh-token');
  expect(response.body.data.tokenType).toBe('Bearer');
  expect(decodeProtectedHeader(accessToken).alg).toBe('EdDSA');
  expect(JSON.stringify(response.body)).not.toContain('$argon2');
});
```

- [x] **Step 3: Test de 401 identico (no enumeracion)**

Insertar despues del test `'POST /login returns 401 on bad credentials'`:

```ts
it('POST /login returns the same 401 body for wrong password and unknown email', async () => {
  const { APIError } = await import('better-auth/api');
  authMock.api.signInEmail.mockRejectedValue(
    new APIError(401, { message: 'Invalid email or password' }),
  );
  const app = await loadApp(authMock);

  const wrongPassword = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: 'admin@utp.ac.pa', password: 'wrong-password' })
    .expect(401);
  const unknownEmail = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: 'ghost@utp.ac.pa', password: 'wrong-password' })
    .expect(401);

  expect(wrongPassword.body).toEqual(unknownEmail.body);
  expect(wrongPassword.body).toEqual({
    success: false,
    message: 'Invalid email or password',
    errors: [],
  });
});
```

- [x] **Step 4: Test de 429 al sexto intento**

Insertar despues del test anterior:

```ts
it('POST /login returns 429 on the sixth attempt within a minute', async () => {
  const { APIError } = await import('better-auth/api');
  authMock.api.signInEmail.mockRejectedValue(
    new APIError(401, { message: 'Invalid email or password' }),
  );
  const app = await loadApp(authMock);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'a@b.com', password: 'strongpass1234' })
      .expect(401);
  }

  const response = await request(app)
    .post('/api/v1/auth/login')
    .send({ email: 'a@b.com', password: 'strongpass1234' })
    .expect(429);
  expect(response.body.success).toBe(false);
  expect(response.body.message).toBe('Too many login attempts. Try again in one minute.');
});
```

- [x] **Step 5: Ejecutar rutas**

Run: `pnpm vitest run src/modules/auth/auth.routes.test.ts`
Expected: todo en verde (el limitador y el mensaje generico ya existen; el rojo real esta en Task 1).

### Task 3: Implementación (verde)

**Files:**

- Modify: `src/modules/auth/auth.service.ts:126`

- [x] **Step 1: Mensaje generico**

Cambiar:

```ts
throw new ApiError(401, 'User not found.');
```

por:

```ts
throw new ApiError(401, 'Invalid credentials.');
```

- [x] **Step 2: Verificar verde**

Run: `pnpm vitest run src/modules/auth/auth.service.test.ts src/modules/auth/auth.routes.test.ts`
Expected: todos los tests en verde, sin regresiones.

### Task 4: Bruno y documentación

**Files:**

- Modify: `bruno/Auth/Log in with email and password.bru`
- Create: `bruno/Auth/Login wrong password returns 401.bru`
- Create: `bruno/Auth/Login unknown email returns 401.bru`
- Create: `bruno/Auth/Login rate limit returns 429.bru`
- Modify: `README.md` y `CONTEXT.md`

- [x] **Step 1: Assertions en el login principal**

Agregar despues del bloque `script:post-response` (no eliminarlo, captura `token`/`refreshToken`):

```bru
tests {
  test("login returns an EdDSA access token and a refresh token", function () {
    expect(res.getStatus()).to.equal(200);
    const body = res.getBody();
    expect(body.success).to.equal(true);
    expect(body.data.tokenType).to.equal("Bearer");
    expect(body.data.refreshToken).to.be.a("string");
    const [encodedHeader] = body.data.accessToken.split(".");
    const header = JSON.parse(Buffer.from(encodedHeader, "base64url").toString("utf8"));
    expect(header.alg).to.equal("EdDSA");
  });

  test("login response does not leak password hashes", function () {
    expect(JSON.stringify(res.getBody())).to.not.include("$argon2");
  });
}
```

- [x] **Step 2: Request de password incorrecta (seq 23)**

```bru
meta {
  name: Login wrong password returns 401
  type: http
  seq: 23
  tags: [
    Auth
  ]
}

post {
  url: {{baseUrl}}/api/v1/auth/login
  body: json
  auth: inherit
}

body:json {
  {
    "email": "{{demoEmail}}",
    "password": "ClaveIncorrecta2026*"
  }
}

tests {
  test("wrong password returns 401 with the generic message", function () {
    expect(res.getStatus()).to.equal(401);
    const body = res.getBody();
    expect(body.success).to.equal(false);
    expect(body.message).to.equal("Invalid email or password");
    expect(body.errors).to.deep.equal([]);
  });
}

docs {
  El proveedor responde el mismo mensaje que para un email inexistente. Consume 1 de los 5 intentos por minuto.
}
```

- [x] **Step 3: Request de email inexistente (seq 24)**

Mismo contenido que el paso anterior con `name: Login unknown email returns 401` y:

```bru
body:json {
  {
    "email": "no-existe.{{$randomInt}}@utp.ac.pa",
    "password": "ClaveIncorrecta2026*"
  }
}
```

Los `tests` deben afirmar exactamente el mismo status/mensaje (`Invalid email or password`) para demostrar la no enumeracion.

- [x] **Step 4: Request de rate limit (seq 25)**

```bru
meta {
  name: Login rate limit returns 429
  type: http
  seq: 25
  tags: [
    Auth
  ]
}

post {
  url: {{baseUrl}}/api/v1/auth/login
  body: json
  auth: inherit
}

body:json {
  {
    "email": "{{demoEmail}}",
    "password": "ClaveIncorrecta2026*"
  }
}

tests {
  const attempts = Number(bru.getVar("loginAttempts") ?? 0) + 1;
  bru.setVar("loginAttempts", attempts);

  test("sixth login attempt within a minute returns 429", function () {
    if (attempts >= 6) {
      expect(res.getStatus()).to.equal(429);
    } else {
      expect([401, 429]).to.include(res.getStatus());
    }
  });
}

docs {
  Envia este request seis veces en menos de un minuto desde una ventana limpia: los primeros cinco responden 401 y el sexto 429. En una corrida completa de la carpeta, login, refresh y las pruebas de credenciales invalidas tambien consumen la cuota de 5/min.
}
```

- [x] **Step 5: README**

En la linea 164 ampliar la lista de restauracion tras `api:collection:import` con los tres archivos nuevos y mencionar las assertions de `Auth/Log in with email and password.bru`. Despues de la linea 166 agregar:

```
Flujo de login (fase 1.2) en Bruno: `Auth/Log in with email and password` valida 200, captura los tokens y comprueba `alg=EdDSA` y ausencia de `$argon2`. `Auth/Login wrong password returns 401` y `Auth/Login unknown email returns 401` verifican el mismo 401 generico (`Invalid email or password`), sin revelar si el correo existe. El login tiene limite de 5 intentos por minuto por IP: invoca `Auth/Login rate limit returns 429` seis veces en una ventana limpia; el sexto responde 429. Espera 60 segundos entre corridas completas de `Auth`.
```

Y en la lista de endpoints (linea 208), precisar: `POST /auth/login` — devuelve access token EdDSA + refresh token; credenciales invalidas -> 401 generico; 5 intentos/min.

- [x] **Step 6: CONTEXT**

Agregar tras la linea 106:

```
- `POST /api/v1/auth/login` autentica contra el proveedor, crea la sesion (refresh token de 7 dias) y firma un access token JWT EdDSA; credenciales invalidas responden `401` con el mensaje generico `Invalid email or password` tanto para email inexistente como para password incorrecta; limite de 5 intentos por minuto por IP.
```

### Task 5: Verificación real y evidencia

- [x] **Step 1: Calidad**

```bash
pnpm test
pnpm run typecheck
pnpm run lint
pnpm run build
pnpm run docs:generate && pnpm run docs:check
```

Expected: todo verde; `docs:generate` no debe modificar `openapi.json` (sin cambio de contrato).

- [x] **Step 2: Levantar servidor**

```bash
node dist/server.js > /tmp/opencode/sipeg-fase-1-2.log 2>&1 &
echo $! > /tmp/opencode/sipeg-fase-1-2.pid
sleep 3
curl -s http://localhost:3000/api/v1/health
```

Expected: health 200 con `authJwksReachable: true`.

- [x] **Step 3: Login real + JWT EdDSA + sesion persistida**

```bash
curl -s -X POST http://localhost:3000/api/v1/auth/login -H 'content-type: application/json' \
  -d '{"email":"admin@utp.ac.pa","password":"Sipeg2026*UTP"}' > /tmp/opencode/login-1-2.json
ACCESS_TOKEN=$(node -e "console.log(JSON.parse(require('fs').readFileSync('/tmp/opencode/login-1-2.json','utf8')).data.accessToken)")
REFRESH_TOKEN=$(node -e "console.log(JSON.parse(require('fs').readFileSync('/tmp/opencode/login-1-2.json','utf8')).data.refreshToken)")
ACCESS_TOKEN="$ACCESS_TOKEN" node --input-type=module -e "
import { decodeProtectedHeader, decodeJwt } from 'jose';
const header = decodeProtectedHeader(process.env.ACCESS_TOKEN);
const payload = decodeJwt(process.env.ACCESS_TOKEN);
console.log(JSON.stringify({ alg: header.alg, sub: payload.sub, role: payload.role, iss: payload.iss, aud: payload.aud }));
"
REFRESH_TOKEN="$REFRESH_TOKEN" node --import tsx --input-type=module -e "
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './src/generated/prisma/client.js';
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const session = await prisma.session.findFirst({
  where: { token: process.env.REFRESH_TOKEN },
  select: { userId: true, createdAt: true, expiresAt: true },
});
console.log(JSON.stringify(session));
await prisma.\$disconnect();
"
```

Expected: JSON 200 con `accessToken`/`refreshToken`; header `alg: EdDSA`; `role: ADMIN`; `iss`/`aud` = `http://localhost:3000`; fila de `sessions` con el token, `userId` del admin y `expiresAt - createdAt` ~ 7 dias.

- [x] **Step 4: Credenciales invalidas identicas y login case-insensitive**

```bash
curl -s -o /tmp/opencode/wrong-pass.json -w '%{http_code}\n' -X POST http://localhost:3000/api/v1/auth/login \
  -H 'content-type: application/json' -d '{"email":"admin@utp.ac.pa","password":"ClaveIncorrecta2026*"}'
curl -s -o /tmp/opencode/unknown-mail.json -w '%{http_code}\n' -X POST http://localhost:3000/api/v1/auth/login \
  -H 'content-type: application/json' -d '{"email":"no-existe@utp.ac.pa","password":"ClaveIncorrecta2026*"}'
diff /tmp/opencode/wrong-pass.json /tmp/opencode/unknown-mail.json && echo IDENTICAL
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/v1/auth/login \
  -H 'content-type: application/json' -d '{"email":"Admin@UTP.ac.pa","password":"Sipeg2026*UTP"}'
```

Expected: `401`, `401`, `IDENTICAL`, y `200` para el email con mayusculas.

- [x] **Step 5: 429 aislado por IP**

```bash
for i in 1 2 3 4 5 6; do
  curl -s -o /dev/null -w "attempt $i: %{http_code}\n" -X POST http://localhost:3000/api/v1/auth/login \
    -H 'content-type: application/json' -H 'X-Forwarded-For: 198.51.100.10' \
    -d '{"email":"admin@utp.ac.pa","password":"ClaveIncorrecta2026*"}';
done
```

Expected: `attempt 1..5: 401`, `attempt 6: 429` (ventana limpia para esa IP; `trust proxy: 1` hace que el limitador use la IP del header).

- [x] **Step 6: Bruno (ventana limpia)**

```bash
sleep 60
pnpm --dir bruno exec bru run Auth --env local
```

Expected: 13/13 requests y 12/12 tests. El archivo de rate limit corre como quinto hit real y acepta 401/429; la evidencia dura del 429 ya quedo en Step 5.

- [x] **Step 7: Detener servidor**

```bash
kill -TERM "$(cat /tmp/opencode/sipeg-fase-1-2.pid)"
```

- [x] **Step 8: Cerrar 1.2 en el plan maestro**

Marcar `[x] 1.2` en `docs/superpowers/plans/plan-maestro-sipeg-utp.md` y agregar el registro de ejecucion con: tests nuevos, conteo `pnpm test`, evidencia real (JWT EdDSA, sesion 7d, 401 identico, 429) y el hallazgo diferido:

```
- `F1-A` (diferido a 1.4): Better Auth no valida `isActive` en login; un usuario desactivado puede emitir tokens nuevos, pero `authenticate` bloquea su uso con 403. Decidir en 1.4 si el login debe rechazarlo y eliminar la sesion recien creada.
```

### Registro de desviaciones (2026-09-19)

- El rojo esperado de Task 1 (`'User not found.'`) no ocurrio: el catch de `loginWithPassword` ya normalizaba ese `ApiError` interno a 401 `'Invalid credentials.'`, por lo que el mensaje nunca era observable. Se detecto, ademas, que ese mismo catch enmascaraba errores legitimos de servidor: un fallo de JWKS (`ApiError(500)`) se convertia en 401.
- Task 3 se ajusto con TDD real: se agrego primero la prueba en rojo `login surfaces signing key failures as a 500` (confirmada fallando con 401) y se implemento `if (error instanceof ApiError) throw error;` en `throwBetterAuthError`, mas el cambio de mensaje interno a `'Invalid credentials.'`.
- El contenedor de desarrollo (`tsx watch`, volumen `./src`) no recargo los cambios por eventos de inotify; la primera corrida Bruno fallo por codigo viejo. Se reinicio `api` con `docker compose -f compose.dev.yaml restart api` y se re-ejecuto toda la verificacion real contra el codigo fresco.
- El CLI de Bruno no soporta `Buffer.from(..., "base64url")` ("Unknown encoding"); el test de login decodifica con base64 estandar (`replace` de `-`/`_`).
- La verificacion real se hizo contra el stack Docker de desarrollo ya en ejecucion (no se levanto `node dist/server.js` ni se detuvo el stack del usuario).

### Self-review

- **Cobertura del checklist:** tokens EdDSA + refresh + sesion (Tasks 1, 2, 5), 401 sin enumeracion (Tasks 1, 2, 5), 429 (Tasks 2, 4, 5). El contrato no cambia, por eso no hay Task de OpenAPI.
- **Sin placeholders:** todas las pruebas y archivos Bruno van con codigo completo.
- **Consistencia:** se usan los helpers existentes (`loadApp`, `loadService`, `APIError`), el mismo patron de Bruno de 1.1 y los nombres reales (`loginWithPassword`, `authTokensSchema`, `session.findFirst`).
