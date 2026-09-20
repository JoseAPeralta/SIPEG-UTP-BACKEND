# Fase 1.3 - Renovacion de sesion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Cerrar el checklist 1.3 del plan maestro: `POST /api/v1/auth/refresh` entrega un nuevo par de tokens, el refresh anterior deja de funcionar tras la rotacion, y tokens vencidos o revocados responden 401.

**Architecture:** `refreshAccessToken` hoy busca la sesion por `token` sin validar `expiresAt` y devuelve el mismo refresh token. Se implementa rotacion a nivel de la tabla `sessions`: validar expiracion, firmar el access token EdDSA con el usuario de la sesion y reemplazar el token de la fila con `updateMany` atomico (`where: { token, expiresAt: { gt: now } }`). El token anterior deja de existir; la expiracion absoluta de la sesion no se extiende. Better Auth no ofrece rotacion de refresh tokens opacos; la sesion sigue siendo la fuente de verdad server-side.

**Tech Stack:** TypeScript, Express 5, Prisma 7, jose 6, `node:crypto`, Vitest, Supertest, Bruno.

**Hallazgos de partida (2026-09-19):**

- `auth.service.ts` `refreshAccessToken`: `findFirst({ where: { token } })` no filtra `expiresAt`, asi que un refresh vencido hoy entrega un access token nuevo; y devuelve `refreshToken: body.refreshToken` sin rotar. El checklist 1.3 falla en dos de sus tres clausulas.
- `sessions.token` es `@unique` y `expiresAt` esta indexado (`prisma/schema.prisma:480-494`), lo que permite rotar con un update atomico.
- `AUTH_REFRESH_TTL` esta documentado en `.env.example`, README y AGENTS, pero `src/lib/auth.ts:69-72` hardcodea `expiresIn: 7 dias`. Hallazgo `F1.3-A` para 1.4; no se cablea en esta fase.
- Decidido: la rotacion mantiene `expiresAt` absoluto (sin sliding). Decidir sliding en 1.4 si el producto lo pide (`F1.3-B`).
- Diferido a 1.4: refresh no valida `isActive` (igual que login); `authenticate` ya bloquea el uso con 403.

---

### Task 1: Pruebas de servicio (rojo)

**Files:**

- Modify: `src/modules/auth/auth.service.test.ts`

- [x] **Step 1: Agregar `updateMany` al mock de Prisma**

En la interfaz `PrismaMock` (linea 25) y en `createPrismaMock` (linea 44):

```ts
session: {
  findFirst: ReturnType<typeof vi.fn>;
  updateMany: ReturnType<typeof vi.fn>;
  deleteMany: ReturnType<typeof vi.fn>;
}
```

```ts
  session: { findFirst: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
```

- [x] **Step 2: Reemplazar la prueba de refresh existente por la de rotacion**

Reemplazar `'refresh issues new access token on valid session'` (lineas 292-310) por:

```ts
it('refresh rotates the refresh token, keeps the expiry and signs an EdDSA access token', async () => {
  const expiresAt = new Date(Date.now() + 86400000);
  prismaMock.session.findFirst.mockResolvedValue({
    expiresAt,
    userId: 'u-1',
    user: {
      id: 'u-1',
      email: 'a@b.com',
      globalRole: 'USER',
      unitId: null,
      careerId: null,
      isActive: true,
    },
  });
  prismaMock.session.updateMany.mockResolvedValue({ count: 1 });

  const { refreshAccessToken } = await loadService(authMock, prismaMock);
  const result = await refreshAccessToken({ refreshToken: 'old-token' });

  expect(result.refreshToken).not.toBe('old-token');
  expect(result.refreshToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(result.refreshTokenExpiresAt.getTime()).toBe(expiresAt.getTime());
  expect(decodeProtectedHeader(result.accessToken).alg).toBe('EdDSA');
  expect(decodeJwt(result.accessToken)).toMatchObject({ sub: 'u-1', role: 'USER' });
  expect(prismaMock.session.updateMany).toHaveBeenCalledWith({
    where: { token: 'old-token', expiresAt: { gt: expect.any(Date) } },
    data: { token: result.refreshToken },
  });
});

it('refresh rejects an expired session without rotating', async () => {
  prismaMock.session.findFirst.mockResolvedValue({
    expiresAt: new Date(Date.now() - 1000),
    userId: 'u-1',
    user: {
      id: 'u-1',
      email: 'a@b.com',
      globalRole: 'USER',
      unitId: null,
      careerId: null,
      isActive: true,
    },
  });

  const { refreshAccessToken } = await loadService(authMock, prismaMock);
  await expect(refreshAccessToken({ refreshToken: 'expired-token' })).rejects.toMatchObject({
    statusCode: 401,
    message: 'Refresh token has expired.',
  });
  expect(prismaMock.session.updateMany).not.toHaveBeenCalled();
});

it('refresh rejects when the rotation loses the race', async () => {
  prismaMock.session.findFirst.mockResolvedValue({
    expiresAt: new Date(Date.now() + 86400000),
    userId: 'u-1',
    user: {
      id: 'u-1',
      email: 'a@b.com',
      globalRole: 'USER',
      unitId: null,
      careerId: null,
      isActive: true,
    },
  });
  prismaMock.session.updateMany.mockResolvedValue({ count: 0 });

  const { refreshAccessToken } = await loadService(authMock, prismaMock);
  await expect(refreshAccessToken({ refreshToken: 'raced-token' })).rejects.toMatchObject({
    statusCode: 401,
    message: 'Refresh token is invalid.',
  });
});
```

