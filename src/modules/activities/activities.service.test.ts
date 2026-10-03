import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { CreateActivityBody } from './activities.schemas.js';

interface ActivityRecord {
  id: string;
  name: string;
  description: string | null;
  type:
    'WORKSHOP' | 'SEMINAR' | 'TALK' | 'CONFERENCE' | 'PANEL' | 'COURSE' | 'COMPETITION' | 'OTHER';
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
  auditEvent: { create: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
}

const createCreatePrismaMock = (): CreatePrismaMock => {
  const prisma: CreatePrismaMock = {
    eventProgram: { findUnique: vi.fn() },
    classroom: { findUnique: vi.fn() },
    user: { findMany: vi.fn() },
    activity: { create: vi.fn() },
    auditEvent: { create: vi.fn().mockResolvedValue({ id: 'audit-001' }) },
    $transaction: vi.fn(),
  };

  prisma.$transaction.mockImplementation(
    async (callback: (client: CreatePrismaMock) => Promise<unknown>) => callback(prisma),
  );

  return prisma;
};

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
      enrolledCount: 0,
      checkedInCount: 0,
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

  it('writes one creation event inside the transaction', async () => {
    const prisma = createCreatePrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue(activeProgram);
    prisma.activity.create.mockResolvedValue(createdRecord);
    const { createActivity } = await loadCreateService(prisma);

    await createActivity(createBody, {
      actorId: 'user-001',
      actorType: 'USER',
      requestId: 'req-030',
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.auditEvent.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'activity.created',
        actorId: 'user-001',
        resourceType: 'activity',
        resourceId: 'activity-001',
        requestId: 'req-030',
        scopeType: 'event_program',
        scopeId: 'program-001',
        changes: {
          after: {
            status: 'DRAFT',
            type: 'WORKSHOP',
            date: '2026-09-20',
            startTime: '08:00',
            endTime: '10:00',
            maxCapacity: null,
            classroomId: null,
            eventProgramId: 'program-001',
          },
        },
      }),
    });
    expect(prisma.activity.create.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.auditEvent.create.mock.invocationCallOrder[0] as number,
    );
  });

  it('does not audit a creation rejected by validation', async () => {
    const prisma = createCreatePrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ ...activeProgram, status: 'DRAFT' });
    const { createActivity } = await loadCreateService(prisma);

    await expect(createActivity(createBody)).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });
});

interface DetailPrismaMock {
  activity: { findUnique: ReturnType<typeof vi.fn> };
  attendance: { count: ReturnType<typeof vi.fn> };
}

const createDetailPrismaMock = (): DetailPrismaMock => ({
  activity: { findUnique: vi.fn() },
  attendance: { count: vi.fn() },
});

const permissionsMock = vi.fn();

const loadDetailService = async (prisma: DetailPrismaMock) => {
  vi.resetModules();
  vi.doMock('../../config/prisma.js', () => ({
    getPrismaClient: () => prisma,
  }));
  vi.doMock('../authorization/authorization.service.js', () => ({
    getEffectivePermissions: permissionsMock,
  }));

  return import('./activities.service.js');
};

const buildDetailRecord = (
  overrides: {
    status?: 'DRAFT' | 'SCHEDULED' | 'ONGOING' | 'COMPLETED' | 'CANCELLED';
    programStatus?: 'DRAFT' | 'ACTIVE' | 'ARCHIVED';
    enrolledCount?: number;
    cancelReason?: string | null;
  } = {},
) => {
  const base = buildRecord();

  return {
    ...base,
    status: overrides.status ?? 'SCHEDULED',
    cancelReason: overrides.cancelReason ?? null,
    equipment: [{ name: 'Proyector' }],
    eventProgram: { ...base.eventProgram, status: overrides.programStatus ?? 'ACTIVE' },
    _count: { attendance: overrides.enrolledCount ?? 6 },
  };
};

const regularViewer: Express.AuthenticatedUser = {
  id: 'user-001',
  email: 'user@example.com',
  globalRole: 'USER',
  unitId: null,
  careerId: null,
  isActive: true,
};

const adminViewer: Express.AuthenticatedUser = {
  ...regularViewer,
  id: 'admin-001',
  email: 'admin@example.com',
  globalRole: 'ADMIN',
};

