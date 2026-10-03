import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CreateEventProgramBody, UpdateEventProgramBody } from './event-programs.schemas.js';

interface PrismaMock {
  activity: { count: ReturnType<typeof vi.fn>; groupBy: ReturnType<typeof vi.fn> };
  organizationalUnit: { findUnique: ReturnType<typeof vi.fn> };
  eventProgram: {
    count: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  auditEvent: { create: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
}

const createPrismaMock = (): PrismaMock => {
  const prisma: PrismaMock = {
    activity: { count: vi.fn(), groupBy: vi.fn() },
    organizationalUnit: { findUnique: vi.fn() },
    eventProgram: {
      count: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    auditEvent: { create: vi.fn().mockResolvedValue({ id: 'audit-001' }) },
    $transaction: vi.fn(),
  };

  prisma.$transaction.mockImplementation(
    async (callback: (client: PrismaMock) => Promise<unknown>) => callback(prisma),
  );

  return prisma;
};

const hasPermissionMock = vi.fn();

const loadService = async (prisma: PrismaMock) => {
  vi.resetModules();
  hasPermissionMock.mockReset();
  vi.doMock('../../config/prisma.js', () => ({ getPrismaClient: () => prisma }));
  vi.doMock('../authorization/authorization.service.js', () => ({
    hasPermission: hasPermissionMock,
  }));
  return import('./event-programs.service.js');
};

const input: CreateEventProgramBody = {
  name: 'Congreso de Innovacion 2026',
  description: 'Encuentro academico.',
  label: 'CI-2026',
  bannerUrl: 'https://example.com/banner.png',
  organizationalUnitId: 'unit-001',
  startDate: '2026-10-12',
  endDate: '2026-10-16',
};

const createdRecord = {
  id: 'program-001',
  name: input.name,
  description: input.description ?? null,
  label: input.label ?? null,
  bannerUrl: input.bannerUrl ?? null,
  isDefault: false,
  status: 'DRAFT' as const,
  startDate: new Date('2026-10-12T00:00:00.000Z'),
  endDate: new Date('2026-10-16T00:00:00.000Z'),
  organizationalUnit: {
    id: 'unit-001',
    name: 'Facultad de Ingenieria',
    type: 'FACULTY' as const,
  },
};

const listedRecord = {
  ...createdRecord,
  id: 'program-002',
  status: 'ACTIVE' as const,
};

const adminViewer: Express.AuthenticatedUser = {
  id: 'admin-001',
  email: 'admin@example.com',
  globalRole: 'ADMIN',
  unitId: null,
  careerId: null,
  isActive: true,
};

const regularViewer: Express.AuthenticatedUser = {
  ...adminViewer,
  id: 'user-001',
  email: 'user@example.com',
  globalRole: 'USER',
};

describe('listEventPrograms', () => {
  afterEach(() => {
    vi.doUnmock('../../config/prisma.js');
    vi.doUnmock('../authorization/authorization.service.js');
  });

  it('lists active programs with pagination metadata', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findMany.mockResolvedValue([listedRecord]);
    prisma.eventProgram.count.mockResolvedValue(1);
    const { listEventPrograms } = await loadService(prisma);

    const result = await listEventPrograms({ page: 2, limit: 10 });

    expect(prisma.eventProgram.findMany).toHaveBeenCalledWith({
      where: { status: 'ACTIVE' },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      skip: 10,
      take: 10,
      select: expect.any(Object),
    });
    expect(prisma.eventProgram.count).toHaveBeenCalledWith({ where: { status: 'ACTIVE' } });
    expect(result).toEqual({
      items: [
        {
          ...listedRecord,
          startDate: '2026-10-12',
          endDate: '2026-10-16',
        },
      ],
      page: 2,
      limit: 10,
      total: 1,
      totalPages: 1,
    });
  });

  it('applies organizational unit, unit type and search filters', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findMany.mockResolvedValue([]);
    prisma.eventProgram.count.mockResolvedValue(0);
    const { listEventPrograms } = await loadService(prisma);

    const result = await listEventPrograms({
      page: 1,
      limit: 20,
      organizationalUnitId: 'unit-001',
      unitType: 'FACULTY',
      q: 'congreso',
    });

    expect(prisma.eventProgram.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: 'ACTIVE',
          organizationalUnitId: 'unit-001',
          organizationalUnit: { type: 'FACULTY' },
          OR: [
            { name: { contains: 'congreso', mode: 'insensitive' } },
            { label: { contains: 'congreso', mode: 'insensitive' } },
          ],
        },
      }),
    );
    expect(result.totalPages).toBe(0);
  });

  it('honors the status filter for an admin', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findMany.mockResolvedValue([]);
    prisma.eventProgram.count.mockResolvedValue(0);
    const { listEventPrograms } = await loadService(prisma);

    await listEventPrograms({ page: 1, limit: 20, status: 'DRAFT' }, adminViewer);

    expect(prisma.eventProgram.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'DRAFT' } }),
    );
    expect(prisma.eventProgram.count).toHaveBeenCalledWith({ where: { status: 'DRAFT' } });
  });

  it('omits the status constraint for an admin requesting ALL', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findMany.mockResolvedValue([]);
    prisma.eventProgram.count.mockResolvedValue(0);
    const { listEventPrograms } = await loadService(prisma);

    await listEventPrograms({ page: 1, limit: 20, status: 'ALL' }, adminViewer);

    expect(prisma.eventProgram.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: {} }),
    );
    expect(prisma.eventProgram.count).toHaveBeenCalledWith({ where: {} });
  });

  it('keeps the ACTIVE default when an admin omits the status filter', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findMany.mockResolvedValue([]);
    prisma.eventProgram.count.mockResolvedValue(0);
    const { listEventPrograms } = await loadService(prisma);

    await listEventPrograms({ page: 1, limit: 20 }, adminViewer);

    expect(prisma.eventProgram.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'ACTIVE' } }),
    );
  });

  it('ignores a non-active status filter from an anonymous caller', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findMany.mockResolvedValue([]);
    prisma.eventProgram.count.mockResolvedValue(0);
    const { listEventPrograms } = await loadService(prisma);

    await listEventPrograms({ page: 1, limit: 20, status: 'ARCHIVED' });

    expect(prisma.eventProgram.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'ACTIVE' } }),
    );
  });

  it('ignores a non-active status filter from a non-admin viewer', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findMany.mockResolvedValue([]);
    prisma.eventProgram.count.mockResolvedValue(0);
    const { listEventPrograms } = await loadService(prisma);

    await listEventPrograms({ page: 1, limit: 20, status: 'ALL' }, regularViewer);

    expect(prisma.eventProgram.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { status: 'ACTIVE' } }),
    );
  });

  it('combines the admin status filter with other filters', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findMany.mockResolvedValue([]);
    prisma.eventProgram.count.mockResolvedValue(0);
    const { listEventPrograms } = await loadService(prisma);

    await listEventPrograms(
      { page: 1, limit: 20, status: 'COMPLETED', organizationalUnitId: 'unit-001', q: 'foro' },
      adminViewer,
    );

    expect(prisma.eventProgram.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          status: 'COMPLETED',
          organizationalUnitId: 'unit-001',
          OR: [
            { name: { contains: 'foro', mode: 'insensitive' } },
            { label: { contains: 'foro', mode: 'insensitive' } },
          ],
        },
      }),
    );
  });
});

