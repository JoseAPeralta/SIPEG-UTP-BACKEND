import { describe, expect, it } from 'vitest';

import {
  createEventProgramSchema,
  eventProgramDetailSchema,
  eventProgramParamsSchema,
  eventProgramPublicDetailSchema,
  listEventProgramsQuerySchema,
  paginatedEventProgramsSchema,
  updateEventProgramSchema,
} from './event-programs.schemas.js';

describe('listEventProgramsQuerySchema', () => {
  it('applies default pagination', () => {
    const parsed = listEventProgramsQuerySchema.parse({ query: {} });

    expect(parsed.query).toEqual({ page: 1, limit: 20 });
  });

  it('coerces pagination, trims the search term and accepts filters', () => {
    const parsed = listEventProgramsQuerySchema.parse({
      query: {
        page: '2',
        limit: '50',
        organizationalUnitId: 'unit-001',
        unitType: 'FACULTY',
        q: '  congreso  ',
      },
    });

    expect(parsed.query).toEqual({
      page: 2,
      limit: 50,
      organizationalUnitId: 'unit-001',
      unitType: 'FACULTY',
      q: 'congreso',
    });
  });

  it('rejects unknown query parameters', () => {
    expect(() => listEventProgramsQuerySchema.parse({ query: { isDefault: 'true' } })).toThrow();
  });

  it('rejects a limit above the maximum', () => {
    expect(() => listEventProgramsQuerySchema.parse({ query: { limit: '51' } })).toThrow();
  });

  it('rejects an invalid unit type', () => {
    expect(() => listEventProgramsQuerySchema.parse({ query: { unitType: 'CAMPUS' } })).toThrow();
  });

  it('accepts every program status and the ALL pseudo-status', () => {
    for (const status of ['DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'ARCHIVED', 'ALL']) {
      expect(listEventProgramsQuerySchema.parse({ query: { status } }).query.status).toBe(status);
    }
  });

  it('rejects an invalid status', () => {
    expect(() => listEventProgramsQuerySchema.parse({ query: { status: 'PENDING' } })).toThrow();
  });
});

describe('paginatedEventProgramsSchema', () => {
  it('accepts an empty paginated payload', () => {
    const payload = { items: [], page: 1, limit: 20, total: 0, totalPages: 0 };

    expect(paginatedEventProgramsSchema.parse(payload)).toEqual(payload);
  });
});

const createPayload = {
  name: 'Congreso de Innovacion 2026',
  organizationalUnitId: 'unit-001',
  startDate: '2026-10-12',
  endDate: '2026-10-16',
};

describe('createEventProgramSchema', () => {
  it('accepts a valid body and trims textual fields', () => {
    const parsed = createEventProgramSchema.parse({
      body: {
        ...createPayload,
        name: '  Congreso de Innovacion 2026  ',
        description: '  Encuentro academico.  ',
        label: '  CI-2026  ',
        bannerUrl: 'https://example.com/banner.png',
      },
    });

    expect(parsed.body).toMatchObject({
      name: 'Congreso de Innovacion 2026',
      description: 'Encuentro academico.',
      label: 'CI-2026',
    });
  });

  it('rejects unknown fields such as status and isDefault', () => {
    expect(() =>
      createEventProgramSchema.parse({
        body: { ...createPayload, status: 'ACTIVE', isDefault: true },
      }),
    ).toThrow();
  });

  it('rejects invalid calendar dates', () => {
    expect(() =>
      createEventProgramSchema.parse({ body: { ...createPayload, startDate: '2026-02-30' } }),
    ).toThrow();
  });

  it('rejects an end date before the start date', () => {
    expect(() =>
      createEventProgramSchema.parse({
        body: { ...createPayload, startDate: '2026-10-16', endDate: '2026-10-12' },
      }),
    ).toThrow();
  });

  it('rejects an invalid banner URL', () => {
    expect(() =>
      createEventProgramSchema.parse({ body: { ...createPayload, bannerUrl: 'not-a-url' } }),
    ).toThrow();
  });
});

describe('updateEventProgramSchema', () => {
  const params = { id: 'program-001' };

  it('accepts a partial body and trims textual fields', () => {
    const parsed = updateEventProgramSchema.parse({
      params,
      body: { name: '  Congreso actualizado  ', label: '  CI-2026  ' },
    });

    expect(parsed.body).toEqual({ name: 'Congreso actualizado', label: 'CI-2026' });
  });

  it('accepts clearing nullable fields with null', () => {
    const parsed = updateEventProgramSchema.parse({
      params,
      body: { description: null, label: null, bannerUrl: null },
    });

    expect(parsed.body).toEqual({ description: null, label: null, bannerUrl: null });
  });

  it('rejects an empty body', () => {
    expect(() => updateEventProgramSchema.parse({ params, body: {} })).toThrow();
  });

  it('rejects unknown fields such as isDefault and organizationalUnitId', () => {
    expect(() =>
      updateEventProgramSchema.parse({
        params,
        body: { isDefault: true, organizationalUnitId: 'unit-002' },
      }),
    ).toThrow();
  });

  it('accepts publishing a draft program with status ACTIVE', () => {
    const parsed = updateEventProgramSchema.parse({ params, body: { status: 'ACTIVE' } });

    expect(parsed.body).toEqual({ status: 'ACTIVE' });
  });

  it('rejects any status other than ACTIVE', () => {
    for (const status of ['DRAFT', 'ARCHIVED', 'COMPLETED', 'CANCELLED']) {
      expect(() => updateEventProgramSchema.parse({ params, body: { status } })).toThrow();
    }
  });

  it('rejects invalid calendar dates', () => {
    expect(() =>
      updateEventProgramSchema.parse({ params, body: { startDate: '2026-02-30' } }),
    ).toThrow();
  });

  it('rejects an end date before the start date when both are provided', () => {
    expect(() =>
      updateEventProgramSchema.parse({
        params,
        body: { startDate: '2026-10-16', endDate: '2026-10-12' },
      }),
    ).toThrow();
  });

  it('rejects an invalid banner URL', () => {
    expect(() =>
      updateEventProgramSchema.parse({ params, body: { bannerUrl: 'not-a-url' } }),
    ).toThrow();
  });

  it('rejects an empty id param', () => {
    expect(() =>
      updateEventProgramSchema.parse({ params: { id: '  ' }, body: { name: 'X' } }),
    ).toThrow();
  });
});

describe('eventProgramParamsSchema', () => {
  it('accepts and trims the event program id', () => {
    const parsed = eventProgramParamsSchema.parse({ params: { id: '  program-001  ' } });

    expect(parsed.params).toEqual({ id: 'program-001' });
  });

  it('rejects an empty or blank id', () => {
    expect(() => eventProgramParamsSchema.parse({ params: { id: '   ' } })).toThrow();
  });

  it('rejects an id above 100 characters', () => {
    expect(() => eventProgramParamsSchema.parse({ params: { id: 'a'.repeat(101) } })).toThrow();
  });
});

describe('eventProgramDetailSchema', () => {
  it('accepts the event program detail wire payload', () => {
    const payload = {
      id: 'program-001',
      name: 'Congreso de Innovacion 2026',
      description: null,
      label: null,
      bannerUrl: null,
      isDefault: false,
      status: 'DRAFT',
      startDate: '2026-10-12',
      endDate: '2026-10-16',
      organizationalUnit: {
        id: 'unit-001',
        name: 'Facultad de Ingenieria',
        type: 'FACULTY',
      },
    };

    expect(eventProgramDetailSchema.parse(payload)).toEqual(payload);
  });
});

describe('eventProgramPublicDetailSchema', () => {
  const detailPayload = {
    id: 'program-001',
    name: 'Congreso de Innovacion 2026',
    description: null,
    label: 'CI-2026',
    bannerUrl: null,
    isDefault: false,
    status: 'ACTIVE',
    startDate: '2026-10-12',
    endDate: '2026-10-16',
    organizationalUnit: {
      id: 'unit-001',
      name: 'Facultad de Ingenieria',
      type: 'FACULTY',
    },
  };

  it('accepts the public count payload', () => {
    const payload = { ...detailPayload, activityCount: { visible: 6 } };

    expect(eventProgramPublicDetailSchema.parse(payload)).toEqual(payload);
  });

  it('accepts the privileged payload with total and byStatus', () => {
    const activityCount = {
      visible: 6,
      total: 9,
      byStatus: { DRAFT: 2, SCHEDULED: 3, ONGOING: 1, COMPLETED: 2, CANCELLED: 1 },
    };
    const payload = { ...detailPayload, activityCount };

    expect(eventProgramPublicDetailSchema.parse(payload)).toEqual(payload);
  });

  it('rejects a negative count', () => {
    expect(() =>
      eventProgramPublicDetailSchema.parse({
        ...detailPayload,
        activityCount: { visible: -1 },
      }),
    ).toThrow();
  });

  it('rejects a byStatus payload with a missing status', () => {
    expect(() =>
      eventProgramPublicDetailSchema.parse({
        ...detailPayload,
        activityCount: {
          visible: 6,
          total: 9,
          byStatus: { DRAFT: 2, SCHEDULED: 3, ONGOING: 1, COMPLETED: 2 },
        },
      }),
    ).toThrow();
  });
});
