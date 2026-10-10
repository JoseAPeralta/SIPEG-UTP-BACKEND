import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AlertType } from '../../generated/prisma/enums.js';
import {
  createAlert,
  getAlertById,
  listAlerts,
  markAlertRead,
  markAllAlertsRead,
} from './alerts.service.js';
import type { CreateAlertInput } from './alerts.types.js';

interface AlertClientMock {
  alert: {
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
}

const createPrismaMock = (): AlertClientMock => ({
  alert: {
    findMany: vi.fn(),
    count: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    create: vi.fn(),
  },
});

const prismaMock = createPrismaMock();

vi.mock('../../config/prisma.js', () => ({
  getPrismaClient: () => prismaMock,
}));

const baseQuery = { page: 1, limit: 20 };

interface AlertRecord {
  id: string;
  type: AlertType;
  isRead: boolean;
  createdAt: Date;
  proposalId: string | null;
  eventProgramId: string | null;
  activityId: string | null;
  certificateId: string | null;
}

const alertRecord = (overrides: Partial<AlertRecord> = {}): AlertRecord => ({
  id: 'alert-001',
  type: 'ACTIVITY_UPDATED',
  isRead: false,
  createdAt: new Date('2026-10-04T14:05:00.000Z'),
  proposalId: null,
  eventProgramId: null,
  activityId: 'activity-001',
  certificateId: null,
  ...overrides,
});

const expectedResponse = {
  id: 'alert-001',
  type: 'ACTIVITY_UPDATED',
  isRead: false,
  createdAt: '2026-10-04T14:05:00.000Z',
  target: { kind: 'ACTIVITY', id: 'activity-001' },
};

const createTxMock = () => ({ alert: { create: vi.fn().mockResolvedValue({ id: 'alert-001' }) } });

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.alert.findMany.mockResolvedValue([alertRecord()]);
  prismaMock.alert.count.mockResolvedValue(1);
  prismaMock.alert.findUnique.mockResolvedValue(alertRecord());
  prismaMock.alert.update.mockResolvedValue(alertRecord({ isRead: true }));
  prismaMock.alert.updateMany.mockResolvedValue({ count: 2 });
});

describe('listAlerts', () => {
  it('always scopes the query to the recipient and combines the filters', async () => {
    await listAlerts('user-001', { ...baseQuery, isRead: false, type: 'ACTIVITY_UPDATED' });

    expect(prismaMock.alert.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { recipientId: 'user-001', isRead: false, type: 'ACTIVITY_UPDATED' },
      }),
    );
    expect(prismaMock.alert.count).toHaveBeenCalledWith({
      where: { recipientId: 'user-001', isRead: false, type: 'ACTIVITY_UPDATED' },
    });
  });

  it('omits absent optional filters', async () => {
    await listAlerts('user-001', baseQuery);

    expect(prismaMock.alert.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { recipientId: 'user-001' } }),
    );
  });

  it('orders by createdAt descending with a stable id tiebreaker', async () => {
    await listAlerts('user-001', baseQuery);

    expect(prismaMock.alert.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ createdAt: 'desc' }, { id: 'asc' }] }),
    );
  });

  it('applies the offset pagination window', async () => {
    await listAlerts('user-001', { page: 3, limit: 5 });

    expect(prismaMock.alert.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 10, take: 5 }),
    );
  });

  it('maps the record into the public response and the page envelope', async () => {
    const result = await listAlerts('user-001', baseQuery);

    expect(result).toEqual({
      items: [expectedResponse],
      page: 1,
      limit: 20,
      total: 1,
      totalPages: 1,
    });
    expect(JSON.stringify(result)).not.to.include('recipientId');
    expect(JSON.stringify(result)).not.to.include('activityId');
  });

  it('returns an empty page with zero total pages', async () => {
    prismaMock.alert.findMany.mockResolvedValue([]);
    prismaMock.alert.count.mockResolvedValue(0);

    await expect(listAlerts('user-001', baseQuery)).resolves.toEqual({
      items: [],
      page: 1,
      limit: 20,
      total: 0,
      totalPages: 0,
    });
  });
});

