import { afterEach, describe, expect, it, vi } from 'vitest';

interface PrismaMock {
  classroom: {
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  classroomAmenity: {
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  classroomAvailability: {
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  activity: { findMany: ReturnType<typeof vi.fn> };
  auditEvent: { create: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
}

const createPrismaMock = (): PrismaMock => {
  const prisma: PrismaMock = {
    classroom: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    classroomAmenity: {
      findFirst: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    classroomAvailability: {
      findFirst: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    activity: { findMany: vi.fn() },
    auditEvent: { create: vi.fn().mockResolvedValue({ id: 'audit-001' }) },
    $transaction: vi.fn(),
  };

  prisma.$transaction.mockImplementation(
    async (callback: (client: PrismaMock) => Promise<unknown>) => callback(prisma),
  );

  return prisma;
};

const currentRecord = {
  id: 'classroom-001',
  name: 'Aula 101',
  type: 'CLASSROOM',
  capacity: 40,
  building: 'Edificio 1',
  floor: 1,
  isActive: true,
};

const loadService = async (prisma: PrismaMock) => {
  vi.resetModules();
  vi.doMock('../../config/prisma.js', () => ({ getPrismaClient: () => prisma }));

  return import('./classrooms.service.js');
};

const summaryRecord = {
  id: 'classroom-001',
  name: 'Aula 101',
  type: 'CLASSROOM',
  capacity: 40,
  building: 'Edificio 1',
  floor: 1,
  isActive: true,
  amenities: [{ amenity: 'Pizarra' }, { amenity: 'Proyector' }],
};

const detailRecord = {
  ...summaryRecord,
  availability: [
    {
      id: 'slot-1',
      dayOfWeek: 1,
      startTime: new Date('1970-01-01T07:00:00.000Z'),
      endTime: new Date('1970-01-01T12:00:00.000Z'),
      period: 'Matutino',
    },
  ],
};

const expectedSummary = {
  id: 'classroom-001',
  name: 'Aula 101',
  type: 'CLASSROOM',
  capacity: 40,
  building: 'Edificio 1',
  floor: 1,
  isActive: true,
  amenities: ['Pizarra', 'Proyector'],
};

const expectedDetail = {
  ...expectedSummary,
  availability: [
    { id: 'slot-1', dayOfWeek: 1, startTime: '07:00', endTime: '12:00', period: 'Matutino' },
  ],
};

const baseQuery = { page: 1, limit: 20 };

afterEach(() => {
  vi.resetModules();
});

describe('listClassrooms', () => {
  it('defaults to active classrooms and maps amenities', async () => {
    const prisma = createPrismaMock();
    const service = await loadService(prisma);

    prisma.classroom.findMany.mockResolvedValue([summaryRecord]);
    prisma.classroom.count.mockResolvedValue(1);

    const result = await service.listClassrooms(baseQuery as never);

    expect(prisma.classroom.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isActive: true },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: 0,
        take: 20,
      }),
    );
    expect(result).toEqual({
      items: [expectedSummary],
      page: 1,
      limit: 20,
      total: 1,
      totalPages: 1,
    });
  });

  it('applies type, capacity, amenity and status filters', async () => {
    const prisma = createPrismaMock();
    const service = await loadService(prisma);

    prisma.classroom.findMany.mockResolvedValue([]);
    prisma.classroom.count.mockResolvedValue(0);

    const result = await service.listClassrooms({
      page: 2,
      limit: 10,
      type: 'LABORATORY',
      minCapacity: 25,
      amenity: 'Proyector',
      isActive: false,
    } as never);

    expect(prisma.classroom.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          isActive: false,
          type: 'LABORATORY',
          capacity: { gte: 25 },
          amenities: { some: { amenity: { equals: 'Proyector', mode: 'insensitive' } } },
        },
        skip: 10,
        take: 10,
      }),
    );
    expect(result.totalPages).toBe(0);
  });
});

describe('getClassroomById', () => {
  it('throws 404 when the classroom does not exist', async () => {
    const prisma = createPrismaMock();
    const service = await loadService(prisma);

    prisma.classroom.findUnique.mockResolvedValue(null);

    await expect(service.getClassroomById('classroom-unknown')).rejects.toMatchObject({
      statusCode: 404,
      message: 'Classroom not found.',
    });
  });

  it('maps availability times to HH:mm', async () => {
    const prisma = createPrismaMock();
    const service = await loadService(prisma);

    prisma.classroom.findUnique.mockResolvedValue(detailRecord);

    await expect(service.getClassroomById('classroom-001')).resolves.toEqual(expectedDetail);
  });
});