describe('createEventProgram', () => {
  afterEach(() => {
    vi.doUnmock('../../config/prisma.js');
    vi.doUnmock('../authorization/authorization.service.js');
  });

  it('rejects when the organizational unit does not exist', async () => {
    const prisma = createPrismaMock();
    prisma.organizationalUnit.findUnique.mockResolvedValue(null);
    const { createEventProgram } = await loadService(prisma);

    await expect(createEventProgram(input, 'admin-001')).rejects.toMatchObject({ statusCode: 404 });
    expect(prisma.eventProgram.create).not.toHaveBeenCalled();
  });

  it('rejects when the organizational unit is inactive', async () => {
    const prisma = createPrismaMock();
    prisma.organizationalUnit.findUnique.mockResolvedValue({ id: 'unit-001', isActive: false });
    const { createEventProgram } = await loadService(prisma);

    await expect(createEventProgram(input, 'admin-001')).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.eventProgram.create).not.toHaveBeenCalled();
  });

  it('creates a non-default DRAFT program attributed to the authenticated admin', async () => {
    const prisma = createPrismaMock();
    prisma.organizationalUnit.findUnique.mockResolvedValue({ id: 'unit-001', isActive: true });
    prisma.eventProgram.create.mockResolvedValue(createdRecord);
    const { createEventProgram } = await loadService(prisma);

    const result = await createEventProgram(input, 'admin-001');

    expect(prisma.eventProgram.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          name: input.name,
          description: input.description,
          label: input.label,
          bannerUrl: input.bannerUrl,
          isDefault: false,
          status: 'DRAFT',
          startDate: new Date('2026-10-12T00:00:00.000Z'),
          endDate: new Date('2026-10-16T00:00:00.000Z'),
          organizationalUnitId: 'unit-001',
          createdById: 'admin-001',
        },
      }),
    );
    expect(result).toEqual({
      ...createdRecord,
      startDate: '2026-10-12',
      endDate: '2026-10-16',
    });
  });

  it('writes one creation event inside the transaction', async () => {
    const prisma = createPrismaMock();
    prisma.organizationalUnit.findUnique.mockResolvedValue({ id: 'unit-001', isActive: true });
    prisma.eventProgram.create.mockResolvedValue(createdRecord);
    const { createEventProgram } = await loadService(prisma);

    await createEventProgram(input, 'admin-001', {
      actorId: 'admin-001',
      actorType: 'USER',
      requestId: 'req-020',
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.auditEvent.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'event_program.created',
        actorId: 'admin-001',
        resourceType: 'event_program',
        resourceId: 'program-001',
        requestId: 'req-020',
        changes: {
          after: {
            status: 'DRAFT',
            startDate: '2026-10-12',
            endDate: '2026-10-16',
            organizationalUnitId: 'unit-001',
          },
        },
        metadata: { hasLabel: true },
      }),
    });
    expect(prisma.eventProgram.create.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.auditEvent.create.mock.invocationCallOrder[0] as number,
    );
  });

  it('does not audit a creation rejected by validation', async () => {
    const prisma = createPrismaMock();
    prisma.organizationalUnit.findUnique.mockResolvedValue({ id: 'unit-001', isActive: false });
    const { createEventProgram } = await loadService(prisma);

    await expect(createEventProgram(input, 'admin-001')).rejects.toMatchObject({
      statusCode: 400,
    });
    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });
});

