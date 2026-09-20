# Fase 1.7 - Cambio de contrasena Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar `POST /api/v1/auth/change-password`: usuario autenticado cambia su contrasena verificando la actual con Argon2id, actualiza `accounts.password` y revoca todas las demas sesiones conservando la sesion actual.

**Architecture:** Endpoint propio del modulo `auth`; no se usa `auth.api.changePassword` de Better Auth porque exige sesion por cookie y esta API es stateless (access JWT + refresh token opaco). El refresh token del body identifica la sesion actual. El servicio verifica `accounts.password` con `verifyPassword`, hashea con `hashPassword` y ejecuta una transaccion Prisma que actualiza el hash y borra las filas de `sessions` del usuario distintas de la actual. Los access tokens de sesiones revocadas siguen siendo stateless hasta su TTL de 15 minutos (documentado).

**Tech Stack:** TypeScript, Express 5, Better Auth 1.7.5, Prisma 7, Argon2id, jose 6, Zod, Vitest, Supertest y Bruno.

**Decisiones confirmadas con el usuario:**

- El body exige `refreshToken` (igual que logout/refresh) para conservar la sesion actual y revocar las demas. Un refresh token ajeno produce 400 `Refresh token is invalid.`
- Rate limit dedicado `changePasswordRateLimit`: 5/min por usuario/IP, sexto intento 429.
- Bruno solo cubre casos sin mutacion (401 sin token y 400 por contrasena actual incorrecta); el happy path se verifica manualmente con usuario temporal.

**Contrato HTTP:**

| Aspecto     | Valor                                                                                     |
| ----------- | ----------------------------------------------------------------------------------------- |
| Ruta        | `POST /api/v1/auth/change-password`                                                       |
| Middlewares | `authenticate -> changePasswordRateLimit -> validate(changePasswordSchema) -> controller` |
| Body        | `{ currentPassword: string>=1, newPassword: string 12-128, refreshToken: string>=1 }`     |
| 200         | `{ success: true, message: "Password updated successfully.", data: {} }`                  |
| 400         | validacion; `Current password is incorrect.`; `Refresh token is invalid.`                 |
| 401         | sin Bearer token o token invalido                                                         |
| 403         | cuenta desactivada (`authenticate`)                                                       |
| 429         | sexto intento por minuto                                                                  |

Sin migracion Prisma ni variables de entorno nuevas.

---

### Task 1: Esquema Zod de cambio de contrasena

**Files:**

- Modify: `src/modules/auth/auth.schemas.test.ts`
- Modify: `src/modules/auth/auth.schemas.ts`

- [x] **Step 1: Escribir pruebas rojas del esquema**

Al inicio de `auth.schemas.test.ts`, extender el import y agregar el bloque:

```ts
import { authTokensSchema, changePasswordSchema, registerResultSchema } from './auth.schemas.js';
```

```ts
describe('changePasswordSchema', () => {
  const validBody = {
    currentPassword: 'currentpass123',
    newPassword: 'newstrongpass12',
    refreshToken: 'session-token',
  };

  it('accepts a valid change password body', () => {
    expect(changePasswordSchema.parse({ body: validBody })).toEqual({ body: validBody });
  });

  it('rejects a new password shorter than 12 characters', () => {
    expect(() =>
      changePasswordSchema.parse({ body: { ...validBody, newPassword: 'short123456' } }),
    ).toThrow();
  });

  it('rejects an empty current password', () => {
    expect(() =>
      changePasswordSchema.parse({ body: { ...validBody, currentPassword: '' } }),
    ).toThrow();
  });

  it('rejects an empty refresh token', () => {
    expect(() =>
      changePasswordSchema.parse({ body: { ...validBody, refreshToken: '' } }),
    ).toThrow();
  });
});
```

- [x] **Step 2: Verificar rojo**

Run: `pnpm vitest run src/modules/auth/auth.schemas.test.ts`

Expected: falla porque `changePasswordSchema` no existe (import indefinido).

- [x] **Step 3: Implementar el esquema**

En `auth.schemas.ts`, despues de `resetPasswordSchema`:

```ts
export const changePasswordSchema = z.object({
  body: z.object({
    currentPassword: z.string().min(1, 'Current password is required.'),
    newPassword: z.string().min(12, 'Password must be at least 12 characters.').max(128),
    refreshToken: z.string().min(1, 'Refresh token is required.'),
  }),
});
```

