import { describe, expect, it } from 'vitest';

import {
  addClassroomAmenitySchema,
  addClassroomAvailabilitySchema,
  availableClassroomsQuerySchema,
  classroomAmenityParamsSchema,
  createClassroomSchema,
  listClassroomsQuerySchema,
  updateClassroomSchema,
} from './classrooms.schemas.js';

const baseBody = {
  name: 'Aula 303',
  type: 'CLASSROOM',
  capacity: 30,
};

describe('listClassroomsQuerySchema', () => {
  it('applies pagination defaults', () => {
    const query = listClassroomsQuerySchema.parse({ query: {} }).query;

    expect(query.page).toBe(1);
    expect(query.limit).toBe(20);
  });

  it('coerces numeric filters and boolean status', () => {
    const query = listClassroomsQuerySchema.parse({
      query: { page: '2', limit: '10', minCapacity: '25', isActive: 'false' },
    }).query;

    expect(query).toMatchObject({ page: 2, limit: 10, minCapacity: 25, isActive: false });
  });

  it('rejects limits above 50', () => {
    expect(() => listClassroomsQuerySchema.parse({ query: { limit: '51' } })).toThrow();
  });

  it('rejects unknown query keys', () => {
    expect(() => listClassroomsQuerySchema.parse({ query: { unknown: 'value' } })).toThrow();
  });

  it('normalizes the amenity filter', () => {
    const query = listClassroomsQuerySchema.parse({
      query: { amenity: '  Aire   Acondicionado ' },
    }).query;

    expect(query.amenity).toBe('Aire Acondicionado');
  });
});

describe('availableClassroomsQuerySchema', () => {
  it('accepts a valid range with optional filters', () => {
    const query = availableClassroomsQuerySchema.parse({
      query: {
        date: '2026-09-21',
        startTime: '08:00',
        endTime: '10:00',
        minCapacity: '20',
        type: 'LABORATORY',
        amenity: 'Proyector',
      },
    }).query;

    expect(query).toMatchObject({
      date: '2026-09-21',
      startTime: '08:00',
      endTime: '10:00',
      minCapacity: 20,
      type: 'LABORATORY',
      amenity: 'Proyector',
    });
  });

  it('rejects impossible calendar dates', () => {
    expect(() =>
      availableClassroomsQuerySchema.parse({
        query: { date: '2026-02-30', startTime: '08:00', endTime: '10:00' },
      }),
    ).toThrow();
  });

  it('rejects an end time not after the start time', () => {
    expect(() =>
      availableClassroomsQuerySchema.parse({
        query: { date: '2026-09-21', startTime: '10:00', endTime: '10:00' },
      }),
    ).toThrow();
  });

  it('requires date, start time and end time', () => {
    expect(() => availableClassroomsQuerySchema.parse({ query: { date: '2026-09-21' } })).toThrow();
  });
});

describe('createClassroomSchema', () => {
  it('trims the name and accepts nullable location fields', () => {
    const body = createClassroomSchema.parse({
      body: { ...baseBody, name: '  Aula 303  ', building: null, floor: null },
    }).body;

    expect(body).toMatchObject({ name: 'Aula 303', building: null, floor: null });
  });

  it('rejects a capacity of zero or less', () => {
    expect(() => createClassroomSchema.parse({ body: { ...baseBody, capacity: 0 } })).toThrow();
  });

  it('rejects a decimal floor', () => {
    expect(() => createClassroomSchema.parse({ body: { ...baseBody, floor: 1.5 } })).toThrow();
  });

  it('rejects unknown body keys', () => {
    expect(() => createClassroomSchema.parse({ body: { ...baseBody, code: 'A-303' } })).toThrow();
  });

  it('accepts an explicit inactive status', () => {
    const body = createClassroomSchema.parse({ body: { ...baseBody, isActive: false } }).body;

    expect(body.isActive).toBe(false);
  });
});

describe('updateClassroomSchema', () => {
  it('accepts a partial body', () => {
    const body = updateClassroomSchema.parse({
      params: { id: 'classroom-1' },
      body: { capacity: 45 },
    }).body;

    expect(body).toEqual({ capacity: 45 });
  });

  it('rejects an empty body', () => {
    expect(() =>
      updateClassroomSchema.parse({ params: { id: 'classroom-1' }, body: {} }),
    ).toThrow();
  });

  it('rejects unknown body keys', () => {
    expect(() =>
      updateClassroomSchema.parse({
        params: { id: 'classroom-1' },
        body: { amenities: [] },
      }),
    ).toThrow();
  });
});

describe('addClassroomAmenitySchema', () => {
  it('normalizes the amenity and rejects unknown keys', () => {
    const body = addClassroomAmenitySchema.parse({
      params: { id: 'classroom-1' },
      body: { amenity: '  Smart   Board ' },
    }).body;

    expect(body.amenity).toBe('Smart Board');
    expect(() =>
      addClassroomAmenitySchema.parse({
        params: { id: 'classroom-1' },
        body: { amenity: 'Proyector', extra: true },
      }),
    ).toThrow();
  });

  it('rejects invalid amenity characters and long values', () => {
    expect(() =>
      addClassroomAmenitySchema.parse({
        params: { id: 'classroom-1' },
        body: { amenity: 'Proyector@' },
      }),
    ).toThrow();
    expect(() =>
      addClassroomAmenitySchema.parse({
        params: { id: 'classroom-1' },
        body: { amenity: 'a'.repeat(51) },
      }),
    ).toThrow();
  });
});

describe('classroomAmenityParamsSchema', () => {
  it('normalizes the amenity path param', () => {
    const params = classroomAmenityParamsSchema.parse({
      params: { id: 'classroom-1', amenity: ' Aire  Acondicionado ' },
    }).params;

    expect(params).toEqual({ id: 'classroom-1', amenity: 'Aire Acondicionado' });
  });
});

describe('addClassroomAvailabilitySchema', () => {
  it('accepts a valid window', () => {
    const body = addClassroomAvailabilitySchema.parse({
      params: { id: 'classroom-1' },
      body: { dayOfWeek: 1, startTime: '08:00', endTime: '10:00', period: 'Matutino' },
    }).body;

    expect(body).toMatchObject({ dayOfWeek: 1, startTime: '08:00', endTime: '10:00' });
  });

  it('rejects days outside 1-7', () => {
    for (const dayOfWeek of [0, 8]) {
      expect(() =>
        addClassroomAvailabilitySchema.parse({
          params: { id: 'classroom-1' },
          body: { dayOfWeek, startTime: '08:00', endTime: '10:00' },
        }),
      ).toThrow();
    }
  });

  it('rejects an end time not after the start time', () => {
    expect(() =>
      addClassroomAvailabilitySchema.parse({
        params: { id: 'classroom-1' },
        body: { dayOfWeek: 1, startTime: '10:00', endTime: '09:00' },
      }),
    ).toThrow();
  });

  it('rejects periods longer than 30 characters', () => {
    expect(() =>
      addClassroomAvailabilitySchema.parse({
        params: { id: 'classroom-1' },
        body: { dayOfWeek: 1, startTime: '08:00', endTime: '10:00', period: 'x'.repeat(31) },
      }),
    ).toThrow();
  });
});