- [x] **Step 3: Verificar rojos**

Run: `pnpm vitest run src/modules/auth/auth.service.test.ts`
Expected: 3 fallos por comportamiento actual (mismo token, sin validar expiracion, sin `updateMany`); el resto en verde.

### Task 2: Pruebas de ruta (rojo)

**Files:**

- Modify: `src/modules/auth/auth.routes.test.ts`

- [x] **Step 1: Permitir overrides de sesion en `loadApp`**

Agregar la interfaz antes de `loadApp` (linea 49) y el tercer parametro:

```ts
interface SessionMockOverrides {
  findFirst?: (args: { where?: { token?: string } }) => Promise<unknown>;
  updateMany?: (args: {
    where?: { token?: string };
    data?: { token?: string };
  }) => Promise<{ count: number }>;
}

const defaultSessionFindFirst = ({
  where,
}: {
  where?: { token?: string };
}): Promise<unknown> => {
  if (where?.token === 'invalid') return Promise.resolve(null);
  return Promise.resolve({
    expiresAt: new Date(Date.now() + 86400000),
    userId: 'u-1',
    user: {
      id: 'u-1',
      email: 'a@b.com',
      globalRole: 'USER',
      unitId: null,
      careerId: null,
      isActive: true,
    },
  });
};

const loadApp = async (
  authMock: AuthMock,
  userFindUnique: (args: FindUniqueArgs) => Promise<unknown> = defaultFindUnique,
  sessionOverrides: SessionMockOverrides = {},
) => {
```

Y dentro del mock de Prisma reemplazar el bloque `session`:

```ts
      session: {
        findFirst: vi.fn().mockImplementation(sessionOverrides.findFirst ?? defaultSessionFindFirst),
        updateMany: vi
          .fn()
          .mockImplementation(sessionOverrides.updateMany ?? (() => Promise.resolve({ count: 1 }))),
        deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
```

- [x] **Step 2: Agregar pruebas de rotacion, expiracion y reuso**

Insertar despues de `'POST /refresh returns 401 when session not found'`:

