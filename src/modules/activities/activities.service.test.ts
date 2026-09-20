import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CreateActivityBody } from './activities.schemas.js';

interface ActivityRecord {
  id: string;
  name: string;
  description: string | null;
  type: 'WORKSHOP' | 'SEMINAR' | 'TALK' | 'OTHER';
  date: Date;
  startTime: Date;
  endTime: Date;
  maxCapacity: number | null;
  bannerUrl: string | null;
  speakers: { speaker: { id: string; firstName: string; lastName: string } }[];
  classroom: { id: string; name: string; building: string | null } | null;
  eventProgram: {
    id: string;
    name: string;
    label: string | null;
    organizationalUnit: {
      id: string;
      name: string;
      type: 'FACULTY' | 'SUBDIRECTORATE';
    };
  };
}

interface PrismaMock {
  activity: {
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
}

const createPrismaMock = (): PrismaMock => ({
  activity: {
    findMany: vi.fn(),
    count: vi.fn(),
  },
});

const loadService = async (prisma: PrismaMock) => {
  vi.resetModules();
  vi.doMock('../../config/prisma.js', () => ({
    getPrismaClient: () => prisma,
  }));

  return import('./activities.service.js');
};

const buildRecord = (overrides: Partial<ActivityRecord> = {}): ActivityRecord => ({
  id: 'activity-001',
  name: 'Taller de Inteligencia Artificial',
  description: 'Introduccion a modelos generativos.',
  type: 'WORKSHOP',
  date: new Date('2026-09-20T00:00:00.000Z'),
  startTime: new Date('1970-01-01T14:00:00.000Z'),
  endTime: new Date('1970-01-01T17:00:00.000Z'),
  maxCapacity: 35,
  bannerUrl: null,
  speakers: [
    { speaker: { id: 'speaker-001', firstName: 'Carlos', lastName: 'Rivera' } },
    { speaker: { id: 'speaker-002', firstName: 'Ana', lastName: 'Zapata' } },
  ],
  classroom: { id: 'classroom-001', name: 'Laboratorio 3', building: 'Edificio B' },
  eventProgram: {
    id: 'program-001',
    name: 'Programa de Ingenieria',
    label: null,
    organizationalUnit: {
      id: 'faculty-001',
      name: 'Ingenieria de Sistemas Computacionales',
      type: 'FACULTY',
    },
  },
  ...overrides,
});

const NOW = new Date('2026-09-19T15:00:00.000Z');

describe('activities service', () => {
  afterEach(() => {
    vi.doUnmock('../../config/prisma.js');
  });

  it('queries upcoming active activities with pagination', async () => {
    const prisma = createPrismaMock();
    prisma.activity.findMany.mockResolvedValue([buildRecord()]);
    prisma.activity.count.mockResolvedValue(37);
    const { listUpcomingActivities } = await loadService(prisma);

    const result = await listUpcomingActivities({ page: 2, limit: 20 }, NOW);

    expect(prisma.activity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: { in: ['SCHEDULED', 'ONGOING'] },
          eventProgram: { status: 'ACTIVE' },
          date: { gte: new Date('2026-09-19T00:00:00.000Z') },
        },
        orderBy: [{ date: 'asc' }, { startTime: 'asc' }, { id: 'asc' }],
        skip: 20,
        take: 20,
      }),
    );
    expect(prisma.activity.count).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ page: 2, limit: 20, total: 37, totalPages: 2 });
  });

  it('uses the Panama calendar date for the upcoming boundary', async () => {
    const prisma = createPrismaMock();
    prisma.activity.findMany.mockResolvedValue([]);
    prisma.activity.count.mockResolvedValue(0);
    const { listUpcomingActivities } = await loadService(prisma);

    await listUpcomingActivities({ page: 1, limit: 20 }, new Date('2026-09-20T03:00:00.000Z'));

    expect(prisma.activity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          date: { gte: new Date('2026-09-19T00:00:00.000Z') },
        }),
      }),
    );
  });

  it('maps a full activity without leaking check-in codes', async () => {
    const prisma = createPrismaMock();
    prisma.activity.findMany.mockResolvedValue([buildRecord()]);
    prisma.activity.count.mockResolvedValue(1);
    const { listUpcomingActivities } = await loadService(prisma);

    const result = await listUpcomingActivities({ page: 1, limit: 20 }, NOW);

    expect(result.items).toEqual([
      {
        id: 'activity-001',
        name: 'Taller de Inteligencia Artificial',
        description: 'Introduccion a modelos generativos.',
        type: 'WORKSHOP',
        date: '2026-09-20',
        startTime: '14:00',
        endTime: '17:00',
        capacity: 35,
        bannerUrl: null,
        speakers: [
          { id: 'speaker-001', firstName: 'Carlos', lastName: 'Rivera' },
          { id: 'speaker-002', firstName: 'Ana', lastName: 'Zapata' },
        ],
        classroom: { id: 'classroom-001', name: 'Laboratorio 3', building: 'Edificio B' },
        eventProgram: { id: 'program-001', name: 'Programa de Ingenieria', label: null },
        organizationalUnit: {
          type: 'FACULTY',
          id: 'faculty-001',
          name: 'Ingenieria de Sistemas Computacionales',
        },
      },
    ]);
    expect(JSON.stringify(result.items[0])).not.toContain('qrCode');
    expect(JSON.stringify(result.items[0])).not.toContain('manualCode');
  });

  it('maps a subdirectorate program', async () => {
    const prisma = createPrismaMock();
    prisma.activity.findMany.mockResolvedValue([
      buildRecord({
        speakers: [],
        classroom: null,
        eventProgram: {
          id: 'program-002',
          name: 'Programa de Extension',
          label: 'Bienestar',
          organizationalUnit: {
            id: 'sub-001',
            name: 'Subdireccion de Extension',
            type: 'SUBDIRECTORATE',
          },
        },
      }),
    ]);
    prisma.activity.count.mockResolvedValue(1);
    const { listUpcomingActivities } = await loadService(prisma);

    const result = await listUpcomingActivities({ page: 1, limit: 20 }, NOW);

    expect(result.items[0]?.organizationalUnit).toEqual({
      type: 'SUBDIRECTORATE',
      id: 'sub-001',
      name: 'Subdireccion de Extension',
    });
    expect(result.items[0]?.speakers).toEqual([]);
    expect(result.items[0]?.classroom).toBeNull();
  });

  it('returns zero total pages when there are no activities', async () => {
    const prisma = createPrismaMock();
    prisma.activity.findMany.mockResolvedValue([]);
    prisma.activity.count.mockResolvedValue(0);
    const { listUpcomingActivities } = await loadService(prisma);

    const result = await listUpcomingActivities({ page: 1, limit: 20 }, NOW);

    expect(result).toEqual({ items: [], page: 1, limit: 20, total: 0, totalPages: 0 });
  });
});