describe('getActivityById', () => {
  beforeEach(() => {
    permissionsMock.mockReset();
    permissionsMock.mockResolvedValue(new Set());
  });

  afterEach(() => {
    vi.doUnmock('../../config/prisma.js');
    vi.doUnmock('../authorization/authorization.service.js');
    permissionsMock.mockReset();
  });

  it('returns the detail with enrollment and check-in counts', async () => {
    const prisma = createDetailPrismaMock();
    prisma.activity.findUnique.mockResolvedValue(buildDetailRecord());
    prisma.attendance.count.mockResolvedValue(4);
    const { getActivityById } = await loadDetailService(prisma);

    const result = await getActivityById('activity-001');

    const query = prisma.activity.findUnique.mock.calls[0]?.[0] as {
      select: { _count: unknown; eventProgram: { select: { status: boolean } } };
    };
    expect(query).toMatchObject({ where: { id: 'activity-001' } });
    expect(query.select._count).toEqual({ select: { attendance: true } });
    expect(query.select.eventProgram.select.status).toBe(true);
    expect(prisma.attendance.count).toHaveBeenCalledWith({
      where: { activityId: 'activity-001', checkedInAt: { not: null } },
    });
    expect(result).toMatchObject({
      id: 'activity-001',
      status: 'SCHEDULED',
      equipment: ['Proyector'],
      enrolledCount: 6,
      checkedInCount: 4,
    });
    expect(permissionsMock).not.toHaveBeenCalled();
  });

  it('throws 404 when the activity does not exist', async () => {
    const prisma = createDetailPrismaMock();
    prisma.activity.findUnique.mockResolvedValue(null);
    const { getActivityById } = await loadDetailService(prisma);

    await expect(getActivityById('missing')).rejects.toMatchObject({ statusCode: 404 });
    expect(prisma.attendance.count).not.toHaveBeenCalled();
  });

  it('hides DRAFT activities from anonymous viewers', async () => {
    const prisma = createDetailPrismaMock();
    prisma.activity.findUnique.mockResolvedValue(buildDetailRecord({ status: 'DRAFT' }));
    const { getActivityById } = await loadDetailService(prisma);

    await expect(getActivityById('activity-001')).rejects.toMatchObject({ statusCode: 404 });
    expect(prisma.attendance.count).not.toHaveBeenCalled();
  });

  it.each(['DRAFT', 'ARCHIVED'] as const)(
    'hides activities of %s programs from anonymous viewers',
    async (programStatus) => {
      const prisma = createDetailPrismaMock();
      prisma.activity.findUnique.mockResolvedValue(buildDetailRecord({ programStatus }));
      const { getActivityById } = await loadDetailService(prisma);

      await expect(getActivityById('activity-001')).rejects.toMatchObject({ statusCode: 404 });
    },
  );

  it.each(['ONGOING', 'COMPLETED', 'CANCELLED'] as const)(
    'exposes %s activities of ACTIVE programs publicly',
    async (status) => {
      const prisma = createDetailPrismaMock();
      prisma.activity.findUnique.mockResolvedValue(buildDetailRecord({ status }));
      prisma.attendance.count.mockResolvedValue(0);
      const { getActivityById } = await loadDetailService(prisma);

      const result = await getActivityById('activity-001');

      expect(result.status).toBe(status);
    },
  );

  it('lets a collaborator with activity:read see a DRAFT activity', async () => {
    const prisma = createDetailPrismaMock();
    prisma.activity.findUnique.mockResolvedValue(buildDetailRecord({ status: 'DRAFT' }));
    prisma.attendance.count.mockResolvedValue(2);
    permissionsMock.mockResolvedValue(new Set(['activity:read']));
    const { getActivityById } = await loadDetailService(prisma);

    const result = await getActivityById('activity-001', regularViewer);

    expect(result).toMatchObject({ status: 'DRAFT', enrolledCount: 6, checkedInCount: 2 });
    expect(permissionsMock).toHaveBeenCalledWith(regularViewer, { activityId: 'activity-001' });
  });

  it('lets an ADMIN see a DRAFT activity without a permission lookup', async () => {
    const prisma = createDetailPrismaMock();
    prisma.activity.findUnique.mockResolvedValue(buildDetailRecord({ status: 'DRAFT' }));
    prisma.attendance.count.mockResolvedValue(0);
    const { getActivityById } = await loadDetailService(prisma);

    const result = await getActivityById('activity-001', adminViewer);

    expect(result.status).toBe('DRAFT');
    expect(permissionsMock).not.toHaveBeenCalled();
  });

  it('returns the public detail to an authenticated viewer without permission', async () => {
    const prisma = createDetailPrismaMock();
    prisma.activity.findUnique.mockResolvedValue(buildDetailRecord());
    prisma.attendance.count.mockResolvedValue(0);
    const { getActivityById } = await loadDetailService(prisma);

    const result = await getActivityById('activity-001', regularViewer);

    expect(result.status).toBe('SCHEDULED');
    expect(permissionsMock).toHaveBeenCalledWith(regularViewer, { activityId: 'activity-001' });
  });

  it('hides a DRAFT activity from an authenticated viewer without permission', async () => {
    const prisma = createDetailPrismaMock();
    prisma.activity.findUnique.mockResolvedValue(buildDetailRecord({ status: 'DRAFT' }));
    const { getActivityById } = await loadDetailService(prisma);

    await expect(getActivityById('activity-001', regularViewer)).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});

interface UpdatePrismaMock {
  activity: {
    findUnique: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  classroom: { findUnique: ReturnType<typeof vi.fn> };
  classroomAvailability: { findFirst: ReturnType<typeof vi.fn> };
  user: { findMany: ReturnType<typeof vi.fn> };
  attendance: { count: ReturnType<typeof vi.fn> };
  auditEvent: { create: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
}

const createUpdatePrismaMock = (): UpdatePrismaMock => {
  const prisma: UpdatePrismaMock = {
    activity: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    classroom: { findUnique: vi.fn() },
    classroomAvailability: { findFirst: vi.fn() },
    user: { findMany: vi.fn() },
    attendance: { count: vi.fn() },
    auditEvent: { create: vi.fn().mockResolvedValue({ id: 'audit-001' }) },
    $transaction: vi.fn(),
  };

  prisma.$transaction.mockImplementation(
    async (callback: (client: UpdatePrismaMock) => Promise<unknown>) => callback(prisma),
  );

  return prisma;
};

const loadUpdateService = async (prisma: UpdatePrismaMock) => {
  vi.resetModules();
  vi.doMock('../../config/prisma.js', () => ({
    getPrismaClient: () => prisma,
  }));

  return import('./activities.service.js');
};

const updateRecord = (overrides: Record<string, unknown> = {}) => ({
  id: 'activity-001',
  name: 'Taller de Inteligencia Artificial',
  description: 'Introduccion a modelos generativos.',
  type: 'WORKSHOP' as const,
  date: new Date('2026-10-05T00:00:00.000Z'),
  startTime: new Date('1970-01-01T14:00:00.000Z'),
  endTime: new Date('1970-01-01T17:00:00.000Z'),
  maxCapacity: 35,
  bannerUrl: null,
  status: 'SCHEDULED' as const,
  classroomId: 'classroom-001',
  equipment: [{ name: 'Proyector' }],
  speakers: [],
  classroom: { id: 'classroom-001', name: 'Laboratorio 3', building: 'Edificio B' },
  eventProgram: {
    id: 'program-001',
    name: 'Programa de Ingenieria',
    label: null,
    status: 'ACTIVE' as const,
    isDefault: true,
    startDate: null,
    endDate: null,
    organizationalUnit: {
      id: 'faculty-001',
      name: 'Ingenieria de Sistemas Computacionales',
      type: 'FACULTY' as const,
    },
  },
  _count: { attendance: 6 },
  ...overrides,
});

describe('updateActivity', () => {
  afterEach(() => {
    vi.doUnmock('../../config/prisma.js');
  });

  it('throws 404 when the activity does not exist', async () => {
    const prisma = createUpdatePrismaMock();
    prisma.activity.findUnique.mockResolvedValue(null);
    const { updateActivity } = await loadUpdateService(prisma);

    await expect(updateActivity('missing', { name: 'X' })).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(prisma.activity.update).not.toHaveBeenCalled();
  });

  it.each(['COMPLETED', 'CANCELLED'] as const)(
    'rejects updates of %s activities with 409',
    async (status) => {
      const prisma = createUpdatePrismaMock();
      prisma.activity.findUnique.mockResolvedValue({ ...updateRecord(), status });
      const { updateActivity } = await loadUpdateService(prisma);

      await expect(updateActivity('activity-001', { name: 'X' })).rejects.toMatchObject({
        statusCode: 409,
        message: 'Completed or cancelled activities cannot be modified.',
      });
      expect(prisma.activity.update).not.toHaveBeenCalled();
    },
  );

  it.each(['ARCHIVED', 'DRAFT'] as const)(
    'rejects updates when the program is %s with 409',
    async (programStatus) => {
      const prisma = createUpdatePrismaMock();
      prisma.activity.findUnique.mockResolvedValue(
        updateRecord({ eventProgram: { ...updateRecord().eventProgram, status: programStatus } }),
      );
      const { updateActivity } = await loadUpdateService(prisma);

      await expect(updateActivity('activity-001', { name: 'X' })).rejects.toMatchObject({
        statusCode: 409,
        message: 'Event programs must be active to modify their activities.',
      });
    },
  );

  it('updates scalar fields with parsed date and time and returns the detail with counts', async () => {
    const prisma = createUpdatePrismaMock();
    prisma.activity.findUnique.mockResolvedValue(updateRecord({ status: 'DRAFT' }));
    prisma.activity.update.mockResolvedValue(
      updateRecord({ name: 'Taller actualizado', status: 'DRAFT' }),
    );
    prisma.attendance.count.mockResolvedValue(4);
    const { updateActivity } = await loadUpdateService(prisma);

    const result = await updateActivity('activity-001', {
      name: 'Taller actualizado',
      date: '2026-10-05',
      startTime: '15:00',
      endTime: '18:00',
      maxCapacity: 40,
      description: null,
      classroomId: null,
    });

    expect(prisma.activity.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'activity-001' },
        data: expect.objectContaining({
          name: 'Taller actualizado',
          description: null,
          date: new Date('2026-10-05T00:00:00.000Z'),
          startTime: new Date('1970-01-01T15:00:00.000Z'),
          endTime: new Date('1970-01-01T18:00:00.000Z'),
          maxCapacity: 40,
          classroomId: null,
        }),
      }),
    );
    expect(result).toMatchObject({
      id: 'activity-001',
      name: 'Taller actualizado',
      enrolledCount: 6,
      checkedInCount: 4,
    });
  });

  it('rejects a partial time change that leaves the range invalid', async () => {
    const prisma = createUpdatePrismaMock();
    prisma.activity.findUnique.mockResolvedValue(updateRecord({ status: 'DRAFT' }));
    const { updateActivity } = await loadUpdateService(prisma);

    await expect(updateActivity('activity-001', { startTime: '18:00' })).rejects.toMatchObject({
      statusCode: 400,
      message: 'End time must be after start time.',
    });
    expect(prisma.activity.update).not.toHaveBeenCalled();
  });

  it('publishes a DRAFT activity and validates the classroom booking', async () => {
    const prisma = createUpdatePrismaMock();
    prisma.activity.findUnique.mockResolvedValue(updateRecord({ status: 'DRAFT' }));
    prisma.classroom.findUnique.mockResolvedValue({
      id: 'classroom-001',
      isActive: true,
      capacity: 60,
    });
    prisma.classroomAvailability.findFirst.mockResolvedValue({ id: 'slot-001' });
    prisma.activity.findFirst.mockResolvedValue(null);
    prisma.activity.update.mockResolvedValue(updateRecord({ status: 'SCHEDULED' }));
    prisma.attendance.count.mockResolvedValue(0);
    const { updateActivity } = await loadUpdateService(prisma);

    const result = await updateActivity('activity-001', { status: 'SCHEDULED' });

    expect(prisma.classroomAvailability.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          classroomId: 'classroom-001',
          dayOfWeek: 1,
          startTime: { lte: new Date('1970-01-01T14:00:00.000Z') },
          endTime: { gte: new Date('1970-01-01T17:00:00.000Z') },
        }),
      }),
    );
    expect(prisma.activity.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { not: 'activity-001' },
          classroomId: 'classroom-001',
          date: new Date('2026-10-05T00:00:00.000Z'),
          status: { in: ['SCHEDULED', 'ONGOING'] },
          startTime: { lt: new Date('1970-01-01T17:00:00.000Z') },
          endTime: { gt: new Date('1970-01-01T14:00:00.000Z') },
        }),
      }),
    );
    expect(result.status).toBe('SCHEDULED');
  });

  it('accepts a SCHEDULED -> DRAFT transition', async () => {
    const prisma = createUpdatePrismaMock();
    prisma.activity.findUnique.mockResolvedValue(updateRecord({ status: 'SCHEDULED' }));
    prisma.activity.update.mockResolvedValue(updateRecord({ status: 'DRAFT' }));
    prisma.attendance.count.mockResolvedValue(0);
    const { updateActivity } = await loadUpdateService(prisma);

    const result = await updateActivity('activity-001', { status: 'DRAFT' });

    expect(result.status).toBe('DRAFT');
    expect(prisma.classroomAvailability.findFirst).not.toHaveBeenCalled();
  });

  it('rejects status transitions from ONGOING with 400', async () => {
    const prisma = createUpdatePrismaMock();
    prisma.activity.findUnique.mockResolvedValue(updateRecord({ status: 'ONGOING' }));
    const { updateActivity } = await loadUpdateService(prisma);

    await expect(updateActivity('activity-001', { status: 'SCHEDULED' })).rejects.toMatchObject({
      statusCode: 400,
      message: 'Activity status transition is not allowed.',
    });
    expect(prisma.activity.update).not.toHaveBeenCalled();
  });

  it.each(['SCHEDULED', 'DRAFT'] as const)(
    'accepts the same %s status as a no-op',
    async (status) => {
      const prisma = createUpdatePrismaMock();
      prisma.activity.findUnique.mockResolvedValue(updateRecord({ status }));
      prisma.activity.update.mockResolvedValue(updateRecord({ status }));
      prisma.attendance.count.mockResolvedValue(0);
      const { updateActivity } = await loadUpdateService(prisma);

      const result = await updateActivity('activity-001', { status, name: 'Mismo estado' });

      expect(result.status).toBe(status);
    },
  );

  it('rejects a date outside a non-default program range', async () => {
    const prisma = createUpdatePrismaMock();
    prisma.activity.findUnique.mockResolvedValue(
      updateRecord({
        status: 'DRAFT',
        eventProgram: {
          ...updateRecord().eventProgram,
          isDefault: false,
          startDate: new Date('2026-10-01T00:00:00.000Z'),
          endDate: new Date('2026-10-31T00:00:00.000Z'),
        },
      }),
    );
    const { updateActivity } = await loadUpdateService(prisma);

    await expect(updateActivity('activity-001', { date: '2026-11-15' })).rejects.toMatchObject({
      statusCode: 400,
      message: 'Activity date must be within the event program date range.',
    });
  });

  it('rejects a missing or inactive classroom when classroomId is provided', async () => {
    const missing = createUpdatePrismaMock();
    missing.activity.findUnique.mockResolvedValue(updateRecord({ status: 'DRAFT' }));
    missing.classroom.findUnique.mockResolvedValue(null);
    const { updateActivity: updateWithMissing } = await loadUpdateService(missing);

    await expect(
      updateWithMissing('activity-001', { classroomId: 'classroom-missing' }),
    ).rejects.toMatchObject({ statusCode: 404 });

    const inactive = createUpdatePrismaMock();
    inactive.activity.findUnique.mockResolvedValue(updateRecord({ status: 'DRAFT' }));
    inactive.classroom.findUnique.mockResolvedValue({
      id: 'classroom-001',
      isActive: false,
      capacity: 60,
    });
    const { updateActivity: updateWithInactive } = await loadUpdateService(inactive);

    await expect(
      updateWithInactive('activity-001', { classroomId: 'classroom-001' }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects a classroom without an availability window that covers the schedule', async () => {
    const prisma = createUpdatePrismaMock();
    prisma.activity.findUnique.mockResolvedValue(updateRecord());
    prisma.classroom.findUnique.mockResolvedValue({
      id: 'classroom-001',
      isActive: true,
      capacity: 60,
    });
    prisma.classroomAvailability.findFirst.mockResolvedValue(null);
    const { updateActivity } = await loadUpdateService(prisma);

    await expect(updateActivity('activity-001', { endTime: '18:00' })).rejects.toMatchObject({
      statusCode: 409,
      message: 'Classroom is not available in the requested time window.',
    });
  });

  it('rejects an overlapping classroom reservation with 409', async () => {
    const prisma = createUpdatePrismaMock();
    prisma.activity.findUnique.mockResolvedValue(updateRecord());
    prisma.classroom.findUnique.mockResolvedValue({
      id: 'classroom-001',
      isActive: true,
      capacity: 60,
    });
    prisma.classroomAvailability.findFirst.mockResolvedValue({ id: 'slot-001' });
    prisma.activity.findFirst.mockResolvedValue({ id: 'activity-999' });
    const { updateActivity } = await loadUpdateService(prisma);

    await expect(updateActivity('activity-001', { date: '2026-10-06' })).rejects.toMatchObject({
      statusCode: 409,
      message: 'Classroom is already reserved for an overlapping activity.',
    });
  });

  it('rejects a classroom with less capacity than the activity', async () => {
    const prisma = createUpdatePrismaMock();
    prisma.activity.findUnique.mockResolvedValue(updateRecord());
    prisma.classroom.findUnique.mockResolvedValue({
      id: 'classroom-001',
      isActive: true,
      capacity: 20,
    });
    const { updateActivity } = await loadUpdateService(prisma);

    await expect(updateActivity('activity-001', { maxCapacity: 30 })).rejects.toMatchObject({
      statusCode: 400,
      message: 'Classroom capacity is below the activity capacity.',
    });
  });

  it('skips booking validation when the resulting status is DRAFT', async () => {
    const prisma = createUpdatePrismaMock();
    prisma.activity.findUnique.mockResolvedValue(updateRecord({ status: 'DRAFT' }));
    prisma.activity.update.mockResolvedValue(updateRecord({ status: 'DRAFT' }));
    prisma.attendance.count.mockResolvedValue(0);
    const { updateActivity } = await loadUpdateService(prisma);

    await updateActivity('activity-001', { date: '2026-12-01' });

    expect(prisma.classroomAvailability.findFirst).not.toHaveBeenCalled();
    expect(prisma.activity.findFirst).not.toHaveBeenCalled();
  });

  it('clears the classroom with null without booking validation', async () => {
    const prisma = createUpdatePrismaMock();
    prisma.activity.findUnique.mockResolvedValue(updateRecord());
    prisma.activity.update.mockResolvedValue(updateRecord({ classroom: null }));
    prisma.attendance.count.mockResolvedValue(0);
    const { updateActivity } = await loadUpdateService(prisma);

    await updateActivity('activity-001', { classroomId: null });

    expect(prisma.classroom.findUnique).not.toHaveBeenCalled();
    expect(prisma.activity.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ classroomId: null }) }),
    );
  });

  it('replaces equipment and speakers atomically', async () => {
    const prisma = createUpdatePrismaMock();
    prisma.activity.findUnique.mockResolvedValue(updateRecord({ status: 'DRAFT' }));
    prisma.user.findMany.mockResolvedValue([{ id: 'user-001', email: 'ana@example.com' }]);
    prisma.activity.update.mockResolvedValue(updateRecord({ status: 'DRAFT' }));
    prisma.attendance.count.mockResolvedValue(0);
    const { updateActivity } = await loadUpdateService(prisma);

    await updateActivity('activity-001', {
      equipment: ['Pizarra'],
      speakers: [{ firstName: 'Ana', lastName: 'Gomez', email: 'ana@example.com' }],
    });

    expect(prisma.activity.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          equipment: {
            deleteMany: {},
            createMany: { data: [{ name: 'Pizarra' }], skipDuplicates: true },
          },
          speakers: {
            deleteMany: {},
            create: [
              {
                speaker: {
                  connectOrCreate: {
                    where: { email: 'ana@example.com' },
                    create: {
                      firstName: 'Ana',
                      lastName: 'Gomez',
                      email: 'ana@example.com',
                      organization: null,
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

  it('clears equipment and speakers with empty arrays', async () => {
    const prisma = createUpdatePrismaMock();
    prisma.activity.findUnique.mockResolvedValue(updateRecord({ status: 'DRAFT' }));
    prisma.activity.update.mockResolvedValue(updateRecord({ status: 'DRAFT' }));
    prisma.attendance.count.mockResolvedValue(0);
    const { updateActivity } = await loadUpdateService(prisma);

    await updateActivity('activity-001', { equipment: [], speakers: [] });

    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(prisma.activity.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          equipment: { deleteMany: {} },
          speakers: { deleteMany: {} },
        }),
      }),
    );
  });

  it('translates an exclusion constraint violation into a 409', async () => {
    const prisma = createUpdatePrismaMock();
    prisma.activity.findUnique.mockResolvedValue(updateRecord());
    prisma.classroom.findUnique.mockResolvedValue({
      id: 'classroom-001',
      isActive: true,
      capacity: 60,
    });
    prisma.classroomAvailability.findFirst.mockResolvedValue({ id: 'slot-001' });
    prisma.activity.findFirst.mockResolvedValue(null);
    prisma.activity.update.mockRejectedValue({ code: '23P01' });
    const { updateActivity } = await loadUpdateService(prisma);

    await expect(updateActivity('activity-001', { date: '2026-10-06' })).rejects.toMatchObject({
      statusCode: 409,
      message: 'Classroom is already reserved for an overlapping activity.',
    });
  });

  it('writes a single schedule_changed event for a date and time change', async () => {
    const prisma = createUpdatePrismaMock();
    prisma.activity.findUnique.mockResolvedValue(updateRecord({ status: 'SCHEDULED' }));
    prisma.classroom.findUnique.mockResolvedValue({
      id: 'classroom-001',
      isActive: true,
      capacity: 60,
    });
    prisma.classroomAvailability.findFirst.mockResolvedValue({ id: 'slot-001' });
    prisma.activity.findFirst.mockResolvedValue(null);
    prisma.activity.update.mockResolvedValue(
      updateRecord({
        status: 'SCHEDULED',
        date: new Date('2026-10-12T00:00:00.000Z'),
        startTime: new Date('1970-01-01T15:00:00.000Z'),
        endTime: new Date('1970-01-01T18:00:00.000Z'),
      }),
    );
    const { updateActivity } = await loadUpdateService(prisma);

    await updateActivity(
      'activity-001',
      { date: '2026-10-12', startTime: '15:00', endTime: '18:00' },
      { actorId: 'user-001', actorType: 'USER', requestId: 'req-100' },
    );

    expect(prisma.auditEvent.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'activity.schedule_changed',
        actorId: 'user-001',
        resourceType: 'activity',
        resourceId: 'activity-001',
        scopeType: 'event_program',
        scopeId: 'program-001',
        requestId: 'req-100',
        changes: {
          before: { date: '2026-10-05', startTime: '14:00', endTime: '17:00' },
          after: { date: '2026-10-12', startTime: '15:00', endTime: '18:00' },
        },
      }),
    });
  });

  it('writes a single scheduled event when a draft is published to the schedule', async () => {
    const prisma = createUpdatePrismaMock();
    prisma.activity.findUnique.mockResolvedValue(updateRecord({ status: 'DRAFT' }));
    prisma.classroom.findUnique.mockResolvedValue({
      id: 'classroom-001',
      isActive: true,
      capacity: 60,
    });
    prisma.classroomAvailability.findFirst.mockResolvedValue({ id: 'slot-001' });
    prisma.activity.findFirst.mockResolvedValue(null);
    prisma.activity.update.mockResolvedValue(updateRecord({ status: 'SCHEDULED' }));
    const { updateActivity } = await loadUpdateService(prisma);

    await updateActivity(
      'activity-001',
      { status: 'SCHEDULED' },
      {
        actorId: 'user-001',
        actorType: 'USER',
        requestId: 'req-101',
      },
    );

    expect(prisma.auditEvent.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'activity.scheduled',
        resourceType: 'activity',
        resourceId: 'activity-001',
        scopeType: 'event_program',
        scopeId: 'program-001',
        requestId: 'req-101',
        changes: { before: { status: 'DRAFT' }, after: { status: 'SCHEDULED' } },
      }),
    });
  });

  it('writes a single unpublished event when a scheduled activity returns to draft', async () => {
    const prisma = createUpdatePrismaMock();
    prisma.activity.findUnique.mockResolvedValue(updateRecord({ status: 'SCHEDULED' }));
    prisma.activity.update.mockResolvedValue(updateRecord({ status: 'DRAFT' }));
    const { updateActivity } = await loadUpdateService(prisma);

    await updateActivity(
      'activity-001',
      { status: 'DRAFT' },
      {
        actorId: 'user-001',
        actorType: 'USER',
      },
    );

    expect(prisma.auditEvent.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'activity.unpublished',
        resourceType: 'activity',
        resourceId: 'activity-001',
        changes: { before: { status: 'SCHEDULED' }, after: { status: 'DRAFT' } },
      }),
    });
  });

  it('emits only the status transition when a patch changes status and schedule together', async () => {
    const prisma = createUpdatePrismaMock();
    prisma.activity.findUnique.mockResolvedValue(updateRecord({ status: 'DRAFT' }));
    prisma.classroom.findUnique.mockResolvedValue({
      id: 'classroom-001',
      isActive: true,
      capacity: 60,
    });
    prisma.classroomAvailability.findFirst.mockResolvedValue({ id: 'slot-001' });
    prisma.activity.findFirst.mockResolvedValue(null);
    prisma.activity.update.mockResolvedValue(updateRecord({ status: 'SCHEDULED' }));
    const { updateActivity } = await loadUpdateService(prisma);

    await updateActivity('activity-001', { status: 'SCHEDULED', startTime: '15:00' });

    expect(prisma.auditEvent.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'activity.scheduled' }),
    });
  });

  it('records the classroom change inside the schedule_changed event', async () => {
    const prisma = createUpdatePrismaMock();
    prisma.activity.findUnique.mockResolvedValue(updateRecord({ status: 'SCHEDULED' }));
    prisma.activity.update.mockResolvedValue(
      updateRecord({ status: 'SCHEDULED', classroomId: 'classroom-002' }),
    );
    prisma.classroom.findUnique.mockResolvedValue({
      id: 'classroom-002',
      isActive: true,
      capacity: 60,
    });
    prisma.classroomAvailability.findFirst.mockResolvedValue({ id: 'slot-001' });
    prisma.activity.findFirst.mockResolvedValue(null);
    const { updateActivity } = await loadUpdateService(prisma);

    await updateActivity('activity-001', { classroomId: 'classroom-002' });

    expect(prisma.auditEvent.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'activity.schedule_changed',
        changes: {
          before: { classroomId: 'classroom-001' },
          after: { classroomId: 'classroom-002' },
        },
      }),
    });
  });

  it('audits a patch that only renames the activity as an attribute change', async () => {
    const prisma = createUpdatePrismaMock();
    prisma.activity.findUnique.mockResolvedValue(updateRecord({ status: 'SCHEDULED' }));
    prisma.activity.update.mockResolvedValue(
      updateRecord({ status: 'SCHEDULED', name: 'Taller renombrado' }),
    );
    const { updateActivity } = await loadUpdateService(prisma);

    await updateActivity('activity-001', { name: 'Taller renombrado' });

    expect(prisma.auditEvent.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'activity.updated',
        resourceId: 'activity-001',
        metadata: { changedFields: ['name'] },
      }),
    });
  });

  it('does not audit a patch that repeats the stored attributes', async () => {
    const prisma = createUpdatePrismaMock();
    prisma.activity.findUnique.mockResolvedValue(updateRecord({ status: 'SCHEDULED' }));
    prisma.activity.update.mockResolvedValue(updateRecord({ status: 'SCHEDULED' }));
    const { updateActivity } = await loadUpdateService(prisma);

    await updateActivity('activity-001', { name: 'Taller de Inteligencia Artificial' });

    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it('does not audit a status transition rejected as invalid', async () => {
    const prisma = createUpdatePrismaMock();
    prisma.activity.findUnique.mockResolvedValue(updateRecord({ status: 'ONGOING' }));
    const { updateActivity } = await loadUpdateService(prisma);

    await expect(updateActivity('activity-001', { status: 'DRAFT' })).rejects.toMatchObject({
      statusCode: 400,
      message: 'Activity status transition is not allowed.',
    });

    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it('reverts the activity when the schedule audit insert fails', async () => {
    const prisma = createUpdatePrismaMock();
    prisma.activity.findUnique.mockResolvedValue(updateRecord({ status: 'SCHEDULED' }));
    prisma.classroom.findUnique.mockResolvedValue({
      id: 'classroom-001',
      isActive: true,
      capacity: 60,
    });
    prisma.classroomAvailability.findFirst.mockResolvedValue({ id: 'slot-001' });
    prisma.activity.findFirst.mockResolvedValue(null);
    prisma.activity.update.mockResolvedValue(
      updateRecord({ status: 'SCHEDULED', startTime: new Date('1970-01-01T15:00:00.000Z') }),
    );
    prisma.auditEvent.create.mockRejectedValue(new Error('audit insert failed'));
    const { updateActivity } = await loadUpdateService(prisma);

    await expect(updateActivity('activity-001', { startTime: '15:00' })).rejects.toThrow(
      'audit insert failed',
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});

interface ProgramActivitiesPrismaMock {
  eventProgram: { findUnique: ReturnType<typeof vi.fn> };
  activity: { findMany: ReturnType<typeof vi.fn>; count: ReturnType<typeof vi.fn> };
}

const createProgramActivitiesPrismaMock = (): ProgramActivitiesPrismaMock => ({
  eventProgram: { findUnique: vi.fn() },
  activity: { findMany: vi.fn(), count: vi.fn() },
});

const loadProgramActivitiesService = async ({
  prisma,
  permissions,
}: {
  prisma: ProgramActivitiesPrismaMock;
  permissions?: ReturnType<typeof vi.fn>;
}) => {
  vi.resetModules();
  vi.doMock('../../config/prisma.js', () => ({
    getPrismaClient: () => prisma,
  }));
  vi.doMock('../authorization/authorization.service.js', () => ({
    getEffectivePermissions: permissions ?? permissionsMock,
  }));

  return import('./activities.service.js');
};

const buildProgramActivityRecord = (
  overrides: { status?: 'DRAFT' | 'SCHEDULED' | 'ONGOING' | 'COMPLETED' | 'CANCELLED' } = {},
) => ({ ...buildRecord(), status: overrides.status ?? 'SCHEDULED' });

describe('listEventProgramActivities', () => {
  const publicStatuses = ['SCHEDULED', 'ONGOING', 'COMPLETED'];
  const allStatuses = ['DRAFT', 'SCHEDULED', 'ONGOING', 'COMPLETED', 'CANCELLED'];

  beforeEach(() => {
    permissionsMock.mockReset();
    permissionsMock.mockResolvedValue(new Set());
  });

  afterEach(() => {
    vi.doUnmock('../../config/prisma.js');
    vi.doUnmock('../authorization/authorization.service.js');
    permissionsMock.mockReset();
  });

  it('throws 404 when the event program does not exist', async () => {
    const prisma = createProgramActivitiesPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue(null);
    const { listEventProgramActivities } = await loadProgramActivitiesService({ prisma });

    await expect(
      listEventProgramActivities('missing', { page: 1, limit: 20 }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(prisma.activity.findMany).not.toHaveBeenCalled();
  });

  it('lists the public statuses for anonymous callers with pagination', async () => {
    const prisma = createProgramActivitiesPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'program-001', status: 'ACTIVE' });
    prisma.activity.findMany.mockResolvedValue([buildProgramActivityRecord()]);
    prisma.activity.count.mockResolvedValue(2);
    const { listEventProgramActivities } = await loadProgramActivitiesService({ prisma });

    const result = await listEventProgramActivities('program-001', { page: 1, limit: 20 });

    expect(prisma.eventProgram.findUnique).toHaveBeenCalledWith({
      where: { id: 'program-001' },
      select: { id: true, status: true },
    });
    expect(prisma.activity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { eventProgramId: 'program-001', status: { in: publicStatuses } },
        orderBy: [{ date: 'asc' }, { startTime: 'asc' }, { id: 'asc' }],
        skip: 0,
        take: 20,
      }),
    );
    expect(result).toMatchObject({ page: 1, limit: 20, total: 2, totalPages: 1 });
    expect(result.items[0]).toMatchObject({ id: 'activity-001', status: 'SCHEDULED' });
    expect(JSON.stringify(result.items[0])).not.toContain('qrCode');
    expect(JSON.stringify(result.items[0])).not.toContain('manualCode');
  });

  it('returns 404 for anonymous callers when the program is not active', async () => {
    const prisma = createProgramActivitiesPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'program-001', status: 'DRAFT' });
    const { listEventProgramActivities } = await loadProgramActivitiesService({ prisma });

    await expect(
      listEventProgramActivities('program-001', { page: 1, limit: 20 }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(prisma.activity.findMany).not.toHaveBeenCalled();
  });

  it('ignores the status filter for anonymous callers', async () => {
    const prisma = createProgramActivitiesPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'program-001', status: 'ACTIVE' });
    prisma.activity.findMany.mockResolvedValue([]);
    prisma.activity.count.mockResolvedValue(0);
    const { listEventProgramActivities } = await loadProgramActivitiesService({ prisma });

    await listEventProgramActivities('program-001', { page: 1, limit: 20, status: 'DRAFT' });

    expect(prisma.activity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { in: publicStatuses } }),
      }),
    );
  });

  it('lets a collaborator with activity:read filter by status', async () => {
    const prisma = createProgramActivitiesPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'program-001', status: 'ACTIVE' });
    prisma.activity.findMany.mockResolvedValue([buildProgramActivityRecord({ status: 'DRAFT' })]);
    prisma.activity.count.mockResolvedValue(1);
    permissionsMock.mockResolvedValue(new Set(['activity:read']));
    const { listEventProgramActivities } = await loadProgramActivitiesService({ prisma });

    const result = await listEventProgramActivities(
      'program-001',
      {
        page: 1,
        limit: 20,
        status: 'DRAFT',
      },
      regularViewer,
    );

    expect(permissionsMock).toHaveBeenCalledWith(regularViewer, { eventProgramId: 'program-001' });
    expect(prisma.activity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { in: ['DRAFT'] } }),
      }),
    );
    expect(result.items[0]).toMatchObject({ status: 'DRAFT' });
  });

  it('shows every status to an authorized collaborator by default and with ALL', async () => {
    const prisma = createProgramActivitiesPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'program-001', status: 'ACTIVE' });
    prisma.activity.findMany.mockResolvedValue([]);
    prisma.activity.count.mockResolvedValue(0);
    permissionsMock.mockResolvedValue(new Set(['activity:read']));
    const { listEventProgramActivities } = await loadProgramActivitiesService({ prisma });

    await listEventProgramActivities('program-001', { page: 1, limit: 20 }, regularViewer);
    await listEventProgramActivities(
      'program-001',
      { page: 1, limit: 20, status: 'ALL' },
      regularViewer,
    );

    expect(prisma.activity.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: expect.objectContaining({ status: { in: allStatuses } }),
      }),
    );
    expect(prisma.activity.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({ status: { in: allStatuses } }),
      }),
    );
  });

  it('lets an ADMIN see every status without a permission lookup', async () => {
    const prisma = createProgramActivitiesPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'program-001', status: 'ARCHIVED' });
    prisma.activity.findMany.mockResolvedValue([]);
    prisma.activity.count.mockResolvedValue(0);
    const { listEventProgramActivities } = await loadProgramActivitiesService({ prisma });

    await listEventProgramActivities('program-001', { page: 1, limit: 20 }, adminViewer);

    expect(permissionsMock).not.toHaveBeenCalled();
    expect(prisma.activity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { in: allStatuses } }),
      }),
    );
  });

  it('hides a non-active program from an authenticated viewer without permission', async () => {
    const prisma = createProgramActivitiesPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'program-001', status: 'ARCHIVED' });
    const { listEventProgramActivities } = await loadProgramActivitiesService({ prisma });

    await expect(
      listEventProgramActivities('program-001', { page: 1, limit: 20 }, regularViewer),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(prisma.activity.findMany).not.toHaveBeenCalled();
  });

  it('applies type, search and date range filters', async () => {
    const prisma = createProgramActivitiesPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'program-001', status: 'ACTIVE' });
    prisma.activity.findMany.mockResolvedValue([]);
    prisma.activity.count.mockResolvedValue(0);
    const { listEventProgramActivities } = await loadProgramActivitiesService({ prisma });

    await listEventProgramActivities('program-001', {
      page: 2,
      limit: 5,
      type: 'TALK',
      q: 'IA',
      dateFrom: '2026-09-01',
      dateTo: '2026-09-30',
    });

    expect(prisma.activity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          eventProgramId: 'program-001',
          status: { in: publicStatuses },
          type: 'TALK',
          OR: [
            { name: { contains: 'IA', mode: 'insensitive' } },
            { description: { contains: 'IA', mode: 'insensitive' } },
          ],
          date: {
            gte: new Date('2026-09-01T00:00:00.000Z'),
            lte: new Date('2026-09-30T00:00:00.000Z'),
          },
        },
        skip: 5,
        take: 5,
      }),
    );
  });

  it('returns zero total pages when there are no activities', async () => {
    const prisma = createProgramActivitiesPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'program-001', status: 'ACTIVE' });
    prisma.activity.findMany.mockResolvedValue([]);
    prisma.activity.count.mockResolvedValue(0);
    const { listEventProgramActivities } = await loadProgramActivitiesService({ prisma });

    const result = await listEventProgramActivities('program-001', { page: 1, limit: 20 });

    expect(result).toEqual({ items: [], page: 1, limit: 20, total: 0, totalPages: 0 });
  });
});

