import { describe, expect, it } from 'vitest';

import {
  careerParamsSchema,
  careerSummarySchema,
  createCareerSchema,
  listCareersQuerySchema,
  updateCareerSchema,
} from './careers.schemas.js';

describe('listCareersQuerySchema', () => {
  it('applies pagination defaults without forcing unitId', () => {
    expect(listCareersQuerySchema.parse({ query: {} })).toEqual({
      query: { page: 1, limit: 20 },
    });
  });

  it('coerces and validates pagination bounds', () => {
    expect(listCareersQuerySchema.parse({ query: { page: '2', limit: '50' } })).toEqual({
      query: { page: 2, limit: 50 },
    });
    expect(() => listCareersQuerySchema.parse({ query: { limit: '51' } })).toThrow();
    expect(() => listCareersQuerySchema.parse({ query: { page: '0' } })).toThrow();
  });

  it('trims unitId and search filters', () => {
    expect(
      listCareersQuerySchema.parse({ query: { unitId: ' unit-001 ', q: '  civil  ' } }),
    ).toEqual({ query: { page: 1, limit: 20, unitId: 'unit-001', q: 'civil' } });
  });

  it('accepts the global unit sentinel', () => {
    expect(listCareersQuerySchema.parse({ query: { unitId: 'global' } })).toEqual({
      query: { page: 1, limit: 20, unitId: 'global' },
    });
  });

  it('rejects empty filters, unknown keys and invalid pagination values', () => {
    expect(() => listCareersQuerySchema.parse({ query: { q: '   ' } })).toThrow();
    expect(() => listCareersQuerySchema.parse({ query: { unitId: '' } })).toThrow();
    expect(() => listCareersQuerySchema.parse({ query: { unknown: 'x' } })).toThrow();
    expect(() => listCareersQuerySchema.parse({ query: { page: 'x' } })).toThrow();
  });
});

describe('careerParamsSchema', () => {
  it('accepts and trims a career id', () => {
    expect(careerParamsSchema.parse({ params: { id: ' car-001 ' } })).toEqual({
      params: { id: 'car-001' },
    });
  });

  it('rejects an empty or oversized career id', () => {
    expect(() => careerParamsSchema.parse({ params: { id: '' } })).toThrow();
    expect(() => careerParamsSchema.parse({ params: { id: '   ' } })).toThrow();
    expect(() => careerParamsSchema.parse({ params: { id: 'a'.repeat(101) } })).toThrow();
  });
});

describe('createCareerSchema', () => {
  it('normalizes the code to uppercase and trims values', () => {
    expect(
      createCareerSchema.parse({
        body: { name: '  Ingenieria Civil  ', code: ' fic-civ ' },
      }),
    ).toEqual({
      body: { name: 'Ingenieria Civil', code: 'FIC-CIV' },
    });
  });

  it('accepts null description and a global career', () => {
    expect(
      createCareerSchema.parse({
        body: { name: 'Otros', code: 'OTROS', description: null, unitId: null },
      }),
    ).toEqual({
      body: { name: 'Otros', code: 'OTROS', description: null, unitId: null },
    });
  });

  it('rejects invalid codes', () => {
    expect(() => createCareerSchema.parse({ body: { name: 'Carrera', code: 'A' } })).toThrow();
    expect(() => createCareerSchema.parse({ body: { name: 'Carrera', code: 'A B' } })).toThrow();
    expect(() =>
      createCareerSchema.parse({ body: { name: 'Carrera', code: 'A'.repeat(21) } }),
    ).toThrow();
  });

  it('rejects a missing name and unknown keys', () => {
    expect(() => createCareerSchema.parse({ body: { code: 'ABC' } })).toThrow();
    expect(() =>
      createCareerSchema.parse({ body: { name: 'Carrera', code: 'ABC', isActive: true } }),
    ).toThrow();
  });
});

describe('updateCareerSchema', () => {
  it('accepts a partial update with a nullable unitId', () => {
    expect(
      updateCareerSchema.parse({
        params: { id: ' car-001 ' },
        body: { unitId: null },
      }),
    ).toEqual({ params: { id: 'car-001' }, body: { unitId: null } });
  });

  it('rejects an empty body, unknown keys and an empty unitId', () => {
    expect(() => updateCareerSchema.parse({ params: { id: 'car-001' }, body: {} })).toThrow();
    expect(() =>
      updateCareerSchema.parse({ params: { id: 'car-001' }, body: { isActive: false } }),
    ).toThrow();
    expect(() =>
      updateCareerSchema.parse({ params: { id: 'car-001' }, body: { unitId: '' } }),
    ).toThrow();
  });
});

describe('careerSummarySchema', () => {
  it('strips internal fields and accepts a nullable unit', () => {
    expect(
      careerSummarySchema.parse({
        id: 'car-otros',
        name: 'Otros',
        code: 'OTROS',
        description: null,
        unit: null,
        createdAt: new Date(),
      }),
    ).toEqual({
      id: 'car-otros',
      name: 'Otros',
      code: 'OTROS',
      description: null,
      unit: null,
    });
  });
});
