# Fase 1.4 - Cierre de sesion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Cerrar el checklist 1.4: logout revoca exactamente la sesion indicada, los endpoints versionados no emiten ni renuevan tokens para cuentas desactivadas y sus access tokens son rechazados, y `AUTH_REFRESH_TTL` controla una expiracion absoluta.

**Architecture:** `sessions.token` sigue siendo el refresh token opaco y la fuente de verdad server-side. Logout permanece idempotente y elimina solo la fila identificada por el token; login y refresh consultan `User.isActive`, revocan la sesion involucrada y responden 401 generico para no revelar el estado de la cuenta. Better Auth recibe `AUTH_REFRESH_TTL` en segundos y `disableSessionRefresh: true`, por lo que ni el proveedor ni la rotacion propia extienden `expiresAt`.

**Tech Stack:** TypeScript, Express 5, Better Auth 1.7.5, Prisma 7, jose 6, Zod, Vitest, Supertest y Bruno.

**Decisiones de seguridad:**

- Logout revoca el refresh token; el access token EdDSA ya emitido sigue stateless hasta su TTL. Una desactivacion si lo bloquea inmediatamente porque `authenticate` recarga al usuario desde la BD.
- Login de una cuenta desactivada devuelve el mismo 401 generico de credenciales invalidas y elimina la sesion creada por Better Auth.
- Refresh de una cuenta desactivada devuelve 401 `Refresh token is invalid.` y elimina esa sesion.
- Se mantiene expiracion absoluta. Better Auth 1.7 documenta que `updateAge` extiende sesiones y que `disableSessionRefresh: true` evita esa actualizacion: https://better-auth.com/docs/concepts/session-management#disable-session-refresh.
- La eliminacion de todas las sesiones al ejecutar la futura accion administrativa de desactivar queda en 1.11; 1.4 impide usar o renovar cualquier token aunque esa accion aun no exista.

---

### Task 1: Pruebas rojas de cuentas desactivadas y logout

**Files:**

- Modify: `src/modules/auth/auth.service.test.ts`
- Modify: `src/modules/auth/auth.routes.test.ts`
- Verify: `src/middlewares/authenticate.middleware.test.ts`

- [x] **Step 1: Probar que login revoca la sesion creada para una cuenta desactivada**

Agregar a `auth.service.test.ts`:

```ts
it('login rejects an inactive user and revokes the created session', async () => {
  authMock.api.signInEmail.mockResolvedValue({
    token: 'inactive-session',
    redirect: false,
    user: { id: 'u-inactive' },
  });
  prismaMock.user.findUnique.mockResolvedValue({
    id: 'u-inactive',
    email: 'inactive@b.com',
    globalRole: 'USER',
    unitId: null,
    careerId: null,
    isActive: false,
  });
  prismaMock.session.deleteMany.mockResolvedValue({ count: 1 });

  const { loginWithPassword } = await loadService(authMock, prismaMock);
  await expect(
    loginWithPassword({ email: 'inactive@b.com', password: 'strongpass1234' }),
  ).rejects.toMatchObject({ statusCode: 401, message: 'Invalid email or password' });
  expect(prismaMock.session.deleteMany).toHaveBeenCalledWith({
    where: { token: 'inactive-session' },
  });
});
```

- [x] **Step 2: Probar que refresh revoca la sesion de una cuenta desactivada**

```ts
it('refresh rejects an inactive user and revokes the session', async () => {
  prismaMock.session.findFirst.mockResolvedValue({
    expiresAt: new Date(Date.now() + 86400000),
    userId: 'u-inactive',
    user: {
      id: 'u-inactive',
      email: 'inactive@b.com',
      globalRole: 'USER',
      unitId: null,
      careerId: null,
      isActive: false,
    },
  });
  prismaMock.session.deleteMany.mockResolvedValue({ count: 1 });

  const { refreshAccessToken } = await loadService(authMock, prismaMock);
  await expect(refreshAccessToken({ refreshToken: 'inactive-token' })).rejects.toMatchObject({
    statusCode: 401,
    message: 'Refresh token is invalid.',
  });
  expect(prismaMock.session.deleteMany).toHaveBeenCalledWith({
    where: { token: 'inactive-token' },
  });
  expect(prismaMock.session.updateMany).not.toHaveBeenCalled();
});
```

