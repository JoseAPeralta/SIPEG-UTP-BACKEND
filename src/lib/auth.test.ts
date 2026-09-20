import { afterEach, describe, expect, it, vi } from 'vitest';

const { sendPasswordResetEmail, sendVerificationEmail } = vi.hoisted(() => ({
  sendPasswordResetEmail: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  sendVerificationEmail: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
}));

vi.mock('../modules/auth/auth.email.js', () => ({
  sendPasswordResetEmail,
  sendVerificationEmail,
}));

describe('auth instance', () => {
  afterEach(() => {
    delete process.env['AUTH_REFRESH_TTL'];
    delete process.env['AUTH_EMAIL_VERIFICATION_TTL'];
    delete process.env['AUTH_PASSWORD_RESET_TTL'];
    delete process.env['AUTH_EMAIL_VERIFICATION_URL'];
    delete process.env['AUTH_PASSWORD_RESET_URL'];
    sendPasswordResetEmail.mockReset().mockResolvedValue(undefined);
    sendVerificationEmail.mockReset().mockResolvedValue(undefined);
    vi.doUnmock('../config/prisma.js');
  });

  it('boots with required env vars', async () => {
    process.env['NODE_ENV'] = 'test';
    process.env['AUTH_SECRET'] = 'a'.repeat(32);
    process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test';
    process.env['AUTH_URL'] = 'http://localhost:3000';
    process.env['AUTH_REFRESH_TTL'] = '2h';
    process.env['AUTH_EMAIL_VERIFICATION_TTL'] = '24h';
    process.env['AUTH_PASSWORD_RESET_TTL'] = '1h';
    process.env['AUTH_EMAIL_VERIFICATION_URL'] = 'http://localhost:5173/verify-email';
    process.env['AUTH_PASSWORD_RESET_URL'] = 'http://localhost:5173/reset-password';
    vi.resetModules();

    vi.doMock('../config/prisma.js', () => ({
      getPrismaClient: () => ({}),
    }));

    const { auth } = await import('./auth.js');

    expect(auth.options.baseURL).toBe('http://localhost:3000');
    expect(auth.options.plugins?.length ?? 0).toBeGreaterThan(0);
    expect(auth.options.session).toMatchObject({
      expiresIn: 7200,
      disableSessionRefresh: true,
    });
    expect(auth.options.emailAndPassword).toMatchObject({
      requireEmailVerification: true,
      resetPasswordTokenExpiresIn: 3600,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: expect.any(Function),
    });
    expect(auth.options.emailVerification).toMatchObject({
      sendOnSignUp: true,
      autoSignInAfterVerification: false,
      expiresIn: 86_400,
      sendVerificationEmail: expect.any(Function),
    });
  });

  it('dispatches auth emails without awaiting delivery and logs no sensitive details', async () => {
    process.env['NODE_ENV'] = 'test';
    process.env['AUTH_SECRET'] = 'a'.repeat(32);
    process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test';
    process.env['AUTH_URL'] = 'http://localhost:3000';
    vi.resetModules();
    vi.doMock('../config/prisma.js', () => ({
      getPrismaClient: () => ({}),
    }));
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    let rejectDelivery: ((reason: Error) => void) | undefined;
    const rejectedDelivery = new Promise<void>((_resolve, reject) => {
      rejectDelivery = reject;
    });
    sendVerificationEmail.mockReturnValueOnce(rejectedDelivery);
    sendPasswordResetEmail.mockReturnValueOnce(new Promise<void>(() => undefined));

    const { auth } = await import('./auth.js');
    const verificationCallback = auth.options.emailVerification?.sendVerificationEmail;
    const resetCallback = auth.options.emailAndPassword?.sendResetPassword;
    const user = { email: 'user@utp.ac.pa' } as never;

    const verificationResult = verificationCallback?.({
      user,
      token: 'verification-secret',
      url: 'https://secret.example/verify',
    });
    const resetResult = resetCallback?.({
      user,
      token: 'reset-secret',
      url: 'https://secret.example/reset',
    });

    await expect(verificationResult).resolves.toBeUndefined();
    await expect(resetResult).resolves.toBeUndefined();
    expect(sendVerificationEmail).toHaveBeenCalledWith('user@utp.ac.pa', 'verification-secret');
    expect(sendPasswordResetEmail).toHaveBeenCalledWith('user@utp.ac.pa', 'reset-secret');
    rejectDelivery?.(new Error('SMTP secret detail'));
    await vi.waitFor(() => {
      expect(consoleError).toHaveBeenCalledWith('Failed to deliver authentication email.');
    });
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('secret');
    consoleError.mockRestore();
  });
});
