import { describe, expect, it } from 'vitest';

import { authTokensSchema, changePasswordSchema, registerResultSchema } from './auth.schemas.js';

const authTokensPayload = {
  accessToken: 'header.payload.signature',
  accessTokenExpiresAt: '2026-09-19T10:15:00.000Z',
  refreshToken: 'session-token',
  refreshTokenExpiresAt: '2026-09-26T10:00:00.000Z',
  tokenType: 'Bearer',
};

describe('authTokensSchema', () => {
  it('accepts the auth success payload', () => {
    expect(authTokensSchema.parse(authTokensPayload)).toEqual(authTokensPayload);
  });

  it('rejects a non ISO expiration timestamp', () => {
    expect(() =>
      authTokensSchema.parse({ ...authTokensPayload, accessTokenExpiresAt: 'tomorrow' }),
    ).toThrow();
  });

  it('rejects an unknown token type', () => {
    expect(() => authTokensSchema.parse({ ...authTokensPayload, tokenType: 'Basic' })).toThrow();
  });
});

describe('changePasswordSchema', () => {
  const validBody = {
    currentPassword: 'currentpass123',
    newPassword: 'newstrongpass12',
    refreshToken: 'session-token',
  };

  it('accepts a valid change password body', () => {
    expect(changePasswordSchema.parse({ body: validBody })).toEqual({ body: validBody });
  });

  it('rejects a new password shorter than 12 characters', () => {
    expect(changePasswordSchema).toBeDefined();
    expect(() =>
      changePasswordSchema.parse({ body: { ...validBody, newPassword: 'short123456' } }),
    ).toThrow();
  });

  it('rejects an empty current password', () => {
    expect(changePasswordSchema).toBeDefined();
    expect(() =>
      changePasswordSchema.parse({ body: { ...validBody, currentPassword: '' } }),
    ).toThrow();
  });

  it('rejects an empty refresh token', () => {
    expect(changePasswordSchema).toBeDefined();
    expect(() =>
      changePasswordSchema.parse({ body: { ...validBody, refreshToken: '' } }),
    ).toThrow();
  });
});

describe('registerResultSchema', () => {
  it('accepts a registration result', () => {
    expect(registerResultSchema.parse({ userId: 'user-001' })).toEqual({ userId: 'user-001' });
  });

  it('rejects a result without userId', () => {
    expect(() => registerResultSchema.parse({})).toThrow();
  });
});
