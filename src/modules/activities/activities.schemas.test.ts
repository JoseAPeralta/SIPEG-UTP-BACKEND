import { describe, expect, it } from 'vitest';

import {
  activityDetailSchema,
  activityListItemSchema,
  createActivitySchema,
  listActivitiesQuerySchema,
  paginatedActivitiesSchema,
} from './activities.schemas.js';

describe('listActivitiesQuerySchema', () => {
  it('applies default pagination', () => {
    const parsed = listActivitiesQuerySchema.parse({ query: {} });

    expect(parsed.query).toEqual({ page: 1, limit: 20 });
  });

  it('coerces numeric strings', () => {
    const parsed = listActivitiesQuerySchema.parse({ query: { page: '3', limit: '50' } });

    expect(parsed.query).toEqual({ page: 3, limit: 50 });
  });

  it('rejects a limit above the maximum', () => {
    expect(() => listActivitiesQuerySchema.parse({ query: { limit: '51' } })).toThrow();
  });

  it('rejects a page below one', () => {
    expect(() => listActivitiesQuerySchema.parse({ query: { page: '0' } })).toThrow();
  });

  it('rejects non numeric values', () => {
    expect(() => listActivitiesQuerySchema.parse({ query: { page: 'abc' } })).toThrow();
  });

  it('rejects unknown query parameters', () => {
    expect(() => listActivitiesQuerySchema.parse({ query: { sort: 'name' } })).toThrow();
  });
});

const activityPayload = {
  id: 'activity-001',
  name: 'Introduccion a TypeScript',
  description: null,
  type: 'WORKSHOP',
  date: '2026-09-20',
  startTime: '08:00',
  endTime: '10:00',
  capacity: 30,
  bannerUrl: null,
  speakers: [
    { id: 'speaker-001', firstName: 'Ana', lastName: 'Gomez' },
    { id: 'speaker-002', firstName: 'Luis', lastName: 'Mora' },
  ],
  classroom: { id: 'classroom-001', name: 'Laboratorio 3', building: 'Edificio B' },
  eventProgram: { id: 'program-001', name: 'Semana de Ingenieria', label: 'SI-2026' },
  organizationalUnit: { id: 'unit-001', name: 'Facultad de Ingenieria', type: 'FACULTY' },
};

describe('activityListItemSchema', () => {
  it('accepts an activity wire payload with null optional relations', () => {
    expect(() =>
      activityListItemSchema.parse({
        ...activityPayload,
        description: null,
        bannerUrl: null,
        speakers: [],
        classroom: null,
      }),
    ).not.toThrow();
  });

  it('accepts the full activity wire payload', () => {
    expect(activityListItemSchema.parse(activityPayload)).toEqual(activityPayload);
  });

  it('rejects an activity type outside the catalog', () => {
    expect(() =>
      activityListItemSchema.parse({ ...activityPayload, type: 'CONFERENCE' }),
    ).toThrow();
  });

  it('rejects an organizational unit type outside the catalog', () => {
    expect(() =>
      activityListItemSchema.parse({
        ...activityPayload,
        organizationalUnit: { ...activityPayload.organizationalUnit, type: 'DEPARTMENT' },
      }),
    ).toThrow();
  });
});

describe('paginatedActivitiesSchema', () => {
  const paginatedPayload = {
    items: [activityPayload],
    page: 1,
    limit: 20,
    total: 1,
    totalPages: 1,
  };

  it('accepts a paginated activities payload', () => {
    expect(paginatedActivitiesSchema.parse(paginatedPayload)).toEqual(paginatedPayload);
  });

  it('accepts an empty page', () => {
    expect(() =>
      paginatedActivitiesSchema.parse({ ...paginatedPayload, items: [], total: 0, totalPages: 0 }),
    ).not.toThrow();
  });

  it('rejects a non numeric total', () => {
    expect(() => paginatedActivitiesSchema.parse({ ...paginatedPayload, total: '1' })).toThrow();
  });
});

const createPayload = {
  name: 'Introduccion a TypeScript',
  type: 'WORKSHOP',
  date: '2026-09-20',
  startTime: '08:00',
  endTime: '10:00',
  eventProgramId: 'program-001',
};