describe('updateEventProgram', () => {
  afterEach(() => {
    vi.doUnmock('../../config/prisma.js');
    vi.doUnmock('../authorization/authorization.service.js');
  });

  const storedRecord = {
    id: 'program-001',
    status: 'ACTIVE' as const,
    isDefault: false,
    startDate: new Date('2026-10-12T00:00:00.000Z'),
    endDate: new Date('2026-10-16T00:00:00.000Z'),
    name: 'Congreso de Innovacion',
    description: null,
    label: null,
    bannerUrl: null,
  };

  const updatedRecord = {
    id: 'program-001',
    name: 'Congreso actualizado',
    description: null,
    label: null,
    bannerUrl: null,
    isDefault: false,
    status: 'ACTIVE' as const,
    startDate: new Date('2026-10-12T00:00:00.000Z'),
    endDate: new Date('2026-10-16T00:00:00.000Z'),
    organizationalUnit: {
      id: 'unit-001',
      name: 'Facultad de Ingenieria',
      type: 'FACULTY' as const,
    },
  };

  it('rejects when the event program does not exist', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue(null);
    const { updateEventProgram } = await loadService(prisma);

    await expect(
      updateEventProgram('program-001', { name: 'Congreso actualizado' }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(prisma.eventProgram.update).not.toHaveBeenCalled();
  });

  it('rejects when the event program is archived', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ ...storedRecord, status: 'ARCHIVED' });
    const { updateEventProgram } = await loadService(prisma);

    await expect(
      updateEventProgram('program-001', { name: 'Congreso actualizado' }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(prisma.eventProgram.update).not.toHaveBeenCalled();
  });

  it('rejects an end date before the stored start date', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue(storedRecord);
    const { updateEventProgram } = await loadService(prisma);

    await expect(
      updateEventProgram('program-001', { endDate: '2026-10-01' }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.eventProgram.update).not.toHaveBeenCalled();
  });

  it('rejects a start date after the stored end date', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue(storedRecord);
    const { updateEventProgram } = await loadService(prisma);

    await expect(
      updateEventProgram('program-001', { startDate: '2026-10-20' }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.eventProgram.update).not.toHaveBeenCalled();
  });

  it('updates only the provided fields', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue(storedRecord);
    prisma.eventProgram.update.mockResolvedValue(updatedRecord);
    const { updateEventProgram } = await loadService(prisma);

    const input: UpdateEventProgramBody = { name: 'Congreso actualizado', description: null };
    const result = await updateEventProgram('program-001', input);

    expect(prisma.eventProgram.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'program-001' },
        data: { name: 'Congreso actualizado', description: null },
      }),
    );
    expect(result).toEqual({
      ...updatedRecord,
      startDate: '2026-10-12',
      endDate: '2026-10-16',
    });
  });

  it('rejects dates on a default event program', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({
      id: 'program-default',
      status: 'ACTIVE',
      isDefault: true,
      startDate: null,
      endDate: null,
    });
    const { updateEventProgram } = await loadService(prisma);

    await expect(
      updateEventProgram('program-default', { endDate: '2026-11-05' }),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(prisma.eventProgram.update).not.toHaveBeenCalled();
    expect(prisma.activity.count).not.toHaveBeenCalled();
  });

  it('activates a draft event program', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ ...storedRecord, status: 'DRAFT' });
    prisma.eventProgram.update.mockResolvedValue({ ...updatedRecord, status: 'ACTIVE' });
    const { updateEventProgram } = await loadService(prisma);

    const result = await updateEventProgram('program-001', { status: 'ACTIVE' });

    expect(prisma.eventProgram.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'ACTIVE' } }),
    );
    expect(result.status).toBe('ACTIVE');
  });

  it('rejects activation when the event program is not a draft', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue(storedRecord);
    const { updateEventProgram } = await loadService(prisma);

    await expect(updateEventProgram('program-001', { status: 'ACTIVE' })).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(prisma.eventProgram.update).not.toHaveBeenCalled();
  });

  it('rejects dates that exclude existing activities', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue(storedRecord);
    prisma.activity.count.mockResolvedValue(2);
    const { updateEventProgram } = await loadService(prisma);

    await expect(
      updateEventProgram('program-001', { endDate: '2026-10-15' }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(prisma.activity.count).toHaveBeenCalledWith({
      where: {
        eventProgramId: 'program-001',
        OR: [
          { date: { lt: new Date('2026-10-12T00:00:00.000Z') } },
          { date: { gt: new Date('2026-10-15T00:00:00.000Z') } },
        ],
      },
    });
    expect(prisma.eventProgram.update).not.toHaveBeenCalled();
  });

  it('allows a date change that keeps every activity inside the range', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue(storedRecord);
    prisma.activity.count.mockResolvedValue(0);
    prisma.eventProgram.update.mockResolvedValue({
      ...updatedRecord,
      endDate: new Date('2026-10-31T00:00:00.000Z'),
    });
    const { updateEventProgram } = await loadService(prisma);

    const result = await updateEventProgram('program-001', { endDate: '2026-10-31' });

    expect(prisma.eventProgram.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { endDate: new Date('2026-10-31T00:00:00.000Z') } }),
    );
    expect(result.endDate).toBe('2026-10-31');
  });

  it('does not query activities when only non-date fields change', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue(storedRecord);
    prisma.eventProgram.update.mockResolvedValue(updatedRecord);
    const { updateEventProgram } = await loadService(prisma);

    await updateEventProgram('program-001', { name: 'Congreso actualizado' });

    expect(prisma.activity.count).not.toHaveBeenCalled();
  });

  it('writes a single publish audit event when a draft is activated', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ ...storedRecord, status: 'DRAFT' });
    prisma.eventProgram.update.mockResolvedValue({ ...updatedRecord, status: 'ACTIVE' });
    const { updateEventProgram } = await loadService(prisma);

    await updateEventProgram(
      'program-001',
      { status: 'ACTIVE' },
      {
        actorId: 'user-001',
        actorType: 'USER',
        requestId: 'req-010',
      },
    );

    expect(prisma.auditEvent.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'event_program.published',
        actorId: 'user-001',
        resourceType: 'event_program',
        resourceId: 'program-001',
        requestId: 'req-010',
        changes: { before: { status: 'DRAFT' }, after: { status: 'ACTIVE' } },
      }),
    });
  });

  it('audits a plain field update as an attribute change, not as a publication', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue(storedRecord);
    prisma.eventProgram.update.mockResolvedValue(updatedRecord);
    const { updateEventProgram } = await loadService(prisma);

    await updateEventProgram('program-001', { name: 'Congreso actualizado' });

    expect(prisma.auditEvent.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'event_program.updated',
        resourceId: 'program-001',
        metadata: { changedFields: ['name'] },
      }),
    });
  });

  it('does not audit an update that repeats the stored values', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue(storedRecord);
    prisma.eventProgram.update.mockResolvedValue(updatedRecord);
    const { updateEventProgram } = await loadService(prisma);

    await updateEventProgram('program-001', { name: storedRecord.name });

    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it('does not audit an activation rejected as non-draft', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue(storedRecord);
    const { updateEventProgram } = await loadService(prisma);

    await expect(updateEventProgram('program-001', { status: 'ACTIVE' })).rejects.toMatchObject({
      statusCode: 409,
    });

    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it('reverts the program when the publish audit insert fails', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ ...storedRecord, status: 'DRAFT' });
    prisma.eventProgram.update.mockResolvedValue({ ...updatedRecord, status: 'ACTIVE' });
    prisma.auditEvent.create.mockRejectedValue(new Error('audit insert failed'));
    const { updateEventProgram } = await loadService(prisma);

    await expect(updateEventProgram('program-001', { status: 'ACTIVE' })).rejects.toThrow(
      'audit insert failed',
    );
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe('getEventProgramById', () => {
  afterEach(() => {
    vi.doUnmock('../../config/prisma.js');
    vi.doUnmock('../authorization/authorization.service.js');
  });

  const activeRecord = {
    id: 'program-001',
    name: 'Congreso de Innovacion 2026',
    description: null,
    label: 'CI-2026',
    bannerUrl: null,
    isDefault: false,
    status: 'ACTIVE' as const,
    startDate: new Date('2026-10-12T00:00:00.000Z'),
    endDate: new Date('2026-10-16T00:00:00.000Z'),
    organizationalUnit: {
      id: 'unit-001',
      name: 'Facultad de Ingenieria',
      type: 'FACULTY' as const,
    },
  };

  const statusGroups = [
    { status: 'DRAFT' as const, _count: { _all: 2 } },
    { status: 'SCHEDULED' as const, _count: { _all: 3 } },
    { status: 'ONGOING' as const, _count: { _all: 1 } },
    { status: 'COMPLETED' as const, _count: { _all: 2 } },
    { status: 'CANCELLED' as const, _count: { _all: 1 } },
  ];

  const viewer = {
    id: 'user-001',
    email: 'user@example.com',
    globalRole: 'USER' as const,
    unitId: null,
    careerId: null,
    isActive: true,
  };

  it('returns the public count for anonymous callers', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue(activeRecord);
    prisma.activity.groupBy.mockResolvedValue(statusGroups);
    const { getEventProgramById } = await loadService(prisma);

    const result = await getEventProgramById('program-001');

    expect(prisma.eventProgram.findUnique).toHaveBeenCalledWith({
      where: { id: 'program-001' },
      select: expect.any(Object),
    });
    expect(prisma.activity.groupBy).toHaveBeenCalledWith({
      by: ['status'],
      where: { eventProgramId: 'program-001' },
      _count: { _all: true },
    });
    expect(hasPermissionMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      ...activeRecord,
      startDate: '2026-10-12',
      endDate: '2026-10-16',
      activityCount: { visible: 6 },
    });
  });

  it('adds the total and the per-status breakdown for authorized viewers', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue(activeRecord);
    prisma.activity.groupBy.mockResolvedValue(statusGroups);
    const { getEventProgramById } = await loadService(prisma);
    const { PERMISSIONS } = await import('../authorization/permissions.js');
    hasPermissionMock.mockResolvedValue(true);

    const result = await getEventProgramById('program-001', viewer);

    expect(hasPermissionMock).toHaveBeenCalledWith(viewer, PERMISSIONS.PROGRAM_READ, {
      eventProgramId: 'program-001',
    });
    expect(result.activityCount).toEqual({
      visible: 6,
      total: 9,
      byStatus: { DRAFT: 2, SCHEDULED: 3, ONGOING: 1, COMPLETED: 2, CANCELLED: 1 },
    });
  });

  it('falls back to the public count when the viewer lacks program:read', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue(activeRecord);
    prisma.activity.groupBy.mockResolvedValue(statusGroups);
    const { getEventProgramById } = await loadService(prisma);
    hasPermissionMock.mockResolvedValue(false);

    const result = await getEventProgramById('program-001', viewer);

    expect(result.activityCount).toEqual({ visible: 6 });
    expect(result.activityCount).not.toHaveProperty('total');
  });

  it('rejects a missing event program without counting activities', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue(null);
    const { getEventProgramById } = await loadService(prisma);

    await expect(getEventProgramById('missing')).rejects.toMatchObject({ statusCode: 404 });
    expect(prisma.activity.groupBy).not.toHaveBeenCalled();
  });

  it('rejects non-active event programs as not found', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ ...activeRecord, status: 'DRAFT' });
    const { getEventProgramById } = await loadService(prisma);

    await expect(getEventProgramById('program-001', viewer)).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(prisma.activity.groupBy).not.toHaveBeenCalled();
    expect(hasPermissionMock).not.toHaveBeenCalled();
  });

  it('returns zero visible activities when the program has none', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue(activeRecord);
    prisma.activity.groupBy.mockResolvedValue([]);
    const { getEventProgramById } = await loadService(prisma);

    const result = await getEventProgramById('program-001');

    expect(result.activityCount).toEqual({ visible: 0 });
  });
});

