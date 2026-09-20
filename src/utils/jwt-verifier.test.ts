import { describe, expect, it } from 'vitest';

import { createJwtVerifierWithLocalJwks } from './jwt-verifier.js';
import { createTestJwks, signTestToken } from '../test-helpers/auth-helpers.js';

const issuer = 'http://localhost:3000';
const audience = 'http://localhost:3000';

describe('jwt verifier', () => {
  it('accepts a valid token', async () => {
    const { privateKey, publicJwk, kid } = await createTestJwks();
    const verifier = createJwtVerifierWithLocalJwks({ keys: [publicJwk] });
    const token = await signTestToken({
      privateKey,
      kid,
      issuer,
      audience,
      subject: 'user-1',
      payload: { email: 'a@b.com', role: 'USER', unitId: null, careerId: null, isActive: true },
    });
    const payload = await verifier.verify(token);
    expect(payload.sub).toBe('user-1');
    expect(payload.email).toBe('a@b.com');
  });

  it('rejects an expired token', async () => {
    const { privateKey, publicJwk, kid } = await createTestJwks();
    const verifier = createJwtVerifierWithLocalJwks({ keys: [publicJwk] });
    const token = await signTestToken({
      privateKey,
      kid,
      issuer,
      audience,
      subject: 'user-1',
      payload: { email: 'a@b.com', role: 'USER' },
      expiresIn: '-1s',
    });
    await expect(verifier.verify(token)).rejects.toMatchObject({ statusCode: 401 });
  });

  it('rejects a token with wrong audience', async () => {
    const { privateKey, publicJwk, kid } = await createTestJwks();
    const verifier = createJwtVerifierWithLocalJwks({ keys: [publicJwk] });
    const token = await signTestToken({
      privateKey,
      kid,
      issuer,
      audience: 'http://attacker.example.com',
      subject: 'user-1',
      payload: { email: 'a@b.com', role: 'USER' },
    });
    await expect(verifier.verify(token)).rejects.toMatchObject({ statusCode: 401 });
  });

  it('rejects a token with wrong issuer', async () => {
    const { privateKey, publicJwk, kid } = await createTestJwks();
    const verifier = createJwtVerifierWithLocalJwks({ keys: [publicJwk] });
    const token = await signTestToken({
      privateKey,
      kid,
      issuer: 'http://attacker.example.com',
      audience,
      subject: 'user-1',
      payload: { email: 'a@b.com', role: 'USER' },
    });
    await expect(verifier.verify(token)).rejects.toMatchObject({ statusCode: 401 });
  });

  it('rejects a token with unknown kid', async () => {
    const { privateKey, publicJwk } = await createTestJwks();
    const verifier = createJwtVerifierWithLocalJwks({ keys: [publicJwk] });
    const token = await signTestToken({
      privateKey,
      kid: 'unknown-kid',
      issuer,
      audience,
      subject: 'user-1',
      payload: { email: 'a@b.com', role: 'USER' },
    });
    await expect(verifier.verify(token)).rejects.toMatchObject({ statusCode: 401 });
  });
});