describe('createClassroom', () => {
  it('applies defaults and returns the mapped detail', async () => {
    const prisma = createPrismaMock();
    const service = await loadService(prisma);

    prisma.classroom.create.mockResolvedValue(detailRecord);

    const result = await service.createClassroom({
      name: 'Aula 101',
      type: 'CLASSROOM',
      capacity: 40,
    });

    expect(prisma.classroom.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: 'Aula 101',
          type: 'CLASSROOM',
          capacity: 40,
          building: null,
          floor: null,
          isActive: true,
        }),
      }),
    );
    expect(result).toEqual(expectedDetail);
  });

  it('respects an explicit inactive status', async () => {
    const prisma = createPrismaMock();
    const service = await loadService(prisma);

    prisma.classroom.create.mockResolvedValue({ ...detailRecord, isActive: false });

    await service.createClassroom({
      name: 'Aula 101',
      type: 'CLASSROOM',
      capacity: 40,
      isActive: false,
    });

    expect(prisma.classroom.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ isActive: false }) }),
    );
  });
});

describe('updateClassroom', () => {
  it('throws 404 when the classroom does not exist', async () => {
    const prisma = createPrismaMock();
    const service = await loadService(prisma);

    prisma.classroom.findUnique.mockResolvedValue(null);

    await expect(
      service.updateClassroom('classroom-unknown', { capacity: 45 }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('updates only the provided fields', async () => {
    const prisma = createPrismaMock();
    const service = await loadService(prisma);

    prisma.classroom.findUnique.mockResolvedValue(currentRecord);
    prisma.classroom.update.mockResolvedValue(detailRecord);

    await service.updateClassroom('classroom-001', { capacity: 45, floor: null });

    expect(prisma.classroom.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'classroom-001' },
        data: { capacity: 45, floor: null },
      }),
    );
  });

  it('rejects deactivation while scheduled or ongoing activities exist', async () => {
    const prisma = createPrismaMock();
    const service = await loadService(prisma);

    prisma.classroom.findUnique.mockResolvedValue(currentRecord);
    prisma.activity.findMany.mockResolvedValue([{ id: 'activity-001' }]);

    await expect(
      service.updateClassroom('classroom-001', { isActive: false }),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: 'Cannot deactivate a classroom with scheduled or ongoing activities.',
    });
    expect(prisma.classroom.update).not.toHaveBeenCalled();
    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it('deactivates when no activity reserves the classroom', async () => {
    const prisma = createPrismaMock();
    const service = await loadService(prisma);

    prisma.classroom.findUnique.mockResolvedValue(currentRecord);
    prisma.activity.findMany.mockResolvedValue([]);
    prisma.classroom.update.mockResolvedValue({ ...detailRecord, isActive: false });

    const result = await service.updateClassroom('classroom-001', { isActive: false });

    expect(prisma.activity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { classroomId: 'classroom-001', status: { in: ['SCHEDULED', 'ONGOING'] } },
      }),
    );
    expect(result.isActive).toBe(false);
  });
});

