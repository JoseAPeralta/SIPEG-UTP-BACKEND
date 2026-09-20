import {
  calculateJwkThumbprint,
  decodeJwt,
  decodeProtectedHeader,
  exportJWK,
  generateKeyPair,
} from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hashPassword, verifyPassword } from '../../lib/password.js';

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

const loadService = async (authMock: AuthMock, prismaMock: PrismaMock) => {
  vi.resetModules();
  vi.doMock('../../lib/auth.js', () => ({ auth: authMock }));
  vi.doMock('../../config/prisma.js', () => ({ getPrismaClient: () => prismaMock }));
  vi.doMock('../../config/env.js', () => ({
    env: {
      AUTH_URL: 'http://localhost:3000',
      AUTH_TOKEN_TTL: '15m',
      AUTH_PASSWORD_RESET_URL: 'http://localhost:5173/reset-password',
    },
  }));
  return import('./auth.service.js');
};

const setupJwks = async (prismaMock: PrismaMock): Promise<void> => {
  const kp = await generateKeyPair('EdDSA', { crv: 'Ed25519', extractable: true });
  const publicJwk = await exportJWK(kp.publicKey);
  const privateJwk = await exportJWK(kp.privateKey);
  const kid = await calculateJwkThumbprint(publicJwk);
  publicJwk.kid = kid;
  privateJwk.kid = kid;
  prismaMock.jwks.findMany.mockResolvedValue([
    {
      id: kid,
      publicKey: JSON.stringify(publicJwk),
      privateKey: JSON.stringify(privateJwk),
    },
  ]);
};