interface CancelPrismaMock {
  activity: { findUnique: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  attendance: { count: ReturnType<typeof vi.fn> };
  auditEvent: { create: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
}

const createCancelPrismaMock = (): CancelPrismaMock => {
  const prisma: CancelPrismaMock = {
    activity: { findUnique: vi.fn(), update: vi.fn() },
    attendance: { count: vi.fn() },
    auditEvent: { create: vi.fn().mockResolvedValue({ id: 'audit-001' }) },
    $transaction: vi.fn(),
  };

  prisma.$transaction.mockImplementation(
    async (callback: (client: CancelPrismaMock) => Promise<unknown>) => callback(prisma),
  );

  return prisma;
};

const loadCancelService = async (prisma: CancelPrismaMock) => {
  vi.resetModules();
  vi.doMock('../../config/prisma.js', () => ({ getPrismaClient: () => prisma }));

  return import('./activities.service.js');
};

describe('cancelActivity', () => {
  afterEach(() => {
    vi.doUnmock('../../config/prisma.js');
  });

  it('throws 404 when the activity does not exist', async () => {
    const prisma = createCancelPrismaMock();
    prisma.activity.findUnique.mockResolvedValue(null);
    const { cancelActivity } = await loadCancelService(prisma);

    await expect(cancelActivity('missing', 'Lluvia')).rejects.toMatchObject({ statusCode: 404 });
    expect(prisma.activity.update).not.toHaveBeenCalled();
  });

  it('rejects COMPLETED activities with 409', async () => {
    const prisma = createCancelPrismaMock();
    prisma.activity.findUnique.mockResolvedValue(buildDetailRecord({ status: 'COMPLETED' }));
    const { cancelActivity } = await loadCancelService(prisma);

    await expect(cancelActivity('activity-001', 'Lluvia')).rejects.toMatchObject({
      statusCode: 409,
      message: 'Completed activities cannot be cancelled.',
    });
    expect(prisma.activity.update).not.toHaveBeenCalled();
  });

  it.each(['DRAFT', 'SCHEDULED', 'ONGOING'] as const)(
    'cancels a %s activity and stores the reason',
    async (status) => {
      const prisma = createCancelPrismaMock();
      prisma.activity.findUnique.mockResolvedValue(buildDetailRecord({ status }));
      prisma.activity.update.mockResolvedValue(
        buildDetailRecord({ status: 'CANCELLED', cancelReason: 'Lluvia' }),
      );
      prisma.attendance.count.mockResolvedValue(4);
      const { cancelActivity } = await loadCancelService(prisma);

      const result = await cancelActivity('activity-001', 'Lluvia');

      expect(prisma.activity.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'activity-001' },
          data: { status: 'CANCELLED', cancelReason: 'Lluvia' },
        }),
      );
      expect(result).toMatchObject({
        status: 'CANCELLED',
        cancelReason: 'Lluvia',
        enrolledCount: 6,
        checkedInCount: 4,
      });
    },
  );

