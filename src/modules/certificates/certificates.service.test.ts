import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ListMyCertificatesQuery } from './certificates.schemas.js';
import { listMyCertificates } from './certificates.service.js';

interface PrismaMock {
  certificate: {
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
}

const prismaMock: PrismaMock = {
  certificate: {
    findMany: vi.fn(),
    count: vi.fn(),
  },
};

vi.mock('../../config/prisma.js', () => ({
  getPrismaClient: () => prismaMock,
}));

const record = {
  id: 'cert-001',
  code: 'CERT-8F3A2B',
  issuedAt: new Date('2026-09-07T14:05:00.000Z'),
  attendance: {
    activity: {
      id: 'activity-001',
      name: 'Workshop de Ciberseguridad Defensiva',
      date: new Date('2026-09-07T00:00:00.000Z'),
      type: 'WORKSHOP',
      eventProgram: { id: 'program-001', name: 'Programa de Eventos - FISC' },
    },
  },
};

const baseQuery: ListMyCertificatesQuery = { page: 1, limit: 20 };

describe('listMyCertificates', () => {
  beforeEach(() => {
    prismaMock.certificate.findMany.mockReset().mockResolvedValue([record]);
    prismaMock.certificate.count.mockReset().mockResolvedValue(1);
  });

  it('always scopes the query to the authenticated user', async () => {
    await listMyCertificates('user-001', baseQuery);

    expect(prismaMock.certificate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { attendance: { userId: 'user-001' } } }),
    );
  });

  it('never selects storage or attendance internals', async () => {
    await listMyCertificates('user-001', baseQuery);

    const args = prismaMock.certificate.findMany.mock.calls[0]?.[0] as {
      select: Record<string, unknown>;
    };
    const serializedSelect = JSON.stringify(args.select);

    expect(serializedSelect).toContain('code');
    expect(serializedSelect).toContain('issuedAt');
    expect(serializedSelect).not.toContain('pdfUrl');
    expect(serializedSelect).not.toContain('attendanceId');
  });

  it('orders by issuedAt descending with a stable id tiebreaker', async () => {
    await listMyCertificates('user-001', baseQuery);

    expect(prismaMock.certificate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ issuedAt: 'desc' }, { id: 'asc' }] }),
    );
  });

  it('maps the nested record into the public summary', async () => {
    const result = await listMyCertificates('user-001', baseQuery);

    expect(result.items).toEqual([
      {
        id: 'cert-001',
        code: 'CERT-8F3A2B',
        issuedAt: '2026-09-07T14:05:00.000Z',
        activity: {
          id: 'activity-001',
          name: 'Workshop de Ciberseguridad Defensiva',
          date: '2026-09-07',
          type: 'WORKSHOP',
        },
        eventProgram: { id: 'program-001', name: 'Programa de Eventos - FISC' },
      },
    ]);
    expect(result).toMatchObject({ page: 1, limit: 20, total: 1, totalPages: 1 });
  });

  it('applies the offset pagination window', async () => {
    await listMyCertificates('user-001', { page: 3, limit: 5 });

    expect(prismaMock.certificate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 10, take: 5 }),
    );
  });

  it('filters by activity', async () => {
    await listMyCertificates('user-001', { ...baseQuery, activityId: 'activity-001' });

    expect(prismaMock.certificate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { attendance: { userId: 'user-001', activityId: 'activity-001' } },
      }),
    );
  });

  it('filters by event program through the attendance activity', async () => {
    await listMyCertificates('user-001', { ...baseQuery, eventProgramId: 'program-001' });

    expect(prismaMock.certificate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          attendance: { userId: 'user-001', activity: { eventProgramId: 'program-001' } },
        },
      }),
    );
  });

  it('translates the issued range into institutional day bounds', async () => {
    await listMyCertificates('user-001', {
      ...baseQuery,
      issuedFrom: '2026-08-26',
      issuedTo: '2026-09-07',
    });

    expect(prismaMock.certificate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          attendance: { userId: 'user-001' },
          issuedAt: {
            gte: new Date('2026-08-26T05:00:00.000Z'),
            lt: new Date('2026-09-08T05:00:00.000Z'),
          },
        },
      }),
    );
  });

  it('applies a single sided issued range', async () => {
    await listMyCertificates('user-001', { ...baseQuery, issuedFrom: '2026-08-26' });

    expect(prismaMock.certificate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          attendance: { userId: 'user-001' },
          issuedAt: { gte: new Date('2026-08-26T05:00:00.000Z') },
        },
      }),
    );
  });

  it('applies only the lower bound when issuedTo is present alone', async () => {
    await listMyCertificates('user-001', { ...baseQuery, issuedTo: '2026-09-07' });

    expect(prismaMock.certificate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          attendance: { userId: 'user-001' },
          issuedAt: { lt: new Date('2026-09-08T05:00:00.000Z') },
        },
      }),
    );
  });

  it('combines every filter at once', async () => {
    await listMyCertificates('user-001', {
      page: 1,
      limit: 20,
      eventProgramId: 'program-001',
      activityId: 'activity-001',
      issuedFrom: '2026-08-26',
      issuedTo: '2026-09-07',
    });

    expect(prismaMock.certificate.count).toHaveBeenCalledWith({
      where: {
        attendance: {
          userId: 'user-001',
          activityId: 'activity-001',
          activity: { eventProgramId: 'program-001' },
        },
        issuedAt: {
          gte: new Date('2026-08-26T05:00:00.000Z'),
          lt: new Date('2026-09-08T05:00:00.000Z'),
        },
      },
    });
  });

  it('reports zero total pages for an empty result', async () => {
    prismaMock.certificate.findMany.mockResolvedValue([]);
    prismaMock.certificate.count.mockResolvedValue(0);

    const result = await listMyCertificates('user-001', baseQuery);

    expect(result).toEqual({ items: [], page: 1, limit: 20, total: 0, totalPages: 0 });
  });

  it('rounds the total pages up', async () => {
    prismaMock.certificate.findMany.mockResolvedValue([]);
    prismaMock.certificate.count.mockResolvedValue(21);

    const result = await listMyCertificates('user-001', { page: 1, limit: 10 });

    expect(result.totalPages).toBe(3);
  });

  it('counts with the same filter as the listing', async () => {
    await listMyCertificates('user-001', { ...baseQuery, activityId: 'activity-001' });

    expect(prismaMock.certificate.count).toHaveBeenCalledWith({
      where: { attendance: { userId: 'user-001', activityId: 'activity-001' } },
    });
  });
});
