import { describe, expect, it } from 'vitest';

import { userProfileSchema } from './users.schemas.js';

const baseProfile = {
  id: 'user-001',
  firstName: 'Juan',
  lastName: 'Perez',
  identificationNumber: '8-123-4567',
  email: 'juan.perez@example.com',
  globalRole: 'USER',
  unit: { id: 'unit-001', name: 'Facultad de Ingenieria', code: 'FIS' },
  career: { id: 'car-001', name: 'Sistemas', code: 'SIS' },
};

describe('userProfileSchema', () => {
  it('accepts a profile with organizational references', () => {
    expect(userProfileSchema.parse(baseProfile)).toEqual(baseProfile);
  });

  it('accepts a profile with null unit and career', () => {
    expect(() =>
      userProfileSchema.parse({ ...baseProfile, unit: null, career: null }),
    ).not.toThrow();
  });

  it('rejects an unknown global role', () => {
    expect(() => userProfileSchema.parse({ ...baseProfile, globalRole: 'SUPERADMIN' })).toThrow();
  });

  it('rejects a profile without identificationNumber', () => {
    const { identificationNumber: _identificationNumber, ...withoutId } = baseProfile;

    expect(() => userProfileSchema.parse(withoutId)).toThrow();
  });
});