```ts
it('POST /refresh returns a rotated refresh token and an EdDSA access token', async () => {
  const app = await loadApp(authMock);
  const response = await request(app)
    .post('/api/v1/auth/refresh')
    .send({ refreshToken: 'valid-token' })
    .expect(200);

  const accessToken = response.body.data.accessToken as string;
  expect(response.body.success).toBe(true);
  expect(response.body.data.refreshToken).not.toBe('valid-token');
  expect(response.body.data.tokenType).toBe('Bearer');
  expect(decodeProtectedHeader(accessToken).alg).toBe('EdDSA');
  expect(JSON.stringify(response.body)).not.toContain('$argon2');
});

it('POST /refresh returns 401 for an expired session', async () => {
  const app = await loadApp(authMock, defaultFindUnique, {
    findFirst: () =>
      Promise.resolve({
        expiresAt: new Date(Date.now() - 1000),
        userId: 'u-1',
        user: {
          id: 'u-1',
          email: 'a@b.com',
          globalRole: 'USER',
          unitId: null,
          careerId: null,
          isActive: true,
        },
      }),
  });

  const response = await request(app)
    .post('/api/v1/auth/refresh')
    .send({ refreshToken: 'expired-token' })
    .expect(401);
  expect(response.body.message).toBe('Refresh token has expired.');
});

it('POST /refresh rejects a reused token after rotation', async () => {
  const state = { token: 'old-token' };
  const sessionRow = {
    expiresAt: new Date(Date.now() + 86400000),
    userId: 'u-1',
    user: {
      id: 'u-1',
      email: 'a@b.com',
      globalRole: 'USER',
      unitId: null,
      careerId: null,
      isActive: true,
    },
  };
  const app = await loadApp(authMock, defaultFindUnique, {
    findFirst: ({ where }) => Promise.resolve(where?.token === state.token ? sessionRow : null),
    updateMany: ({ where, data }) => {
      if (where?.token !== state.token) return Promise.resolve({ count: 0 });
      state.token = data?.token ?? state.token;
      return Promise.resolve({ count: 1 });
    },
  });

  const first = await request(app)
    .post('/api/v1/auth/refresh')
    .send({ refreshToken: 'old-token' })
    .expect(200);
  const rotated = first.body.data.refreshToken as string;
  expect(rotated).not.toBe('old-token');

  await request(app).post('/api/v1/auth/refresh').send({ refreshToken: 'old-token' }).expect(401);
  await request(app).post('/api/v1/auth/refresh').send({ refreshToken: rotated }).expect(200);
});
```

- [x] **Step 3: Verificar rojos**

Run: `pnpm vitest run src/modules/auth/auth.routes.test.ts`
Expected: fallos en rotacion, expiracion y reuso (el token no cambia y el vencido devuelve 200); el resto en verde.

### Task 3: Implementación (verde)

**Files:**

- Modify: `src/modules/auth/auth.service.ts`

- [x] **Step 1: Importar generador de tokens**

Al inicio del archivo:

```ts
import { randomBytes } from 'node:crypto';
```

- [x] **Step 2: Rotar en `refreshAccessToken`**

Reemplazar el cuerpo de la funcion (desde `const prisma = getPrismaClient();` hasta el `return`) por:

```ts
const prisma = getPrismaClient();
const now = new Date();
const session = await prisma.session.findFirst({
  where: { token: body.refreshToken },
  select: {
    expiresAt: true,
    userId: true,
    user: {
      select: {
        id: true,
        email: true,
        globalRole: true,
        unitId: true,
        careerId: true,
        isActive: true,
      },
    },
  },
});
if (!session) {
  throw new ApiError(401, 'Refresh token is invalid.');
}
if (session.expiresAt.getTime() <= now.getTime()) {
  throw new ApiError(401, 'Refresh token has expired.');
}
const accessToken = await signAccessJwt({
  userId: session.user.id,
  email: session.user.email,
  globalRole: session.user.globalRole,
  unitId: session.user.unitId,
  careerId: session.user.careerId,
  isActive: session.user.isActive,
});
const rotatedToken = randomBytes(32).toString('base64url');
const rotated = await prisma.session.updateMany({
  where: { token: body.refreshToken, expiresAt: { gt: now } },
  data: { token: rotatedToken },
});
if (rotated.count !== 1) {
  throw new ApiError(401, 'Refresh token is invalid.');
}
return {
  accessToken,
  accessTokenExpiresAt: new Date(Date.now() + parseTtlToMs(env.AUTH_TOKEN_TTL)),
  refreshToken: rotatedToken,
  refreshTokenExpiresAt: session.expiresAt,
};
```

- [x] **Step 3: Verificar verde**

Run: `pnpm vitest run src/modules/auth/auth.service.test.ts src/modules/auth/auth.routes.test.ts`
Expected: todos en verde.

### Task 4: Bruno y documentación

**Files:**

- Modify: `bruno/Auth/Refresh the access token.bru`
- Modify: `bruno/Auth/Log out and revoke the refresh token.bru`
- Create: `bruno/Auth/Refresh reused token returns 401.bru`
- Modify: `README.md` y `CONTEXT.md`

- [x] **Step 1: Refresh con rotacion**

Reemplazar `body:json` por `{{refreshToken}}` y agregar pre-request, post-response y tests antes de los `example`:

