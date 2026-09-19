import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CreateEventProgramBody } from './event-programs.schemas.js';

interface PrismaMock {
  organizationalUnit: { findUnique: ReturnType<typeof vi.fn> };
  eventProgram: { create: ReturnType<typeof vi.fn> };
}

const createPrismaMock = (): PrismaMock => ({
  organizationalUnit: { findUnique: vi.fn() },
  eventProgram: { create: vi.fn() },
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
