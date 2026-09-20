import { describe, expect, it } from 'vitest';

import {
  adminUserParamsSchema,
  adminUserSchema,
  createUserSchema,
  listUsersQuerySchema,
  updateAdminUserSchema,
  updateProfileSchema,
  userProfileSchema,
} from './users.schemas.js';

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

  it('strips internal Better Auth fields', () => {
    const parsed = userProfileSchema.parse({
      ...baseProfile,
      name: 'Internal Name',
      accounts: [{ password: '$argon2id$hash' }],
      passwordHash: '$argon2id$hash',
    });

    expect(parsed).not.toHaveProperty('name');
    expect(parsed).not.toHaveProperty('accounts');
    expect(parsed).not.toHaveProperty('passwordHash');
  });
});

describe('updateProfileSchema', () => {
  it('accepts unitId null to select the Otro option', () => {
    const parsed = updateProfileSchema.parse({ body: { unitId: null } });

    expect(parsed.body.unitId).toBeNull();
  });

  it('rejects an empty unitId', () => {
    expect(() => updateProfileSchema.parse({ body: { unitId: '' } })).toThrow();
  });

  it('rejects an empty body', () => {
    expect(() => updateProfileSchema.parse({ body: {} })).toThrow(
      'At least one field must be provided.',
    );
  });

  it('rejects a body with only unknown fields', () => {
    expect(() => updateProfileSchema.parse({ body: { globalRole: 'ADMIN' } })).toThrow(
      'At least one field must be provided.',
    );
  });

  it('strips unknown fields from a valid body', () => {
    const parsed = updateProfileSchema.parse({
      body: { firstName: 'Ana', globalRole: 'ADMIN', isActive: false },
    });

    expect(parsed.body).toEqual({ firstName: 'Ana' });
  });

  it('trims names before validating', () => {
    const parsed = updateProfileSchema.parse({ body: { firstName: '  Ana  ' } });

    expect(parsed.body.firstName).toBe('Ana');
  });
});

describe('listUsersQuerySchema', () => {
  it('applies default pagination', () => {
    const parsed = listUsersQuerySchema.parse({ query: {} });

    expect(parsed.query).toEqual({ page: 1, limit: 20 });
  });

  it('parses isActive as a real boolean', () => {
    expect(listUsersQuerySchema.parse({ query: { isActive: 'false' } }).query.isActive).toBe(false);
    expect(listUsersQuerySchema.parse({ query: { isActive: 'true' } }).query.isActive).toBe(true);
  });

  it('trims the search term', () => {
    expect(listUsersQuerySchema.parse({ query: { q: '  perez  ' } }).query.q).toBe('perez');
  });

  it('rejects invalid pagination and filters', () => {
    expect(() => listUsersQuerySchema.parse({ query: { page: '0' } })).toThrow();
    expect(() => listUsersQuerySchema.parse({ query: { limit: '51' } })).toThrow();
    expect(() => listUsersQuerySchema.parse({ query: { globalRole: 'SUPERADMIN' } })).toThrow();
    expect(() => listUsersQuerySchema.parse({ query: { isActive: 'maybe' } })).toThrow();
    expect(() => listUsersQuerySchema.parse({ query: { unitId: '' } })).toThrow();
    expect(() => listUsersQuerySchema.parse({ query: { q: '' } })).toThrow();
  });

  it('rejects unknown query parameters', () => {
    expect(() => listUsersQuerySchema.parse({ query: { name: 'Juan' } })).toThrow();
  });
});

describe('adminUserParamsSchema', () => {
  it('accepts and trims a user id', () => {
    expect(adminUserParamsSchema.parse({ params: { id: ' user-001 ' } })).toEqual({
      params: { id: 'user-001' },
    });
  });

  it('rejects an empty or whitespace user id', () => {
    expect(() => adminUserParamsSchema.parse({ params: { id: '' } })).toThrow();
    expect(() => adminUserParamsSchema.parse({ params: { id: '   ' } })).toThrow();
  });

  it('rejects an oversized user id', () => {
    expect(() => adminUserParamsSchema.parse({ params: { id: 'a'.repeat(101) } })).toThrow();
  });
});