Y con los demas tipos exportados:

```ts
export type ChangePasswordBody = z.infer<typeof changePasswordSchema>['body'];
```

- [x] **Step 4: Verificar verde**

Run: `pnpm vitest run src/modules/auth/auth.schemas.test.ts`

Expected: 7 tests en verde.

### Task 2: Pruebas rojas del servicio

**Files:**

- Modify: `src/modules/auth/auth.service.test.ts`

- [x] **Step 1: Extender imports y mocks de Prisma**

Agregar al import de Vitest el uso de Argon2id real:

```ts
import { hashPassword, verifyPassword } from '../../lib/password.js';
```

Extender `PrismaMock` y `createPrismaMock`:

```ts
interface PrismaMock {
  user: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  session: {
    findFirst: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
  };
  account: { findFirst: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  jwks: { findMany: ReturnType<typeof vi.fn>; count: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
}
```

```ts
const createPrismaMock = (): PrismaMock => {
  const prisma: PrismaMock = {
    user: { findUnique: vi.fn(), update: vi.fn() },
    session: { findFirst: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn() },
    account: { findFirst: vi.fn(), update: vi.fn() },
    jwks: { findMany: vi.fn(), count: vi.fn() },
    $transaction: vi.fn(),
  };
  prisma.$transaction.mockImplementation(
    async (callback: (client: PrismaMock) => Promise<unknown>) => callback(prisma),
  );
  return prisma;
};
```

- [x] **Step 2: Escribir los cuatro casos rojos**

Agregar antes de `it('logout deletes the session row', ...)`:

```ts
it('changePassword rejects a wrong current password without mutating anything', async () => {
  const currentHash = await hashPassword('currentpass123');
  prismaMock.account.findFirst.mockResolvedValue({ id: 'acc-1', password: currentHash });

  const { changePassword } = await loadService(authMock, prismaMock);
  await expect(
    changePassword('u-1', {
      currentPassword: 'wrongpass123',
      newPassword: 'newstrongpass12',
      refreshToken: 'current-token',
    }),
  ).rejects.toMatchObject({ statusCode: 400, message: 'Current password is incorrect.' });

  expect(prismaMock.account.update).not.toHaveBeenCalled();
  expect(prismaMock.session.deleteMany).not.toHaveBeenCalled();
});

it('changePassword stores an Argon2id hash and revokes every other session', async () => {
  const currentHash = await hashPassword('currentpass123');
  prismaMock.account.findFirst.mockResolvedValue({ id: 'acc-1', password: currentHash });
  prismaMock.session.findFirst.mockResolvedValue({ id: 'session-current' });

  const { changePassword } = await loadService(authMock, prismaMock);
  await changePassword('u-1', {
    currentPassword: 'currentpass123',
    newPassword: 'newstrongpass12',
    refreshToken: 'current-token',
  });

  const updateArgs = prismaMock.account.update.mock.calls[0]?.[0] as {
    where: { id: string };
    data: { password: string };
  };
  expect(updateArgs.where).toEqual({ id: 'acc-1' });
  expect(updateArgs.data.password.startsWith('$argon2id$')).toBe(true);
  await expect(verifyPassword(updateArgs.data.password, 'newstrongpass12')).resolves.toBe(true);
  await expect(verifyPassword(updateArgs.data.password, 'currentpass123')).resolves.toBe(false);
  expect(prismaMock.session.deleteMany).toHaveBeenCalledWith({
    where: { userId: 'u-1', token: { not: 'current-token' } },
  });
});

it('changePassword rejects a refresh token that does not belong to the user', async () => {
  const currentHash = await hashPassword('currentpass123');
  prismaMock.account.findFirst.mockResolvedValue({ id: 'acc-1', password: currentHash });
  prismaMock.session.findFirst.mockResolvedValue(null);

  const { changePassword } = await loadService(authMock, prismaMock);
  await expect(
    changePassword('u-1', {
      currentPassword: 'currentpass123',
      newPassword: 'newstrongpass12',
      refreshToken: 'foreign-token',
    }),
  ).rejects.toMatchObject({ statusCode: 400, message: 'Refresh token is invalid.' });

  expect(prismaMock.session.findFirst).toHaveBeenCalledWith(
    expect.objectContaining({ where: { token: 'foreign-token', userId: 'u-1' } }),
  );
  expect(prismaMock.account.update).not.toHaveBeenCalled();
  expect(prismaMock.session.deleteMany).not.toHaveBeenCalled();
});

it('changePassword rejects a user without a credential password', async () => {
  prismaMock.account.findFirst.mockResolvedValue(null);

  const { changePassword } = await loadService(authMock, prismaMock);
  await expect(
    changePassword('u-oauth', {
      currentPassword: 'currentpass123',
      newPassword: 'newstrongpass12',
      refreshToken: 'current-token',
    }),
  ).rejects.toMatchObject({ statusCode: 400, message: 'Current password is incorrect.' });

  expect(prismaMock.session.findFirst).not.toHaveBeenCalled();
  expect(prismaMock.account.update).not.toHaveBeenCalled();
});
```

