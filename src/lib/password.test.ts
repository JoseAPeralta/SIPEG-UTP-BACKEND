import { describe, expect, it } from 'vitest';

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

  it('returns false on a malformed hash without throwing', async () => {
    expect(await verifyPassword('not-a-real-hash', 'whatever')).toBe(false);
  });
});