describe('archiveEventProgram', () => {
  afterEach(() => {
    vi.doUnmock('../../config/prisma.js');
    vi.doUnmock('../authorization/authorization.service.js');
  });

  const archivableRecord = {
    ...createdRecord,
    status: 'ACTIVE' as const,
    organizationalUnit: { ...createdRecord.organizationalUnit, isActive: true },
  };

  const archivedRecord = {
    ...archivableRecord,
    status: 'ARCHIVED' as const,
  };

  it('archives an additional program and stamps archivedAt', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue(archivableRecord);
    prisma.activity.count.mockResolvedValue(0);
    prisma.eventProgram.update.mockResolvedValue({ ...createdRecord, status: 'ARCHIVED' });
    const { archiveEventProgram } = await loadService(prisma);

    const result = await archiveEventProgram('program-001');

    expect(prisma.activity.count).toHaveBeenCalledWith({
      where: { eventProgramId: 'program-001', status: { in: ['SCHEDULED', 'ONGOING'] } },
    });
    expect(prisma.eventProgram.update).toHaveBeenCalledWith({
      where: { id: 'program-001' },
      data: { status: 'ARCHIVED', archivedAt: expect.any(Date) },
      select: expect.any(Object),
    });
    expect(result.status).toBe('ARCHIVED');
  });

  it('is idempotent when the program is already archived', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue(archivedRecord);
    const { archiveEventProgram } = await loadService(prisma);

    const result = await archiveEventProgram('program-001');

    expect(prisma.activity.count).not.toHaveBeenCalled();
    expect(prisma.eventProgram.update).not.toHaveBeenCalled();
    expect(result.status).toBe('ARCHIVED');
    expect(result.id).toBe('program-001');
  });

  it('rejects a default program while its organizational unit is active', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ ...archivableRecord, isDefault: true });
    const { archiveEventProgram } = await loadService(prisma);

    await expect(archiveEventProgram('program-001')).rejects.toMatchObject({
      statusCode: 409,
      message:
        'A default event program cannot be archived while its organizational unit is active.',
    });
    expect(prisma.activity.count).not.toHaveBeenCalled();
    expect(prisma.eventProgram.update).not.toHaveBeenCalled();
  });

  it('archives a default program when its organizational unit is inactive', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({
      ...archivableRecord,
      isDefault: true,
      organizationalUnit: { ...createdRecord.organizationalUnit, isActive: false },
    });
    prisma.eventProgram.update.mockResolvedValue({
      ...createdRecord,
      isDefault: true,
      status: 'ARCHIVED',
    });
    const { archiveEventProgram } = await loadService(prisma);

    const result = await archiveEventProgram('program-001');

    expect(prisma.activity.count).not.toHaveBeenCalled();
    expect(prisma.eventProgram.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'ARCHIVED', archivedAt: expect.any(Date) } }),
    );
    expect(result.status).toBe('ARCHIVED');
  });

  it('rejects an additional program with scheduled or ongoing activities', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue(archivableRecord);
    prisma.activity.count.mockResolvedValue(2);
    const { archiveEventProgram } = await loadService(prisma);

    await expect(archiveEventProgram('program-001')).rejects.toMatchObject({
      statusCode: 409,
      message: 'An event program with scheduled or ongoing activities cannot be archived.',
    });
    expect(prisma.eventProgram.update).not.toHaveBeenCalled();
  });

  it('rejects a missing program with 404', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue(null);
    const { archiveEventProgram } = await loadService(prisma);

    await expect(archiveEventProgram('missing')).rejects.toMatchObject({
      statusCode: 404,
      message: 'Event program not found.',
    });
    expect(prisma.activity.count).not.toHaveBeenCalled();
    expect(prisma.eventProgram.update).not.toHaveBeenCalled();
  });

  it('writes a single archive audit event inside the transaction', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue(archivableRecord);
    prisma.activity.count.mockResolvedValue(0);
    prisma.eventProgram.update.mockResolvedValue({ ...createdRecord, status: 'ARCHIVED' });
    const { archiveEventProgram } = await loadService(prisma);

    await archiveEventProgram('program-001', {
      actorId: 'user-001',
      actorType: 'USER',
      requestId: 'req-020',
    });

    expect(prisma.auditEvent.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'event_program.archived',
        actorId: 'user-001',
        resourceType: 'event_program',
        resourceId: 'program-001',
        requestId: 'req-020',
        changes: { before: { status: 'ACTIVE' }, after: { status: 'ARCHIVED' } },
      }),
    });
  });

  it('does not audit an already archived program', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue(archivedRecord);
    const { archiveEventProgram } = await loadService(prisma);

    await archiveEventProgram('program-001');

    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it('does not audit an archive rejected by a blocking activity', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue(archivableRecord);
    prisma.activity.count.mockResolvedValue(2);
    const { archiveEventProgram } = await loadService(prisma);

    await expect(archiveEventProgram('program-001')).rejects.toMatchObject({
      statusCode: 409,
    });

    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });
});