- [x] **Step 3: Verificar rojo**

Run: `pnpm vitest run src/modules/auth/auth.service.test.ts`

Expected: los cuatro casos fallan porque `changePassword` no existe; el resto en verde.

### Task 3: Implementacion del servicio

**Files:**

- Modify: `src/modules/auth/auth.service.ts`

- [x] **Step 1: Importar dependencias**

Agregar a los imports existentes:

```ts
import { hashPassword, verifyPassword } from '../../lib/password.js';
import type { ChangePasswordBody } from './auth.schemas.js';
```

- [x] **Step 2: Implementar `changePassword`**

Agregar antes de `export const logoutUser`:

```ts
export const changePassword = async (userId: string, body: ChangePasswordBody): Promise<void> => {
  const prisma = getPrismaClient();

  const account = await prisma.account.findFirst({
    where: { userId, providerId: 'credential' },
    select: { id: true, password: true },
  });

  if (!account?.password || !(await verifyPassword(account.password, body.currentPassword))) {
    throw new ApiError(400, 'Current password is incorrect.');
  }

  const currentSession = await prisma.session.findFirst({
    where: { token: body.refreshToken, userId },
    select: { id: true },
  });

  if (!currentSession) {
    throw new ApiError(400, 'Refresh token is invalid.');
  }

  const newHash = await hashPassword(body.newPassword);

  await prisma.$transaction(async (tx) => {
    await tx.account.update({
      where: { id: account.id },
      data: { password: newHash },
    });
    await tx.session.deleteMany({
      where: { userId, token: { not: body.refreshToken } },
    });
  });
};
```

- [x] **Step 3: Verificar verde**

Run: `pnpm vitest run src/modules/auth/auth.service.test.ts`

Expected: todos en verde.

### Task 4: Pruebas rojas de ruta

**Files:**

- Modify: `src/modules/auth/auth.routes.test.ts`

- [x] **Step 1: Extender imports y fixtures**

Reemplazar el import de `jose` y agregar fixture de access token:

```ts
import {
  calculateJwkThumbprint,
  createLocalJWKSet,
  decodeProtectedHeader,
  exportJWK,
  generateKeyPair,
  jwtVerify,
  SignJWT,
} from 'jose';
```

```ts
let accessToken: string;
let jwksRows: Array<{ id: string; publicKey: string; privateKey: string }> = [];
```

En `beforeAll`, tras construir `jwksRows`, firmar el access token con la misma clave:

```ts
accessToken = await new SignJWT({
  email: 'a@b.com',
  role: 'USER',
  unitId: null,
  careerId: null,
  isActive: true,
})
  .setProtectedHeader({ alg: 'EdDSA', kid, typ: 'JWT' })
  .setIssuer('http://localhost:3000')
  .setAudience('http://localhost:3000')
  .setSubject('u-1')
  .setIssuedAt()
  .setExpirationTime('15m')
  .sign(kp.privateKey);
```

- [x] **Step 2: Extender overrides y `loadApp`**

Renombrar `SessionMockOverrides` a `PrismaMockOverrides` y ampliar firmas:

```ts
interface PrismaMockOverrides {
  findFirst?: (args: { where?: { token?: string; userId?: string } }) => Promise<unknown>;
  updateMany?: (args: {
    where?: { token?: string };
    data?: { token?: string };
  }) => Promise<{ count: number }>;
  deleteMany?: (args: {
    where?: { token?: string | { not?: string }; userId?: string };
  }) => Promise<{ count: number }>;
  accountFindFirst?: (args: { where?: Record<string, unknown> }) => Promise<unknown>;
  accountUpdate?: (args: {
    where?: { id?: string };
    data?: Record<string, unknown>;
  }) => Promise<unknown>;
}
```