  it('stores a null reason when none is provided', async () => {
    const prisma = createCancelPrismaMock();
    prisma.activity.findUnique.mockResolvedValue(buildDetailRecord({ status: 'SCHEDULED' }));
    prisma.activity.update.mockResolvedValue(buildDetailRecord({ status: 'CANCELLED' }));
    prisma.attendance.count.mockResolvedValue(0);
    const { cancelActivity } = await loadCancelService(prisma);

    await cancelActivity('activity-001');

    expect(prisma.activity.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'CANCELLED', cancelReason: null } }),
    );
  });

  it('returns the existing cancellation without writing when already CANCELLED', async () => {
    const prisma = createCancelPrismaMock();
    prisma.activity.findUnique.mockResolvedValue(
      buildDetailRecord({ status: 'CANCELLED', cancelReason: 'Motivo original' }),
    );
    prisma.attendance.count.mockResolvedValue(4);
    const { cancelActivity } = await loadCancelService(prisma);

    const result = await cancelActivity('activity-001', 'Motivo nuevo');

    expect(prisma.activity.update).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'CANCELLED', cancelReason: 'Motivo original' });
  });

  it('writes a single cancelled event with the status transition', async () => {
    const prisma = createCancelPrismaMock();
    prisma.activity.findUnique.mockResolvedValue(buildDetailRecord({ status: 'SCHEDULED' }));
    prisma.activity.update.mockResolvedValue(
      buildDetailRecord({ status: 'CANCELLED', cancelReason: 'Lluvia' }),
    );
    prisma.attendance.count.mockResolvedValue(4);
    const { cancelActivity } = await loadCancelService(prisma);

    await cancelActivity('activity-001', 'Lluvia', {
      actorId: 'user-001',
      actorType: 'USER',
      requestId: 'req-200',
    });

    expect(prisma.auditEvent.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'activity.cancelled',
        actorId: 'user-001',
        resourceType: 'activity',
        resourceId: 'activity-001',
        scopeType: 'event_program',
        scopeId: 'program-001',
        requestId: 'req-200',
        changes: { before: { status: 'SCHEDULED' }, after: { status: 'CANCELLED' } },
      }),
    });
  });

  it('flags that a cancellation carried a free-text reason without storing it', async () => {
    const prisma = createCancelPrismaMock();
    prisma.activity.findUnique.mockResolvedValue(buildDetailRecord({ status: 'SCHEDULED' }));
    prisma.activity.update.mockResolvedValue(
      buildDetailRecord({ status: 'CANCELLED', cancelReason: 'Lluvia' }),
    );
    prisma.attendance.count.mockResolvedValue(0);
    const { cancelActivity } = await loadCancelService(prisma);

    await cancelActivity('activity-001', 'Lluvia');

    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ metadata: { hasCancelReason: true } }),
    });
  });

  it('flags a cancellation without reason', async () => {
    const prisma = createCancelPrismaMock();
    prisma.activity.findUnique.mockResolvedValue(buildDetailRecord({ status: 'SCHEDULED' }));
    prisma.activity.update.mockResolvedValue(buildDetailRecord({ status: 'CANCELLED' }));
    prisma.attendance.count.mockResolvedValue(0);
    const { cancelActivity } = await loadCancelService(prisma);

    await cancelActivity('activity-001');

    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ metadata: { hasCancelReason: false } }),
    });
  });

  it('does not audit a cancellation rejected by the program state', async () => {
    const prisma = createCancelPrismaMock();
    prisma.activity.findUnique.mockResolvedValue(
      buildDetailRecord({ status: 'DRAFT', programStatus: 'ARCHIVED' }),
    );
    const { cancelActivity } = await loadCancelService(prisma);

    await expect(cancelActivity('activity-001')).rejects.toMatchObject({ statusCode: 409 });

    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it('reverts the activity when the cancellation audit insert fails', async () => {
    const prisma = createCancelPrismaMock();
    prisma.activity.findUnique.mockResolvedValue(buildDetailRecord({ status: 'SCHEDULED' }));
    prisma.activity.update.mockResolvedValue(buildDetailRecord({ status: 'CANCELLED' }));
    prisma.attendance.count.mockResolvedValue(0);
    prisma.auditEvent.create.mockRejectedValue(new Error('audit insert failed'));
    const { cancelActivity } = await loadCancelService(prisma);

    await expect(cancelActivity('activity-001', 'Lluvia')).rejects.toThrow('audit insert failed');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('rejects DRAFT activities of non ACTIVE programs with 409', async () => {
    const prisma = createCancelPrismaMock();
    prisma.activity.findUnique.mockResolvedValue(
      buildDetailRecord({ status: 'DRAFT', programStatus: 'ARCHIVED' }),
    );
    const { cancelActivity } = await loadCancelService(prisma);

    await expect(cancelActivity('activity-001')).rejects.toMatchObject({
      statusCode: 409,
      message: 'Event programs must be active to cancel their activities.',
    });
    expect(prisma.activity.update).not.toHaveBeenCalled();
  });

  it('checks COMPLETED before the program state', async () => {
    const prisma = createCancelPrismaMock();
    prisma.activity.findUnique.mockResolvedValue(
      buildDetailRecord({ status: 'COMPLETED', programStatus: 'ARCHIVED' }),
    );
    const { cancelActivity } = await loadCancelService(prisma);

    await expect(cancelActivity('activity-001')).rejects.toMatchObject({
      statusCode: 409,
      message: 'Completed activities cannot be cancelled.',
    });
  });
});

interface DeletePrismaMock {
  activity: {
    findUnique: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
  };
  attendance: { count: ReturnType<typeof vi.fn> };
  alert: { count: ReturnType<typeof vi.fn> };
  auditEvent: { create: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
}

const createDeletePrismaMock = (): DeletePrismaMock => {
  const prisma: DeletePrismaMock = {
    activity: { findUnique: vi.fn(), deleteMany: vi.fn() },
    attendance: { count: vi.fn() },
    alert: { count: vi.fn() },
    auditEvent: { create: vi.fn().mockResolvedValue({ id: 'audit-001' }) },
    $transaction: vi.fn(),
  };

  prisma.$transaction.mockImplementation(
    async (callback: (client: DeletePrismaMock) => Promise<unknown>) => callback(prisma),
  );

  return prisma;
};

const loadDeleteService = async (prisma: DeletePrismaMock) => {
  vi.resetModules();
  vi.doMock('../../config/prisma.js', () => ({ getPrismaClient: () => prisma }));

  return import('./activities.service.js');
};

const deletableActivity = () => ({
  id: 'activity-001',
  status: 'DRAFT' as const,
  eventProgram: { id: 'program-001', status: 'ACTIVE' as const },
});

const cleanDeleteMock = (): DeletePrismaMock => {
  const prisma = createDeletePrismaMock();
  prisma.activity.findUnique.mockResolvedValue(deletableActivity());
  prisma.attendance.count.mockResolvedValue(0);
  prisma.alert.count.mockResolvedValue(0);

  return prisma;
};

describe('deleteActivity', () => {
  afterEach(() => {
    vi.doUnmock('../../config/prisma.js');
  });

  it('throws 404 when the activity does not exist', async () => {
    const prisma = createDeletePrismaMock();
    prisma.activity.findUnique.mockResolvedValue(null);
    const { deleteActivity } = await loadDeleteService(prisma);

    await expect(deleteActivity('missing')).rejects.toMatchObject({
      statusCode: 404,
      message: 'Activity not found.',
    });
    expect(prisma.activity.deleteMany).not.toHaveBeenCalled();
  });

  it.each(['SCHEDULED', 'ONGOING', 'COMPLETED', 'CANCELLED'] as const)(
    'rejects deleting a %s activity with 409',
    async (status) => {
      const prisma = createDeletePrismaMock();
      prisma.activity.findUnique.mockResolvedValue({ ...deletableActivity(), status });
      const { deleteActivity } = await loadDeleteService(prisma);

      await expect(deleteActivity('activity-001')).rejects.toMatchObject({
        statusCode: 409,
        message: 'Only DRAFT activities can be deleted.',
      });
      expect(prisma.activity.deleteMany).not.toHaveBeenCalled();
    },
  );

  it.each(['ARCHIVED', 'DRAFT'] as const)(
    'rejects deleting when the program is %s with 409',
    async (programStatus) => {
      const prisma = createDeletePrismaMock();
      prisma.activity.findUnique.mockResolvedValue({
        ...deletableActivity(),
        eventProgram: { id: 'program-001', status: programStatus },
      });
      const { deleteActivity } = await loadDeleteService(prisma);

      await expect(deleteActivity('activity-001')).rejects.toMatchObject({
        statusCode: 409,
        message: 'Event programs must be active to delete their activities.',
      });
      expect(prisma.activity.deleteMany).not.toHaveBeenCalled();
    },
  );

  it('rejects an activity with attendance records with 409', async () => {
    const prisma = createDeletePrismaMock();
    prisma.activity.findUnique.mockResolvedValue(deletableActivity());
    prisma.attendance.count.mockResolvedValue(3);
    const { deleteActivity } = await loadDeleteService(prisma);

    await expect(deleteActivity('activity-001')).rejects.toMatchObject({
      statusCode: 409,
      message: 'Activities with attendance records cannot be deleted.',
    });
    expect(prisma.attendance.count).toHaveBeenCalledWith({
      where: { activityId: 'activity-001' },
    });
    expect(prisma.activity.deleteMany).not.toHaveBeenCalled();
  });

  it('rejects an activity with alert records with 409', async () => {
    const prisma = createDeletePrismaMock();
    prisma.activity.findUnique.mockResolvedValue(deletableActivity());
    prisma.attendance.count.mockResolvedValue(0);
    prisma.alert.count.mockResolvedValue(1);
    const { deleteActivity } = await loadDeleteService(prisma);

    await expect(deleteActivity('activity-001')).rejects.toMatchObject({
      statusCode: 409,
      message: 'Activities with alert records cannot be deleted.',
    });
    expect(prisma.activity.deleteMany).not.toHaveBeenCalled();
  });

  it('deletes a clean DRAFT activity with a conditional delete and returns nothing', async () => {
    const prisma = cleanDeleteMock();
    prisma.activity.deleteMany.mockResolvedValue({ count: 1 });
    const { deleteActivity } = await loadDeleteService(prisma);

    await expect(deleteActivity('activity-001')).resolves.toBeUndefined();

    expect(prisma.activity.deleteMany).toHaveBeenCalledWith({
      where: {
        id: 'activity-001',
        status: 'DRAFT',
        eventProgram: { status: 'ACTIVE' },
        attendance: { none: {} },
        alerts: { none: {} },
      },
    });
  });

  it('writes a single activity.deleted event in the same transaction', async () => {
    const prisma = cleanDeleteMock();
    prisma.activity.deleteMany.mockResolvedValue({ count: 1 });
    const { deleteActivity } = await loadDeleteService(prisma);

    await deleteActivity('activity-001', {
      actorId: 'user-001',
      actorType: 'USER',
      requestId: 'req-300',
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.auditEvent.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'activity.deleted',
        actorId: 'user-001',
        resourceType: 'activity',
        resourceId: 'activity-001',
        scopeType: 'event_program',
        scopeId: 'program-001',
        requestId: 'req-300',
        changes: { before: { status: 'DRAFT' } },
      }),
    });
  });

  it('does not audit a deletion rejected by the status guard', async () => {
    const prisma = createDeletePrismaMock();
    prisma.activity.findUnique.mockResolvedValue({ ...deletableActivity(), status: 'SCHEDULED' });
    const { deleteActivity } = await loadDeleteService(prisma);

    await expect(deleteActivity('activity-001')).rejects.toMatchObject({ statusCode: 409 });

    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it('surfaces the conflict when the conditional delete matches no row', async () => {
    const prisma = cleanDeleteMock();
    prisma.activity.deleteMany.mockResolvedValue({ count: 0 });
    const { deleteActivity } = await loadDeleteService(prisma);

    await expect(deleteActivity('activity-001')).rejects.toMatchObject({
      statusCode: 409,
      message: 'The activity changed while it was being deleted. Retry the request.',
    });
    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it('translates a foreign key violation raised by a concurrent insert into a 409', async () => {
    const prisma = cleanDeleteMock();
    prisma.activity.deleteMany.mockRejectedValue(
      Object.assign(new Error('Foreign key constraint violated'), { code: 'P2003' }),
    );
    const { deleteActivity } = await loadDeleteService(prisma);

    await expect(deleteActivity('activity-001')).rejects.toMatchObject({
      statusCode: 409,
      message: 'The activity changed while it was being deleted. Retry the request.',
    });
    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it('translates the retention trigger rejection into a 409', async () => {
    const prisma = cleanDeleteMock();
    prisma.activity.deleteMany.mockRejectedValue(new Error('only DRAFT activities can be deleted'));
    const { deleteActivity } = await loadDeleteService(prisma);

    await expect(deleteActivity('activity-001')).rejects.toMatchObject({
      statusCode: 409,
      message: 'The activity changed while it was being deleted. Retry the request.',
    });
    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it('reverts the deletion when the audit insert fails', async () => {
    const prisma = cleanDeleteMock();
    prisma.activity.deleteMany.mockResolvedValue({ count: 1 });
    prisma.auditEvent.create.mockRejectedValue(new Error('audit insert failed'));
    const { deleteActivity } = await loadDeleteService(prisma);

    await expect(deleteActivity('activity-001')).rejects.toThrow('audit insert failed');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
