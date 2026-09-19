import { describe, expect, it } from 'vitest';

import { authTokensSchema, registerResultSchema } from './auth.schemas.js';

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

describe('registerResultSchema', () => {
  it('accepts a registration result', () => {
    expect(registerResultSchema.parse({ userId: 'user-001' })).toEqual({ userId: 'user-001' });
  });

  it('rejects a result without userId', () => {
    expect(() => registerResultSchema.parse({})).toThrow();
  });
});
