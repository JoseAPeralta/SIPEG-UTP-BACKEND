import { describe, expect, it } from 'vitest';

import {
  certificateSummarySchema,
  listMyCertificatesQuerySchema,
  paginatedMyCertificatesSchema,
} from './certificates.schemas.js';

describe('listMyCertificatesQuerySchema', () => {
  it('applies pagination defaults', () => {
    expect(listMyCertificatesQuerySchema.parse({ query: {} })).toEqual({
      query: { page: 1, limit: 20 },
    });
  });

  it('coerces and validates pagination bounds', () => {
    expect(listMyCertificatesQuerySchema.parse({ query: { page: '2', limit: '50' } })).toEqual({
      query: { page: 2, limit: 50 },
    });
    expect(() => listMyCertificatesQuerySchema.parse({ query: { limit: '51' } })).toThrow();
    expect(() => listMyCertificatesQuerySchema.parse({ query: { page: '0' } })).toThrow();
    expect(() => listMyCertificatesQuerySchema.parse({ query: { page: 'x' } })).toThrow();
  });

  it('trims the scope filters', () => {
    expect(
      listMyCertificatesQuerySchema.parse({
        query: { eventProgramId: '  program-001  ', activityId: '  activity-001  ' },
      }),
    ).toEqual({
      query: {
        page: 1,
        limit: 20,
        eventProgramId: 'program-001',
        activityId: 'activity-001',
      },
    });
  });

  it('rejects empty and oversized scope filters', () => {
    expect(() => listMyCertificatesQuerySchema.parse({ query: { activityId: '   ' } })).toThrow();
    expect(() =>
      listMyCertificatesQuerySchema.parse({ query: { eventProgramId: 'p'.repeat(101) } }),
    ).toThrow();
  });

  it('accepts well formed issued bounds and rejects impossible calendar dates', () => {
    expect(
      listMyCertificatesQuerySchema.parse({
        query: { issuedFrom: '2026-08-26', issuedTo: '2026-09-07' },
      }),
    ).toEqual({ query: { page: 1, limit: 20, issuedFrom: '2026-08-26', issuedTo: '2026-09-07' } });

    expect(() =>
      listMyCertificatesQuerySchema.parse({ query: { issuedFrom: '2026-02-30' } }),
    ).toThrow();
    expect(() =>
      listMyCertificatesQuerySchema.parse({ query: { issuedTo: '26-08-2026' } }),
    ).toThrow();
    expect(() =>
      listMyCertificatesQuerySchema.parse({ query: { issuedFrom: ' 2026-08-26 ' } }),
    ).toThrow();
  });

  it('rejects an inverted issued range pointing at issuedTo', () => {
    const result = listMyCertificatesQuerySchema.safeParse({
      query: { issuedFrom: '2026-09-07', issuedTo: '2026-08-26' },
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['query', 'issuedTo']);
    expect(result.error?.issues[0]?.message).toBe('issuedFrom cannot be after issuedTo.');
  });

  it('accepts a single sided issued range', () => {
    expect(listMyCertificatesQuerySchema.parse({ query: { issuedFrom: '2026-09-07' } })).toEqual({
      query: { page: 1, limit: 20, issuedFrom: '2026-09-07' },
    });
  });

  it('rejects unknown query keys', () => {
    expect(() => listMyCertificatesQuerySchema.parse({ query: { userId: 'other' } })).toThrow();
    expect(() => listMyCertificatesQuerySchema.parse({ query: { status: 'ISSUED' } })).toThrow();
  });
});

describe('certificateSummarySchema', () => {
  it('describes a certificate with its activity and event program', () => {
    const certificate = {
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
    };

    expect(certificateSummarySchema.parse(certificate)).toEqual(certificate);
  });

  it('strips storage and attendance internals from a certificate', () => {
    const parsed = certificateSummarySchema.parse({
      id: 'cert-001',
      code: 'CERT-8F3A2B',
      issuedAt: '2026-09-07T14:05:00.000Z',
      activity: {
        id: 'activity-001',
        name: 'Workshop',
        date: '2026-09-07',
        type: 'WORKSHOP',
      },
      eventProgram: { id: 'program-001', name: 'Programa' },
      pdfUrl: '/certificates/CERT-8F3A2B.pdf',
      attendanceId: 'attendance-001',
    });

    expect(parsed).toEqual({
      id: 'cert-001',
      code: 'CERT-8F3A2B',
      issuedAt: '2026-09-07T14:05:00.000Z',
      activity: {
        id: 'activity-001',
        name: 'Workshop',
        date: '2026-09-07',
        type: 'WORKSHOP',
      },
      eventProgram: { id: 'program-001', name: 'Programa' },
    });
  });
});

describe('paginatedMyCertificatesSchema', () => {
  it('describes the page envelope', () => {
    expect(
      paginatedMyCertificatesSchema.parse({
        items: [],
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0,
      }),
    ).toEqual({ items: [], page: 1, limit: 20, total: 0, totalPages: 0 });
  });
});
