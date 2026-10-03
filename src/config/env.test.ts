import { afterEach, describe, expect, it, vi } from 'vitest';

const importEnv = async () => {
  vi.resetModules();

  return import('./env.js');
};

describe('env LOG_LEVEL', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it.each(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])(
    'accepts the %s level',
    async (level) => {
      vi.stubEnv('LOG_LEVEL', level);

      const { env } = await importEnv();

      expect(env.LOG_LEVEL).toBe(level);
    },
  );

  it('rejects a level outside the catalog', async () => {
    vi.stubEnv('LOG_LEVEL', 'verbose');

    await expect(importEnv()).rejects.toThrow();
  });

  it('defaults to info when LOG_LEVEL is absent', async () => {
    vi.stubEnv('LOG_LEVEL', undefined);

    const { env } = await importEnv();

    expect(env.LOG_LEVEL).toBe('info');
  });
});

describe('env AUTH_PASSWORD_RESET_URL', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  const stubBase = (): void => {
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('AUTH_SECRET', 'a'.repeat(32));
    vi.stubEnv('CORS_ORIGIN', 'https://app.example.com');
  };

  it('accepts a reset URL whose origin is the CORS origin', async () => {
    stubBase();
    vi.stubEnv('AUTH_PASSWORD_RESET_URL', 'https://app.example.com/reset-password');

    const { env } = await importEnv();

    expect(env.AUTH_PASSWORD_RESET_URL).toBe('https://app.example.com/reset-password');
  });

  it('accepts a reset URL whose origin is listed in TRUSTED_ORIGINS', async () => {
    stubBase();
    vi.stubEnv('TRUSTED_ORIGINS', 'https://admin.example.com,https://app.example.com');
    vi.stubEnv('AUTH_PASSWORD_RESET_URL', 'https://admin.example.com/reset-password');

    const { env } = await importEnv();

    expect(env.AUTH_PASSWORD_RESET_URL).toBe('https://admin.example.com/reset-password');
  });

  it('rejects a reset URL whose origin is not trusted', async () => {
    stubBase();
    vi.stubEnv('AUTH_PASSWORD_RESET_URL', 'https://evil.example.com/reset-password');

    await expect(importEnv()).rejects.toThrow(/AUTH_PASSWORD_RESET_URL/);
  });

  it('rejects a reset URL whose origin is not trusted even outside production', async () => {
    stubBase();
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('AUTH_PASSWORD_RESET_URL', 'https://preview.example.com/reset-password');

    await expect(importEnv()).rejects.toThrow(/AUTH_PASSWORD_RESET_URL/);
  });
});