```bru
body:json {
  {
    "refreshToken": "{{refreshToken}}"
  }
}

script:pre-request {
  bru.setVar("previousRefreshToken", bru.getVar("refreshToken") ?? "");
}

script:post-response {
  const body = res.getBody();

  if (body?.success && body.data?.refreshToken) {
    bru.setVar("token", body.data.accessToken);
    bru.setVar("refreshToken", body.data.refreshToken);
  }
}

tests {
  test("refresh returns a rotated refresh token and an EdDSA access token", function () {
    expect(res.getStatus()).to.equal(200);
    const body = res.getBody();
    expect(body.success).to.equal(true);
    expect(body.data.tokenType).to.equal("Bearer");
    expect(body.data.refreshToken).to.not.equal(bru.getVar("previousRefreshToken"));
    const [encodedHeader] = body.data.accessToken.split(".");
    const base64Header = encodedHeader.replace(/-/g, "+").replace(/_/g, "/");
    const header = JSON.parse(Buffer.from(base64Header, "base64").toString("utf8"));
    expect(header.alg).to.equal("EdDSA");
  });
}
```

- [x] **Step 2: Logout con el token vigente**

Reemplazar `body:json` por `{{refreshToken}}` y agregar tests:

```bru
body:json {
  {
    "refreshToken": "{{refreshToken}}"
  }
}

tests {
  test("logout revokes the current refresh token", function () {
    expect(res.getStatus()).to.equal(200);
    expect(res.getBody().success).to.equal(true);
  });
}
```

- [x] **Step 3: Reuso del token anterior (seq 26)**

```bru
meta {
  name: Refresh reused token returns 401
  type: http
  seq: 26
  tags: [
    Auth
  ]
}

post {
  url: {{baseUrl}}/api/v1/auth/refresh
  body: json
  auth: inherit
}

body:json {
  {
    "refreshToken": "{{previousRefreshToken}}"
  }
}

tests {
  test("reused refresh token returns 401", function () {
    expect(res.getStatus()).to.equal(401);
    expect(res.getBody().success).to.equal(false);
  });
}

docs {
  Depende de "Refresh the access token": reenvia el token anterior a la rotacion. Ejecutalo despues del refresh dentro de la misma corrida.
}
```

- [x] **Step 4: README**

En la lista de restauracion tras `api:collection:import` agregar `Auth/Refresh reused token returns 401.bru` y mencionar las assertions de `Auth/Refresh the access token.bru` y `Auth/Log out and revoke the refresh token.bru`. Despues del parrafo del flujo de login agregar:

```
Flujo de refresh (fase 1.3) en Bruno: `Auth/Refresh the access token` usa el refresh token capturado por el login, espera 200, comprueba que el refresh token rota (nuevo distinto al anterior) y que el access token es EdDSA; actualiza las variables de runtime. `Auth/Log out and revoke the refresh token` revoca el token vigente y `Auth/Refresh reused token returns 401` reenvia el token anterior a la rotacion y espera 401. La rotacion no extiende la expiracion absoluta de la sesion.
```

Y en la lista de endpoints, precisar `POST /auth/refresh` — rota el refresh token y emite un nuevo par; el token anterior queda invalido; expirados o revocados → 401.

- [x] **Step 5: CONTEXT**

Agregar tras la linea del login (fase 1.2):

```
- `POST /api/v1/auth/refresh` rota el refresh token: valida que la sesion exista y no este vencida, firma un access token EdDSA nuevo y reemplaza `sessions.token` de forma atomica. El refresh anterior deja de funcionar; un token vencido o revocado responde `401`. La rotacion conserva la expiracion absoluta de la sesion.
```

### Task 5: Verificación real y evidencia

- [x] **Step 1: Calidad**

```bash
pnpm test
pnpm run typecheck
pnpm run lint
pnpm run build
pnpm run format:check
pnpm run docs:generate && pnpm run docs:check
```

Expected: todo verde; `openapi.json` sin cambios.

- [x] **Step 2: Reiniciar el API de desarrollo**

El `tsx watch` del contenedor puede no detectar cambios del bind mount:

```bash
docker compose -f compose.dev.yaml restart api
sleep 5
curl -s http://localhost:3000/api/v1/health
```

- [x] **Step 3: Rotacion real**