describe('addClassroomAmenity', () => {
  it('throws 404 when the classroom does not exist', async () => {
    const prisma = createPrismaMock();
    const service = await loadService(prisma);

    prisma.classroom.findUnique.mockResolvedValue(null);

    await expect(
      service.addClassroomAmenity('classroom-unknown', 'Proyector'),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('rejects case-insensitive duplicates with 409', async () => {
    const prisma = createPrismaMock();
    const service = await loadService(prisma);

    prisma.classroom.findUnique.mockResolvedValue({ id: 'classroom-001' });
    prisma.classroomAmenity.findFirst.mockResolvedValue({ amenity: 'Proyector' });

    await expect(service.addClassroomAmenity('classroom-001', 'proyector')).rejects.toMatchObject({
      statusCode: 409,
      message: 'Amenity already exists for this classroom.',
    });
    expect(prisma.classroomAmenity.create).not.toHaveBeenCalled();
  });

  it('creates the amenity preserving its casing and returns the detail', async () => {
    const prisma = createPrismaMock();
    const service = await loadService(prisma);

    prisma.classroom.findUnique
      .mockResolvedValueOnce({ id: 'classroom-001' })
      .mockResolvedValueOnce(detailRecord);
    prisma.classroomAmenity.findFirst.mockResolvedValue(null);
    prisma.classroomAmenity.create.mockResolvedValue({ classroomId: 'classroom-001' });

    const result = await service.addClassroomAmenity('classroom-001', 'Smart Board');

    expect(prisma.classroomAmenity.create).toHaveBeenCalledWith({
      data: { classroomId: 'classroom-001', amenity: 'Smart Board' },
    });
    expect(result).toEqual(expectedDetail);
  });
});

describe('removeClassroomAmenity', () => {
  it('throws 404 when the amenity does not exist', async () => {
    const prisma = createPrismaMock();
    const service = await loadService(prisma);

    prisma.classroom.findUnique.mockResolvedValue({ id: 'classroom-001' });
    prisma.classroomAmenity.findFirst.mockResolvedValue(null);

    await expect(
      service.removeClassroomAmenity('classroom-001', 'Proyector'),
    ).rejects.toMatchObject({ statusCode: 404, message: 'Amenity not found.' });
    expect(prisma.classroomAmenity.delete).not.toHaveBeenCalled();
  });

  it('deletes the stored casing when the request differs in case', async () => {
    const prisma = createPrismaMock();
    const service = await loadService(prisma);

    prisma.classroom.findUnique
      .mockResolvedValueOnce({ id: 'classroom-001' })
      .mockResolvedValueOnce(detailRecord);
    prisma.classroomAmenity.findFirst.mockResolvedValue({ amenity: 'Proyector' });
    prisma.classroomAmenity.delete.mockResolvedValue({ classroomId: 'classroom-001' });

    await service.removeClassroomAmenity('classroom-001', 'proyector');

    expect(prisma.classroomAmenity.delete).toHaveBeenCalledWith({
      where: { classroomId_amenity: { classroomId: 'classroom-001', amenity: 'Proyector' } },
    });
  });
});

describe('classroom audit trail', () => {
  const auditContext = { actorId: 'user-001', actorType: 'USER' as const, requestId: 'req-001' };

  it('writes one creation event inside the transaction', async () => {
    const prisma = createPrismaMock();
    const service = await loadService(prisma);

    prisma.classroom.create.mockResolvedValue(detailRecord);

    await service.createClassroom(
      { name: 'Aula 101', type: 'CLASSROOM', capacity: 40 },
      auditContext,
    );

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.auditEvent.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'classroom.created',
        actorType: 'USER',
        actorId: 'user-001',
        resourceType: 'classroom',
        resourceId: 'classroom-001',
        requestId: 'req-001',
        changes: {
          after: { type: 'CLASSROOM', capacity: 40, floor: null, isActive: true },
        },
      }),
    });
  });

  it('writes the creation event after the classroom row', async () => {
    const prisma = createPrismaMock();
    const service = await loadService(prisma);

    prisma.classroom.create.mockResolvedValue(detailRecord);

    await service.createClassroom({ name: 'Aula 101', type: 'CLASSROOM', capacity: 40 });

    expect(prisma.classroom.create.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.auditEvent.create.mock.invocationCallOrder[0] as number,
    );
  });

  it('records a deactivation lifecycle event', async () => {
    const prisma = createPrismaMock();
    const service = await loadService(prisma);

    prisma.classroom.findUnique.mockResolvedValue(currentRecord);
    prisma.activity.findMany.mockResolvedValue([]);
    prisma.classroom.update.mockResolvedValue({ ...detailRecord, isActive: false });

    await service.updateClassroom('classroom-001', { isActive: false }, auditContext);

    expect(prisma.auditEvent.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'classroom.deactivated',
        resourceType: 'classroom',
        resourceId: 'classroom-001',
        changes: { before: { isActive: true }, after: { isActive: false } },
      }),
    });
  });

  it('records an activation lifecycle event', async () => {
    const prisma = createPrismaMock();
    const service = await loadService(prisma);

    prisma.classroom.findUnique.mockResolvedValue({ ...currentRecord, isActive: false });
    prisma.classroom.update.mockResolvedValue(detailRecord);

    await service.updateClassroom('classroom-001', { isActive: true }, auditContext);

    expect(prisma.auditEvent.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'classroom.activated',
        changes: { before: { isActive: false }, after: { isActive: true } },
      }),
    });
  });

  it('reports only the attributes that actually changed and names free text', async () => {
    const prisma = createPrismaMock();
    const service = await loadService(prisma);

    prisma.classroom.findUnique.mockResolvedValue(currentRecord);
    prisma.classroom.update.mockResolvedValue({ ...detailRecord, name: 'Aula 102', capacity: 45 });

    await service.updateClassroom(
      'classroom-001',
      { name: 'Aula 102', capacity: 45 },
      auditContext,
    );

    expect(prisma.auditEvent.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'classroom.updated',
        changes: { before: { capacity: 40 }, after: { capacity: 45 } },
        metadata: { changedFields: ['name'] },
      }),
    });
  });

  it('records the lifecycle event and the attribute event in the same transaction', async () => {
    const prisma = createPrismaMock();
    const service = await loadService(prisma);

    prisma.classroom.findUnique.mockResolvedValue(currentRecord);
    prisma.activity.findMany.mockResolvedValue([]);
    prisma.classroom.update.mockResolvedValue({ ...detailRecord, floor: 2, isActive: false });

    await service.updateClassroom('classroom-001', { isActive: false, floor: 2 }, auditContext);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.auditEvent.create).toHaveBeenCalledTimes(2);
    expect(prisma.auditEvent.create.mock.calls.map(([call]) => call.data.action)).toEqual([
      'classroom.deactivated',
      'classroom.updated',
    ]);
  });

  it('does not audit an update that repeats the current state', async () => {
    const prisma = createPrismaMock();
    const service = await loadService(prisma);

    prisma.classroom.findUnique.mockResolvedValue(currentRecord);
    prisma.classroom.update.mockResolvedValue(detailRecord);

    await service.updateClassroom(
      'classroom-001',
      { isActive: true, capacity: 40, type: 'CLASSROOM' },
      auditContext,
    );

    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it('does not audit an update rejected by validation', async () => {
    const prisma = createPrismaMock();
    const service = await loadService(prisma);

    prisma.classroom.findUnique.mockResolvedValue(null);

    await expect(
      service.updateClassroom('classroom-unknown', { capacity: 45 }, auditContext),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it('reverts the classroom when the audit insert fails', async () => {
    const prisma = createPrismaMock();
    const service = await loadService(prisma);

    prisma.classroom.findUnique.mockResolvedValue(currentRecord);
    prisma.classroom.update.mockResolvedValue(detailRecord);
    prisma.auditEvent.create.mockRejectedValue(new Error('audit insert failed'));

    await expect(
      service.updateClassroom('classroom-001', { capacity: 45 }, auditContext),
    ).rejects.toThrow('audit insert failed');
    expect(prisma.classroom.update).toHaveBeenCalledTimes(1);
  });

  it('records an added amenity', async () => {
    const prisma = createPrismaMock();
    const service = await loadService(prisma);

    prisma.classroom.findUnique
      .mockResolvedValueOnce(currentRecord)
      .mockResolvedValueOnce(detailRecord);
    prisma.classroomAmenity.findFirst.mockResolvedValue(null);
    prisma.classroomAmenity.create.mockResolvedValue({ classroomId: 'classroom-001' });

    await service.addClassroomAmenity('classroom-001', 'Smart Board', auditContext);

    expect(prisma.auditEvent.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'classroom.amenity_added',
        resourceId: 'classroom-001',
        changes: { after: { amenity: 'Smart Board' } },
      }),
    });
  });

  it('records a removed amenity and does not audit a missing one', async () => {
    const prisma = createPrismaMock();
    const service = await loadService(prisma);

    prisma.classroom.findUnique
      .mockResolvedValueOnce(currentRecord)
      .mockResolvedValueOnce(detailRecord);
    prisma.classroomAmenity.findFirst.mockResolvedValue({ amenity: 'Proyector' });
    prisma.classroomAmenity.delete.mockResolvedValue({ classroomId: 'classroom-001' });

    await service.removeClassroomAmenity('classroom-001', 'proyector', auditContext);

    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'classroom.amenity_removed',
        changes: { before: { amenity: 'Proyector' } },
      }),
    });

    const missing = createPrismaMock();
    const missingService = await loadService(missing);

    missing.classroom.findUnique.mockResolvedValue(currentRecord);
    missing.classroomAmenity.findFirst.mockResolvedValue(null);

    await expect(
      missingService.removeClassroomAmenity('classroom-001', 'Proyector', auditContext),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(missing.auditEvent.create).not.toHaveBeenCalled();
  });

  it('records an added availability window without persisting the free text period', async () => {
    const prisma = createPrismaMock();
    const service = await loadService(prisma);

    prisma.classroom.findUnique
      .mockResolvedValueOnce(currentRecord)
      .mockResolvedValueOnce(detailRecord);
    prisma.classroomAvailability.findFirst.mockResolvedValue(null);
    prisma.classroomAvailability.create.mockResolvedValue({ id: 'slot-new' });

    await service.addClassroomAvailability(
      'classroom-001',
      { dayOfWeek: 1, startTime: '08:00', endTime: '10:00', period: 'Matutino' },
      auditContext,
    );

    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'classroom.availability_added',
        changes: {
          after: { dayOfWeek: 1, startTime: '08:00', endTime: '10:00' },
        },
        metadata: { hasPeriod: true },
      }),
    });
  });

  it('records a removed availability window', async () => {
    const prisma = createPrismaMock();
    const service = await loadService(prisma);

    prisma.classroom.findUnique
      .mockResolvedValueOnce(currentRecord)
      .mockResolvedValueOnce(detailRecord);
    prisma.classroomAvailability.findFirst.mockResolvedValue({
      id: 'slot-1',
      dayOfWeek: 1,
      startTime: new Date('1970-01-01T07:00:00.000Z'),
      endTime: new Date('1970-01-01T12:00:00.000Z'),
      period: 'Matutino',
    });
    prisma.classroomAvailability.delete.mockResolvedValue({ id: 'slot-1' });

    await service.removeClassroomAvailability('classroom-001', 'slot-1', auditContext);

    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'classroom.availability_removed',
        changes: {
          before: { dayOfWeek: 1, startTime: '07:00', endTime: '12:00' },
        },
        metadata: { hasPeriod: true },
      }),
    });
  });
});

