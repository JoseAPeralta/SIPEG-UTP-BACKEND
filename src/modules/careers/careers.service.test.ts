import { afterEach, describe, expect, it, vi } from 'vitest';

import { Prisma } from '../../generated/prisma/client.js';

interface PrismaMock {
  career: {
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  organizationalUnit: { findUnique: ReturnType<typeof vi.fn> };
  user: { count: ReturnType<typeof vi.fn> };
  auditEvent: { create: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
}

const createPrismaMock = (): PrismaMock => {
  const prisma: PrismaMock = {
    career: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    organizationalUnit: { findUnique: vi.fn() },
    user: { count: vi.fn() },
    auditEvent: { create: vi.fn().mockResolvedValue({ id: 'audit-001' }) },
    $transaction: vi.fn(),
  };

  prisma.$transaction.mockImplementation(
    async (callback: (client: PrismaMock) => Promise<unknown>) => callback(prisma),
  );

  return prisma;
};

const loadService = async (prisma: PrismaMock) => {
  vi.resetModules();
  vi.doMock('../../config/prisma.js', () => ({ getPrismaClient: () => prisma }));

  return import('./careers.service.js');
};

const unitRecord = { id: 'unit-001', name: 'Facultad de Ingenieria Civil', code: 'FIC' };

const careerRecord = {
  id: 'car-001',
  name: 'Ingenieria Civil',
  code: 'FIC-CIV',
  description: 'Licenciatura',
  unit: unitRecord,
};

const otrosRecord = {
  id: 'car-otros',
  name: 'Otros',
  code: 'OTROS',
  description: null,
  unit: null,
};

const facultyUnitRecord = { id: 'unit-001', type: 'FACULTY', isActive: true };

const careerLookup = { id: 'car-001', code: 'FIC-CIV', unitId: 'unit-001' };

const careerEditable = { ...careerLookup, name: 'Ingenieria Civil', description: 'Licenciatura' };

const createInput = {
  name: 'Ingenieria Civil',
  code: 'FIC-CIV',
};

describe('careers service', () => {
  afterEach(() => {
    vi.doUnmock('../../config/prisma.js');
  });

  it('lists all careers with pagination', async () => {
    const prisma = createPrismaMock();
    prisma.career.findMany.mockResolvedValue([careerRecord, otrosRecord]);
    prisma.career.count.mockResolvedValue(30);
    const { listCareers } = await loadService(prisma);

    const result = await listCareers({ page: 2, limit: 10 });

    expect(result).toEqual({
      items: [careerRecord, otrosRecord],
      page: 2,
      limit: 10,
      total: 30,
      totalPages: 3,
    });
    expect(prisma.career.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {},
        skip: 10,
        take: 10,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }),
    );
  });

  it('does not select internal timestamp fields', async () => {
    const prisma = createPrismaMock();
    prisma.career.findMany.mockResolvedValue([]);
    prisma.career.count.mockResolvedValue(0);
    const { listCareers } = await loadService(prisma);

    await listCareers({ page: 1, limit: 20 });

    const args = prisma.career.findMany.mock.calls[0]?.[0] as { select: Record<string, unknown> };

    expect(args.select).not.toHaveProperty('createdAt');
    expect(args.select).not.toHaveProperty('updatedAt');
    expect(args.select['unit']).toEqual({ select: { id: true, name: true, code: true } });
  });

  it('includes global careers when filtering by unit', async () => {
    const prisma = createPrismaMock();
    prisma.career.findMany.mockResolvedValue([]);
    prisma.career.count.mockResolvedValue(0);
    const { listCareers } = await loadService(prisma);

    await listCareers({ page: 1, limit: 20, unitId: 'unit-001' });

    expect(prisma.career.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { AND: [{ OR: [{ unitId: 'unit-001' }, { unitId: null }] }] },
      }),
    );
  });

  it('filters only global careers with the global sentinel', async () => {
    const prisma = createPrismaMock();
    prisma.career.findMany.mockResolvedValue([]);
    prisma.career.count.mockResolvedValue(0);
    const { listCareers } = await loadService(prisma);

    await listCareers({ page: 1, limit: 20, unitId: 'global' });

    expect(prisma.career.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { AND: [{ unitId: null }] } }),
    );
  });

  it('searches by name or code', async () => {
    const prisma = createPrismaMock();
    prisma.career.findMany.mockResolvedValue([]);
    prisma.career.count.mockResolvedValue(0);
    const { listCareers } = await loadService(prisma);

    await listCareers({ page: 1, limit: 20, q: 'civil' });

    expect(prisma.career.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            {
              OR: [
                { name: { contains: 'civil', mode: 'insensitive' } },
                { code: { contains: 'civil', mode: 'insensitive' } },
              ],
            },
          ],
        },
      }),
    );
  });

  it('combines unit and search filters without key collisions', async () => {
    const prisma = createPrismaMock();
    prisma.career.findMany.mockResolvedValue([]);
    prisma.career.count.mockResolvedValue(0);
    const { listCareers } = await loadService(prisma);

    await listCareers({ page: 1, limit: 20, unitId: 'unit-001', q: 'civil' });

    expect(prisma.career.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          AND: [
            { OR: [{ unitId: 'unit-001' }, { unitId: null }] },
            {
              OR: [
                { name: { contains: 'civil', mode: 'insensitive' } },
                { code: { contains: 'civil', mode: 'insensitive' } },
              ],
            },
          ],
        },
      }),
    );
  });

  it('returns an empty page when no career matches', async () => {
    const prisma = createPrismaMock();
    prisma.career.findMany.mockResolvedValue([]);
    prisma.career.count.mockResolvedValue(0);
    const { listCareers } = await loadService(prisma);

    await expect(listCareers({ page: 1, limit: 20 })).resolves.toEqual({
      items: [],
      page: 1,
      limit: 20,
      total: 0,
      totalPages: 0,
    });
  });

  it('creates a global career when unitId is omitted', async () => {
    const prisma = createPrismaMock();
    prisma.career.findUnique.mockResolvedValue(null);
    prisma.career.create.mockResolvedValue(otrosRecord);
    const { createCareer } = await loadService(prisma);

    const career = await createCareer({ name: 'Otros', code: 'OTROS' });

    expect(career).toEqual(otrosRecord);
    expect(prisma.organizationalUnit.findUnique).not.toHaveBeenCalled();
    expect(prisma.career.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { name: 'Otros', code: 'OTROS', description: null, unitId: null },
      }),
    );
  });

  it('creates a career inside an active faculty', async () => {
    const prisma = createPrismaMock();
    prisma.organizationalUnit.findUnique.mockResolvedValue(facultyUnitRecord);
    prisma.career.findUnique.mockResolvedValue(null);
    prisma.career.create.mockResolvedValue(careerRecord);
    const { createCareer } = await loadService(prisma);

    await createCareer({ ...createInput, unitId: 'unit-001' });

    expect(prisma.career.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          name: 'Ingenieria Civil',
          code: 'FIC-CIV',
          description: null,
          unitId: 'unit-001',
        },
      }),
    );
  });

  it('rejects creating a career with an unknown unit', async () => {
    const prisma = createPrismaMock();
    prisma.organizationalUnit.findUnique.mockResolvedValue(null);
    const { createCareer } = await loadService(prisma);

    await expect(createCareer({ ...createInput, unitId: 'unit-missing' })).rejects.toMatchObject({
      statusCode: 404,
      message: 'Organizational unit not found.',
    });
    expect(prisma.career.create).not.toHaveBeenCalled();
  });

  it('rejects creating a career outside a faculty', async () => {
    const prisma = createPrismaMock();
    prisma.organizationalUnit.findUnique.mockResolvedValue({
      id: 'unit-sub',
      type: 'SUBDIRECTORATE',
      isActive: true,
    });
    const { createCareer } = await loadService(prisma);

    await expect(createCareer({ ...createInput, unitId: 'unit-sub' })).rejects.toMatchObject({
      statusCode: 400,
      message: 'Careers can only belong to a faculty.',
    });
    expect(prisma.career.create).not.toHaveBeenCalled();
  });

  it('rejects creating a career in an inactive unit', async () => {
    const prisma = createPrismaMock();
    prisma.organizationalUnit.findUnique.mockResolvedValue({
      id: 'unit-001',
      type: 'FACULTY',
      isActive: false,
    });
    const { createCareer } = await loadService(prisma);

    await expect(createCareer({ ...createInput, unitId: 'unit-001' })).rejects.toMatchObject({
      statusCode: 400,
      message: 'Organizational unit is inactive.',
    });
    expect(prisma.career.create).not.toHaveBeenCalled();
  });

  it('rejects a duplicated career code before writing', async () => {
    const prisma = createPrismaMock();
    prisma.career.findUnique.mockResolvedValue({ id: 'car-existing' });
    const { createCareer } = await loadService(prisma);

    await expect(createCareer(createInput)).rejects.toMatchObject({
      statusCode: 409,
      message: 'Career code already exists.',
    });
    expect(prisma.career.create).not.toHaveBeenCalled();
  });

  it('translates a unique constraint race into a conflict', async () => {
    const prisma = createPrismaMock();
    prisma.career.findUnique.mockResolvedValue(null);
    prisma.career.create.mockRejectedValue({ code: 'P2002' });
    const { createCareer } = await loadService(prisma);

    await expect(createCareer(createInput)).rejects.toMatchObject({
      statusCode: 409,
      message: 'Career code already exists.',
    });
  });

  it('fails updating a missing career', async () => {
    const prisma = createPrismaMock();
    prisma.career.findUnique.mockResolvedValue(null);
    const { updateCareer } = await loadService(prisma);

    await expect(updateCareer('missing', { name: 'Nueva' })).rejects.toMatchObject({
      statusCode: 404,
      message: 'Career not found.',
    });
    expect(prisma.career.update).not.toHaveBeenCalled();
  });

  it('updates only the provided fields', async () => {
    const prisma = createPrismaMock();
    prisma.career.findUnique.mockResolvedValue(careerLookup);
    prisma.career.update.mockResolvedValue(careerRecord);
    const { updateCareer } = await loadService(prisma);

    await updateCareer('car-001', { description: 'Nueva descripcion' });

    expect(prisma.career.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'car-001' },
        data: { description: 'Nueva descripcion' },
      }),
    );
  });

  it('skips the user count when the unit does not change', async () => {
    const prisma = createPrismaMock();
    prisma.career.findUnique.mockResolvedValue(careerLookup);
    prisma.organizationalUnit.findUnique.mockResolvedValue(facultyUnitRecord);
    prisma.career.update.mockResolvedValue(careerRecord);
    const { updateCareer } = await loadService(prisma);

    await updateCareer('car-001', { unitId: 'unit-001' });

    expect(prisma.user.count).not.toHaveBeenCalled();
    expect(prisma.career.update).toHaveBeenCalledTimes(1);
  });

  it('rejects changing the unit of a career with associated users', async () => {
    const prisma = createPrismaMock();
    prisma.career.findUnique.mockResolvedValue(careerLookup);
    prisma.organizationalUnit.findUnique.mockResolvedValue({
      id: 'unit-002',
      type: 'FACULTY',
      isActive: true,
    });
    prisma.user.count.mockResolvedValue(3);
    const { updateCareer } = await loadService(prisma);

    await expect(updateCareer('car-001', { unitId: 'unit-002' })).rejects.toMatchObject({
      statusCode: 409,
      message: 'Cannot change the unit of a career with associated users.',
    });
    expect(prisma.career.update).not.toHaveBeenCalled();
  });

  it('changes the unit when there are no associated users', async () => {
    const prisma = createPrismaMock();
    prisma.career.findUnique.mockResolvedValue(careerLookup);
    prisma.organizationalUnit.findUnique.mockResolvedValue({
      id: 'unit-002',
      type: 'FACULTY',
      isActive: true,
    });
    prisma.user.count.mockResolvedValue(0);
    prisma.career.update.mockResolvedValue(careerRecord);
    const { updateCareer } = await loadService(prisma);

    await updateCareer('car-001', { unitId: 'unit-002' });

    expect(prisma.career.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { unitId: 'unit-002' } }),
    );
  });

  it('turns a career global when unitId is null', async () => {
    const prisma = createPrismaMock();
    prisma.career.findUnique.mockResolvedValue(careerLookup);
    prisma.user.count.mockResolvedValue(0);
    prisma.career.update.mockResolvedValue(otrosRecord);
    const { updateCareer } = await loadService(prisma);

    await updateCareer('car-001', { unitId: null });

    expect(prisma.organizationalUnit.findUnique).not.toHaveBeenCalled();
    expect(prisma.career.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { unitId: null } }),
    );
  });

  it('rejects renaming the Otros career code', async () => {
    const prisma = createPrismaMock();
    prisma.career.findUnique.mockResolvedValue({ id: 'car-otros', code: 'OTROS', unitId: null });
    const { updateCareer } = await loadService(prisma);

    await expect(updateCareer('car-otros', { code: 'OTRO' })).rejects.toMatchObject({
      statusCode: 409,
      message: 'The Otros career code cannot be changed.',
    });
    expect(prisma.career.update).not.toHaveBeenCalled();
  });

  it('rejects moving the Otros career out of the global scope', async () => {
    const prisma = createPrismaMock();
    prisma.career.findUnique.mockResolvedValue({ id: 'car-otros', code: 'OTROS', unitId: null });
    const { updateCareer } = await loadService(prisma);

    await expect(updateCareer('car-otros', { unitId: 'unit-001' })).rejects.toMatchObject({
      statusCode: 409,
      message: 'The Otros career must remain global.',
    });
    expect(prisma.organizationalUnit.findUnique).not.toHaveBeenCalled();
    expect(prisma.career.update).not.toHaveBeenCalled();
  });

  it('updates the Otros career name', async () => {
    const prisma = createPrismaMock();
    prisma.career.findUnique.mockResolvedValue({ id: 'car-otros', code: 'OTROS', unitId: null });
    prisma.career.update.mockResolvedValue(otrosRecord);
    const { updateCareer } = await loadService(prisma);

    await updateCareer('car-otros', { name: 'Otros programas' });

    expect(prisma.user.count).not.toHaveBeenCalled();
    expect(prisma.career.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { name: 'Otros programas' } }),
    );
  });

  it('translates a duplicated code on update', async () => {
    const prisma = createPrismaMock();
    prisma.career.findUnique.mockResolvedValue(careerLookup);
    prisma.career.update.mockRejectedValue({ code: 'P2002' });
    const { updateCareer } = await loadService(prisma);

    await expect(updateCareer('car-001', { code: 'FIE-ELE' })).rejects.toMatchObject({
      statusCode: 409,
      message: 'Career code already exists.',
    });
  });

  it('fails deleting a missing career', async () => {
    const prisma = createPrismaMock();
    prisma.career.findUnique.mockResolvedValue(null);
    const { deleteCareer } = await loadService(prisma);

    await expect(deleteCareer('missing')).rejects.toMatchObject({
      statusCode: 404,
      message: 'Career not found.',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('protects the global Otros career from deletion', async () => {
    const prisma = createPrismaMock();
    prisma.career.findUnique.mockResolvedValue({ id: 'car-otros', code: 'OTROS' });
    const { deleteCareer } = await loadService(prisma);

    await expect(deleteCareer('car-otros')).rejects.toMatchObject({
      statusCode: 409,
      message: 'The global Otros career cannot be deleted.',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects deleting a career with associated users', async () => {
    const prisma = createPrismaMock();
    prisma.career.findUnique.mockResolvedValue({ id: 'car-001', code: 'FIC-CIV' });
    prisma.user.count.mockResolvedValue(2);
    const { deleteCareer } = await loadService(prisma);

    await expect(deleteCareer('car-001')).rejects.toMatchObject({
      statusCode: 409,
      message: 'Career has associated users.',
    });
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.career.delete).not.toHaveBeenCalled();
  });

  it('deletes a career without users inside a transaction', async () => {
    const prisma = createPrismaMock();
    prisma.career.findUnique.mockResolvedValue({ id: 'car-001', code: 'FIC-CIV' });
    prisma.user.count.mockResolvedValue(0);
    prisma.career.delete.mockResolvedValue({ id: 'car-001' });
    const { deleteCareer } = await loadService(prisma);

    await expect(deleteCareer('car-001')).resolves.toBeUndefined();

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.user.count).toHaveBeenCalledWith({ where: { careerId: 'car-001' } });
    expect(prisma.career.delete).toHaveBeenCalledWith({ where: { id: 'car-001' } });
  });
});

describe('career audit trail', () => {
  const auditContext = { actorId: 'user-001', actorType: 'USER' as const, requestId: 'req-001' };

  it('writes one creation event inside the transaction', async () => {
    const prisma = createPrismaMock();
    prisma.organizationalUnit.findUnique.mockResolvedValue(facultyUnitRecord);
    prisma.career.findUnique.mockResolvedValue(null);
    prisma.career.create.mockResolvedValue(careerRecord);
    const { createCareer } = await loadService(prisma);

    await createCareer({ ...createInput, unitId: 'unit-001' }, auditContext);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.auditEvent.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'career.created',
        actorId: 'user-001',
        resourceType: 'career',
        resourceId: 'car-001',
        requestId: 'req-001',
        changes: { after: { code: 'FIC-CIV', unitId: 'unit-001' } },
      }),
    });
  });

  it('reports a global career as a null unit', async () => {
    const prisma = createPrismaMock();
    prisma.career.findUnique.mockResolvedValue(null);
    prisma.career.create.mockResolvedValue(otrosRecord);
    const { createCareer } = await loadService(prisma);

    await createCareer(createInput, auditContext);

    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ changes: { after: { code: 'FIC-CIV', unitId: null } } }),
    });
  });

  it('writes the creation event after the career row', async () => {
    const prisma = createPrismaMock();
    prisma.career.findUnique.mockResolvedValue(null);
    prisma.career.create.mockResolvedValue(careerRecord);
    const { createCareer } = await loadService(prisma);

    await createCareer(createInput);

    expect(prisma.career.create.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.auditEvent.create.mock.invocationCallOrder[0] as number,
    );
  });

  it('records only the attributes that changed and names free text', async () => {
    const prisma = createPrismaMock();
    prisma.career.findUnique.mockResolvedValue(careerEditable);
    prisma.user.count.mockResolvedValue(0);
    prisma.career.update.mockResolvedValue(careerRecord);
    const { updateCareer } = await loadService(prisma);

    await updateCareer(
      'car-001',
      { name: 'Ingenieria Civil y Ambiental', description: 'Nueva', code: 'FIC-CIV' },
      auditContext,
    );

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.auditEvent.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'career.updated',
        metadata: { changedFields: ['name', 'description'] },
      }),
    });
    expect(prisma.auditEvent.create.mock.calls[0]?.[0].data.changes).toBe(Prisma.DbNull);
  });

  it('records a unit reassignment as a before and after change', async () => {
    const prisma = createPrismaMock();
    prisma.career.findUnique.mockResolvedValue(careerLookup);
    prisma.organizationalUnit.findUnique.mockResolvedValue(facultyUnitRecord);
    prisma.user.count.mockResolvedValue(0);
    prisma.career.update.mockResolvedValue(careerRecord);
    const { updateCareer } = await loadService(prisma);

    await updateCareer('car-001', { unitId: 'unit-002' }, auditContext);

    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'career.updated',
        changes: { before: { unitId: 'unit-001' }, after: { unitId: 'unit-002' } },
      }),
    });
  });

  it('does not audit an update that repeats the current state', async () => {
    const prisma = createPrismaMock();
    prisma.organizationalUnit.findUnique.mockResolvedValue(facultyUnitRecord);
    prisma.career.findUnique.mockResolvedValue(careerEditable);
    prisma.career.update.mockResolvedValue(careerRecord);
    const { updateCareer } = await loadService(prisma);

    await updateCareer('car-001', { code: 'FIC-CIV', unitId: 'unit-001' }, auditContext);

    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it('does not audit an update rejected by validation', async () => {
    const prisma = createPrismaMock();
    prisma.career.findUnique.mockResolvedValue({ id: 'car-otros', code: 'OTROS', unitId: null });
    const { updateCareer } = await loadService(prisma);

    await expect(updateCareer('car-otros', { code: 'OTRO' }, auditContext)).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it('reverts the career when the audit insert fails', async () => {
    const prisma = createPrismaMock();
    prisma.career.findUnique.mockResolvedValue(careerEditable);
    prisma.career.update.mockResolvedValue(careerRecord);
    prisma.auditEvent.create.mockRejectedValue(new Error('audit insert failed'));
    const { updateCareer } = await loadService(prisma);

    await expect(updateCareer('car-001', { unitId: null }, auditContext)).rejects.toThrow(
      'audit insert failed',
    );
    expect(prisma.career.update).toHaveBeenCalledTimes(1);
  });

  it('records a deletion with the state it removed', async () => {
    const prisma = createPrismaMock();
    prisma.career.findUnique.mockResolvedValue({
      id: 'car-001',
      code: 'FIC-CIV',
      unitId: 'unit-001',
    });
    prisma.user.count.mockResolvedValue(0);
    prisma.career.delete.mockResolvedValue({ id: 'car-001' });
    const { deleteCareer } = await loadService(prisma);

    await deleteCareer('car-001', auditContext);

    expect(prisma.auditEvent.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'career.deleted',
        actorId: 'user-001',
        resourceType: 'career',
        resourceId: 'car-001',
        changes: { before: { code: 'FIC-CIV', unitId: 'unit-001' } },
      }),
    });
  });

  it('does not audit a deletion rejected by validation', async () => {
    const prisma = createPrismaMock();
    prisma.career.findUnique.mockResolvedValue({ id: 'car-otros', code: 'OTROS' });
    const { deleteCareer } = await loadService(prisma);

    await expect(deleteCareer('car-otros', auditContext)).rejects.toMatchObject({
      statusCode: 409,
    });
    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });
});