describe('updateAdminUserSchema', () => {
  it('accepts role, status, unit and career updates', () => {
    const parsed = updateAdminUserSchema.parse({
      params: { id: ' user-001 ' },
      body: { globalRole: 'ADMIN', isActive: false, unitId: 'unit-001', careerId: 'car-001' },
    });

    expect(parsed).toEqual({
      params: { id: 'user-001' },
      body: { globalRole: 'ADMIN', isActive: false, unitId: 'unit-001', careerId: 'car-001' },
    });
  });

  it('accepts a null unit to select the Otro option', () => {
    const parsed = updateAdminUserSchema.parse({
      params: { id: 'user-001' },
      body: { unitId: null },
    });

    expect(parsed.body.unitId).toBeNull();
  });

  it('rejects an empty body', () => {
    expect(() => updateAdminUserSchema.parse({ params: { id: 'user-001' }, body: {} })).toThrow(
      'At least one field must be provided.',
    );
  });

  it('strips unknown fields and rejects a body with only unknown fields', () => {
    expect(() =>
      updateAdminUserSchema.parse({
        params: { id: 'user-001' },
        body: { firstName: 'Ana' },
      }),
    ).toThrow('At least one field must be provided.');

    const parsed = updateAdminUserSchema.parse({
      params: { id: 'user-001' },
      body: { isActive: true, firstName: 'Ana' },
    });

    expect(parsed.body).toEqual({ isActive: true });
  });

  it('rejects invalid update values', () => {
    expect(() =>
      updateAdminUserSchema.parse({
        params: { id: 'user-001' },
        body: { globalRole: 'SUPERADMIN' },
      }),
    ).toThrow();
    expect(() =>
      updateAdminUserSchema.parse({ params: { id: 'user-001' }, body: { isActive: 'yes' } }),
    ).toThrow();
    expect(() =>
      updateAdminUserSchema.parse({ params: { id: 'user-001' }, body: { unitId: '' } }),
    ).toThrow();
    expect(() =>
      updateAdminUserSchema.parse({
        params: { id: 'user-001' },
        body: { careerId: 'a'.repeat(51) },
      }),
    ).toThrow();
  });
});

describe('adminUserSchema', () => {
  const baseAdminUser = { ...baseProfile, isActive: true };

  it('accepts an administrative user view', () => {
    expect(adminUserSchema.parse(baseAdminUser)).toEqual(baseAdminUser);
  });

  it('rejects an unknown global role', () => {
    expect(() => adminUserSchema.parse({ ...baseAdminUser, globalRole: 'SUPERADMIN' })).toThrow();
  });

  it('strips internal Better Auth fields', () => {
    const parsed = adminUserSchema.parse({
      ...baseAdminUser,
      name: 'Internal Name',
      accounts: [{ password: '$argon2id$hash' }],
      passwordHash: '$argon2id$hash',
      emailVerified: true,
    });

    expect(parsed).not.toHaveProperty('name');
    expect(parsed).not.toHaveProperty('accounts');
    expect(parsed).not.toHaveProperty('passwordHash');
    expect(parsed).not.toHaveProperty('emailVerified');
  });
});

describe('createUserSchema', () => {
  const baseCreate = {
    email: 'nuevo@utp.ac.pa',
    password: 'SipegNueva2026*',
    firstName: 'Ana',
    lastName: 'Gomez',
    identificationNumber: '8-888-1234',
  };

  it('applies USER and active defaults', () => {
    const parsed = createUserSchema.parse({ body: baseCreate });

    expect(parsed.body.globalRole).toBe('USER');
    expect(parsed.body.isActive).toBe(true);
  });

  it('accepts role, status, unit and career overrides', () => {
    const parsed = createUserSchema.parse({
      body: {
        ...baseCreate,
        globalRole: 'ADMIN',
        isActive: false,
        unitId: 'unit-001',
        careerId: 'car-001',
      },
    });

    expect(parsed.body).toMatchObject({
      globalRole: 'ADMIN',
      isActive: false,
      unitId: 'unit-001',
      careerId: 'car-001',
    });
  });

  it('rejects unknown fields such as id or emailVerified', () => {
    expect(() => createUserSchema.parse({ body: { ...baseCreate, id: 'user-999' } })).toThrow();
    expect(() =>
      createUserSchema.parse({ body: { ...baseCreate, emailVerified: true } }),
    ).toThrow();
  });

  it('rejects a short password', () => {
    expect(() => createUserSchema.parse({ body: { ...baseCreate, password: 'short' } })).toThrow();
  });

  it('rejects an invalid email', () => {
    expect(() =>
      createUserSchema.parse({ body: { ...baseCreate, email: 'not-an-email' } }),
    ).toThrow();
  });

  it('rejects an unknown role or a non-boolean status', () => {
    expect(() =>
      createUserSchema.parse({ body: { ...baseCreate, globalRole: 'SUPERADMIN' } }),
    ).toThrow();
    expect(() => createUserSchema.parse({ body: { ...baseCreate, isActive: 'false' } })).toThrow();
  });

  it('trims names and identification before validating', () => {
    const parsed = createUserSchema.parse({
      body: {
        ...baseCreate,
        firstName: '  Ana  ',
        lastName: ' Gomez ',
        identificationNumber: ' 8-888-1234 ',
      },
    });

    expect(parsed.body).toMatchObject({
      firstName: 'Ana',
      lastName: 'Gomez',
      identificationNumber: '8-888-1234',
    });
  });
});