- [x] **Step 3: Hacer stateful el mock de sesion de ruta y probar logout -> refresh 401**

Extender `SessionMockOverrides` con `deleteMany`, usarlo en `loadApp` y agregar:

```ts
it('POST /logout revokes only the supplied refresh token', async () => {
  const tokens = new Set(['session-a', 'session-b']);
  const sessionRow = {
    expiresAt: new Date(Date.now() + 86400000),
    userId: 'u-1',
    user: baseUser,
  };
  const app = await loadApp(authMock, defaultFindUnique, {
    findFirst: ({ where }) => Promise.resolve(tokens.has(where?.token ?? '') ? sessionRow : null),
    deleteMany: ({ where }) => {
      const deleted = tokens.delete(where?.token ?? '');
      return Promise.resolve({ count: deleted ? 1 : 0 });
    },
  });

  await request(app).post('/api/v1/auth/logout').send({ refreshToken: 'session-a' }).expect(200);
  await request(app).post('/api/v1/auth/refresh').send({ refreshToken: 'session-a' }).expect(401);
  await request(app).post('/api/v1/auth/refresh').send({ refreshToken: 'session-b' }).expect(200);
});
```

- [x] **Step 4: Verificar rojo por el comportamiento faltante**

Run: `pnpm vitest run src/modules/auth/auth.service.test.ts src/modules/auth/auth.routes.test.ts src/middlewares/authenticate.middleware.test.ts`

Expected: fallan login/refresh inactivos porque hoy emiten tokens; la prueba existente de middleware inactivo y el flujo logout pasan.

### Task 2: Pruebas rojas de TTL absoluto

**Files:**

- Create: `src/utils/ttl.test.ts`
- Modify: `src/lib/auth.test.ts`

- [x] **Step 1: Definir el contrato del conversor de TTL**

```ts
import { describe, expect, it } from 'vitest';
import { parseTtlToMilliseconds, parseTtlToSeconds } from './ttl.js';

describe('TTL parsing', () => {
  it.each([
    ['15s', 15_000],
    ['15m', 900_000],
    ['2h', 7_200_000],
    ['7d', 604_800_000],
  ])('parses %s', (ttl, expected) => {
    expect(parseTtlToMilliseconds(ttl)).toBe(expected);
    expect(parseTtlToSeconds(ttl)).toBe(expected / 1000);
  });

  it('rejects an invalid TTL', () => {
    expect(() => parseTtlToMilliseconds('forever')).toThrow('Invalid TTL');
  });
});
```

- [x] **Step 2: Probar la configuracion de Better Auth**

En `src/lib/auth.test.ts`, antes del import dinamico definir `AUTH_REFRESH_TTL=2h` y afirmar:

```ts
expect(auth.options.session).toMatchObject({
  expiresIn: 7200,
  disableSessionRefresh: true,
});
```

- [x] **Step 3: Verificar rojo**

Run: `pnpm vitest run src/utils/ttl.test.ts src/lib/auth.test.ts`

Expected: falla porque `src/utils/ttl.ts` no existe y Better Auth aun usa siete dias con refresh automatico.

### Task 3: Implementacion minima

**Files:**

- Create: `src/utils/ttl.ts`
- Modify: `src/modules/auth/auth.service.ts`
- Modify: `src/lib/auth.ts`
- Modify: `compose.dev.yaml`
- Modify: `compose.prod.yaml`
- Modify: `.env.example`

- [x] **Step 1: Crear el conversor compartido**

