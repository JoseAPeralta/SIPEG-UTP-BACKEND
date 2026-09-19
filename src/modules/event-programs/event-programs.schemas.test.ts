import { describe, expect, it } from 'vitest';

import { createEventProgramSchema, eventProgramDetailSchema } from './event-programs.schemas.js';

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