Dentro de `loadApp`, tras `vi.doMock('../../lib/auth.js', ...)` agregar el mock del verificador con JWKS local:

```ts
vi.doMock('../../utils/jwt-verifier.js', () => ({
  getJwtVerifier: () => ({
    verify: async (token: string) => {
      const publicJwk = JSON.parse(jwksRows[0]!.publicKey) as Record<string, unknown>;
      const resolver = createLocalJWKSet({
        keys: [publicJwk],
      } as Parameters<typeof createLocalJWKSet>[0]);
      const { payload } = await jwtVerify(token, resolver, {
        issuer: 'http://localhost:3000',
        audience: 'http://localhost:3000',
        algorithms: ['EdDSA'],
      });
      return payload;
    },
    refresh: async () => {},
  }),
}));
```

Reemplazar la construccion inline del mock de Prisma por un objeto reutilizable con `account` y `$transaction`:

```ts
const prismaMock = {
  user: { findUnique: vi.fn().mockImplementation(userFindUnique) },
  session: {
    findFirst: vi.fn().mockImplementation(overrides.findFirst ?? defaultSessionFindFirst),
    updateMany: vi
      .fn()
      .mockImplementation(overrides.updateMany ?? (() => Promise.resolve({ count: 1 }))),
    deleteMany: vi
      .fn()
      .mockImplementation(overrides.deleteMany ?? (() => Promise.resolve({ count: 1 }))),
  },
  account: {
    findFirst: vi
      .fn()
      .mockImplementation(overrides.accountFindFirst ?? (() => Promise.resolve(null))),
    update: vi.fn().mockImplementation(overrides.accountUpdate ?? (() => Promise.resolve({}))),
  },
  jwks: {
    findMany: vi.fn().mockImplementation(() => Promise.resolve(jwksRows)),
    count: vi.fn().mockImplementation(() => Promise.resolve(jwksRows.length)),
  },
  $transaction: vi.fn(),
};
prismaMock.$transaction.mockImplementation(
  async (callback: (client: typeof prismaMock) => Promise<unknown>) => callback(prismaMock),
);
vi.doMock('../../config/prisma.js', () => ({ getPrismaClient: () => prismaMock }));
```

Agregar `vi.doUnmock('../../utils/jwt-verifier.js')` en `afterEach`.

- [x] **Step 3: Escribir los cinco casos rojos**

Insertar despues del test `POST /logout revokes only the supplied refresh token`:

```ts
it('POST /change-password returns 401 without a bearer token', async () => {
  const app = await loadApp(authMock);
  const response = await request(app)
    .post('/api/v1/auth/change-password')
    .send({
      currentPassword: 'currentpass123',
      newPassword: 'newstrongpass12',
      refreshToken: 'session-current',
    })
    .expect(401);
  expect(response.body.success).toBe(false);
});

it('POST /change-password returns 400 for a wrong current password', async () => {
  const currentHash = await hashPassword('currentpass123');
  const app = await loadApp(authMock, defaultFindUnique, {
    accountFindFirst: () => Promise.resolve({ id: 'acc-1', password: currentHash }),
  });

  const response = await request(app)
    .post('/api/v1/auth/change-password')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({
      currentPassword: 'wrongpass123',
      newPassword: 'newstrongpass12',
      refreshToken: 'session-current',
    })
    .expect(400);

  expect(response.body.message).toBe('Current password is incorrect.');
  expect(JSON.stringify(response.body)).not.toContain('$argon2');
});

it('POST /change-password revokes every other session and keeps the current one', async () => {
  const currentHash = await hashPassword('currentpass123');
  const app = await loadApp(authMock, defaultFindUnique, {
    accountFindFirst: () => Promise.resolve({ id: 'acc-1', password: currentHash }),
    accountUpdate: () => Promise.resolve({ id: 'acc-1' }),
    findFirst: ({ where }) =>
      Promise.resolve(where?.token === 'session-current' ? { id: 'session-current' } : null),
  });

  const response = await request(app)
    .post('/api/v1/auth/change-password')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({
      currentPassword: 'currentpass123',
      newPassword: 'newstrongpass12',
      refreshToken: 'session-current',
    })
    .expect(200);

  expect(response.body).toEqual({
    success: true,
    message: 'Password updated successfully.',
    data: {},
  });
  expect(JSON.stringify(response.body)).not.toContain('$argon2');
});
```

