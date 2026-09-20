import {
  calculateJwkThumbprint,
  createLocalJWKSet,
  decodeProtectedHeader,
  exportJWK,
  generateKeyPair,
  jwtVerify,
  SignJWT,
} from 'jose';
import request from 'supertest';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { hashPassword } from '../../lib/password.js';

interface AuthMock {
  api: {
    signInEmail: ReturnType<typeof vi.fn>;
    signUpEmail: ReturnType<typeof vi.fn>;
    getToken: ReturnType<typeof vi.fn>;
    getSession: ReturnType<typeof vi.fn>;
    signOut: ReturnType<typeof vi.fn>;
    verifyEmail: ReturnType<typeof vi.fn>;
    requestPasswordReset: ReturnType<typeof vi.fn>;
    resetPassword: ReturnType<typeof vi.fn>;
  };
}

const createAuthMock = (): AuthMock => ({
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
});

let accessToken: string;
let jwksRows: Array<{ id: string; publicKey: string; privateKey: string }> = [];

const baseUser = {
  id: 'u-1',
  email: 'a@b.com',
  globalRole: 'USER',
  unitId: null,
  careerId: null,
  isActive: true,
};

interface FindUniqueArgs {
  where?: Record<string, unknown>;
}

const defaultFindUnique = ({ where }: FindUniqueArgs): Promise<unknown> =>
  where && 'id' in where ? Promise.resolve(baseUser) : Promise.resolve(null);

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