```bash
XF="203.0.113.91"
R1=$(curl -s -X POST http://localhost:3000/api/v1/auth/login -H 'content-type: application/json' -H "X-Forwarded-For: $XF" \
  -d '{"email":"admin@utp.ac.pa","password":"Sipeg2026*UTP"}' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).data.refreshToken))")
ROTATED=$(curl -s -X POST http://localhost:3000/api/v1/auth/refresh -H 'content-type: application/json' -H "X-Forwarded-For: $XF" \
  -d "{\"refreshToken\":\"$R1\"}")
R2=$(node -e "console.log(JSON.parse(process.argv[1]).data.refreshToken)" "$ROTATED")
echo "R1!=R2: $([ "$R1" != "$R2" ] && echo yes || echo no)"
echo -n "old token: "; curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/v1/auth/refresh -H 'content-type: application/json' -H "X-Forwarded-For: $XF" -d "{\"refreshToken\":\"$R1\"}"
echo -n "new token: "; curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/v1/auth/refresh -H 'content-type: application/json' -H "X-Forwarded-For: $XF" -d "{\"refreshToken\":\"$R2\"}"
```

Expected: `R1!=R2: yes`, old 401, new 200. Ademas verificar en BD que `sessions.token` ya no es `R1`.

- [x] **Step 4: Token vencido y revocado**

Insertar una sesion vencida con Prisma y probar:

```bash
EXPIRED_TOKEN="expired-$(date +%s)"
EXPIRED_TOKEN="$EXPIRED_TOKEN" node --import tsx --input-type=module -e "
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './src/generated/prisma/client.js';
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const user = await prisma.user.findUnique({ where: { email: 'admin@utp.ac.pa' }, select: { id: true } });
await prisma.session.create({ data: { id: randomUUID(), token: process.env.EXPIRED_TOKEN, userId: user.id, expiresAt: new Date(Date.now() - 60000) } });
console.log('expired session created');
await prisma.\$disconnect();
"
echo -n "expired token: "; curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/v1/auth/refresh -H 'content-type: application/json' -H "X-Forwarded-For: $XF" -d "{\"refreshToken\":\"$EXPIRED_TOKEN\"}"
```

Luego revocar el token vigente y reusarlo:

```bash
curl -s -o /dev/null -X POST http://localhost:3000/api/v1/auth/logout -H 'content-type: application/json' -d "{\"refreshToken\":\"$R2\"}"
echo -n "revoked token: "; curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/v1/auth/refresh -H 'content-type: application/json' -H "X-Forwarded-For: $XF" -d "{\"refreshToken\":\"$R2\"}"
```

Expected: expired 401 (`Refresh token has expired.`), revoked 401 (`Refresh token is invalid.`).

- [x] **Step 5: Bruno (ventana limpia)**

```bash
sleep 62
pnpm --dir bruno exec bru run Auth --env local
```

Expected: 14/14 requests y 15/15 tests. Si el `tsx watch` no recargo el cambio, reiniciar `api` antes.

- [x] **Step 6: Cerrar 1.3 en el plan maestro**

Marcar `[x] 1.3` y agregar el registro de ejecucion con: rotacion implementada, validacion de expiracion, conteo `pnpm test`, evidencia real (R1→R2, R1 401, vencido 401, revocado 401) y hallazgos `F1.3-A` (`AUTH_REFRESH_TTL` sin cablear) y `F1.3-B` (sin sliding; decidir en 1.4).

### Registro de desviaciones (2026-09-19)

- `Refresh reused token returns 401` se creo con `seq: 26`, despues del test de rate limit, y recibio 429. Se movio a `seq: 8` (despues de la rotacion, antes de las pruebas de limite de login) para que el 401 sea determinista.
- Conteos reales de Bruno: 14/14 requests y 15/15 tests (la estimacion inicial 15/16 era incorrecta).
- El `tsx watch` del contenedor se reinicio explicitamente antes de la verificacion real (mismo comportamiento observado en 1.2).

### Self-review

- **Cobertura del checklist:** nuevo par de tokens (Tasks 1-3, 5), refresh anterior deja de funcionar (Tasks 1-3, 5 con reuso), vencidos/revocados 401 (Tasks 1-3, 5). Sin cambio de contrato HTTP.
- **Sin placeholders:** pruebas, implementacion y archivos Bruno con codigo completo.
- **Consistencia:** se mantienen los helpers `loadService`/`loadApp`, el patron de Bruno de 1.1/1.2 y los nombres reales (`refreshAccessToken`, `session.updateMany`, `previousRefreshToken`).