Para asertar la revocacion, en el mismo test capturar el mock de sesiones no es posible desde `loadApp`; en su lugar extender el override `deleteMany` para registrar la llamada y afirmarla:

```ts
it('POST /change-password deletes only the other sessions', async () => {
  const currentHash = await hashPassword('currentpass123');
  const deleted: Array<Record<string, unknown>> = [];
  const app = await loadApp(authMock, defaultFindUnique, {
    accountFindFirst: () => Promise.resolve({ id: 'acc-1', password: currentHash }),
    accountUpdate: ({ data }) => {
      const password = String(data?.password ?? '');
      expect(password.startsWith('$argon2id$')).toBe(true);
      return Promise.resolve({ id: 'acc-1' });
    },
    findFirst: ({ where }) =>
      Promise.resolve(where?.token === 'session-current' ? { id: 'session-current' } : null),
    deleteMany: ({ where }) => {
      deleted.push(where ?? {});
      return Promise.resolve({ count: 1 });
    },
  });

  await request(app)
    .post('/api/v1/auth/change-password')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({
      currentPassword: 'currentpass123',
      newPassword: 'newstrongpass12',
      refreshToken: 'session-current',
    })
    .expect(200);

  expect(deleted).toEqual([{ userId: 'u-1', token: { not: 'session-current' } }]);
});

it('POST /change-password returns 400 for a refresh token from another session', async () => {
  const currentHash = await hashPassword('currentpass123');
  const app = await loadApp(authMock, defaultFindUnique, {
    accountFindFirst: () => Promise.resolve({ id: 'acc-1', password: currentHash }),
    findFirst: () => Promise.resolve(null),
  });

  const response = await request(app)
    .post('/api/v1/auth/change-password')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({
      currentPassword: 'currentpass123',
      newPassword: 'newstrongpass12',
      refreshToken: 'foreign-session',
    })
    .expect(400);

  expect(response.body.message).toBe('Refresh token is invalid.');
});

it('POST /change-password returns 429 on the sixth attempt within a minute', async () => {
  const app = await loadApp(authMock, defaultFindUnique, {
    accountFindFirst: () => Promise.resolve({ id: 'acc-1', password: null }),
  });

  for (let attempt = 0; attempt < 5; attempt += 1) {
    await request(app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        currentPassword: 'wrongpass123',
        newPassword: 'newstrongpass12',
        refreshToken: 'session-current',
      })
      .expect(400);
  }

  const response = await request(app)
    .post('/api/v1/auth/change-password')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({
      currentPassword: 'wrongpass123',
      newPassword: 'newstrongpass12',
      refreshToken: 'session-current',
    })
    .expect(429);

  expect(response.body.message).toBe('Too many password change attempts. Try again in one minute.');
});
```

- [x] **Step 4: Verificar rojo**

Run: `pnpm vitest run src/modules/auth/auth.routes.test.ts`

Expected: los casos nuevos fallan con 404/401 porque la ruta no existe; el resto en verde. Los tests existentes siguen pasando con el mock ampliado.

### Task 5: Controller, ruta y rate limit

**Files:**

- Modify: `src/middlewares/rateLimit.middleware.ts`
- Modify: `src/modules/auth/auth.controller.ts`
- Modify: `src/modules/auth/auth.routes.ts`

- [x] **Step 1: Agregar el limiter**

Al final de `rateLimit.middleware.ts`:

```ts
export const changePasswordRateLimit = authRateLimit({
  windowMs: 60_000,
  max: 5,
  message: 'Too many password change attempts. Try again in one minute.',
});
```

- [x] **Step 2: Agregar el controller**

Importar `requireAuthenticatedUser`, `ChangePasswordBody` y `changePassword`; luego:

```ts
export const changePasswordHandler: RequestHandler = asyncHandler(async (req, res) => {
  const user = requireAuthenticatedUser(req);
  await changePassword(user.id, req.body as ChangePasswordBody);
  res.status(200).json(successResponse('Password updated successfully.', {}));
});
```

- [x] **Step 3: Montar la ruta**

En `auth.routes.ts` agregar imports de `authenticate`, `changePasswordRateLimit`, `changePasswordHandler` y `changePasswordSchema`; y al final:

