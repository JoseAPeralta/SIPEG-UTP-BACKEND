import { beforeEach, describe, expect, it, vi } from 'vitest';

const { sendEmail } = vi.hoisted(() => ({
  sendEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../lib/email.js', () => ({ sendEmail }));
vi.mock('../../config/env.js', () => ({
  env: {
    AUTH_EMAIL_VERIFICATION_URL: 'http://localhost:5173/verify-email',
    AUTH_PASSWORD_RESET_URL: 'http://localhost:5173/reset-password',
    AUTH_EMAIL_VERIFICATION_TTL: '24h',
    AUTH_PASSWORD_RESET_TTL: '1h',
  },
}));

describe('auth emails', () => {
  beforeEach(() => {
    sendEmail.mockClear();
  });

  it('sends an email verification link with an encoded token', async () => {
    const { sendVerificationEmail } = await import('./auth.email.js');

    await sendVerificationEmail('user@utp.ac.pa', 'verify token/+');

    expect(sendEmail).toHaveBeenCalledWith({
      to: 'user@utp.ac.pa',
      subject: 'Verifica tu correo de SIPEG UTP',
      text: expect.stringContaining('http://localhost:5173/verify-email?token=verify+token%2F%2B'),
    });
    expect(sendEmail.mock.calls[0]?.[0].text).toContain('24h');
  });

  it('sends a password reset link with an encoded token', async () => {
    const { sendPasswordResetEmail } = await import('./auth.email.js');

    await sendPasswordResetEmail('user@utp.ac.pa', 'reset token/+');

    expect(sendEmail).toHaveBeenCalledWith({
      to: 'user@utp.ac.pa',
      subject: 'Restablece tu contrasena de SIPEG UTP',
      text: expect.stringContaining('http://localhost:5173/reset-password?token=reset+token%2F%2B'),
    });
    expect(sendEmail.mock.calls[0]?.[0].text).toContain('1h');
  });
});