describe('addClassroomAvailability', () => {
  it('throws 404 when the classroom does not exist', async () => {
    const prisma = createPrismaMock();
    const service = await loadService(prisma);

    prisma.classroom.findUnique.mockResolvedValue(null);

    await expect(
      service.addClassroomAvailability('classroom-unknown', {
        dayOfWeek: 1,
        startTime: '08:00',
        endTime: '10:00',
      }),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('rejects overlapping windows with 409', async () => {
    const prisma = createPrismaMock();
    const service = await loadService(prisma);

    prisma.classroom.findUnique.mockResolvedValue({ id: 'classroom-001' });
    prisma.classroomAvailability.findFirst.mockResolvedValue({ id: 'slot-1' });

    await expect(
      service.addClassroomAvailability('classroom-001', {
        dayOfWeek: 1,
        startTime: '09:00',
        endTime: '11:00',
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: 'Classroom availability overlaps an existing window.',
    });
    expect(prisma.classroomAvailability.create).not.toHaveBeenCalled();
  });

  it('allows adjacent windows and converts times to Date values', async () => {
    const prisma = createPrismaMock();
    const service = await loadService(prisma);

    prisma.classroom.findUnique
      .mockResolvedValueOnce({ id: 'classroom-001' })
      .mockResolvedValueOnce(detailRecord);
    prisma.classroomAvailability.findFirst.mockResolvedValue(null);
    prisma.classroomAvailability.create.mockResolvedValue({ id: 'slot-new' });

    await service.addClassroomAvailability('classroom-001', {
      dayOfWeek: 1,
      startTime: '12:00',
      endTime: '17:00',
    });

    expect(prisma.classroomAvailability.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          classroomId: 'classroom-001',
          dayOfWeek: 1,
          startTime: { lt: new Date('1970-01-01T17:00:00.000Z') },
          endTime: { gt: new Date('1970-01-01T12:00:00.000Z') },
        },
      }),
    );
    expect(prisma.classroomAvailability.create).toHaveBeenCalledWith({
      data: {
        classroomId: 'classroom-001',
        dayOfWeek: 1,
        startTime: new Date('1970-01-01T12:00:00.000Z'),
        endTime: new Date('1970-01-01T17:00:00.000Z'),
        period: null,
      },
    });
  });
});

describe('removeClassroomAvailability', () => {
  it('throws 404 when the window does not exist', async () => {
    const prisma = createPrismaMock();
    const service = await loadService(prisma);

    prisma.classroom.findUnique.mockResolvedValue({ id: 'classroom-001' });
    prisma.classroomAvailability.findFirst.mockResolvedValue(null);

    await expect(
      service.removeClassroomAvailability('classroom-001', 'slot-unknown'),
    ).rejects.toMatchObject({ statusCode: 404, message: 'Classroom availability not found.' });
    expect(prisma.classroomAvailability.delete).not.toHaveBeenCalled();
  });

  it('deletes the window and returns the detail', async () => {
    const prisma = createPrismaMock();
    const service = await loadService(prisma);

    prisma.classroom.findUnique
      .mockResolvedValueOnce(currentRecord)
      .mockResolvedValueOnce(detailRecord);
    prisma.classroomAvailability.findFirst.mockResolvedValue({
      id: 'slot-1',
      dayOfWeek: 1,
      startTime: new Date('1970-01-01T07:00:00.000Z'),
      endTime: new Date('1970-01-01T12:00:00.000Z'),
      period: 'Matutino',
    });
    prisma.classroomAvailability.delete.mockResolvedValue({ id: 'slot-1' });

    await service.removeClassroomAvailability('classroom-001', 'slot-1');

    expect(prisma.classroomAvailability.delete).toHaveBeenCalledWith({ where: { id: 'slot-1' } });
  });
});

describe('findAvailableClassrooms', () => {
  it('requires an active classroom with a covering window', async () => {
    const prisma = createPrismaMock();
    const service = await loadService(prisma);

    prisma.classroom.findMany.mockResolvedValue([]);
    prisma.activity.findMany.mockResolvedValue([]);

    await service.findAvailableClassrooms({
      date: '2026-09-21',
      startTime: '08:00',
      endTime: '10:00',
      minCapacity: 25,
      type: 'LABORATORY',
      amenity: 'Proyector',
    } as never);

    expect(prisma.classroom.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          isActive: true,
          type: 'LABORATORY',
          capacity: { gte: 25 },
          amenities: { some: { amenity: { equals: 'Proyector', mode: 'insensitive' } } },
          availability: {
            some: {
              dayOfWeek: 1,
              startTime: { lte: new Date('1970-01-01T08:00:00.000Z') },
              endTime: { gte: new Date('1970-01-01T10:00:00.000Z') },
            },
          },
        },
        orderBy: [{ capacity: 'asc' }, { name: 'asc' }, { id: 'asc' }],
      }),
    );
  });

  it('derives Sunday as day 7', async () => {
    const prisma = createPrismaMock();
    const service = await loadService(prisma);

    prisma.classroom.findMany.mockResolvedValue([]);

    await service.findAvailableClassrooms({
      date: '2026-09-27',
      startTime: '08:00',
      endTime: '10:00',
    } as never);

    const call = prisma.classroom.findMany.mock.calls[0]?.[0] as {
      where: { availability: { some: { dayOfWeek: number } } };
    };

    expect(call.where.availability.some.dayOfWeek).toBe(7);
    expect(prisma.activity.findMany).not.toHaveBeenCalled();
  });

  it('excludes classrooms blocked by scheduled or ongoing activities', async () => {
    const prisma = createPrismaMock();
    const service = await loadService(prisma);

    const laboratoryRecord = {
      ...summaryRecord,
      id: 'classroom-lab',
      name: 'Laboratorio 1',
      type: 'LABORATORY',
    };

    prisma.classroom.findMany.mockResolvedValue([summaryRecord, laboratoryRecord]);
    prisma.activity.findMany.mockResolvedValue([{ classroomId: 'classroom-001' }]);

    const result = await service.findAvailableClassrooms({
      date: '2026-09-21',
      startTime: '08:00',
      endTime: '10:00',
    } as never);

    expect(prisma.activity.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          date: new Date('2026-09-21T00:00:00.000Z'),
          status: { in: ['SCHEDULED', 'ONGOING'] },
          classroomId: { in: ['classroom-001', 'classroom-lab'] },
          startTime: { lt: new Date('1970-01-01T10:00:00.000Z') },
          endTime: { gt: new Date('1970-01-01T08:00:00.000Z') },
        },
        distinct: ['classroomId'],
      }),
    );
    expect(result).toEqual([{ ...laboratoryRecord, amenities: ['Pizarra', 'Proyector'] }]);
  });
});