describe('auth service', () => {
  let authMock: AuthMock;
  let prismaMock: PrismaMock;

  beforeEach(async () => {
    process.env['NODE_ENV'] = 'test';
    process.env['AUTH_SECRET'] = 'a'.repeat(32);
    authMock = createAuthMock();
    prismaMock = createPrismaMock();
    await setupJwks(prismaMock);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.doUnmock('../../lib/auth.js');
    vi.doUnmock('../../config/prisma.js');
    vi.doUnmock('../../config/env.js');
  });

  it('login returns tokens on success', async () => {
    authMock.api.signInEmail.mockResolvedValue({
      token: 'refresh-token',
      redirect: false,
      user: { id: 'u-1', email: 'a@b.com' },
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
    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBe('refresh-token');
  });

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
    expect(prismaMock.session.deleteMany).toHaveBeenCalledWith({
      where: { token: 'refresh-token' },
    });
  });

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

  it('login surfaces signing key failures as a 500', async () => {
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
    prismaMock.jwks.findMany.mockResolvedValue([]);

    const { loginWithPassword } = await loadService(authMock, prismaMock);
    await expect(
      loginWithPassword({ email: 'a@b.com', password: 'strongpass1234' }),
    ).rejects.toMatchObject({ statusCode: 500 });
  });

  it('login maps errors to 401', async () => {
    const { APIError } = await import('better-auth/api');
    authMock.api.signInEmail.mockRejectedValue(
      new APIError(401, { message: 'Invalid email or password' }),
    );
    const { loginWithPassword } = await loadService(authMock, prismaMock);
    await expect(loginWithPassword({ email: 'a@b.com', password: 'wrong' })).rejects.toMatchObject({
      statusCode: 401,
    });
  });

  it('refresh rejects when session lookup fails', async () => {
    prismaMock.session.findFirst.mockResolvedValue(null);
    const { refreshAccessToken } = await loadService(authMock, prismaMock);
    await expect(refreshAccessToken({ refreshToken: 'expired' })).rejects.toMatchObject({
      statusCode: 401,
    });
  });

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

  it('register forwards additional fields', async () => {
    authMock.api.signUpEmail.mockResolvedValue({ user: { id: 'u-1' } });
    prismaMock.user.findUnique.mockImplementation(
      ({ where }: { where: Record<string, unknown> }) => {
        if ('id' in where) return Promise.resolve({ id: 'u-1' });
        return Promise.resolve(null);
      },
    );
    const { registerUser } = await loadService(authMock, prismaMock);
    await registerUser({
      email: 'a@b.com',
      password: 'strongpass1234',
      firstName: 'Ana',
      lastName: 'Perez',
      identificationNumber: '8-123-4567',
    });
    expect(authMock.api.signUpEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ firstName: 'Ana', identificationNumber: '8-123-4567' }),
      }),
    );
  });

  it('register rejects duplicate identification before calling Better Auth', async () => {
    prismaMock.user.findUnique.mockImplementation(
      ({ where }: { where: Record<string, unknown> }) => {
        if ('identificationNumber' in where) return Promise.resolve({ id: 'u-existing' });
        return Promise.resolve(null);
      },
    );

    const { registerUser } = await loadService(authMock, prismaMock);
    await expect(
      registerUser({
        email: 'new@b.com',
        password: 'strongpass1234',
        firstName: 'Ana',
        lastName: 'Perez',
        identificationNumber: '8-123-4567',
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: 'Identification number is already registered.',
    });
    expect(authMock.api.signUpEmail).not.toHaveBeenCalled();
  });

  it('register rejects duplicate email before calling Better Auth', async () => {
    prismaMock.user.findUnique.mockImplementation(
      ({ where }: { where: Record<string, unknown> }) => {
        if ('email' in where) return Promise.resolve({ id: 'u-existing' });
        return Promise.resolve(null);
      },
    );

    const { registerUser } = await loadService(authMock, prismaMock);
    await expect(
      registerUser({
        email: 'dup@b.com',
        password: 'strongpass1234',
        firstName: 'Ana',
        lastName: 'Perez',
        identificationNumber: '8-123-4567',
      }),
    ).rejects.toMatchObject({ statusCode: 409, message: 'Email is already registered.' });
    expect(authMock.api.signUpEmail).not.toHaveBeenCalled();
  });

  it('register normalizes the email before duplicate checks', async () => {
    authMock.api.signUpEmail.mockResolvedValue({ user: { id: 'u-1' } });
    prismaMock.user.findUnique.mockImplementation(
      ({ where }: { where: Record<string, unknown> }) => {
        if ('id' in where) return Promise.resolve({ id: 'u-1' });
        return Promise.resolve(null);
      },
    );

    const { registerUser } = await loadService(authMock, prismaMock);
    await registerUser({
      email: 'Mixed.Case@UTP.ac.pa',
      password: 'strongpass1234',
      firstName: 'Ana',
      lastName: 'Perez',
      identificationNumber: '8-123-4567',
    });

    expect(prismaMock.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: 'mixed.case@utp.ac.pa' } }),
    );
  });

  it('register rejects when Better Auth returns a synthetic user that was not persisted', async () => {
    authMock.api.signUpEmail.mockResolvedValue({ user: { id: 'synthetic-id' } });
    prismaMock.user.findUnique.mockResolvedValue(null);

    const { registerUser } = await loadService(authMock, prismaMock);
    await expect(
      registerUser({
        email: 'dup@b.com',
        password: 'strongpass1234',
        firstName: 'Ana',
        lastName: 'Perez',
        identificationNumber: '8-123-4567',
      }),
    ).rejects.toMatchObject({ statusCode: 409, message: 'Email is already registered.' });
  });

  it('register maps a duplicate email APIError to 409', async () => {
    const { APIError } = await import('better-auth/api');
    authMock.api.signUpEmail.mockRejectedValue(
      new APIError(422, {
        message: 'User already exists. Use another email.',
        code: 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL',
      }),
    );
    prismaMock.user.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'u-existing' });

    const { registerUser } = await loadService(authMock, prismaMock);
    await expect(
      registerUser({
        email: 'dup@b.com',
        password: 'strongpass1234',
        firstName: 'Ana',
        lastName: 'Perez',
        identificationNumber: '8-123-4567',
      }),
    ).rejects.toMatchObject({ statusCode: 409, message: 'Email is already registered.' });
  });

  it('register keeps 422 when Better Auth fails without a stored conflict', async () => {
    const { APIError } = await import('better-auth/api');
    authMock.api.signUpEmail.mockRejectedValue(
      new APIError(422, { message: 'Failed to create user' }),
    );
    prismaMock.user.findUnique.mockResolvedValue(null);

    const { registerUser } = await loadService(authMock, prismaMock);
    await expect(
      registerUser({
        email: 'ghost@b.com',
        password: 'strongpass1234',
        firstName: 'Ana',
        lastName: 'Perez',
        identificationNumber: '8-123-4567',
      }),
    ).rejects.toMatchObject({ statusCode: 422 });
  });

  it('register does not forward globalRole to Better Auth', async () => {
    authMock.api.signUpEmail.mockResolvedValue({ user: { id: 'u-1' } });
    prismaMock.user.findUnique.mockImplementation(
      ({ where }: { where: Record<string, unknown> }) => {
        if ('id' in where) return Promise.resolve({ id: 'u-1' });
        return Promise.resolve(null);
      },
    );

    const { registerUser } = await loadService(authMock, prismaMock);
    await registerUser({
      email: 'a@b.com',
      password: 'strongpass1234',
      firstName: 'Ana',
      lastName: 'Perez',
      identificationNumber: '8-123-4567',
    });

    const call = authMock.api.signUpEmail.mock.calls[0]?.[0] as { body: Record<string, unknown> };
    expect(call.body).not.toHaveProperty('globalRole');
  });

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

  it('logout deletes the session row', async () => {
    prismaMock.session.deleteMany.mockResolvedValue({ count: 1 });
    const { logoutUser } = await loadService(authMock, prismaMock);
    await logoutUser({ refreshToken: 'refresh-1' });
    expect(prismaMock.session.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { token: 'refresh-1' } }),
    );
  });

  it('verifyEmail delegates', async () => {
    authMock.api.verifyEmail.mockResolvedValue(undefined);
    const { verifyEmail } = await loadService(authMock, prismaMock);
    await verifyEmail({ token: 'verify-token' });
    expect(authMock.api.verifyEmail).toHaveBeenCalledWith(
      expect.objectContaining({ query: { token: 'verify-token' } }),
    );
  });

  it('verifyEmail returns a generic error for an expired token', async () => {
    const { APIError } = await import('better-auth/api');
    authMock.api.verifyEmail.mockRejectedValue(
      new APIError(401, { message: 'Token expired', code: 'TOKEN_EXPIRED' }),
    );
    const { verifyEmail } = await loadService(authMock, prismaMock);

    await expect(verifyEmail({ token: 'expired-secret' })).rejects.toMatchObject({
      statusCode: 400,
      message: 'Email verification token is invalid or expired.',
    });
  });

  it('forgot password always resolves', async () => {
    authMock.api.requestPasswordReset.mockResolvedValue({ success: true });
    const { requestPasswordReset } = await loadService(authMock, prismaMock);
    await expect(requestPasswordReset({ email: 'nobody@example.com' })).resolves.toBeUndefined();
  });

  it('forgot password normalizes the email and uses the frontend reset URL', async () => {
    authMock.api.requestPasswordReset.mockResolvedValue({ success: true });
    const { requestPasswordReset } = await loadService(authMock, prismaMock);

    await requestPasswordReset({ email: '  User@UTP.ac.pa  ' });

    expect(authMock.api.requestPasswordReset).toHaveBeenCalledWith(
      expect.objectContaining({
        body: {
          email: 'user@utp.ac.pa',
          redirectTo: 'http://localhost:5173/reset-password',
        },
      }),
    );
  });

  it('reset password delegates', async () => {
    authMock.api.resetPassword.mockResolvedValue(undefined);
    const { resetPassword } = await loadService(authMock, prismaMock);
    await resetPassword({ token: 't', newPassword: 'newpass12345' });
    expect(authMock.api.resetPassword).toHaveBeenCalledWith(
      expect.objectContaining({ body: { token: 't', newPassword: 'newpass12345' } }),
    );
  });

  it('reset password returns a generic error for an expired token', async () => {
    const { APIError } = await import('better-auth/api');
    authMock.api.resetPassword.mockRejectedValue(
      new APIError(400, { message: 'Invalid token', code: 'INVALID_TOKEN' }),
    );
    const { resetPassword } = await loadService(authMock, prismaMock);

    await expect(
      resetPassword({ token: 'expired-secret', newPassword: 'newpass12345' }),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: 'Password reset token is invalid or expired.',
    });
  });
});