describe('getAlertById', () => {
  it('looks up the alert by id and recipient in one scoped query', async () => {
    const result = await getAlertById('user-001', 'alert-001');

    expect(prismaMock.alert.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'alert-001', recipientId: 'user-001' } }),
    );
    expect(result).toEqual(expectedResponse);
  });

  it('responds 404 for a missing or foreign alert without leaking existence', async () => {
    prismaMock.alert.findUnique.mockResolvedValue(null);

    await expect(getAlertById('user-001', 'alert-999')).rejects.toMatchObject({
      statusCode: 404,
      message: 'Alert not found.',
    });
  });

  it('maps a proposal target', async () => {
    prismaMock.alert.findUnique.mockResolvedValue(
      alertRecord({
        type: 'PROPOSAL_RECEIVED',
        activityId: null,
        proposalId: 'proposal-001',
      }),
    );

    await expect(getAlertById('user-001', 'alert-001')).resolves.toMatchObject({
      target: { kind: 'PROPOSAL', id: 'proposal-001' },
    });
  });

  it('maps an event program target and a certificate target', async () => {
    prismaMock.alert.findUnique.mockResolvedValueOnce(
      alertRecord({
        type: 'PROGRAM_ARCHIVED',
        activityId: null,
        eventProgramId: 'program-001',
      }),
    );
    await expect(getAlertById('user-001', 'alert-001')).resolves.toMatchObject({
      target: { kind: 'EVENT_PROGRAM', id: 'program-001' },
    });

    prismaMock.alert.findUnique.mockResolvedValueOnce(
      alertRecord({
        type: 'CERTIFICATE_ISSUED',
        activityId: null,
        certificateId: 'certificate-001',
      }),
    );
    await expect(getAlertById('user-001', 'alert-001')).resolves.toMatchObject({
      target: { kind: 'CERTIFICATE', id: 'certificate-001' },
    });
  });

  it('fails closed when the stored alert has no target', async () => {
    prismaMock.alert.findUnique.mockResolvedValue(alertRecord({ activityId: null }));

    await expect(getAlertById('user-001', 'alert-001')).rejects.toMatchObject({
      statusCode: 500,
    });
  });
});

describe('markAlertRead', () => {
  it('updates the alert scoped by id and recipient', async () => {
    const result = await markAlertRead('user-001', 'alert-001');

    expect(prismaMock.alert.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'alert-001', recipientId: 'user-001' },
        data: { isRead: true },
      }),
    );
    expect(result).toMatchObject({ id: 'alert-001', isRead: true });
  });

  it('is idempotent when the alert was already read', async () => {
    prismaMock.alert.update.mockResolvedValue(alertRecord({ isRead: true }));

    await expect(markAlertRead('user-001', 'alert-001')).resolves.toMatchObject({ isRead: true });
  });

  it('translates an unscoped or foreign update into 404', async () => {
    prismaMock.alert.update.mockRejectedValue({ code: 'P2025' });

    await expect(markAlertRead('user-001', 'alert-999')).rejects.toMatchObject({
      statusCode: 404,
      message: 'Alert not found.',
    });
  });

  it('rethrows unexpected database errors', async () => {
    prismaMock.alert.update.mockRejectedValue(new Error('connection lost'));

    await expect(markAlertRead('user-001', 'alert-001')).rejects.toThrow('connection lost');
  });
});

describe('markAllAlertsRead', () => {
  it('updates only the unread alerts of the recipient', async () => {
    const result = await markAllAlertsRead('user-001');

    expect(prismaMock.alert.updateMany).toHaveBeenCalledWith({
      where: { recipientId: 'user-001', isRead: false },
      data: { isRead: true },
    });
    expect(result).toEqual({ updatedCount: 2 });
  });

  it('reports zero when nothing is unread', async () => {
    prismaMock.alert.updateMany.mockResolvedValue({ count: 0 });

    await expect(markAllAlertsRead('user-001')).resolves.toEqual({ updatedCount: 0 });
  });
});