```ts
authRoutes.post(
  '/auth/change-password',
  authenticate,
  changePasswordRateLimit,
  validate(changePasswordSchema),
  changePasswordHandler,
);
```

- [x] **Step 4: Verificar verde focalizado**

Run: `pnpm vitest run src/modules/auth/auth.schemas.test.ts src/modules/auth/auth.service.test.ts src/modules/auth/auth.routes.test.ts`

Expected: todos en verde.

### Task 6: OpenAPI y contrato

**Files:**

- Modify: `src/modules/auth/auth.openapi.ts`
- Modify: `src/docs/openapi.test.ts`
- Generated: `openapi.json`

- [x] **Step 1: Escribir pruebas rojas de contrato**

En `openapi.test.ts` agregar `'POST /api/v1/auth/change-password'` a `expectedOperations` y `'/api/v1/auth/change-password'` a `limitedPaths`; ademas:

```ts
it('marks change password with bearer security and documents its failures', () => {
  const operation = openApiDocument.paths?.['/api/v1/auth/change-password']?.post;

  expect(operation?.security).toEqual([{ bearerAuth: [] }]);
  expect(operation?.responses?.['200']).toBeDefined();
  expect(operation?.responses?.['400']).toBeDefined();
  expect(operation?.responses?.['401']).toBeDefined();
  expect(operation?.responses?.['403']).toBeDefined();
  expect(operation?.responses?.['429']).toBeDefined();
});
```

- [x] **Step 2: Verificar rojo**

Run: `pnpm vitest run src/docs/openapi.test.ts`

Expected: falla porque la operacion no esta documentada.

- [x] **Step 3: Documentar el path**

En `auth.openapi.ts`, importar `changePasswordSchema` y agregar al final de `authPaths`:

```ts
'/api/v1/auth/change-password': {
  post: {
    tags: ['Auth'],
    summary: 'Change the password of the authenticated user',
    security: [{ bearerAuth: [] }],
    requestBody: {
      required: true,
      content: { 'application/json': { schema: changePasswordSchema.shape.body } },
    },
    responses: {
      200: {
        description: 'Password updated. Every other session is revoked.',
        content: { 'application/json': { schema: apiSuccessResponse(emptyDataSchema) } },
      },
      400: errorResponse,
      401: errorResponse,
      403: errorResponse,
      429: errorResponse,
    },
  },
},
```

- [x] **Step 4: Regenerar y verificar contrato**

Run: `pnpm run docs:generate && pnpm run docs:check`

Expected: `openapi.json` incluye el nuevo path y `docs:check` queda en verde sin drift.

### Task 7: Bruno y documentacion

**Files:**

- Create: `bruno/Auth/Change password without a token returns 401.bru`
- Create: `bruno/Auth/Change password with a wrong current password returns 400.bru`
- Modify: `README.md`
- Modify: `CONTEXT.md`
- Modify: `docs/superpowers/plans/plan-maestro-sipeg-utp.md`

- [x] **Step 1: Request sin token (seq 10)**

```bru
meta {
  name: Change password without a token returns 401
  type: http
  seq: 10
  tags: [
    Auth
  ]
}

post {
  url: {{baseUrl}}/api/v1/auth/change-password
  body: json
  auth: none
}

body:json {
  {
    "currentPassword": "currentpass123",
    "newPassword": "newstrongpass12",
    "refreshToken": "session-current"
  }
}

tests {
  test("change password requires an access token", function () {
    expect(res.getStatus()).to.equal(401);
    expect(res.getBody().success).to.equal(false);
  });
}
```

- [x] **Step 2: Request con contrasena actual incorrecta (seq 11)**

```bru
meta {
  name: Change password with a wrong current password returns 400
  type: http
  seq: 11
  tags: [
    Auth
  ]
}

post {
  url: {{baseUrl}}/api/v1/auth/change-password
  body: json
  auth: bearer
}

auth:bearer {
  token: {{token}}
}

body:json {
  {
    "currentPassword": "wrong-password-123",
    "newPassword": "PruebaCambio2026*",
    "refreshToken": "{{refreshToken}}"
  }
}

tests {
  test("wrong current password is rejected", function () {
    expect(res.getStatus()).to.equal(400);
    expect(res.getBody().success).to.equal(false);
  });

  test("change password response does not leak hashes or tokens", function () {
    const serialized = JSON.stringify(res.getBody());
    expect(serialized).to.not.include("$argon2");
    expect(serialized).to.not.include(String(bru.getVar("token") ?? ""));
  });
}
```

