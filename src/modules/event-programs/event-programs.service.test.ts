import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CreateEventProgramBody, UpdateEventProgramBody } from './event-programs.schemas.js';

interface PrismaMock {
  organizationalUnit: { findUnique: ReturnType<typeof vi.fn> };
  eventProgram: {
    count: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
}

const createPrismaMock = (): PrismaMock => ({
  organizationalUnit: { findUnique: vi.fn() },
  eventProgram: {
    count: vi.fn(),
    create: vi.fn(),
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
  },
});

const loadService = async (prisma: PrismaMock) => {
  vi.resetModules();
  vi.doMock('../../config/prisma.js', () => ({ getPrismaClient: () => prisma }));
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

describe('listEventPrograms', () => {
  afterEach(() => {
    vi.doUnmock('../../config/prisma.js');
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
});

describe('createEventProgram', () => {
  afterEach(() => {
    vi.doUnmock('../../config/prisma.js');
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
});

describe('updateEventProgram', () => {
  afterEach(() => {
    vi.doUnmock('../../config/prisma.js');
  });

  const storedRecord = {
    id: 'program-001',
    status: 'ACTIVE' as const,
    startDate: new Date('2026-10-12T00:00:00.000Z'),
    endDate: new Date('2026-10-16T00:00:00.000Z'),
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

  it('allows setting dates on a default program without stored dates', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({
      id: 'program-default',
      status: 'ACTIVE',
      startDate: null,
      endDate: null,
    });
    prisma.eventProgram.update.mockResolvedValue({
      ...updatedRecord,
      id: 'program-default',
      isDefault: true,
      startDate: new Date('2026-11-01T00:00:00.000Z'),
      endDate: new Date('2026-11-05T00:00:00.000Z'),
    });
    const { updateEventProgram } = await loadService(prisma);

    const result = await updateEventProgram('program-default', {
      startDate: '2026-11-01',
      endDate: '2026-11-05',
    });

    expect(prisma.eventProgram.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          startDate: new Date('2026-11-01T00:00:00.000Z'),
          endDate: new Date('2026-11-05T00:00:00.000Z'),
        },
      }),
    );
    expect(result.startDate).toBe('2026-11-01');
    expect(result.endDate).toBe('2026-11-05');
  });
});
