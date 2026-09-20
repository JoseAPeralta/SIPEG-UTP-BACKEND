import { afterEach, describe, expect, it, vi } from 'vitest';

import type { OrganizationalUnitDetail } from './organizational-units.types.js';

interface PrismaMock {
  user: { findUnique: ReturnType<typeof vi.fn> };
  organizationalUnit: {
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  eventProgram: { create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  activity: { count: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
}

const createPrismaMock = (): PrismaMock => {
  const prisma: PrismaMock = {
    user: { findUnique: vi.fn() },
    organizationalUnit: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    eventProgram: { create: vi.fn(), update: vi.fn() },
    activity: { count: vi.fn() },
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

  return import('./organizational-units.service.js');
};

const headRecord = { id: 'user-head', firstName: 'Ana', lastName: 'Gomez' };

const summaryRecord = {
  id: 'unit-001',
  name: 'Facultad de Ingenieria Civil',
  code: 'FIC',
  description: 'Facultad',
  type: 'FACULTY',
  isActive: true,
  head: headRecord,
};

const detailRecord = {
  ...summaryRecord,
  careers: [{ id: 'car-001', name: 'Ingenieria Civil', code: 'FIC-CIV' }],
  eventPrograms: [
    {
      id: 'program-001',
      name: 'Programa de Eventos - Facultad de Ingenieria Civil',
      status: 'ACTIVE',
    },
  ],
};

const expectedDetail: OrganizationalUnitDetail = {
  id: 'unit-001',
  name: 'Facultad de Ingenieria Civil',
  code: 'FIC',
  description: 'Facultad',
  type: 'FACULTY',
  isActive: true,
  head: headRecord,
  careers: [{ id: 'car-001', name: 'Ingenieria Civil', code: 'FIC-CIV' }],
  defaultProgram: {
    id: 'program-001',
    name: 'Programa de Eventos - Facultad de Ingenieria Civil',
    status: 'ACTIVE',
  },
};

const createInput = {
  name: 'Facultad de Ingenieria Civil',
  code: 'FIC',
  type: 'FACULTY' as const,
};

describe('organizational units service', () => {
  afterEach(() => {
    vi.doUnmock('../../config/prisma.js');
  });

  it('lists only active units by default', async () => {
    const prisma = createPrismaMock();
    prisma.organizationalUnit.findMany.mockResolvedValue([summaryRecord]);
    prisma.organizationalUnit.count.mockResolvedValue(11);
    const { listOrganizationalUnits } = await loadService(prisma);

    const result = await listOrganizationalUnits({ page: 2, limit: 10 });

    expect(result).toEqual({
      items: [summaryRecord],
      page: 2,
      limit: 10,
      total: 11,
      totalPages: 2,
    });
    expect(prisma.organizationalUnit.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isActive: true },
        skip: 10,
        take: 10,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }),
    );
  });

  it('applies type, status and search filters', async () => {
    const prisma = createPrismaMock();
    prisma.organizationalUnit.findMany.mockResolvedValue([]);
    prisma.organizationalUnit.count.mockResolvedValue(0);
    const { listOrganizationalUnits } = await loadService(prisma);

    await listOrganizationalUnits({
      page: 1,
      limit: 20,
      type: 'SUBDIRECTORATE',
      isActive: false,
      q: 'sub',
    });

    expect(prisma.organizationalUnit.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          isActive: false,
          type: 'SUBDIRECTORATE',
          OR: [
            { name: { contains: 'sub', mode: 'insensitive' } },
            { code: { contains: 'sub', mode: 'insensitive' } },
          ],
        },
      }),
    );
  });

  it('returns an empty page when no unit matches', async () => {
    const prisma = createPrismaMock();
    prisma.organizationalUnit.findMany.mockResolvedValue([]);
    prisma.organizationalUnit.count.mockResolvedValue(0);
    const { listOrganizationalUnits } = await loadService(prisma);

    await expect(listOrganizationalUnits({ page: 1, limit: 20 })).resolves.toEqual({
      items: [],
      page: 1,
      limit: 20,
      total: 0,
      totalPages: 0,
    });
  });

  it('returns the detail with careers and the default program', async () => {
    const prisma = createPrismaMock();
    prisma.organizationalUnit.findUnique.mockResolvedValue(detailRecord);
    const { getOrganizationalUnitById } = await loadService(prisma);

    await expect(getOrganizationalUnitById('unit-001')).resolves.toEqual(expectedDetail);
  });

  it('fails when the requested unit does not exist', async () => {
    const prisma = createPrismaMock();
    prisma.organizationalUnit.findUnique.mockResolvedValue(null);
    const { getOrganizationalUnitById } = await loadService(prisma);

    await expect(getOrganizationalUnitById('missing')).rejects.toMatchObject({
      statusCode: 404,
      message: 'Organizational unit not found.',
    });
  });

  it('does not select sensitive head fields', async () => {
    const prisma = createPrismaMock();
    let capturedArgs: { select: Record<string, unknown> } | undefined;
    prisma.organizationalUnit.findUnique.mockImplementation(
      (args: { select: Record<string, unknown> }) => {
        capturedArgs = args;
        return Promise.resolve(detailRecord);
      },
    );
    const { getOrganizationalUnitById } = await loadService(prisma);

    await getOrganizationalUnitById('unit-001');

    const headSelect = (capturedArgs?.select['head'] as { select: Record<string, unknown> }).select;

    expect(headSelect).toEqual({ id: true, firstName: true, lastName: true });
    expect(headSelect).not.toHaveProperty('email');
    expect(headSelect).not.toHaveProperty('identificationNumber');
  });

  it('rejects creating a unit with an unknown head', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(null);
    const { createOrganizationalUnit } = await loadService(prisma);

    await expect(
      createOrganizationalUnit({ ...createInput, headId: 'user-missing' }),
    ).rejects.toMatchObject({ statusCode: 404, message: 'User not found.' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects creating a unit with an inactive head', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue({ id: 'user-head', isActive: false });
    const { createOrganizationalUnit } = await loadService(prisma);

    await expect(
      createOrganizationalUnit({ ...createInput, headId: 'user-head' }),
    ).rejects.toMatchObject({ statusCode: 400, message: 'Head user is inactive.' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a duplicated unit code before writing', async () => {
    const prisma = createPrismaMock();
    prisma.organizationalUnit.findUnique.mockResolvedValue({ id: 'unit-existing' });
    const { createOrganizationalUnit } = await loadService(prisma);

    await expect(createOrganizationalUnit(createInput)).rejects.toMatchObject({
      statusCode: 409,
      message: 'Organizational unit code already exists.',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('creates the unit and its default program in one transaction', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue({ id: 'user-head', isActive: true });
    prisma.organizationalUnit.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(detailRecord);
    prisma.organizationalUnit.create.mockResolvedValue({ id: 'unit-001' });
    prisma.eventProgram.create.mockResolvedValue({ id: 'program-001' });
    const { createOrganizationalUnit } = await loadService(prisma);

    const detail = await createOrganizationalUnit({ ...createInput, headId: 'user-head' });

    expect(detail).toEqual(expectedDetail);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.organizationalUnit.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          name: 'Facultad de Ingenieria Civil',
          code: 'FIC',
          description: null,
          type: 'FACULTY',
          headId: 'user-head',
          isActive: true,
        },
      }),
    );
    expect(prisma.eventProgram.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          name: 'Programa de Eventos - Facultad de Ingenieria Civil',
          description: 'Programa predeterminado de Facultad de Ingenieria Civil.',
          organizationalUnitId: 'unit-001',
          isDefault: true,
          status: 'ACTIVE',
        },
      }),
    );
  });

  it('translates a unique constraint race into a conflict', async () => {
    const prisma = createPrismaMock();
    prisma.organizationalUnit.findUnique.mockResolvedValue(null);
    prisma.$transaction.mockRejectedValue({ code: 'P2002' });
    const { createOrganizationalUnit } = await loadService(prisma);

    await expect(createOrganizationalUnit(createInput)).rejects.toMatchObject({
      statusCode: 409,
      message: 'Organizational unit code already exists.',
    });
  });

  it('propagates transaction failures keeping both writes in one transaction', async () => {
    const prisma = createPrismaMock();
    prisma.organizationalUnit.findUnique.mockResolvedValue(null);
    prisma.organizationalUnit.create.mockResolvedValue({ id: 'unit-001' });
    prisma.eventProgram.create.mockRejectedValue(new Error('default program failed'));
    const { createOrganizationalUnit } = await loadService(prisma);

    await expect(createOrganizationalUnit(createInput)).rejects.toThrow('default program failed');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.organizationalUnit.create).toHaveBeenCalledTimes(1);
    expect(prisma.eventProgram.create).toHaveBeenCalledTimes(1);
  });

  it('updates only the provided fields', async () => {
    const prisma = createPrismaMock();
    prisma.organizationalUnit.findUnique.mockResolvedValue({ id: 'unit-001' });
    prisma.organizationalUnit.update.mockResolvedValue(detailRecord);
    const { updateOrganizationalUnit } = await loadService(prisma);

    await updateOrganizationalUnit('unit-001', { description: 'Nueva descripcion' });

    expect(prisma.organizationalUnit.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'unit-001' },
        data: { description: 'Nueva descripcion' },
      }),
    );
  });

  it('clears the head when headId is null', async () => {
    const prisma = createPrismaMock();
    prisma.organizationalUnit.findUnique.mockResolvedValue({ id: 'unit-001' });
    prisma.organizationalUnit.update.mockResolvedValue(detailRecord);
    const { updateOrganizationalUnit } = await loadService(prisma);

    await updateOrganizationalUnit('unit-001', { headId: null });

    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.organizationalUnit.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { headId: null } }),
    );
  });

  it('fails updating a missing unit', async () => {
    const prisma = createPrismaMock();
    prisma.organizationalUnit.findUnique.mockResolvedValue(null);
    const { updateOrganizationalUnit } = await loadService(prisma);

    await expect(updateOrganizationalUnit('missing', { name: 'Nueva' })).rejects.toMatchObject({
      statusCode: 404,
      message: 'Organizational unit not found.',
    });
    expect(prisma.organizationalUnit.update).not.toHaveBeenCalled();
  });

  it('rejects an unknown head on update', async () => {
    const prisma = createPrismaMock();
    prisma.organizationalUnit.findUnique.mockResolvedValue({ id: 'unit-001' });
    prisma.user.findUnique.mockResolvedValue(null);
    const { updateOrganizationalUnit } = await loadService(prisma);

    await expect(
      updateOrganizationalUnit('unit-001', { headId: 'user-missing' }),
    ).rejects.toMatchObject({ statusCode: 404, message: 'User not found.' });
    expect(prisma.organizationalUnit.update).not.toHaveBeenCalled();
  });

  it('deactivates the unit and archives its default program in order', async () => {
    const prisma = createPrismaMock();
    prisma.organizationalUnit.findUnique
      .mockResolvedValueOnce({
        id: 'unit-001',
        isActive: true,
        eventPrograms: [{ id: 'program-001' }],
      })
      .mockResolvedValueOnce({
        ...detailRecord,
        isActive: false,
        eventPrograms: [{ ...detailRecord.eventPrograms[0], status: 'ARCHIVED' }],
      });
    prisma.activity.count.mockResolvedValue(0);
    const { deactivateOrganizationalUnit } = await loadService(prisma);

    const detail = await deactivateOrganizationalUnit('unit-001');

    expect(detail.isActive).toBe(false);
    expect(detail.defaultProgram).toEqual({
      id: 'program-001',
      name: 'Programa de Eventos - Facultad de Ingenieria Civil',
      status: 'ARCHIVED',
    });
    expect(prisma.organizationalUnit.update.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.eventProgram.update.mock.invocationCallOrder[0] as number,
    );
    expect(prisma.eventProgram.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'program-001' },
        data: expect.objectContaining({ status: 'ARCHIVED' }),
      }),
    );
  });

  it('fails deactivating a missing unit', async () => {
    const prisma = createPrismaMock();
    prisma.organizationalUnit.findUnique.mockResolvedValue(null);
    const { deactivateOrganizationalUnit } = await loadService(prisma);

    await expect(deactivateOrganizationalUnit('missing')).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('rejects deactivating an inactive unit', async () => {
    const prisma = createPrismaMock();
    prisma.organizationalUnit.findUnique.mockResolvedValue({
      id: 'unit-001',
      isActive: false,
      eventPrograms: [{ id: 'program-001' }],
    });
    const { deactivateOrganizationalUnit } = await loadService(prisma);

    await expect(deactivateOrganizationalUnit('unit-001')).rejects.toMatchObject({
      statusCode: 409,
      message: 'Organizational unit is already inactive.',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a unit without a default program', async () => {
    const prisma = createPrismaMock();
    prisma.organizationalUnit.findUnique.mockResolvedValue({
      id: 'unit-001',
      isActive: true,
      eventPrograms: [],
    });
    const { deactivateOrganizationalUnit } = await loadService(prisma);

    await expect(deactivateOrganizationalUnit('unit-001')).rejects.toMatchObject({
      statusCode: 409,
      message: 'Organizational unit does not have a default event program.',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects deactivation with scheduled or ongoing activities', async () => {
    const prisma = createPrismaMock();
    prisma.organizationalUnit.findUnique.mockResolvedValue({
      id: 'unit-001',
      isActive: true,
      eventPrograms: [{ id: 'program-001' }],
    });
    prisma.activity.count.mockResolvedValue(2);
    const { deactivateOrganizationalUnit } = await loadService(prisma);

    await expect(deactivateOrganizationalUnit('unit-001')).rejects.toMatchObject({
      statusCode: 409,
      message:
        'Cannot deactivate an organizational unit whose default event program has scheduled or ongoing activities.',
    });
    expect(prisma.activity.count).toHaveBeenCalledWith({
      where: { eventProgramId: 'program-001', status: { in: ['SCHEDULED', 'ONGOING'] } },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('reactivates the unit and lets the database trigger restore the program', async () => {
    const prisma = createPrismaMock();
    prisma.organizationalUnit.findUnique
      .mockResolvedValueOnce({
        id: 'unit-001',
        isActive: false,
        eventPrograms: [{ id: 'program-001' }],
      })
      .mockResolvedValueOnce(detailRecord);
    const { reactivateOrganizationalUnit } = await loadService(prisma);

    const detail = await reactivateOrganizationalUnit('unit-001');

    expect(detail.isActive).toBe(true);
    expect(detail.defaultProgram?.status).toBe('ACTIVE');
    expect(prisma.organizationalUnit.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'unit-001' }, data: { isActive: true } }),
    );
    expect(prisma.eventProgram.update).not.toHaveBeenCalled();
  });

  it('fails reactivating a missing unit', async () => {
    const prisma = createPrismaMock();
    prisma.organizationalUnit.findUnique.mockResolvedValue(null);
    const { reactivateOrganizationalUnit } = await loadService(prisma);

    await expect(reactivateOrganizationalUnit('missing')).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('rejects reactivating an active unit', async () => {
    const prisma = createPrismaMock();
    prisma.organizationalUnit.findUnique.mockResolvedValue({
      id: 'unit-001',
      isActive: true,
      eventPrograms: [{ id: 'program-001' }],
    });
    const { reactivateOrganizationalUnit } = await loadService(prisma);

    await expect(reactivateOrganizationalUnit('unit-001')).rejects.toMatchObject({
      statusCode: 409,
      message: 'Organizational unit is already active.',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects reactivating a unit without a default program', async () => {
    const prisma = createPrismaMock();
    prisma.organizationalUnit.findUnique.mockResolvedValue({
      id: 'unit-001',
      isActive: false,
      eventPrograms: [],
    });
    const { reactivateOrganizationalUnit } = await loadService(prisma);

    await expect(reactivateOrganizationalUnit('unit-001')).rejects.toMatchObject({
      statusCode: 409,
      message: 'Organizational unit does not have a default event program.',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