const defaultSessionFindFirst = ({ where }: { where?: { token?: string } }): Promise<unknown> => {
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
  overrides: PrismaMockOverrides = {},
) => {
  process.env['NODE_ENV'] = 'test';
  process.env['AUTH_SECRET'] = 'a'.repeat(32);
  process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test';
  process.env['AUTH_URL'] = 'http://localhost:3000';
  vi.resetModules();
  vi.doMock('../../lib/auth.js', () => ({ auth: authMock }));
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
  const prismaMock = {
    user: {
      findUnique: vi.fn().mockImplementation(userFindUnique),
    },
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
  const { app } = await import('../../app.js');
  return app;
};

describe('auth routes', () => {
  let authMock: AuthMock;

  beforeAll(async () => {
    const kp = await generateKeyPair('EdDSA', { crv: 'Ed25519', extractable: true });
    const publicJwk = await exportJWK(kp.publicKey);
    const privateJwk = await exportJWK(kp.privateKey);
    const kid = await calculateJwkThumbprint(publicJwk);
    publicJwk.kid = kid;
    privateJwk.kid = kid;
    jwksRows = [
      {
        id: kid,
        publicKey: JSON.stringify(publicJwk),
        privateKey: JSON.stringify(privateJwk),
      },
    ];
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
  });

  beforeEach(() => {
    authMock = createAuthMock();
  });
  afterEach(() => {
    vi.clearAllMocks();
    vi.doUnmock('../../lib/auth.js');
    vi.doUnmock('../../config/prisma.js');
    vi.doUnmock('../../utils/jwt-verifier.js');
  });

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

  it('POST /login returns 400 on invalid body', async () => {
    const app = await loadApp(authMock);
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'not-an-email' })
      .expect(400);
    expect(response.body.success).toBe(false);
  });

  it('POST /login returns 401 on bad credentials', async () => {
    const { APIError } = await import('better-auth/api');
    authMock.api.signInEmail.mockRejectedValue(new APIError(401, { message: 'Invalid' }));
    const app = await loadApp(authMock);
    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'a@b.com', password: 'wrong' })
      .expect(401);
  });

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

  it('POST /login returns a generic 401 for an inactive user', async () => {
    authMock.api.signInEmail.mockResolvedValue({
      token: 'inactive-session',
      redirect: false,
      user: { id: 'u-inactive' },
    });
    const app = await loadApp(authMock, ({ where }) =>
      where && 'id' in where
        ? Promise.resolve({ ...baseUser, isActive: false })
        : Promise.resolve(null),
    );

    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'inactive@b.com', password: 'strongpass1234' })
      .expect(401);

    expect(response.body).toEqual({
      success: false,
      message: 'Invalid email or password',
      errors: [],
    });
  });

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

  it('POST /refresh returns 401 when session not found', async () => {
    const app = await loadApp(authMock);
    const response = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'invalid' })
      .expect(401);
    expect(response.body.success).toBe(false);
  });

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

  it('POST /logout returns 200 even when session missing', async () => {
    const app = await loadApp(authMock);
    await request(app).post('/api/v1/auth/logout').send({ refreshToken: 'r' }).expect(200);
  });

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
        const token = typeof where?.token === 'string' ? where.token : '';
        const deleted = tokens.delete(token);
        return Promise.resolve({ count: deleted ? 1 : 0 });
      },
    });

    await request(app).post('/api/v1/auth/logout').send({ refreshToken: 'session-a' }).expect(200);
    await request(app).post('/api/v1/auth/refresh').send({ refreshToken: 'session-a' }).expect(401);
    await request(app).post('/api/v1/auth/refresh').send({ refreshToken: 'session-b' }).expect(200);
  });

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

  it('POST /change-password deletes only the other sessions', async () => {
    const currentHash = await hashPassword('currentpass123');
    const deleted: Array<Record<string, unknown>> = [];
    const app = await loadApp(authMock, defaultFindUnique, {
      accountFindFirst: () => Promise.resolve({ id: 'acc-1', password: currentHash }),
      accountUpdate: ({ data }) => {
        const password = String(data?.['password'] ?? '');
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

    expect(response.body.message).toBe(
      'Too many password change attempts. Try again in one minute.',
    );
  });

  it('POST /register creates user', async () => {
    authMock.api.signUpEmail.mockResolvedValue({ user: { id: 'u-new' } });
    const app = await loadApp(authMock);
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'new@b.com',
        password: 'strongpass1234',
        firstName: 'Nuevo',
        lastName: 'Usuario',
        identificationNumber: '8-999-9999',
      })
      .expect(201);
    expect(response.body.data).toEqual({ userId: 'u-new' });
    expect(JSON.stringify(response.body)).not.toContain('$argon2');
  });

  it('POST /register returns 409 on duplicate email', async () => {
    const app = await loadApp(authMock, ({ where }) =>
      where && 'email' in where ? Promise.resolve({ id: 'u-existing' }) : Promise.resolve(null),
    );
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'dup@b.com',
        password: 'strongpass1234',
        firstName: 'Nuevo',
        lastName: 'Usuario',
        identificationNumber: '8-999-9999',
      })
      .expect(409);
    expect(response.body.success).toBe(false);
    expect(authMock.api.signUpEmail).not.toHaveBeenCalled();
  });

  it('POST /register returns 409 on duplicate identification', async () => {
    const app = await loadApp(authMock, ({ where }) =>
      where && 'identificationNumber' in where
        ? Promise.resolve({ id: 'u-existing' })
        : Promise.resolve(null),
    );
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({
        email: 'fresh@b.com',
        password: 'strongpass1234',
        firstName: 'Nuevo',
        lastName: 'Usuario',
        identificationNumber: '8-999-9999',
      })
      .expect(409);
    expect(response.body.success).toBe(false);
    expect(authMock.api.signUpEmail).not.toHaveBeenCalled();
  });

  it('POST /register returns 429 on the fourth attempt within a minute', async () => {
    authMock.api.signUpEmail.mockResolvedValue({ user: { id: 'u-new' } });
    const app = await loadApp(authMock);
    const payload = (index: number) => ({
      email: `rate-limit-${index}@b.com`,
      password: 'strongpass1234',
      firstName: 'Nuevo',
      lastName: 'Usuario',
      identificationNumber: `8-999-99${index}0`,
    });

    for (let index = 1; index <= 3; index += 1) {
      await request(app).post('/api/v1/auth/register').send(payload(index)).expect(201);
    }

    const response = await request(app).post('/api/v1/auth/register').send(payload(4)).expect(429);
    expect(response.body.success).toBe(false);
  });

  it('POST /forgot-password returns the same response for existing and unknown emails', async () => {
    authMock.api.requestPasswordReset.mockResolvedValue({ success: true });
    const app = await loadApp(authMock);
    const existing = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'user@example.com' })
      .expect(200);
    const unknown = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'nobody@example.com' })
      .expect(200);

    expect(existing.body).toEqual(unknown.body);
    expect(existing.body).toEqual({
      success: true,
      message: 'If the email is registered, a reset link has been sent.',
      data: {},
    });
  });

  it('POST /forgot-password returns 429 on the fourth request within a minute', async () => {
    authMock.api.requestPasswordReset.mockResolvedValue({ success: true });
    const app = await loadApp(authMock);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await request(app)
        .post('/api/v1/auth/forgot-password')
        .send({ email: `user-${attempt}@example.com` })
        .expect(200);
    }

    const response = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'user-4@example.com' })
      .expect(429);
    expect(response.body.message).toBe(
      'Too many password reset attempts. Try again in one minute.',
    );
  });

  it('keeps forgot-password and reset-password rate limits independent', async () => {
    authMock.api.requestPasswordReset.mockResolvedValue({ success: true });
    authMock.api.resetPassword.mockResolvedValue(undefined);
    const app = await loadApp(authMock);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await request(app)
        .post('/api/v1/auth/forgot-password')
        .send({ email: `user-${attempt}@example.com` })
        .expect(200);
    }

    await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: 'valid-reset-token', newPassword: 'newstrongpass12' })
      .expect(200);
  });

  it('POST /reset-password delegates', async () => {
    authMock.api.resetPassword.mockResolvedValue(undefined);
    const app = await loadApp(authMock);
    await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: 't', newPassword: 'newstrongpass12' })
      .expect(200);
  });

  it('POST /reset-password returns a generic 400 for an expired token', async () => {
    const { APIError } = await import('better-auth/api');
    authMock.api.resetPassword.mockRejectedValue(
      new APIError(400, { message: 'Invalid token', code: 'INVALID_TOKEN' }),
    );
    const app = await loadApp(authMock);

    const response = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: 'expired-secret', newPassword: 'newstrongpass12' })
      .expect(400);

    expect(response.body.message).toBe('Password reset token is invalid or expired.');
    expect(JSON.stringify(response.body)).not.toContain('expired-secret');
  });

  it('POST /verify-email delegates', async () => {
    authMock.api.verifyEmail.mockResolvedValue(undefined);
    const app = await loadApp(authMock);
    await request(app)
      .post('/api/v1/auth/verify-email')
      .send({ token: 'verify-token' })
      .expect(200);
  });

  it('POST /verify-email returns a generic 400 for an expired token', async () => {
    const { APIError } = await import('better-auth/api');
    authMock.api.verifyEmail.mockRejectedValue(
      new APIError(401, { message: 'Token expired', code: 'TOKEN_EXPIRED' }),
    );
    const app = await loadApp(authMock);

    const response = await request(app)
      .post('/api/v1/auth/verify-email')
      .send({ token: 'expired-secret' })
      .expect(400);

    expect(response.body.message).toBe('Email verification token is invalid or expired.');
    expect(JSON.stringify(response.body)).not.toContain('expired-secret');
  });

  it('POST /forgot-password returns 429 on the fourth request within a minute', async () => {
    authMock.api.requestPasswordReset.mockResolvedValue({ success: true });
    const app = await loadApp(authMock);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await request(app)
        .post('/api/v1/auth/forgot-password')
        .send({ email: 'user@example.com' })
        .expect(200);
    }

    const response = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'user@example.com' })
      .expect(429);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toBe(
      'Too many password reset attempts. Try again in one minute.',
    );
  });

  it('POST /reset-password is not blocked by the forgot-password limit', async () => {
    authMock.api.requestPasswordReset.mockResolvedValue({ success: true });
    authMock.api.resetPassword.mockResolvedValue(undefined);
    const app = await loadApp(authMock);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await request(app)
        .post('/api/v1/auth/forgot-password')
        .send({ email: 'user@example.com' })
        .expect(200);
    }

    await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: 'reset-token', newPassword: 'newstrongpass12' })
      .expect(200);
  });

  it('POST /reset-password returns 429 on the fourth request within a minute', async () => {
    authMock.api.resetPassword.mockResolvedValue(undefined);
    const app = await loadApp(authMock);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await request(app)
        .post('/api/v1/auth/reset-password')
        .send({ token: 'reset-token', newPassword: 'newstrongpass12' })
        .expect(200);
    }

    const response = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: 'reset-token', newPassword: 'newstrongpass12' })
      .expect(429);
    expect(response.body.success).toBe(false);
  });

  it('POST /verify-email returns 429 on the sixth attempt within a minute', async () => {
    authMock.api.verifyEmail.mockResolvedValue(undefined);
    const app = await loadApp(authMock);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      await request(app)
        .post('/api/v1/auth/verify-email')
        .send({ token: 'verify-token' })
        .expect(200);
    }

    const response = await request(app)
      .post('/api/v1/auth/verify-email')
      .send({ token: 'verify-token' })
      .expect(429);
    expect(response.body.success).toBe(false);
    expect(response.body.message).toBe(
      'Too many email verification attempts. Try again in one minute.',
    );
  });
});