```ts
const TTL_PATTERN = /^(\d+)([smhd])$/;

export const parseTtlToMilliseconds = (ttl: string): number => {
  const match = TTL_PATTERN.exec(ttl);
  if (!match) throw new Error(`Invalid TTL: ${ttl}`);
  const value = Number(match[1]);
  const multipliers = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 } as const;
  return value * multipliers[match[2] as keyof typeof multipliers];
};

export const parseTtlToSeconds = (ttl: string): number => parseTtlToMilliseconds(ttl) / 1000;
```

- [x] **Step 2: Reutilizar el conversor y rechazar cuentas inactivas**

Eliminar `parseTtlToMs` local de `auth.service.ts`, importar `parseTtlToMilliseconds` y reemplazar sus tres usos. Tras cargar el usuario en login:

```ts
if (!user?.isActive) {
  await prisma.session.deleteMany({ where: { token: result.token } });
  throw new ApiError(401, 'Invalid email or password');
}
```

En refresh, despues de expiracion y antes de firmar:

```ts
if (!session.user.isActive) {
  await prisma.session.deleteMany({ where: { token: body.refreshToken } });
  throw new ApiError(401, 'Refresh token is invalid.');
}
```

- [x] **Step 3: Cablear TTL y desactivar sliding**

En `src/lib/auth.ts`:

```ts
session: {
  expiresIn: parseTtlToSeconds(env.AUTH_REFRESH_TTL),
  disableSessionRefresh: true,
},
```

- [x] **Step 4: Exponer la variable en Docker Compose**

Agregar al servicio `api` de ambos compose:

```yaml
AUTH_REFRESH_TTL: ${AUTH_REFRESH_TTL:-7d}
```

Actualizar la nota de `.env.example` para indicar que ambos compose inyectan `AUTH_REFRESH_TTL`.

- [x] **Step 5: Verificar verde focalizado**

Run: `pnpm vitest run src/utils/ttl.test.ts src/lib/auth.test.ts src/modules/auth/auth.service.test.ts src/modules/auth/auth.routes.test.ts src/middlewares/authenticate.middleware.test.ts`

Expected: todos en verde.

### Task 4: Bruno y documentacion

**Files:**

- Modify: `bruno/Auth/Log out and revoke the refresh token.bru`
- Create: `bruno/Auth/Logout revoked token returns 401.bru`
- Modify: secuencias 5-8 existentes en `bruno/Auth/*.bru`
- Modify: `README.md`
- Modify: `CONTEXT.md`
- Modify: `docs/superpowers/plans/plan-maestro-sipeg-utp.md`

- [x] **Step 1: Conservar el token revocado en Bruno**

Agregar al request de logout:

```bru
script:pre-request {
  bru.setVar("revokedRefreshToken", bru.getVar("refreshToken") ?? "");
}
```

- [x] **Step 2: Probar reuso despues de logout**

Crear request con `seq: 5`, body `{"refreshToken":"{{revokedRefreshToken}}"}` y assertion 401. Desplazar los seq actuales 5-8 a 6-9 para mantener orden determinista.

- [x] **Step 3: Documentar la politica**

Actualizar README y CONTEXT con: logout revoca una sesion, access tokens permanecen stateless hasta vencer, cuentas inactivas reciben 401 en login/refresh y 403 al usar access tokens previos, `AUTH_REFRESH_TTL` controla `expiresIn`, y no hay sliding.

- [x] **Step 4: Cerrar el roadmap**

Marcar `[x] 1.4` y agregar registro de ejecucion con pruebas, configuracion, evidencia real y decision de expiracion absoluta.

No cambia el contrato HTTP documentado; ejecutar `docs:generate` debe dejar `openapi.json` sin drift.

### Task 5: Verificacion completa y evidencia real

- [x] **Step 1: Calidad completa**

```bash
pnpm test
pnpm run typecheck
pnpm run lint
pnpm run build
pnpm run format:check
pnpm run docs:generate
pnpm run docs:check
```

- [x] **Step 2: Reiniciar el API y verificar logout real**

Login con usuario demo, consultar la fila por token, ejecutar logout, confirmar que la fila desaparece y que refresh responde 401. Confirmar que otra sesion del mismo usuario permanece.

