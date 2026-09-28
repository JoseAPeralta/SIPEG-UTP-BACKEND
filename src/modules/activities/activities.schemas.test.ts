import { describe, expect, it } from 'vitest';

import {
  activityDetailSchema,
  activityListItemSchema,
  activityParamsSchema,
  cancelActivitySchema,
  createActivitySchema,
  eventProgramActivitiesQuerySchema,
  eventProgramActivityItemSchema,
  listActivitiesQuerySchema,
  listEventProgramActivitiesSchema,
  paginatedActivitiesSchema,
  paginatedEventProgramActivitiesSchema,
  updateActivitySchema,
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

  it('accepts every activity type in the catalog', () => {
    for (const type of [
      'WORKSHOP',
      'SEMINAR',
      'TALK',
      'CONFERENCE',
      'PANEL',
      'COURSE',
      'COMPETITION',
      'OTHER',
    ]) {
      expect(() => activityListItemSchema.parse({ ...activityPayload, type })).not.toThrow();
    }
  });

  it('rejects an activity type outside the catalog', () => {
    expect(() => activityListItemSchema.parse({ ...activityPayload, type: 'WEBINAR' })).toThrow();
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
      createActivitySchema.parse({ body: { ...createPayload, type: 'WEBINAR' } }),
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
  cancelReason: null,
  equipment: ['Proyector'],
  enrolledCount: 6,
  checkedInCount: 4,
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

  it('rejects negative counts', () => {
    expect(() =>
      activityDetailSchema.parse({ ...activityDetailPayload, enrolledCount: -1 }),
    ).toThrow();
    expect(() =>
      activityDetailSchema.parse({ ...activityDetailPayload, checkedInCount: -1 }),
    ).toThrow();
  });

  it('rejects non integer or missing counts', () => {
    expect(() =>
      activityDetailSchema.parse({ ...activityDetailPayload, checkedInCount: 1.5 }),
    ).toThrow();
    expect(() =>
      activityDetailSchema.parse({ ...activityDetailPayload, enrolledCount: undefined }),
    ).toThrow();
  });

  it('accepts a cancelled activity with a reason', () => {
    const payload = { ...activityDetailPayload, status: 'CANCELLED', cancelReason: 'Lluvia' };

    expect(activityDetailSchema.parse(payload)).toEqual(payload);
  });
});

describe('activityParamsSchema', () => {
  it('trims the activity id', () => {
    expect(activityParamsSchema.parse({ params: { id: '  activity-001  ' } }).params.id).toBe(
      'activity-001',
    );
  });

  it('rejects a blank activity id', () => {
    expect(() => activityParamsSchema.parse({ params: { id: '   ' } })).toThrow();
  });

  it('rejects an activity id above 100 characters', () => {
    expect(() => activityParamsSchema.parse({ params: { id: 'a'.repeat(101) } })).toThrow();
  });
});

describe('updateActivitySchema', () => {
  it('accepts a partial body and trims the name', () => {
    const parsed = updateActivitySchema.parse({
      params: { id: ' activity-001 ' },
      body: { name: '  Nuevo nombre  ' },
    });

    expect(parsed.params.id).toBe('activity-001');
    expect(parsed.body).toEqual({ name: 'Nuevo nombre' });
  });

  it('accepts null to clear nullable fields', () => {
    const parsed = updateActivitySchema.parse({
      params: { id: 'activity-001' },
      body: {
        description: null,
        bannerUrl: null,
        maxCapacity: null,
        classroomId: null,
      },
    });

    expect(parsed.body).toEqual({
      description: null,
      bannerUrl: null,
      maxCapacity: null,
      classroomId: null,
    });
  });

  it('accepts the publish and unpublish statuses', () => {
    expect(
      updateActivitySchema.parse({ params: { id: 'activity-001' }, body: { status: 'SCHEDULED' } })
        .body.status,
    ).toBe('SCHEDULED');
    expect(
      updateActivitySchema.parse({ params: { id: 'activity-001' }, body: { status: 'DRAFT' } }).body
        .status,
    ).toBe('DRAFT');
  });

  it.each(['ONGOING', 'COMPLETED', 'CANCELLED'])('rejects the %s status', (status) => {
    expect(() =>
      updateActivitySchema.parse({ params: { id: 'activity-001' }, body: { status } }),
    ).toThrow();
  });

  it('rejects an empty body', () => {
    expect(() =>
      updateActivitySchema.parse({ params: { id: 'activity-001' }, body: {} }),
    ).toThrow();
  });

  it('rejects unknown fields such as eventProgramId or counts', () => {
    expect(() =>
      updateActivitySchema.parse({
        params: { id: 'activity-001' },
        body: { eventProgramId: 'program-002' },
      }),
    ).toThrow();
    expect(() =>
      updateActivitySchema.parse({
        params: { id: 'activity-001' },
        body: { enrolledCount: 3 },
      }),
    ).toThrow();
  });

  it('rejects an end time not after the provided start time', () => {
    expect(() =>
      updateActivitySchema.parse({
        params: { id: 'activity-001' },
        body: { startTime: '10:00', endTime: '08:00' },
      }),
    ).toThrow();
  });

  it('accepts only one time boundary at a time', () => {
    const parsed = updateActivitySchema.parse({
      params: { id: 'activity-001' },
      body: { endTime: '18:00' },
    });

    expect(parsed.body).toEqual({ endTime: '18:00' });
  });

  it('rejects duplicated equipment and speakers', () => {
    expect(() =>
      updateActivitySchema.parse({
        params: { id: 'activity-001' },
        body: { equipment: ['Proyector', 'Proyector'] },
      }),
    ).toThrow();
    expect(() =>
      updateActivitySchema.parse({
        params: { id: 'activity-001' },
        body: {
          speakers: [
            { firstName: 'Ana', lastName: 'Gomez', email: 'ana@example.com' },
            { firstName: 'Ana', lastName: 'Gomez', email: 'ANA@example.com' },
          ],
        },
      }),
    ).toThrow();
  });
});

describe('eventProgramActivitiesQuerySchema', () => {
  it('applies pagination defaults', () => {
    expect(eventProgramActivitiesQuerySchema.parse({})).toEqual({ page: 1, limit: 20 });
  });

  it('coerces pagination and rejects out-of-range values', () => {
    expect(eventProgramActivitiesQuerySchema.parse({ page: '3', limit: '50' })).toEqual({
      page: 3,
      limit: 50,
    });
    expect(eventProgramActivitiesQuerySchema.safeParse({ limit: '51' }).success).toBe(false);
    expect(eventProgramActivitiesQuerySchema.safeParse({ page: '0' }).success).toBe(false);
    expect(eventProgramActivitiesQuerySchema.safeParse({ page: 'abc' }).success).toBe(false);
  });

  it('rejects unknown query keys', () => {
    expect(eventProgramActivitiesQuerySchema.safeParse({ sort: 'date' }).success).toBe(false);
  });

  it('accepts every status filter and rejects unknown ones', () => {
    for (const status of ['DRAFT', 'SCHEDULED', 'ONGOING', 'COMPLETED', 'CANCELLED', 'ALL']) {
      expect(eventProgramActivitiesQuerySchema.safeParse({ status }).success).toBe(true);
    }
    expect(eventProgramActivitiesQuerySchema.safeParse({ status: 'PENDING' }).success).toBe(false);
  });

  it('validates the activity type', () => {
    for (const type of [
      'WORKSHOP',
      'SEMINAR',
      'TALK',
      'CONFERENCE',
      'PANEL',
      'COURSE',
      'COMPETITION',
      'OTHER',
    ]) {
      expect(eventProgramActivitiesQuerySchema.safeParse({ type }).success).toBe(true);
    }
    expect(eventProgramActivitiesQuerySchema.safeParse({ type: 'WEBINAR' }).success).toBe(false);
  });

  it('rejects an empty search term', () => {
    expect(eventProgramActivitiesQuerySchema.safeParse({ q: '   ' }).success).toBe(false);
  });

  it('validates the institutional date range', () => {
    const parsed = eventProgramActivitiesQuerySchema.parse({
      dateFrom: '2026-09-01',
      dateTo: '2026-09-30',
    });

    expect(parsed).toMatchObject({ dateFrom: '2026-09-01', dateTo: '2026-09-30' });
    expect(eventProgramActivitiesQuerySchema.safeParse({ dateFrom: '2026-02-30' }).success).toBe(
      false,
    );
    expect(eventProgramActivitiesQuerySchema.safeParse({ dateTo: '30-09-2026' }).success).toBe(
      false,
    );
  });

  it('rejects a range that starts after it ends', () => {
    const result = listEventProgramActivitiesSchema.safeParse({
      params: { id: 'program-001' },
      query: { dateFrom: '2026-10-01', dateTo: '2026-09-01' },
    });

    expect(result.success).toBe(false);
  });
});

describe('listEventProgramActivitiesSchema', () => {
  it('trims the program id and validates it', () => {
    const parsed = listEventProgramActivitiesSchema.parse({
      params: { id: '  program-001  ' },
      query: {},
    });

    expect(parsed.params.id).toBe('program-001');
    expect(parsed.query).toEqual({ page: 1, limit: 20 });
  });

  it('rejects a blank or oversized program id', () => {
    expect(
      listEventProgramActivitiesSchema.safeParse({ params: { id: '   ' }, query: {} }).success,
    ).toBe(false);
    expect(
      listEventProgramActivitiesSchema.safeParse({
        params: { id: 'x'.repeat(101) },
        query: {},
      }).success,
    ).toBe(false);
  });
});

describe('eventProgramActivityItemSchema', () => {
  it('accepts an item with status', () => {
    const item = {
      ...activityPayload,
      status: 'CANCELLED',
    };

    expect(eventProgramActivityItemSchema.parse(item)).toEqual(item);
  });

  it('rejects an unknown status', () => {
    expect(
      eventProgramActivityItemSchema.safeParse({ ...activityPayload, status: 'PENDING' }).success,
    ).toBe(false);
  });
});

describe('paginatedEventProgramActivitiesSchema', () => {
  it('wraps a page of program activities', () => {
    const page = {
      items: [{ ...activityPayload, status: 'SCHEDULED' }],
      page: 1,
      limit: 20,
      total: 1,
      totalPages: 1,
    };

    expect(paginatedEventProgramActivitiesSchema.parse(page)).toEqual(page);
  });
});

describe('cancelActivitySchema', () => {
  it('accepts a missing body and trims the activity id', () => {
    const parsed = cancelActivitySchema.parse({ params: { id: '  activity-001  ' } });

    expect(parsed).toEqual({ params: { id: 'activity-001' }, body: {} });
  });

  it('accepts and trims an optional reason', () => {
    const parsed = cancelActivitySchema.parse({
      params: { id: 'activity-001' },
      body: { reason: '  Reprogramada por lluvia  ' },
    });

    expect(parsed.body).toEqual({ reason: 'Reprogramada por lluvia' });
  });

  it('rejects blank reasons, oversized reasons and unknown keys', () => {
    const parse = (body: unknown) =>
      cancelActivitySchema.safeParse({ params: { id: 'activity-001' }, body });

    expect(parse({ reason: '   ' }).success).toBe(false);
    expect(parse({ reason: 'x'.repeat(501) }).success).toBe(false);
    expect(parse({ motive: 'Lluvia' }).success).toBe(false);
  });

  it('rejects a blank or oversized activity id', () => {
    expect(cancelActivitySchema.safeParse({ params: { id: '   ' } }).success).toBe(false);
    expect(cancelActivitySchema.safeParse({ params: { id: 'x'.repeat(101) } }).success).toBe(false);
  });
});
