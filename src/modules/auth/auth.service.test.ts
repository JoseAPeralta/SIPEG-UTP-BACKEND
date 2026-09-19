import { calculateJwkThumbprint, exportJWK, generateKeyPair } from 'jose';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
  session: { findFirst: ReturnType<typeof vi.fn>; deleteMany: ReturnType<typeof vi.fn> };
  jwks: { findMany: ReturnType<typeof vi.fn>; count: ReturnType<typeof vi.fn> };
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

const createPrismaMock = (): PrismaMock => ({
  user: { findUnique: vi.fn(), update: vi.fn() },
  session: { findFirst: vi.fn(), deleteMany: vi.fn() },
  jwks: { findMany: vi.fn(), count: vi.fn() },
});

const loadService = async (authMock: AuthMock, prismaMock: PrismaMock) => {
  vi.resetModules();
  vi.doMock('../../lib/auth.js', () => ({ auth: authMock }));
  vi.doMock('../../config/prisma.js', () => ({ getPrismaClient: () => prismaMock }));
  vi.doMock('../../config/env.js', () => ({
    env: {
      AUTH_URL: 'http://localhost:3000',
      AUTH_TOKEN_TTL: '15m',
    },
  }));
  return import('./auth.service.js');
};

const setupJwks = async (prismaMock: PrismaMock): Promise<void> => {
  const kp = await generateKeyPair('EdDSA', { crv: 'Ed25519' });
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
      facultyId: null,
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

  it('refresh issues new access token on valid session', async () => {
    prismaMock.session.findFirst.mockResolvedValue({
      expiresAt: new Date(Date.now() + 86400000),
      userId: 'u-1',
      user: {
        id: 'u-1',
        email: 'a@b.com',
        globalRole: 'USER',
        facultyId: null,
        careerId: null,
        isActive: true,
      },
    });

    const { refreshAccessToken } = await loadService(authMock, prismaMock);
    const result = await refreshAccessToken({ refreshToken: 'valid' });
    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBe('valid');
  });

  it('register forwards additional fields', async () => {
    authMock.api.signUpEmail.mockResolvedValue({ user: { id: 'u-1' } });
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

  it('forgot password always resolves', async () => {
    authMock.api.requestPasswordReset.mockResolvedValue({ success: true });
    const { requestPasswordReset } = await loadService(authMock, prismaMock);
    await expect(requestPasswordReset({ email: 'nobody@example.com' })).resolves.toBeUndefined();
  });

  it('reset password delegates', async () => {
    authMock.api.resetPassword.mockResolvedValue(undefined);
    const { resetPassword } = await loadService(authMock, prismaMock);
    await resetPassword({ token: 't', newPassword: 'newpass12345' });
    expect(authMock.api.resetPassword).toHaveBeenCalledWith(
      expect.objectContaining({ body: { token: 't', newPassword: 'newpass12345' } }),
    );
  });
});