describe('reactivateEventProgram', () => {
  afterEach(() => {
    vi.doUnmock('../../config/prisma.js');
    vi.doUnmock('../authorization/authorization.service.js');
  });

  const archivedProgram = {
    ...createdRecord,
    status: 'ARCHIVED' as const,
    organizationalUnit: { ...createdRecord.organizationalUnit, isActive: true },
  };

  const reactivatedRecord = { ...archivedProgram, status: 'ACTIVE' as const };

  it('reactivates an archived additional program and clears archivedAt', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue(archivedProgram);
    prisma.eventProgram.update.mockResolvedValue(reactivatedRecord);
    const { reactivateEventProgram } = await loadService(prisma);

    const result = await reactivateEventProgram('program-001');

    expect(prisma.eventProgram.update).toHaveBeenCalledWith({
      where: { id: 'program-001' },
      data: { status: 'ACTIVE', archivedAt: null },
      select: expect.any(Object),
    });
    expect(prisma.activity.count).not.toHaveBeenCalled();
    expect(result).toEqual({
      ...reactivatedRecord,
      startDate: '2026-10-12',
      endDate: '2026-10-16',
    });
  });

  it('rejects a missing event program with 404', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue(null);
    const { reactivateEventProgram } = await loadService(prisma);

    await expect(reactivateEventProgram('missing')).rejects.toMatchObject({
      statusCode: 404,
      message: 'Event program not found.',
    });
    expect(prisma.eventProgram.update).not.toHaveBeenCalled();
  });

  it('writes a single reactivation audit event inside the transaction', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue(archivedProgram);
    prisma.eventProgram.update.mockResolvedValue(reactivatedRecord);
    const { reactivateEventProgram } = await loadService(prisma);

    await reactivateEventProgram('program-001', {
      actorId: 'user-001',
      actorType: 'USER',
      requestId: 'req-030',
    });

    expect(prisma.auditEvent.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'event_program.reactivated',
        actorId: 'user-001',
        resourceType: 'event_program',
        resourceId: 'program-001',
        requestId: 'req-030',
        changes: { before: { status: 'ARCHIVED' }, after: { status: 'ACTIVE' } },
      }),
    });
  });

  it('does not audit a reactivation rejected as non-archived', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ ...archivedProgram, status: 'ACTIVE' });
    const { reactivateEventProgram } = await loadService(prisma);

    await expect(reactivateEventProgram('program-001')).rejects.toMatchObject({
      statusCode: 409,
    });

    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it('rejects default event programs with 409', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ ...archivedProgram, isDefault: true });
    const { reactivateEventProgram } = await loadService(prisma);

    await expect(reactivateEventProgram('program-001')).rejects.toMatchObject({
      statusCode: 409,
      message: 'Only additional event programs can be reactivated.',
    });
    expect(prisma.eventProgram.update).not.toHaveBeenCalled();
  });

  it.each(['DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED'] as const)(
    'rejects an event program in %s status with 409',
    async (status) => {
      const prisma = createPrismaMock();
      prisma.eventProgram.findUnique.mockResolvedValue({ ...archivedProgram, status });
      const { reactivateEventProgram } = await loadService(prisma);

      await expect(reactivateEventProgram('program-001')).rejects.toMatchObject({
        statusCode: 409,
        message: 'Only archived event programs can be reactivated.',
      });
      expect(prisma.eventProgram.update).not.toHaveBeenCalled();
    },
  );

  it('rejects an archived program without dates', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({
      ...archivedProgram,
      startDate: null,
      endDate: null,
    });
    const { reactivateEventProgram } = await loadService(prisma);

    await expect(reactivateEventProgram('program-001')).rejects.toMatchObject({
      statusCode: 400,
      message: 'Event program dates are invalid.',
    });
    expect(prisma.eventProgram.update).not.toHaveBeenCalled();
  });

  it('rejects an archived program whose end date precedes its start date', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({
      ...archivedProgram,
      startDate: new Date('2026-10-16T00:00:00.000Z'),
      endDate: new Date('2026-10-12T00:00:00.000Z'),
    });
    const { reactivateEventProgram } = await loadService(prisma);

    await expect(reactivateEventProgram('program-001')).rejects.toMatchObject({
      statusCode: 400,
      message: 'Event program dates are invalid.',
    });
    expect(prisma.eventProgram.update).not.toHaveBeenCalled();
  });
});
