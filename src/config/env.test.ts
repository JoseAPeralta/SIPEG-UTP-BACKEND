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
