import { afterEach, describe, expect, it, vi } from 'vitest';

import { hashPassword, verifyPassword } from './password.js';

describe('password hashing', () => {
  it('hashes a password with Argon2id', async () => {
    const hash = await hashPassword('StrongPass123!');

    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash.length).toBeGreaterThan(40);
  });

  it('verifies a correct password', async () => {
    const hash = await hashPassword('StrongPass123!');

    expect(await verifyPassword(hash, 'StrongPass123!')).toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const hash = await hashPassword('StrongPass123!');

    expect(await verifyPassword(hash, 'WrongPass456!')).toBe(false);
  });

  it('rejects passwords shorter than 12 chars', async () => {
    await expect(hashPassword('short')).rejects.toThrow();
  });

  it('rejects passwords longer than 20 chars', async () => {
    await expect(hashPassword('a'.repeat(21))).rejects.toThrow(
      'Password length must be between 12 and 20 characters.',
    );
  });

  it('accepts a password of exactly 20 chars', async () => {
    const password = 'a'.repeat(20);

    expect(await verifyPassword(await hashPassword(password), password)).toBe(true);
  });

  it('returns false on a malformed hash without throwing', async () => {
    expect(await verifyPassword('not-a-real-hash', 'whatever')).toBe(false);
  });
});

const ARGON2_ENV_KEYS = [
  'AUTH_ARGON2_MEMORY_COST',
  'AUTH_ARGON2_TIME_COST',
  'AUTH_ARGON2_PARALLELISM',
] as const;

describe('argon2 defaults for a 4 vCPU server', () => {
  const originalValues = new Map(ARGON2_ENV_KEYS.map((key) => [key, process.env[key]]));

  afterEach(() => {
    for (const key of ARGON2_ENV_KEYS) {
      const value = originalValues.get(key);
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    vi.resetModules();
  });

  it('uses the OWASP 12 MiB / t=3 / p=1 configuration by default', async () => {
    for (const key of ARGON2_ENV_KEYS) {
      delete process.env[key];
    }
    vi.resetModules();

    const { hashPassword: hash } = await import('./password.js');
    const value = await hash('StrongPass123!');

    expect(value).toMatch(/^\$argon2id\$v=19\$m=12288,t=3,p=1\$/);
  });
});