- [x] **Step 3: Documentar la politica**

En `README.md` y `CONTEXT.md`, junto al flujo de autenticacion, agregar: `POST /auth/change-password` exige Bearer token, contrasena actual y nueva de 12-128; revoca las demas sesiones conservando la actual; los access tokens de sesiones revocadas siguen stateless hasta su TTL corto; limite 5/min.

- [x] **Step 4: Cerrar el roadmap**

Marcar `[x] 1.7` en `plan-maestro-sipeg-utp.md`, actualizar la fila de estado de autenticacion y agregar el registro de ejecucion con evidencia.

### Task 8: Verificacion completa y evidencia real

- [x] **Step 1: Calidad completa**

```bash
pnpm test
pnpm run typecheck
pnpm run lint
pnpm run build
pnpm run format:check
pnpm run docs:check
```

- [x] **Step 2: Verificacion real con usuario temporal**

Con el stack Docker de desarrollo: registrar un usuario temporal, verificar su email (Mailpit), iniciar sesion dos veces (sesiones A y B) y comprobar:

1. `change-password` con contrasena actual incorrecta responde 400 y el hash no cambia (login con la anterior sigue 200).
2. `change-password` correcto con el refresh token A responde 200.
3. La fila de la sesion B desaparece y su refresh responde 401; la sesion A sigue renovando 200.
4. Login con la contrasena anterior responde 401 y con la nueva 200.
5. `accounts.password` empieza con `$argon2id$`; los logs no contienen tokens ni hashes.
6. Eliminar el usuario temporal y sus filas dependientes al final (con limpieza garantizada aunque falle una comprobacion).

- [x] **Step 3: Bruno**

Run: `pnpm --dir bruno exec bru run Auth --env local`

Expected: requests y assertions en verde, incluidos los dos casos nuevos.

### Registro de ejecucion (2026-09-19)

- TDD verificado: rojos de esquema (4 fallos, endurecidos con `toBeDefined` para evitar pases vacuos), servicio (4 fallos por funcion ausente) y ruta (6 fallos 404 antes de montar el endpoint); luego verde focalizado.
- Pruebas: esquema 4 nuevos (9 en el archivo), servicio 4 nuevos (34), ruta 6 nuevos (33); `pnpm test` 357 en 32 archivos; `typecheck`, `lint`, `build`, `format:check` y `docs:check` en verde. `openapi.json` regenerado sin drift.
- Verificacion real (Docker dev con usuario temporal verificado via Mailpit y eliminado al final): contrasena actual incorrecta 400 `Current password is incorrect.` sin cambiar el hash; cambio 200; refresh de la sesion revocada 401 y de la sesion actual 200; login con la contrasena anterior 401 y con la nueva 200; hash `$argon2id$v=19$m=19456,t=2,p=1$` distinto al anterior; 2 sesiones vivas (actual rotada + login nuevo) y filas revocadas eliminadas; logs sin hashes ni tokens.
- Bruno: `Auth/Change password without a token returns 401` (seq 10) y `Auth/Change password with a wrong current password returns 400` (seq 11); corrida limpia `bru run Auth --env local` 19/19 requests y 24/24 tests.
- Desviacion: la verificacion E2E inicial excedio `loginRateLimit` compartido por login y refresh; se ajusto a comprobar el hash por BD y esperar la ventana de 60 s. Una segunda corrida de Bruno dentro del mismo minuto reutiliza los buckets y falla con 429/401; la corrida limpia posterior quedo en verde.
- Nota de concurrencia: el workstream de 1.8 (`GET /admin/users`) convive en el mismo arbol; `docs:generate` incluyo sus paths y la suite completa cerro 357/357. Sin commit: el usuario no lo solicito.

### Self-review

- **Cobertura:** autenticacion, contrasena actual, 12-128, transaccion de hash + revocacion de otras sesiones, refresh token ajeno, rate limit y contrato OpenAPI/Bruno.
- **Contrato:** nuevo endpoint privado; no cambia endpoints existentes.
- **Seguridad:** mensajes genericos, Argon2id, sin exponer hashes ni tokens, limiter dedicado y sin logs sensibles.
- **Fuera de alcance:** invalidacion inmediata de access tokens stateless (viven hasta 15 min) y administracion de usuarios (1.8-1.11).