interface CreatePrismaMock {
  eventProgram: { findUnique: ReturnType<typeof vi.fn> };
  classroom: { findUnique: ReturnType<typeof vi.fn> };
  user: { findMany: ReturnType<typeof vi.fn> };
  activity: { create: ReturnType<typeof vi.fn> };
}

const createCreatePrismaMock = (): CreatePrismaMock => ({
  eventProgram: { findUnique: vi.fn() },
  classroom: { findUnique: vi.fn() },
  user: { findMany: vi.fn() },
  activity: { create: vi.fn() },
});

const loadCreateService = async (prisma: CreatePrismaMock) => {
  vi.resetModules();
  vi.doMock('../../config/prisma.js', () => ({
    getPrismaClient: () => prisma,
  }));

  return import('./activities.service.js');
};

const activeProgram = {
  id: 'program-001',
  status: 'ACTIVE',
  isDefault: true,
  startDate: null,
  endDate: null,
};

const createBody: CreateActivityBody = {
  name: 'Introduccion a TypeScript',
  type: 'WORKSHOP',
  date: '2026-09-20',
  startTime: '08:00',
  endTime: '10:00',
  eventProgramId: 'program-001',
};

const createdRecord = {
  id: 'activity-001',
  name: 'Introduccion a TypeScript',
  description: null,
  type: 'WORKSHOP' as const,
  date: new Date('2026-09-20T00:00:00.000Z'),
  startTime: new Date('1970-01-01T08:00:00.000Z'),
  endTime: new Date('1970-01-01T10:00:00.000Z'),
  maxCapacity: null,
  bannerUrl: null,
  status: 'DRAFT' as const,
  equipment: [{ name: 'Proyector' }],
  speakers: [],
  classroom: null,
  eventProgram: {
    id: 'program-001',
    name: 'Programa de Ingenieria',
    label: null,
    organizationalUnit: {
      id: 'faculty-001',
      name: 'Ingenieria de Sistemas Computacionales',
      type: 'FACULTY' as const,
    },
  },
};

