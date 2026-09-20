import { describe, expect, it } from 'vitest';

import {
  createOrganizationalUnitSchema,
  listOrganizationalUnitsQuerySchema,
  organizationalUnitParamsSchema,
  updateOrganizationalUnitSchema,
} from './organizational-units.schemas.js';

describe('listOrganizationalUnitsQuerySchema', () => {
  it('applies pagination defaults without forcing isActive', () => {
    expect(listOrganizationalUnitsQuerySchema.parse({ query: {} })).toEqual({
      query: { page: 1, limit: 20 },
    });
  });

  it('coerces and validates pagination bounds', () => {
    expect(listOrganizationalUnitsQuerySchema.parse({ query: { page: '2', limit: '50' } })).toEqual(
      { query: { page: 2, limit: 50 } },
    );
    expect(() => listOrganizationalUnitsQuerySchema.parse({ query: { limit: '51' } })).toThrow();
    expect(() => listOrganizationalUnitsQuerySchema.parse({ query: { page: '0' } })).toThrow();
  });

  it('parses type, status and search filters', () => {
    expect(
      listOrganizationalUnitsQuerySchema.parse({
        query: { type: 'FACULTY', isActive: 'false', q: '  fic  ' },
      }),
    ).toEqual({ query: { page: 1, limit: 20, type: 'FACULTY', isActive: false, q: 'fic' } });
  });

  it('rejects invalid filters and unknown keys', () => {
    expect(() => listOrganizationalUnitsQuerySchema.parse({ query: { type: 'CENTER' } })).toThrow();
    expect(() =>
      listOrganizationalUnitsQuerySchema.parse({ query: { isActive: 'yes' } }),
    ).toThrow();
    expect(() => listOrganizationalUnitsQuerySchema.parse({ query: { unknown: 'x' } })).toThrow();
  });

  it('rejects an empty search term', () => {
    expect(() => listOrganizationalUnitsQuerySchema.parse({ query: { q: '   ' } })).toThrow();
  });
});

describe('organizationalUnitParamsSchema', () => {
  it('accepts and trims a unit id', () => {
    expect(organizationalUnitParamsSchema.parse({ params: { id: ' unit-001 ' } })).toEqual({
      params: { id: 'unit-001' },
    });
  });

  it('rejects an empty or whitespace unit id', () => {
    expect(() => organizationalUnitParamsSchema.parse({ params: { id: '' } })).toThrow();
    expect(() => organizationalUnitParamsSchema.parse({ params: { id: '   ' } })).toThrow();
  });

  it('rejects an oversized unit id', () => {
    expect(() =>
      organizationalUnitParamsSchema.parse({ params: { id: 'a'.repeat(101) } }),
    ).toThrow();
  });
});

describe('createOrganizationalUnitSchema', () => {
  it('normalizes the code to uppercase and trims values', () => {
    expect(
      createOrganizationalUnitSchema.parse({
        body: { name: '  Facultad de Pruebas  ', code: ' tmp-2a ', type: 'FACULTY' },
      }),
    ).toEqual({
      body: { name: 'Facultad de Pruebas', code: 'TMP-2A', type: 'FACULTY' },
    });
  });

  it('accepts null description and headId', () => {
    expect(
      createOrganizationalUnitSchema.parse({
        body: {
          name: 'Subdireccion',
          code: 'SUB-TEST',
          description: null,
          type: 'SUBDIRECTORATE',
          headId: null,
        },
      }),
    ).toEqual({
      body: {
        name: 'Subdireccion',
        code: 'SUB-TEST',
        description: null,
        type: 'SUBDIRECTORATE',
        headId: null,
      },
    });
  });

  it('rejects invalid codes', () => {
    expect(() =>
      createOrganizationalUnitSchema.parse({
        body: { name: 'Unidad', code: 'A', type: 'FACULTY' },
      }),
    ).toThrow();
    expect(() =>
      createOrganizationalUnitSchema.parse({
        body: { name: 'Unidad', code: 'A B', type: 'FACULTY' },
      }),
    ).toThrow();
    expect(() =>
      createOrganizationalUnitSchema.parse({
        body: { name: 'Unidad', code: 'A'.repeat(21), type: 'FACULTY' },
      }),
    ).toThrow();
  });

  it('rejects an unknown type, a missing name and unknown keys', () => {
    expect(() =>
      createOrganizationalUnitSchema.parse({
        body: { name: 'Unidad', code: 'ABC', type: 'CENTER' },
      }),
    ).toThrow();
    expect(() =>
      createOrganizationalUnitSchema.parse({ body: { code: 'ABC', type: 'FACULTY' } }),
    ).toThrow();
    expect(() =>
      createOrganizationalUnitSchema.parse({
        body: { name: 'Unidad', code: 'ABC', type: 'FACULTY', isActive: false },
      }),
    ).toThrow();
  });
});

describe('updateOrganizationalUnitSchema', () => {
  it('accepts a partial update with a nullable headId', () => {
    expect(
      updateOrganizationalUnitSchema.parse({
        params: { id: ' unit-001 ' },
        body: { name: 'Nueva', headId: null },
      }),
    ).toEqual({ params: { id: 'unit-001' }, body: { name: 'Nueva', headId: null } });
  });

  it('rejects an empty body and immutable or unknown fields', () => {
    expect(() =>
      updateOrganizationalUnitSchema.parse({ params: { id: 'unit-001' }, body: {} }),
    ).toThrow();
    expect(() =>
      updateOrganizationalUnitSchema.parse({
        params: { id: 'unit-001' },
        body: { code: 'ABC' },
      }),
    ).toThrow();
    expect(() =>
      updateOrganizationalUnitSchema.parse({
        params: { id: 'unit-001' },
        body: { type: 'FACULTY' },
      }),
    ).toThrow();
    expect(() =>
      updateOrganizationalUnitSchema.parse({
        params: { id: 'unit-001' },
        body: { isActive: false },
      }),
    ).toThrow();
  });
});