describe('createAlert', () => {
  it('maps a proposal alert to the proposal column only', async () => {
    const tx = createTxMock();

    await createAlert(tx as never, {
      recipientId: 'user-001',
      type: 'PROPOSAL_RESPONDED',
      target: { kind: 'PROPOSAL', id: 'proposal-001' },
    });

    expect(tx.alert.create).toHaveBeenCalledTimes(1);
    expect(tx.alert.create).toHaveBeenCalledWith({
      data: { recipientId: 'user-001', type: 'PROPOSAL_RESPONDED', proposalId: 'proposal-001' },
    });
    expect(prismaMock.alert.create).not.toHaveBeenCalled();
  });

  it('maps a program alert to the event program column only', async () => {
    const tx = createTxMock();

    await createAlert(tx as never, {
      recipientId: 'user-001',
      type: 'PROGRAM_UPDATED',
      target: { kind: 'EVENT_PROGRAM', id: 'program-001' },
    });

    expect(tx.alert.create).toHaveBeenCalledWith({
      data: { recipientId: 'user-001', type: 'PROGRAM_UPDATED', eventProgramId: 'program-001' },
    });
  });

  it('maps an activity alert to the activity column only', async () => {
    const tx = createTxMock();

    await createAlert(tx as never, {
      recipientId: 'user-001',
      type: 'ACTIVITY_CANCELLED',
      target: { kind: 'ACTIVITY', id: 'activity-001' },
    });

    expect(tx.alert.create).toHaveBeenCalledWith({
      data: { recipientId: 'user-001', type: 'ACTIVITY_CANCELLED', activityId: 'activity-001' },
    });
  });

  it('maps a certificate alert to the certificate column only', async () => {
    const tx = createTxMock();

    await createAlert(tx as never, {
      recipientId: 'user-001',
      type: 'CERTIFICATE_ISSUED',
      target: { kind: 'CERTIFICATE', id: 'certificate-001' },
    });

    expect(tx.alert.create).toHaveBeenCalledWith({
      data: {
        recipientId: 'user-001',
        type: 'CERTIFICATE_ISSUED',
        certificateId: 'certificate-001',
      },
    });
  });

  it('never forces isRead or createdAt and never opens its own transaction', async () => {
    const tx = createTxMock();

    await createAlert(tx as never, {
      recipientId: 'user-001',
      type: 'ACTIVITY_UPDATED',
      target: { kind: 'ACTIVITY', id: 'activity-001' },
    });

    const data = (tx.alert.create.mock.calls[0]?.[0] as { data: Record<string, unknown> }).data;
    expect(Object.keys(data).sort()).toEqual(['activityId', 'recipientId', 'type']);
    expect(tx).not.toHaveProperty('$transaction');
  });

  it('propagates the insert failure so the caller transaction rolls back', async () => {
    const tx = createTxMock();
    tx.alert.create.mockRejectedValue(new Error('foreign key violation'));

    await expect(
      createAlert(tx as never, {
        recipientId: 'missing-user',
        type: 'ACTIVITY_CANCELLED',
        target: { kind: 'ACTIVITY', id: 'missing-activity' },
      }),
    ).rejects.toThrow('foreign key violation');
  });

  it('rejects mismatched type and target combinations at compile time', () => {
    const acceptCreateAlertInput = (input: CreateAlertInput): CreateAlertInput => input;

    // @ts-expect-error a program alert cannot target an activity
    acceptCreateAlertInput({
      recipientId: 'user-001',
      type: 'PROGRAM_UPDATED',
      target: { kind: 'ACTIVITY', id: 'activity-001' },
    });
    // @ts-expect-error a certificate alert cannot target a proposal
    acceptCreateAlertInput({
      recipientId: 'user-001',
      type: 'CERTIFICATE_ISSUED',
      target: { kind: 'PROPOSAL', id: 'proposal-001' },
    });
    // @ts-expect-error an activity alert cannot target a program
    acceptCreateAlertInput({
      recipientId: 'user-001',
      type: 'ACTIVITY_UPDATED',
      target: { kind: 'EVENT_PROGRAM', id: 'program-001' },
    });

    expect(acceptCreateAlertInput).toBeTypeOf('function');
  });
});

describe('alert isolation invariants', () => {
  it('never queries an alert by id without the recipient', async () => {
    await listAlerts('user-001', baseQuery);
    await getAlertById('user-001', 'alert-001');
    await markAlertRead('user-001', 'alert-001');

    const scopedCalls = [
      prismaMock.alert.findMany.mock.calls[0]?.[0] as { where: Record<string, unknown> },
      prismaMock.alert.findUnique.mock.calls[0]?.[0] as { where: Record<string, unknown> },
      prismaMock.alert.update.mock.calls[0]?.[0] as { where: Record<string, unknown> },
    ];

    for (const args of scopedCalls) {
      expect(args.where['recipientId']).toBe('user-001');
    }
  });
});
