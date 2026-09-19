import { afterEach, describe, expect, it, vi } from 'vitest';

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
  speaker: { id: string; firstName: string; lastName: string } | null;
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
  speaker: { id: 'user-001', firstName: 'Carlos', lastName: 'Rivera' },
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
        speaker: { id: 'user-001', firstName: 'Carlos', lastName: 'Rivera' },
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
        speaker: null,
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
    expect(result.items[0]?.speaker).toBeNull();
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
