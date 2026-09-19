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

const loadService = async (authMock: AuthMock) => {
  vi.resetModules();
  vi.doMock('../../lib/auth.js', () => ({ auth: authMock }));
  vi.doMock('../../config/env.js', () => ({ env: { AUTH_URL: 'http://localhost:3000' } }));
  return import('./auth.service.js');
};

describe('auth service', () => {
  let authMock: AuthMock;
  beforeEach(() => {
    process.env['NODE_ENV'] = 'test';
    process.env['AUTH_SECRET'] = 'a'.repeat(32);
    authMock = createAuthMock();
  });
  afterEach(() => {
    vi.clearAllMocks();
    vi.doUnmock('../../lib/auth.js');
    vi.doUnmock('../../config/env.js');
  });

  it('login returns tokens on success', async () => {
    authMock.api.signInEmail.mockResolvedValue({
      token: 'refresh-token',
      redirect: false,
      user: { id: 'u-1', email: 'a@b.com' },
    });
    authMock.api.getToken.mockResolvedValue({
      token: 'access-jwt',
    });
    authMock.api.getSession.mockResolvedValue({
      session: { expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() },
      user: { id: 'u-1' },
    });
    const { loginWithPassword } = await loadService(authMock);
    const result = await loginWithPassword({ email: 'a@b.com', password: 'strongpass1234' });
    expect(result.accessToken).toBe('access-jwt');
    expect(result.refreshToken).toBe('refresh-token');
  });

  it('login maps errors to 401', async () => {
    const { APIError } = await import('better-auth/api');
    authMock.api.signInEmail.mockRejectedValue(new APIError(401, { message: 'Invalid email or password' }));
    const { loginWithPassword } = await loadService(authMock);
    await expect(loginWithPassword({ email: 'a@b.com', password: 'wrong' }))
      .rejects.toMatchObject({ statusCode: 401 });
  });

  it('refresh rejects when session lookup fails', async () => {
    authMock.api.getToken.mockResolvedValue({
      token: 'new-access', expiresAt: new Date().toISOString(),
    });
    authMock.api.getSession.mockResolvedValue(null);
    const { refreshAccessToken } = await loadService(authMock);
    await expect(refreshAccessToken({ refreshToken: 'expired' }))
      .rejects.toMatchObject({ statusCode: 401 });
  });

  it('register forwards additional fields', async () => {
    authMock.api.signUpEmail.mockResolvedValue({ user: { id: 'u-1' } });
    const { registerUser } = await loadService(authMock);
    await registerUser({
      email: 'a@b.com', password: 'strongpass1234',
      firstName: 'Ana', lastName: 'Perez', identificationNumber: '8-123-4567',
    });
    expect(authMock.api.signUpEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ firstName: 'Ana', identificationNumber: '8-123-4567' }),
      }),
    );
  });

  it('logout signs out with refresh token', async () => {
    authMock.api.signOut.mockResolvedValue(undefined);
    const { logoutUser } = await loadService(authMock);
    await logoutUser({ refreshToken: 'refresh-1' });
    expect(authMock.api.signOut).toHaveBeenCalledWith(
      expect.objectContaining({ headers: expect.objectContaining({ authorization: 'Bearer refresh-1' }) }),
    );
  });

  it('verifyEmail delegates', async () => {
    authMock.api.verifyEmail.mockResolvedValue(undefined);
    const { verifyEmail } = await loadService(authMock);
    await verifyEmail({ token: 'verify-token' });
    expect(authMock.api.verifyEmail).toHaveBeenCalledWith(
      expect.objectContaining({ query: { token: 'verify-token' } }),
    );
  });

  it('forgot password always resolves', async () => {
    authMock.api.requestPasswordReset.mockResolvedValue({ success: true });
    const { requestPasswordReset } = await loadService(authMock);
    await expect(requestPasswordReset({ email: 'nobody@example.com' })).resolves.toBeUndefined();
  });

  it('reset password delegates', async () => {
    authMock.api.resetPassword.mockResolvedValue(undefined);
    const { resetPassword } = await loadService(authMock);
    await resetPassword({ token: 't', newPassword: 'newpass12345' });
    expect(authMock.api.resetPassword).toHaveBeenCalledWith(
      expect.objectContaining({ body: { token: 't', newPassword: 'newpass12345' } }),
    );
  });
});
