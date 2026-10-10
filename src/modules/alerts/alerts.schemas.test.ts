import { describe, expect, it } from 'vitest';

import {
  alertParamsSchema,
  alertSchema,
  listAlertsQuerySchema,
  markAlertReadSchema,
  markAllAlertsReadResultSchema,
  markAllAlertsReadSchema,
  paginatedAlertsSchema,
} from './alerts.schemas.js';

describe('listAlertsQuerySchema', () => {
  it('applies pagination defaults', () => {
    expect(listAlertsQuerySchema.parse({ query: {} })).toEqual({
      query: { page: 1, limit: 20 },
    });
  });

  it('coerces and validates pagination bounds', () => {
    expect(listAlertsQuerySchema.parse({ query: { page: '2', limit: '50' } })).toEqual({
      query: { page: 2, limit: 50 },
    });
    expect(() => listAlertsQuerySchema.parse({ query: { limit: '51' } })).toThrow();
    expect(() => listAlertsQuerySchema.parse({ query: { page: '0' } })).toThrow();
    expect(() => listAlertsQuerySchema.parse({ query: { page: 'x' } })).toThrow();
  });

  it('converts the literal isRead filter into a boolean', () => {
    expect(listAlertsQuerySchema.parse({ query: { isRead: 'true' } })).toEqual({
      query: { page: 1, limit: 20, isRead: true },
    });
    expect(listAlertsQuerySchema.parse({ query: { isRead: 'false' } })).toEqual({
      query: { page: 1, limit: 20, isRead: false },
    });
  });

  it('rejects a non literal isRead filter', () => {
    expect(() => listAlertsQuerySchema.parse({ query: { isRead: '1' } })).toThrow();
    expect(() => listAlertsQuerySchema.parse({ query: { isRead: 'yes' } })).toThrow();
    expect(() => listAlertsQuerySchema.parse({ query: { isRead: '' } })).toThrow();
  });

  it('accepts every alert type and rejects unknown ones', () => {
    const types = [
      'PROPOSAL_RECEIVED',
      'PROPOSAL_UPDATED',
      'PROPOSAL_RESPONDED',
      'PROGRAM_UPDATED',
      'PROGRAM_ARCHIVED',
      'ACTIVITY_UPDATED',
      'ACTIVITY_CANCELLED',
      'CERTIFICATE_ISSUED',
    ] as const;

    for (const type of types) {
      expect(listAlertsQuerySchema.parse({ query: { type } })).toEqual({
        query: { page: 1, limit: 20, type },
      });
    }

    expect(() => listAlertsQuerySchema.parse({ query: { type: 'PROPOSAL_SENT' } })).toThrow();
  });

  it('rejects unknown query keys including recipient impersonation', () => {
    expect(() => listAlertsQuerySchema.parse({ query: { userId: 'user-002' } })).toThrow();
    expect(() => listAlertsQuerySchema.parse({ query: { recipientId: 'user-002' } })).toThrow();
    expect(() => listAlertsQuerySchema.parse({ query: { status: 'UNREAD' } })).toThrow();
  });
});

describe('alertParamsSchema', () => {
  it('trims a valid alert id', () => {
    expect(alertParamsSchema.parse({ params: { id: '  alert-001  ' } })).toEqual({
      params: { id: 'alert-001' },
    });
  });

  it('rejects an empty or oversized alert id', () => {
    expect(() => alertParamsSchema.parse({ params: { id: '   ' } })).toThrow();
    expect(() => alertParamsSchema.parse({ params: { id: 'a'.repeat(101) } })).toThrow();
  });
});

describe('mark alert schemas', () => {
  it('accepts an absent or empty body', () => {
    expect(markAlertReadSchema.parse({ params: { id: 'alert-001' }, body: undefined })).toEqual({
      params: { id: 'alert-001' },
      body: undefined,
    });
    expect(markAlertReadSchema.parse({ params: { id: 'alert-001' }, body: {} })).toEqual({
      params: { id: 'alert-001' },
      body: {},
    });
    expect(markAllAlertsReadSchema.parse({ body: {} })).toEqual({ body: {} });
  });

  it('rejects unexpected body keys', () => {
    expect(() =>
      markAlertReadSchema.parse({ params: { id: 'alert-001' }, body: { isRead: true } }),
    ).toThrow();
    expect(() => markAllAlertsReadSchema.parse({ body: { recipientId: 'user-002' } })).toThrow();
  });
});

describe('alertSchema', () => {
  it('describes every target kind and hides internal columns', () => {
    const targets = [
      { kind: 'PROPOSAL', id: 'proposal-001' },
      { kind: 'EVENT_PROGRAM', id: 'program-001' },
      { kind: 'ACTIVITY', id: 'activity-001' },
      { kind: 'CERTIFICATE', id: 'certificate-001' },
    ] as const;

    for (const target of targets) {
      const alert = {
        id: 'alert-001',
        type: 'ACTIVITY_UPDATED',
        isRead: false,
        createdAt: '2026-10-04T14:05:00.000Z',
        target,
      };

      expect(alertSchema.parse(alert)).toEqual(alert);
    }
  });

  it('strips the recipient and the nullable target columns', () => {
    const parsed = alertSchema.parse({
      id: 'alert-001',
      type: 'ACTIVITY_CANCELLED',
      isRead: true,
      createdAt: '2026-10-04T14:05:00.000Z',
      target: { kind: 'ACTIVITY', id: 'activity-001' },
      recipientId: 'user-002',
      proposalId: null,
      eventProgramId: null,
      activityId: 'activity-001',
      certificateId: null,
    });

    expect(parsed).toEqual({
      id: 'alert-001',
      type: 'ACTIVITY_CANCELLED',
      isRead: true,
      createdAt: '2026-10-04T14:05:00.000Z',
      target: { kind: 'ACTIVITY', id: 'activity-001' },
    });
    expect(JSON.stringify(parsed)).not.to.include('recipientId');
  });

  it('rejects an unknown target kind and a malformed timestamp', () => {
    expect(() =>
      alertSchema.parse({
        id: 'alert-001',
        type: 'ACTIVITY_UPDATED',
        isRead: false,
        createdAt: '2026-10-04T14:05:00.000Z',
        target: { kind: 'USER', id: 'user-001' },
      }),
    ).toThrow();

    expect(() =>
      alertSchema.parse({
        id: 'alert-001',
        type: 'ACTIVITY_UPDATED',
        isRead: false,
        createdAt: '2026-10-04',
        target: { kind: 'ACTIVITY', id: 'activity-001' },
      }),
    ).toThrow();
  });
});

describe('paginatedAlertsSchema', () => {
  it('describes the page envelope', () => {
    expect(
      paginatedAlertsSchema.parse({
        items: [],
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0,
      }),
    ).toEqual({ items: [], page: 1, limit: 20, total: 0, totalPages: 0 });
  });
});

describe('markAllAlertsReadResultSchema', () => {
  it('describes the updated count', () => {
    expect(markAllAlertsReadResultSchema.parse({ updatedCount: 3 })).toEqual({ updatedCount: 3 });
  });
});
