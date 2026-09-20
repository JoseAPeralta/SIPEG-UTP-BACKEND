import { afterEach, describe, expect, it, vi } from 'vitest';

const sendMail = vi.fn().mockResolvedValue({ messageId: 'message-1' });
const createTransport = vi.fn(() => ({ sendMail }));

interface EmailEnvOverrides {
  NODE_ENV?: 'development' | 'test' | 'production';
  MAIL_USER?: string;
  MAIL_PASSWORD?: string;
}

const loadEmail = async (overrides: EmailEnvOverrides = {}) => {
  vi.resetModules();
  vi.doMock('nodemailer', () => ({
    default: { createTransport },
  }));
  vi.doMock('../config/env.js', () => ({
    env: {
      NODE_ENV: overrides.NODE_ENV ?? 'test',
      MAIL_HOST: 'smtp.test',
      MAIL_PORT: 2525,
      MAIL_SECURE: false,
      MAIL_FROM: 'SIPEG UTP <no-reply@utp.ac.pa>',
      ...(overrides.MAIL_USER ? { MAIL_USER: overrides.MAIL_USER } : {}),
      ...(overrides.MAIL_PASSWORD ? { MAIL_PASSWORD: overrides.MAIL_PASSWORD } : {}),
    },
  }));

  return import('./email.js');
};

describe('email transport', () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.doUnmock('nodemailer');
    vi.doUnmock('../config/env.js');
  });

  it('sends a plain-text message through SMTP without undefined auth', async () => {
    const { sendEmail } = await loadEmail();

    await sendEmail({
      to: 'user@utp.ac.pa',
      subject: 'Subject',
      text: 'Body',
    });

    expect(createTransport).toHaveBeenCalledWith({
      host: 'smtp.test',
      port: 2525,
      secure: false,
      tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    });
    expect(sendMail).toHaveBeenCalledWith({
      from: 'SIPEG UTP <no-reply@utp.ac.pa>',
      to: 'user@utp.ac.pa',
      subject: 'Subject',
      text: 'Body',
    });
  });

  it('configures SMTP credentials and requires STARTTLS in production', async () => {
    const { sendEmail } = await loadEmail({
      NODE_ENV: 'production',
      MAIL_USER: 'smtp-user',
      MAIL_PASSWORD: 'smtp-password',
    });

    await sendEmail({
      to: 'user@utp.ac.pa',
      subject: 'Subject',
      text: 'Body',
    });

    expect(createTransport).toHaveBeenCalledWith({
      host: 'smtp.test',
      port: 2525,
      secure: false,
      requireTLS: true,
      auth: { user: 'smtp-user', pass: 'smtp-password' },
      tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
    });
  });
});