describe('createActivity', () => {
  afterEach(() => {
    vi.doUnmock('../../config/prisma.js');
  });

  it('rejects when the event program does not exist', async () => {
    const prisma = createCreatePrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue(null);
    const { createActivity } = await loadCreateService(prisma);

    await expect(createActivity(createBody)).rejects.toMatchObject({ statusCode: 404 });
    expect(prisma.activity.create).not.toHaveBeenCalled();
  });

  it('rejects when the event program is not active', async () => {
    const prisma = createCreatePrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ ...activeProgram, status: 'DRAFT' });
    const { createActivity } = await loadCreateService(prisma);

    await expect(createActivity(createBody)).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.activity.create).not.toHaveBeenCalled();
  });

  it('rejects a date outside a non-default program range', async () => {
    const prisma = createCreatePrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({
      ...activeProgram,
      isDefault: false,
      startDate: new Date('2026-10-01T00:00:00.000Z'),
      endDate: new Date('2026-10-31T00:00:00.000Z'),
    });
    const { createActivity } = await loadCreateService(prisma);

    await expect(createActivity(createBody)).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects a missing or inactive classroom', async () => {
    const missing = createCreatePrismaMock();
    missing.eventProgram.findUnique.mockResolvedValue(activeProgram);
    missing.classroom.findUnique.mockResolvedValue(null);
    const { createActivity: createWithMissing } = await loadCreateService(missing);

    await expect(
      createWithMissing({ ...createBody, classroomId: 'classroom-001' }),
    ).rejects.toMatchObject({ statusCode: 404 });

    const inactive = createCreatePrismaMock();
    inactive.eventProgram.findUnique.mockResolvedValue(activeProgram);
    inactive.classroom.findUnique.mockResolvedValue({ id: 'classroom-001', isActive: false });
    const { createActivity: createWithInactive } = await loadCreateService(inactive);

    await expect(
      createWithInactive({ ...createBody, classroomId: 'classroom-001' }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('reuses speakers by email and links the matching platform user', async () => {
    const prisma = createCreatePrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue(activeProgram);
    prisma.user.findMany.mockResolvedValue([{ id: 'user-001', email: 'ana@example.com' }]);
    prisma.activity.create.mockResolvedValue(createdRecord);
    const { createActivity } = await loadCreateService(prisma);

    await createActivity({
      ...createBody,
      speakers: [
        {
          firstName: 'Ana',
          lastName: 'Gomez',
          email: 'ana@example.com',
          organization: 'UTP',
        },
      ],
    });

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { email: { in: ['ana@example.com'] } },
      }),
    );
    expect(prisma.activity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          speakers: {
            create: [
              {
                speaker: {
                  connectOrCreate: {
                    where: { email: 'ana@example.com' },
                    create: {
                      firstName: 'Ana',
                      lastName: 'Gomez',
                      email: 'ana@example.com',
                      organization: 'UTP',
                      userId: 'user-001',
                    },
                  },
                },
              },
            ],
          },
        }),
      }),
    );
  });

  it('creates speakers without email without querying users', async () => {
    const prisma = createCreatePrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue(activeProgram);
    prisma.activity.create.mockResolvedValue(createdRecord);
    const { createActivity } = await loadCreateService(prisma);

    await createActivity({
      ...createBody,
      speakers: [{ firstName: 'Marco', lastName: 'Santos', organization: 'Colegio' }],
    });

    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(prisma.activity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          speakers: {
            create: [
              {
                speaker: {
                  create: {
                    firstName: 'Marco',
                    lastName: 'Santos',
                    email: null,
                    organization: 'Colegio',
                    userId: null,
                  },
                },
              },
            ],
          },
        }),
      }),
    );
  });

  it('creates a DRAFT activity with parsed date, time and equipment', async () => {
    const prisma = createCreatePrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue(activeProgram);
    prisma.activity.create.mockResolvedValue(createdRecord);
    const { createActivity } = await loadCreateService(prisma);

    const result = await createActivity({ ...createBody, equipment: ['Proyector'] });

    expect(prisma.activity.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: 'DRAFT',
          date: new Date('2026-09-20T00:00:00.000Z'),
          startTime: new Date('1970-01-01T08:00:00.000Z'),
          endTime: new Date('1970-01-01T10:00:00.000Z'),
          equipment: {
            createMany: { data: [{ name: 'Proyector' }], skipDuplicates: true },
          },
        }),
      }),
    );
    expect(result).toEqual({
      id: 'activity-001',
      name: 'Introduccion a TypeScript',
      description: null,
      type: 'WORKSHOP',
      date: '2026-09-20',
      startTime: '08:00',
      endTime: '10:00',
      capacity: null,
      bannerUrl: null,
      status: 'DRAFT',
      equipment: ['Proyector'],
      speakers: [],
      classroom: null,
      eventProgram: { id: 'program-001', name: 'Programa de Ingenieria', label: null },
      organizationalUnit: {
        type: 'FACULTY',
        id: 'faculty-001',
        name: 'Ingenieria de Sistemas Computacionales',
      },
    });
  });
});
