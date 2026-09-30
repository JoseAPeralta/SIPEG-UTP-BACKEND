import { describe, expect, it } from 'vitest';

import {
  authTokensSchema,
  changePasswordSchema,
  registerResultSchema,
  registerSchema,
  resetPasswordSchema,
} from './auth.schemas.js';

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

  it('rejects a new password longer than 20 characters', () => {
    expect(() =>
      changePasswordSchema.parse({ body: { ...validBody, newPassword: 'a'.repeat(21) } }),
    ).toThrow('Password must not exceed 20 characters.');
  });

  it('accepts a new password of exactly 20 characters', () => {
    const newPassword = 'a'.repeat(20);

    expect(changePasswordSchema.parse({ body: { ...validBody, newPassword } })).toEqual({
      body: { ...validBody, newPassword },
    });
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

describe('registerSchema', () => {
  const validBody = {
    email: 'new.user@utp.ac.pa',
    password: 'strongpass1234',
    firstName: 'Nuevo',
    lastName: 'Usuario',
    identificationNumber: '8-999-9999',
  };

  it.each(['globalRole', 'role', 'isActive', 'permissions'])(
    'rejects the privilege field %s',
    (field) => {
      expect(() =>
        registerSchema.parse({
          body: { ...validBody, [field]: field === 'permissions' ? [] : 'ADMIN' },
        }),
      ).toThrow();
    },
  );

  it('rejects a password longer than 20 characters', () => {
    expect(() =>
      registerSchema.parse({ body: { ...validBody, password: 'a'.repeat(21) } }),
    ).toThrow('Password must not exceed 20 characters.');
  });

  it('accepts a password of exactly 20 characters', () => {
    const password = 'a'.repeat(20);

    expect(registerSchema.parse({ body: { ...validBody, password } })).toEqual({
      body: { ...validBody, password },
    });
  });
});

describe('resetPasswordSchema', () => {
  it('accepts a new password of exactly 20 characters', () => {
    const newPassword = 'a'.repeat(20);

    expect(resetPasswordSchema.parse({ body: { token: 'reset-token', newPassword } })).toEqual({
      body: { token: 'reset-token', newPassword },
    });
  });

  it('rejects a new password longer than 20 characters', () => {
    expect(() =>
      resetPasswordSchema.parse({ body: { token: 'reset-token', newPassword: 'a'.repeat(21) } }),
    ).toThrow('Password must not exceed 20 characters.');
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