- [x] **Step 3: Verificar cuenta inactiva sin dejar mutaciones**

Guardar el estado original de un usuario demo, crear una sesion activa, marcarlo inactivo, comprobar: access token previo -> 403, refresh -> 401 y fila eliminada, login -> 401 y sin sesion nueva. Restaurar `isActive=true` en un bloque de limpieza aunque falle una comprobacion.

- [x] **Step 4: Verificar TTL real**

Levantar temporalmente el API con `AUTH_REFRESH_TTL=2h`, iniciar sesion y comprobar que `sessions.expiresAt - createdAt` es aproximadamente 7200 segundos. Restaurar el contenedor/configuracion normal.

- [x] **Step 5: Ejecutar Bruno Auth**

Run: `pnpm --dir bruno exec bru run Auth --env local`

Expected: todas las requests y assertions en verde, incluida la reutilizacion del token revocado por logout.

### Registro de ejecucion (2026-09-19)

- TDD verificado: los tres rojos iniciales fallaron por el comportamiento esperado (login/refresh inactivos emitian tokens y `ttl.ts` no existia) y la suite focalizada quedo verde con la implementacion minima.
- Pruebas: `pnpm test` 288 tests en verde en ese momento (incluye `src/utils/ttl.test.ts` y los nuevos casos de inactivos y logout); `typecheck`, `lint`, `build`, `docs:check` y `format:check` verdes. `openapi.json` sin drift.
- Verificacion real con dos sesiones del admin: logout 200 revoca solo el token enviado (fila eliminada, refresh 401) y la segunda sesion sigue renovando (200).
- Verificacion real de cuenta inactiva (`estudiante01` restaurada a `is_active=true` con `trap`): access token previo 403, refresh 401 con fila eliminada, login 401 y sin sesion nueva.
- Verificacion real de TTL: con `AUTH_REFRESH_TTL=2h` la sesion duro exactamente 7200 s; contenedor restaurado a `7d`.
- Hallazgos cerrados: `F1-A` (login/refresh rechazan inactivos y revocan la sesion), `F1.3-A` (`AUTH_REFRESH_TTL` cableado a `expiresIn`), `F1.3-B` (expiracion absoluta, `disableSessionRefresh: true`, sin sliding).
- Bruno: nuevo `Auth/Logout revoked token returns 401` (seq 5) y pre-request `revokedRefreshToken` en logout; corrida completa `bru run Auth --env local` 15/15 requests y 16/16 tests, incluida la reutilizacion del token revocado y el sexto intento 429.

### Registro de desviaciones (2026-09-19)

- La corrida completa de Bruno fallo en `Login unknown email returns 401` con 429: el request nuevo de logout consumia el quinto cupo de `loginRateLimit` (limite 5/min) y unknown-email pasaba a sexto. Se aisló con `X-Forwarded-For: 203.0.113.201` en ese request; asi la cubeta compartida conserva 5 hits antes de `Login rate limit returns 429` (que sigue demostrando el sexto intento) y la corrida completa queda determinista.
- El plan preveia `if (!user?.isActive)`, pero usuario inexistente e inactivo conservan rutas de error separadas para no alterar el caso ya probado de usuario no persistido; ambos limpian la sesion creada por Better Auth.

### Self-review

- **Cobertura:** logout elimina solo la sesion indicada; el refresh revocado falla; access token de usuario inactivo falla; login/refresh inactivos no emiten tokens; TTL y no-sliding quedan configurados y probados.
- **Contrato:** no se agregan endpoints ni codigos nuevos. Los 401 ya forman parte de login/refresh y logout conserva 200 idempotente.
- **Seguridad:** mensajes genericos, sin tokens en logs/documentacion, consultas parametrizadas por Prisma y restauracion obligatoria de datos demo.
- **Fuera de alcance:** la accion administrativa que desactiva usuarios y elimina todas sus sesiones se implementa en 1.11.