describe('createActivitySchema', () => {
  it('accepts a minimal valid body and trims the name', () => {
    const parsed = createActivitySchema.parse({
      body: { ...createPayload, name: '  Introduccion a TypeScript  ' },
    });

    expect(parsed.body.name).toBe('Introduccion a TypeScript');
    expect(parsed.body.eventProgramId).toBe('program-001');
  });

  it('accepts optional fields including equipment and speakers', () => {
    const parsed = createActivitySchema.parse({
      body: {
        ...createPayload,
        description: 'Taller practico.',
        maxCapacity: 30,
        bannerUrl: 'https://example.com/banner.png',
        classroomId: 'classroom-001',
        speakers: [{ firstName: 'Ana', lastName: 'Gomez', email: 'ana@example.com' }],
        equipment: ['Proyector', 'Pizarra'],
      },
    });

    expect(parsed.body.equipment).toEqual(['Proyector', 'Pizarra']);
    expect(parsed.body.maxCapacity).toBe(30);
    expect(parsed.body.speakers).toHaveLength(1);
  });

  it('accepts inline speakers and normalizes their email', () => {
    const parsed = createActivitySchema.parse({
      body: {
        ...createPayload,
        speakers: [
          {
            firstName: '  Ana ',
            lastName: ' Gomez ',
            email: ' Ana.Gomez@Example.com ',
            organization: ' UTP ',
          },
        ],
      },
    });

    expect(parsed.body.speakers).toEqual([
      {
        firstName: 'Ana',
        lastName: 'Gomez',
        email: 'ana.gomez@example.com',
        organization: 'UTP',
      },
    ]);
  });

  it('accepts a speaker without email', () => {
    const parsed = createActivitySchema.parse({
      body: {
        ...createPayload,
        speakers: [{ firstName: 'Marco', lastName: 'Santos', organization: 'Colegio' }],
      },
    });

    expect(parsed.body.speakers).toEqual([
      { firstName: 'Marco', lastName: 'Santos', organization: 'Colegio' },
    ]);
  });

  it('rejects duplicated speaker emails regardless of case', () => {
    expect(() =>
      createActivitySchema.parse({
        body: {
          ...createPayload,
          speakers: [
            { firstName: 'Ana', lastName: 'Gomez', email: 'ana@example.com' },
            { firstName: 'Ana', lastName: 'Gomez', email: 'ANA@example.com' },
          ],
        },
      }),
    ).toThrow();
  });

  it('rejects more than ten speakers', () => {
    const speakers = Array.from({ length: 11 }, (_, index) => ({
      firstName: `Ponente${index}`,
      lastName: 'Demo',
    }));

    expect(() => createActivitySchema.parse({ body: { ...createPayload, speakers } })).toThrow();
  });

  it('rejects an invalid speaker email', () => {
    expect(() =>
      createActivitySchema.parse({
        body: {
          ...createPayload,
          speakers: [{ firstName: 'Ana', lastName: 'Gomez', email: 'not-an-email' }],
        },
      }),
    ).toThrow();
  });

  it('rejects the legacy speakerId field', () => {
    expect(() =>
      createActivitySchema.parse({ body: { ...createPayload, speakerId: 'user-001' } }),
    ).toThrow();
  });

  it('rejects unknown fields', () => {
    expect(() =>
      createActivitySchema.parse({ body: { ...createPayload, status: 'DRAFT' } }),
    ).toThrow();
  });

  it('rejects an end time not after the start time', () => {
    expect(() =>
      createActivitySchema.parse({
        body: { ...createPayload, startTime: '10:00', endTime: '08:00' },
      }),
    ).toThrow();
  });

  it('rejects an invalid calendar date and an invalid time', () => {
    expect(() =>
      createActivitySchema.parse({ body: { ...createPayload, date: '2026-02-30' } }),
    ).toThrow();
    expect(() =>
      createActivitySchema.parse({ body: { ...createPayload, startTime: '25:00' } }),
    ).toThrow();
  });

  it('rejects a non positive capacity', () => {
    expect(() =>
      createActivitySchema.parse({ body: { ...createPayload, maxCapacity: 0 } }),
    ).toThrow();
  });

  it('rejects duplicated equipment names', () => {
    expect(() =>
      createActivitySchema.parse({
        body: { ...createPayload, equipment: ['Proyector', 'Proyector'] },
      }),
    ).toThrow();
  });

  it('rejects an activity type outside the catalog', () => {
    expect(() =>
      createActivitySchema.parse({ body: { ...createPayload, type: 'CONFERENCE' } }),
    ).toThrow();
  });
});

const activityDetailPayload = {
  id: 'activity-001',
  name: 'Introduccion a TypeScript',
  description: null,
  type: 'WORKSHOP',
  date: '2026-09-20',
  startTime: '08:00',
  endTime: '10:00',
  capacity: 30,
  bannerUrl: null,
  status: 'DRAFT',
  equipment: ['Proyector'],
  speakers: [],
  classroom: null,
  eventProgram: { id: 'program-001', name: 'Semana de Ingenieria', label: 'SI-2026' },
  organizationalUnit: { id: 'unit-001', name: 'Facultad de Ingenieria', type: 'FACULTY' },
};

describe('activityDetailSchema', () => {
  it('accepts the activity detail wire payload', () => {
    expect(activityDetailSchema.parse(activityDetailPayload)).toEqual(activityDetailPayload);
  });

  it('rejects an unknown status', () => {
    expect(() =>
      activityDetailSchema.parse({ ...activityDetailPayload, status: 'ARCHIVED' }),
    ).toThrow();
  });
});
