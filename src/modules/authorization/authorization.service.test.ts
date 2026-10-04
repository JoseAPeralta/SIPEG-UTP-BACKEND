import { afterEach, describe, expect, it, vi } from 'vitest';

import type { GrantEnvelope } from './authorization.types.js';
import { PERMISSIONS, PERMISSION_NAMES, type PermissionName } from './permissions.js';

interface GrantRecord {
  validFrom: Date | null;
  validUntil: Date | null;
  permission: { name: string };
}

interface CollaborationRecord {
  eventProgramId?: string | null;
  activityId?: string | null;
  permissions: GrantRecord[];
}

interface PrismaMock {
  collaboration: { findMany: ReturnType<typeof vi.fn> };
  collaborationPermission: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
  };
  activity: { findUnique: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
  eventProgram: { findUnique: ReturnType<typeof vi.fn>; findMany: ReturnType<typeof vi.fn> };
}

const createPrismaMock = (): PrismaMock => ({
  collaboration: { findMany: vi.fn() },
  collaborationPermission: { create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
  activity: { findUnique: vi.fn(), findMany: vi.fn() },
  eventProgram: { findUnique: vi.fn(), findMany: vi.fn() },
});

const loadService = async (prisma: PrismaMock) => {
  vi.resetModules();
  vi.doMock('../../config/prisma.js', () => ({
    getPrismaClient: () => prisma,
  }));

  return import('./authorization.service.js');
};

const buildUser = (
  overrides: Partial<Express.AuthenticatedUser> = {},
): Express.AuthenticatedUser => ({
  id: 'user-001',
  email: 'user@example.com',
  globalRole: 'USER',
  unitId: null,
  careerId: null,
  isActive: true,
  ...overrides,
});

const grant = (
  name: PermissionName,
  validFrom: Date | null = null,
  validUntil: Date | null = null,
): GrantRecord => ({
  validFrom,
  validUntil,
  permission: { name },
});

const collaboration = (...permissions: GrantRecord[]): CollaborationRecord => ({ permissions });

const scopedCollaboration = (
  scope: { eventProgramId?: string; activityId?: string },
  ...permissions: GrantRecord[]
): CollaborationRecord => ({ ...scope, permissions });

const NOW = new Date('2026-09-19T12:00:00.000Z');

const scopeUnit = { id: 'unit-001', name: 'Facultad de Ingenieria', type: 'FACULTY' as const };

const scopeProgram = (
  overrides: Partial<{
    id: string;
    name: string;
    label: string | null;
    status: 'DRAFT' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED' | 'ARCHIVED';
  }> = {},
) => ({
  id: 'program-001',
  name: 'Programa Uno',
  label: null,
  status: 'ACTIVE' as const,
  organizationalUnit: scopeUnit,
  ...overrides,
});

const scopeActivity = (
  overrides: Partial<{
    id: string;
    name: string;
    status: 'DRAFT' | 'SCHEDULED' | 'CANCELLED';
  }> = {},
) => ({
  id: 'activity-001',
  name: 'Actividad Uno',
  status: 'SCHEDULED' as const,
  date: new Date('2026-09-19T00:00:00.000Z'),
  startTime: new Date('1970-01-01T02:00:00.000Z'),
  endTime: new Date('1970-01-01T03:00:00.000Z'),
  eventProgram: scopeProgram(),
  ...overrides,
});

const programScopeCollaboration = (
  program: ReturnType<typeof scopeProgram>,
  ...permissions: GrantRecord[]
) => ({
  eventProgramId: program.id,
  activityId: null,
  eventProgram: program,
  activity: null,
  permissions,
});

const activityScopeCollaboration = (
  activity: ReturnType<typeof scopeActivity>,
  ...permissions: GrantRecord[]
) => ({
  eventProgramId: null,
  activityId: activity.id,
  eventProgram: null,
  activity,
  permissions,
});

describe('authorization service', () => {
  afterEach(() => {
    vi.doUnmock('../../config/prisma.js');
  });

  it('resolves the parent program when only an activityId is given', async () => {
    const prisma = createPrismaMock();
    prisma.activity.findUnique.mockResolvedValue({ eventProgramId: 'program-001' });
    prisma.collaboration.findMany.mockResolvedValue([]);
    const { resolveScope } = await loadService(prisma);

    const scope = await resolveScope({ activityId: 'activity-001' });

    expect(scope).toEqual({ eventProgramId: 'program-001', activityId: 'activity-001' });
    expect(prisma.activity.findUnique).toHaveBeenCalledWith({
      where: { id: 'activity-001' },
      select: { eventProgramId: true },
    });
  });

  it('throws 404 when the activity does not exist', async () => {
    const prisma = createPrismaMock();
    prisma.activity.findUnique.mockResolvedValue(null);
    const { resolveScope } = await loadService(prisma);

    await expect(resolveScope({ activityId: 'missing' })).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('rejects an empty scope', async () => {
    const prisma = createPrismaMock();
    const { resolveScope } = await loadService(prisma);

    await expect(resolveScope({})).rejects.toMatchObject({ statusCode: 400 });
  });

  it('queries program and activity collaborations for the user', async () => {
    const prisma = createPrismaMock();
    prisma.activity.findUnique.mockResolvedValue({ eventProgramId: 'program-001' });
    prisma.collaboration.findMany.mockResolvedValue([]);
    const { getEffectivePermissions } = await loadService(prisma);

    await getEffectivePermissions(buildUser(), { activityId: 'activity-001' }, NOW);

    expect(prisma.collaboration.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'user-001',
          OR: [{ eventProgramId: 'program-001' }, { activityId: 'activity-001' }],
        },
      }),
    );
  });

  it('unions activity-local and inherited program grants', async () => {
    const prisma = createPrismaMock();
    prisma.activity.findUnique.mockResolvedValue({ eventProgramId: 'program-001' });
    prisma.collaboration.findMany.mockResolvedValue([
      collaboration(grant(PERMISSIONS.PROGRAM_READ)),
      collaboration(grant(PERMISSIONS.ATTENDANCE_CHECKIN)),
    ]);
    const { getEffectivePermissions } = await loadService(prisma);

    const permissions = await getEffectivePermissions(
      buildUser(),
      { activityId: 'activity-001' },
      NOW,
    );

    expect(permissions).toEqual(
      new Set([PERMISSIONS.PROGRAM_READ, PERMISSIONS.ATTENDANCE_CHECKIN]),
    );
  });

  it('ignores expired grants', async () => {
    const prisma = createPrismaMock();
    prisma.collaboration.findMany.mockResolvedValue([
      collaboration(
        grant(PERMISSIONS.ACTIVITY_UPDATE, null, new Date('2026-09-19T11:59:59.000Z')),
        grant(PERMISSIONS.ACTIVITY_READ, null, new Date('2026-09-19T12:00:01.000Z')),
      ),
    ]);
    const { getEffectivePermissions } = await loadService(prisma);

    const permissions = await getEffectivePermissions(buildUser(), { eventProgramId: 'p1' }, NOW);

    expect(permissions.has(PERMISSIONS.ACTIVITY_UPDATE)).toBe(false);
    expect(permissions.has(PERMISSIONS.ACTIVITY_READ)).toBe(true);
  });

  it('ignores grants that start in the future', async () => {
    const prisma = createPrismaMock();
    prisma.collaboration.findMany.mockResolvedValue([
      collaboration(grant(PERMISSIONS.ACTIVITY_UPDATE, new Date('2026-09-19T12:00:01.000Z'))),
    ]);
    const { getEffectivePermissions } = await loadService(prisma);

    const permissions = await getEffectivePermissions(buildUser(), { eventProgramId: 'p1' }, NOW);

    expect(permissions.size).toBe(0);
  });

  it('ignores unknown permission names coming from the database', async () => {
    const prisma = createPrismaMock();
    prisma.collaboration.findMany.mockResolvedValue([
      collaboration(grant('legacy:unknown' as PermissionName)),
    ]);
    const { getEffectivePermissions } = await loadService(prisma);

    const permissions = await getEffectivePermissions(buildUser(), { eventProgramId: 'p1' }, NOW);

    expect(permissions.size).toBe(0);
  });

  it('returns every permission for ADMIN without querying collaborations', async () => {
    const prisma = createPrismaMock();
    const { getEffectivePermissions } = await loadService(prisma);

    const permissions = await getEffectivePermissions(
      buildUser({ globalRole: 'ADMIN' }),
      { eventProgramId: 'p1' },
      NOW,
    );

    expect(permissions.size).toBe(PERMISSION_NAMES.length);
    expect(permissions.has(PERMISSIONS.PERMISSION_GRANT)).toBe(true);
    expect(prisma.collaboration.findMany).not.toHaveBeenCalled();
  });

  it('builds an unbounded envelope when any grant is unbounded', async () => {
    const prisma = createPrismaMock();
    prisma.collaboration.findMany.mockResolvedValue([
      collaboration(
        grant(PERMISSIONS.ACTIVITY_UPDATE, new Date('2026-09-01T00:00:00.000Z')),
        grant(PERMISSIONS.ACTIVITY_UPDATE),
      ),
    ]);
    const { getPermissionEnvelopes } = await loadService(prisma);

    const envelopes = await getPermissionEnvelopes(buildUser(), { eventProgramId: 'p1' }, NOW);

    expect(envelopes.get(PERMISSIONS.ACTIVITY_UPDATE)).toEqual({
      validFrom: null,
      validUntil: null,
    } satisfies GrantEnvelope);
  });

  it('builds a bounded envelope from the union of active grants', async () => {
    const prisma = createPrismaMock();
    prisma.collaboration.findMany.mockResolvedValue([
      collaboration(
        grant(
          PERMISSIONS.ACTIVITY_UPDATE,
          new Date('2026-09-19T10:00:00.000Z'),
          new Date('2026-09-19T15:00:00.000Z'),
        ),
        grant(
          PERMISSIONS.ACTIVITY_UPDATE,
          new Date('2026-09-19T11:00:00.000Z'),
          new Date('2026-09-19T18:00:00.000Z'),
        ),
      ),
    ]);
    const { getPermissionEnvelopes } = await loadService(prisma);

    const envelopes = await getPermissionEnvelopes(buildUser(), { eventProgramId: 'p1' }, NOW);

    expect(envelopes.get(PERMISSIONS.ACTIVITY_UPDATE)).toEqual({
      validFrom: new Date('2026-09-19T10:00:00.000Z'),
      validUntil: new Date('2026-09-19T18:00:00.000Z'),
    } satisfies GrantEnvelope);
  });

  it('hasPermission returns false for a missing grant', async () => {
    const prisma = createPrismaMock();
    prisma.collaboration.findMany.mockResolvedValue([]);
    const { hasPermission } = await loadService(prisma);

    await expect(
      hasPermission(buildUser(), PERMISSIONS.ACTIVITY_UPDATE, { eventProgramId: 'p1' }, NOW),
    ).resolves.toBe(false);
  });

  it('lists own permissions for a program scope with merged envelopes sorted by name', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1' });
    prisma.collaboration.findMany.mockResolvedValue([
      collaboration(
        grant(PERMISSIONS.REPORT_VIEW),
        grant(
          PERMISSIONS.ACTIVITY_UPDATE,
          new Date('2026-09-19T10:00:00.000Z'),
          new Date('2026-09-19T15:00:00.000Z'),
        ),
        grant(
          PERMISSIONS.ACTIVITY_UPDATE,
          new Date('2026-09-19T11:00:00.000Z'),
          new Date('2026-09-19T18:00:00.000Z'),
        ),
      ),
    ]);
    const { listOwnPermissions } = await loadService(prisma);

    const result = await listOwnPermissions(buildUser(), { type: 'program', id: 'p1' }, NOW);

    expect(prisma.eventProgram.findUnique).toHaveBeenCalledWith({
      where: { id: 'p1' },
      select: { id: true },
    });
    expect(result).toEqual({
      scope: { type: 'program', id: 'p1' },
      permissions: [
        {
          name: PERMISSIONS.ACTIVITY_UPDATE,
          origin: 'LOCAL',
          validFrom: '2026-09-19T10:00:00.000Z',
          validUntil: '2026-09-19T18:00:00.000Z',
        },
        { name: PERMISSIONS.REPORT_VIEW, origin: 'LOCAL', validFrom: null, validUntil: null },
      ],
    });
  });

  it('resolves the activity scope and unions inherited program grants', async () => {
    const prisma = createPrismaMock();
    prisma.activity.findUnique.mockResolvedValue({ eventProgramId: 'program-001' });
    prisma.collaboration.findMany.mockResolvedValue([
      collaboration(grant(PERMISSIONS.PROGRAM_READ)),
      collaboration(grant(PERMISSIONS.ATTENDANCE_CHECKIN)),
    ]);
    const { listOwnPermissions } = await loadService(prisma);

    const result = await listOwnPermissions(
      buildUser(),
      { type: 'activity', id: 'activity-001' },
      NOW,
    );

    expect(prisma.collaboration.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId: 'user-001',
          OR: [{ eventProgramId: 'program-001' }, { activityId: 'activity-001' }],
        },
      }),
    );
    expect(result.scope).toEqual({ type: 'activity', id: 'activity-001' });
    expect(result.permissions.map((entry) => entry.name)).toEqual([
      PERMISSIONS.ATTENDANCE_CHECKIN,
      PERMISSIONS.PROGRAM_READ,
    ]);
  });

  it('returns every permission with unbounded envelopes for ADMIN', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1' });
    const { listOwnPermissions } = await loadService(prisma);

    const result = await listOwnPermissions(
      buildUser({ globalRole: 'ADMIN' }),
      { type: 'program', id: 'p1' },
      NOW,
    );

    expect(result.permissions).toHaveLength(PERMISSION_NAMES.length);
    expect(result.permissions.every((entry) => entry.origin === 'LOCAL')).toBe(true);
    expect(
      result.permissions.every((entry) => entry.validFrom === null && entry.validUntil === null),
    ).toBe(true);
    expect(prisma.collaboration.findMany).not.toHaveBeenCalled();
  });

  it('ignores expired and future grants without exposing them', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1' });
    prisma.collaboration.findMany.mockResolvedValue([
      collaboration(
        grant(PERMISSIONS.REPORT_EXPORT, null, new Date('2026-09-19T11:59:59.000Z')),
        grant(PERMISSIONS.ACTIVITY_CANCEL, new Date('2026-09-19T12:00:01.000Z')),
        grant(PERMISSIONS.ACTIVITY_READ),
      ),
    ]);
    const { listOwnPermissions } = await loadService(prisma);

    const result = await listOwnPermissions(buildUser(), { type: 'program', id: 'p1' }, NOW);

    expect(result.permissions).toEqual([
      { name: PERMISSIONS.ACTIVITY_READ, origin: 'LOCAL', validFrom: null, validUntil: null },
    ]);
  });

  it('throws 404 when the event program does not exist', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue(null);
    const { listOwnPermissions } = await loadService(prisma);

    await expect(
      listOwnPermissions(buildUser(), { type: 'program', id: 'missing' }, NOW),
    ).rejects.toMatchObject({ statusCode: 404, message: 'Event program not found.' });
    expect(prisma.collaboration.findMany).not.toHaveBeenCalled();
  });

  it('throws 404 when the activity does not exist', async () => {
    const prisma = createPrismaMock();
    prisma.activity.findUnique.mockResolvedValue(null);
    const { listOwnPermissions } = await loadService(prisma);

    await expect(
      listOwnPermissions(buildUser(), { type: 'activity', id: 'missing' }, NOW),
    ).rejects.toMatchObject({ statusCode: 404, message: 'Activity not found.' });
  });

  it('marks own permissions as local or inherited by their source scope', async () => {
    const prisma = createPrismaMock();
    prisma.activity.findUnique.mockResolvedValue({ eventProgramId: 'program-001' });
    prisma.collaboration.findMany.mockResolvedValue([
      scopedCollaboration(
        { eventProgramId: 'program-001' },
        grant(
          PERMISSIONS.PERMISSION_GRANT,
          new Date('2026-09-19T09:00:00.000Z'),
          new Date('2026-09-19T13:00:00.000Z'),
        ),
      ),
      scopedCollaboration(
        { activityId: 'activity-001' },
        grant(
          PERMISSIONS.PERMISSION_GRANT,
          new Date('2026-09-19T10:00:00.000Z'),
          new Date('2026-09-19T18:00:00.000Z'),
        ),
      ),
      scopedCollaboration({ eventProgramId: 'program-001' }, grant(PERMISSIONS.ATTENDANCE_CHECKIN)),
      scopedCollaboration({ activityId: 'activity-001' }, grant(PERMISSIONS.ACTIVITY_UPDATE)),
    ]);
    const { listOwnPermissions } = await loadService(prisma);

    const result = await listOwnPermissions(
      buildUser(),
      { type: 'activity', id: 'activity-001' },
      NOW,
    );

    expect(result.permissions).toEqual([
      {
        name: PERMISSIONS.ACTIVITY_UPDATE,
        origin: 'LOCAL',
        validFrom: null,
        validUntil: null,
      },
      {
        name: PERMISSIONS.ATTENDANCE_CHECKIN,
        origin: 'INHERITED',
        validFrom: null,
        validUntil: null,
      },
      {
        name: PERMISSIONS.PERMISSION_GRANT,
        origin: 'BOTH',
        validFrom: '2026-09-19T09:00:00.000Z',
        validUntil: '2026-09-19T18:00:00.000Z',
      },
    ]);
  });

  it('marks every own permission as local in a program scope', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1' });
    prisma.collaboration.findMany.mockResolvedValue([
      collaboration(grant(PERMISSIONS.ACTIVITY_READ)),
    ]);
    const { listOwnPermissions } = await loadService(prisma);

    const result = await listOwnPermissions(buildUser(), { type: 'program', id: 'p1' }, NOW);

    expect(result.permissions).toEqual([
      { name: PERMISSIONS.ACTIVITY_READ, origin: 'LOCAL', validFrom: null, validUntil: null },
    ]);
  });

  it('never exposes audit fields in the own permissions response', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1' });
    const auditedGrant = {
      ...grant(PERMISSIONS.ACTIVITY_READ),
      grantedById: 'actor-001',
      grantedAt: new Date('2026-09-19T10:00:00.000Z'),
    };
    prisma.collaboration.findMany.mockResolvedValue([collaboration(auditedGrant)]);
    const { listOwnPermissions } = await loadService(prisma);

    const result = await listOwnPermissions(buildUser(), { type: 'program', id: 'p1' }, NOW);

    const serialized = JSON.stringify(result);
    expect(serialized).not.to.include('grantedBy');
    expect(serialized).not.to.include('grantedAt');
    expect(serialized).not.to.include('source');
    const args = prisma.collaboration.findMany.mock.calls[0]?.[0] as { select: unknown };
    expect(JSON.stringify(args.select)).not.to.include('grantedBy');
    expect(JSON.stringify(args.select)).not.to.include('grantedAt');
  });

  it('keeps inherited permissions when a local grant is expired', async () => {
    const prisma = createPrismaMock();
    prisma.activity.findUnique.mockResolvedValue({ eventProgramId: 'program-001' });
    prisma.collaboration.findMany.mockResolvedValue([
      scopedCollaboration(
        { activityId: 'activity-001' },
        grant(PERMISSIONS.ACTIVITY_UPDATE, null, new Date('2026-09-19T11:59:59.000Z')),
      ),
      scopedCollaboration({ eventProgramId: 'program-001' }, grant(PERMISSIONS.ACTIVITY_UPDATE)),
    ]);
    const { listOwnPermissions } = await loadService(prisma);

    const result = await listOwnPermissions(
      buildUser(),
      { type: 'activity', id: 'activity-001' },
      NOW,
    );

    expect(result.permissions).toEqual([
      { name: PERMISSIONS.ACTIVITY_UPDATE, origin: 'INHERITED', validFrom: null, validUntil: null },
    ]);
  });

  it('lists direct collaboration scopes with effective permissions sorted by name then id', async () => {
    const prisma = createPrismaMock();
    prisma.collaboration.findMany.mockResolvedValue([
      programScopeCollaboration(scopeProgram(), grant(PERMISSIONS.PROGRAM_READ)),
      activityScopeCollaboration(scopeActivity(), grant(PERMISSIONS.ACTIVITY_UPDATE)),
    ]);
    const { listUserScopes } = await loadService(prisma);

    const result = await listUserScopes(buildUser(), { page: 1, limit: 20 }, NOW);

    expect(prisma.collaboration.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-001' } }),
    );
    expect(result).toEqual({
      items: [
        {
          type: 'activity',
          id: 'activity-001',
          name: 'Actividad Uno',
          status: 'COMPLETED',
          eventProgram: {
            id: 'program-001',
            name: 'Programa Uno',
            label: null,
            status: 'ACTIVE',
          },
          organizationalUnit: scopeUnit,
          permissions: [
            {
              name: PERMISSIONS.ACTIVITY_UPDATE,
              origin: 'LOCAL',
              validFrom: null,
              validUntil: null,
            },
            {
              name: PERMISSIONS.PROGRAM_READ,
              origin: 'INHERITED',
              validFrom: null,
              validUntil: null,
            },
          ],
        },
        {
          type: 'program',
          id: 'program-001',
          name: 'Programa Uno',
          status: 'ACTIVE',
          eventProgram: null,
          organizationalUnit: scopeUnit,
          permissions: [
            { name: PERMISSIONS.PROGRAM_READ, origin: 'LOCAL', validFrom: null, validUntil: null },
          ],
        },
      ],
      page: 1,
      limit: 20,
      total: 2,
      totalPages: 1,
    });
  });

  it('unions inherited program grants into activity scopes', async () => {
    const prisma = createPrismaMock();
    prisma.collaboration.findMany.mockResolvedValue([
      programScopeCollaboration(scopeProgram(), grant(PERMISSIONS.PROGRAM_READ)),
      activityScopeCollaboration(scopeActivity(), grant(PERMISSIONS.ACTIVITY_UPDATE)),
    ]);
    const { listUserScopes } = await loadService(prisma);

    const result = await listUserScopes(buildUser(), { page: 1, limit: 20 }, NOW);

    const activity = result.items.find((item) => item.type === 'activity');

    expect(activity?.permissions).toEqual([
      { name: PERMISSIONS.ACTIVITY_UPDATE, origin: 'LOCAL', validFrom: null, validUntil: null },
      { name: PERMISSIONS.PROGRAM_READ, origin: 'INHERITED', validFrom: null, validUntil: null },
    ]);
  });

  it('omits scopes whose direct grants are expired or future', async () => {
    const prisma = createPrismaMock();
    prisma.collaboration.findMany.mockResolvedValue([
      programScopeCollaboration(
        scopeProgram(),
        grant(PERMISSIONS.PROGRAM_READ, null, new Date('2026-09-19T11:59:59.000Z')),
        grant(PERMISSIONS.ACTIVITY_READ, new Date('2026-09-19T12:00:01.000Z')),
      ),
    ]);
    const { listUserScopes } = await loadService(prisma);

    const result = await listUserScopes(buildUser(), { page: 1, limit: 20 }, NOW);

    expect(result).toEqual({ items: [], page: 1, limit: 20, total: 0, totalPages: 0 });
  });

  it('keeps an activity whose only active permissions are inherited from the program', async () => {
    const prisma = createPrismaMock();
    prisma.collaboration.findMany.mockResolvedValue([
      programScopeCollaboration(scopeProgram(), grant(PERMISSIONS.PROGRAM_READ)),
      activityScopeCollaboration(
        scopeActivity(),
        grant(PERMISSIONS.ACTIVITY_UPDATE, null, new Date('2026-09-19T11:59:59.000Z')),
      ),
    ]);
    const { listUserScopes } = await loadService(prisma);

    const result = await listUserScopes(buildUser(), { page: 1, limit: 20 }, NOW);

    expect(result.items).toHaveLength(2);
    const activity = result.items.find((item) => item.type === 'activity');
    expect(activity?.permissions).toEqual([
      { name: PERMISSIONS.PROGRAM_READ, origin: 'INHERITED', validFrom: null, validUntil: null },
    ]);
  });

  it('filters by type and applies offset pagination over direct scopes', async () => {
    const prisma = createPrismaMock();
    prisma.collaboration.findMany.mockResolvedValue([
      programScopeCollaboration(
        scopeProgram({ id: 'program-002', name: 'Programa Dos' }),
        grant(PERMISSIONS.PROGRAM_READ),
      ),
      programScopeCollaboration(
        scopeProgram({ id: 'program-001', name: 'Programa Uno' }),
        grant(PERMISSIONS.PROGRAM_READ),
      ),
      activityScopeCollaboration(scopeActivity(), grant(PERMISSIONS.ACTIVITY_UPDATE)),
    ]);
    const { listUserScopes } = await loadService(prisma);

    const result = await listUserScopes(buildUser(), { page: 2, limit: 1, type: 'program' }, NOW);

    expect(result).toEqual({
      items: [
        {
          type: 'program',
          id: 'program-001',
          name: 'Programa Uno',
          status: 'ACTIVE',
          eventProgram: null,
          organizationalUnit: scopeUnit,
          permissions: [
            { name: PERMISSIONS.PROGRAM_READ, origin: 'LOCAL', validFrom: null, validUntil: null },
          ],
        },
      ],
      page: 2,
      limit: 1,
      total: 2,
      totalPages: 2,
    });
  });

  it('breaks ordering ties by identifier', async () => {
    const prisma = createPrismaMock();
    prisma.collaboration.findMany.mockResolvedValue([
      programScopeCollaboration(
        scopeProgram({ id: 'program-b', name: 'Programa Clon' }),
        grant(PERMISSIONS.PROGRAM_READ),
      ),
      programScopeCollaboration(
        scopeProgram({ id: 'program-a', name: 'Programa Clon' }),
        grant(PERMISSIONS.PROGRAM_READ),
      ),
    ]);
    const { listUserScopes } = await loadService(prisma);

    const result = await listUserScopes(buildUser(), { page: 1, limit: 20 }, NOW);

    expect(result.items.map((item) => item.id)).toEqual(['program-a', 'program-b']);
  });

  it('returns an empty page for a user without collaborations', async () => {
    const prisma = createPrismaMock();
    prisma.collaboration.findMany.mockResolvedValue([]);
    const { listUserScopes } = await loadService(prisma);

    const result = await listUserScopes(buildUser(), { page: 1, limit: 20 }, NOW);

    expect(result).toEqual({ items: [], page: 1, limit: 20, total: 0, totalPages: 0 });
  });

  it('never exposes audit fields in the scopes response', async () => {
    const prisma = createPrismaMock();
    const auditedGrant = {
      ...grant(PERMISSIONS.ACTIVITY_UPDATE),
      grantedById: 'actor-001',
      grantedAt: new Date('2026-09-19T10:00:00.000Z'),
    };
    prisma.collaboration.findMany.mockResolvedValue([
      activityScopeCollaboration(scopeActivity(), auditedGrant),
    ]);
    const { listUserScopes } = await loadService(prisma);

    const result = await listUserScopes(buildUser(), { page: 1, limit: 20 }, NOW);

    const serialized = JSON.stringify(result);
    expect(serialized).not.to.include('grantedBy');
    expect(serialized).not.to.include('grantedAt');
    const args = prisma.collaboration.findMany.mock.calls[0]?.[0] as { select: unknown };
    expect(JSON.stringify(args.select)).not.to.include('grantedBy');
    expect(JSON.stringify(args.select)).not.to.include('grantedAt');
  });

  it('returns the whole catalog for ADMIN with lightweight discovery and page hydration', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findMany
      .mockResolvedValueOnce([
        { id: 'program-001', name: 'Programa Uno' },
        { id: 'program-002', name: 'Programa Dos' },
      ])
      .mockResolvedValueOnce([
        { id: 'program-002', name: 'Programa Dos', status: 'DRAFT', organizationalUnit: scopeUnit },
      ]);
    prisma.activity.findMany
      .mockResolvedValueOnce([{ id: 'activity-001', name: 'Actividad Uno' }])
      .mockResolvedValueOnce([scopeActivity()]);
    const { listUserScopes } = await loadService(prisma);

    const result = await listUserScopes(
      buildUser({ globalRole: 'ADMIN' }),
      { page: 1, limit: 2 },
      NOW,
    );

    expect(prisma.collaboration.findMany).not.toHaveBeenCalled();
    expect(prisma.eventProgram.findMany).toHaveBeenNthCalledWith(1, {
      select: { id: true, name: true },
    });
    expect(prisma.activity.findMany).toHaveBeenNthCalledWith(1, {
      select: { id: true, name: true },
    });
    expect(prisma.eventProgram.findMany).toHaveBeenNthCalledWith(2, {
      where: { id: { in: ['program-002'] } },
      select: {
        id: true,
        name: true,
        status: true,
        organizationalUnit: { select: { id: true, name: true, type: true } },
      },
    });
    expect(prisma.activity.findMany).toHaveBeenNthCalledWith(2, {
      where: { id: { in: ['activity-001'] } },
      select: {
        id: true,
        name: true,
        status: true,
        date: true,
        startTime: true,
        endTime: true,
        eventProgram: {
          select: {
            id: true,
            name: true,
            label: true,
            status: true,
            organizationalUnit: { select: { id: true, name: true, type: true } },
          },
        },
      },
    });
    expect(result).toEqual({
      items: [
        {
          type: 'activity',
          id: 'activity-001',
          name: 'Actividad Uno',
          status: 'COMPLETED',
          eventProgram: {
            id: 'program-001',
            name: 'Programa Uno',
            label: null,
            status: 'ACTIVE',
          },
          organizationalUnit: scopeUnit,
          permissions: expect.arrayContaining([
            { name: PERMISSIONS.PROGRAM_READ, origin: 'LOCAL', validFrom: null, validUntil: null },
          ]),
        },
        {
          type: 'program',
          id: 'program-002',
          name: 'Programa Dos',
          status: 'DRAFT',
          eventProgram: null,
          organizationalUnit: scopeUnit,
          permissions: expect.arrayContaining([
            {
              name: PERMISSIONS.PERMISSION_GRANT,
              origin: 'LOCAL',
              validFrom: null,
              validUntil: null,
            },
          ]),
        },
      ],
      page: 1,
      limit: 2,
      total: 3,
      totalPages: 2,
    });
    expect(result.items[0]?.permissions).toHaveLength(PERMISSION_NAMES.length);
    expect(
      result.items.every((item) =>
        item.permissions.every(
          (entry) =>
            entry.origin === 'LOCAL' && entry.validFrom === null && entry.validUntil === null,
        ),
      ),
    ).toBe(true);
  });

  it('does not query the activity table for ADMIN when the type filter is program', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findMany
      .mockResolvedValueOnce([{ id: 'program-001', name: 'Programa Uno' }])
      .mockResolvedValueOnce([
        {
          id: 'program-001',
          name: 'Programa Uno',
          status: 'ACTIVE',
          organizationalUnit: scopeUnit,
        },
      ]);
    const { listUserScopes } = await loadService(prisma);

    const result = await listUserScopes(
      buildUser({ globalRole: 'ADMIN' }),
      { page: 1, limit: 20, type: 'program' },
      NOW,
    );

    expect(prisma.activity.findMany).not.toHaveBeenCalled();
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.type).toBe('program');
  });
});

const HOUR_MS = 60 * 60 * 1000;

describe('isGrantActive with a controlled clock', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.doUnmock('../../config/prisma.js');
  });

  it('treats validUntil as exclusive and validFrom as inclusive', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    const prisma = createPrismaMock();
    const { isGrantActive } = await loadService(prisma);
    const now = new Date();

    expect(now.getTime()).toBe(NOW.getTime());
    expect(isGrantActive({ validFrom: null, validUntil: NOW }, now)).toBe(false);
    expect(isGrantActive({ validFrom: null, validUntil: new Date(NOW.getTime() + 1) }, now)).toBe(
      true,
    );
    expect(isGrantActive({ validFrom: NOW, validUntil: null }, now)).toBe(true);
    expect(isGrantActive({ validFrom: new Date(NOW.getTime() + 1), validUntil: null }, now)).toBe(
      false,
    );
    expect(isGrantActive({ validFrom: null, validUntil: null }, now)).toBe(true);
  });
});

describe('expiry with the system clock and default now', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.doUnmock('../../config/prisma.js');
  });

  it('ignores a grant that expires while the clock advances without deleting it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    const prisma = createPrismaMock();
    prisma.collaboration.findMany.mockResolvedValue([
      collaboration(grant(PERMISSIONS.ACTIVITY_UPDATE, null, new Date(NOW.getTime() + HOUR_MS))),
    ]);
    const { getEffectivePermissions } = await loadService(prisma);

    const active = await getEffectivePermissions(buildUser(), { eventProgramId: 'p1' });
    expect(active.has(PERMISSIONS.ACTIVITY_UPDATE)).toBe(true);

    vi.setSystemTime(new Date(NOW.getTime() + HOUR_MS));
    const atBoundary = await getEffectivePermissions(buildUser(), { eventProgramId: 'p1' });
    expect(atBoundary.has(PERMISSIONS.ACTIVITY_UPDATE)).toBe(false);

    vi.setSystemTime(new Date(NOW.getTime() + 2 * HOUR_MS));
    const expired = await getEffectivePermissions(buildUser(), { eventProgramId: 'p1' });
    expect(expired.size).toBe(0);

    expect(prisma.collaborationPermission.create).not.toHaveBeenCalled();
    expect(prisma.collaborationPermission.update).not.toHaveBeenCalled();
    expect(prisma.collaborationPermission.deleteMany).not.toHaveBeenCalled();
  });

  it('omits an expired own permission while the row stays stored', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1' });
    prisma.collaboration.findMany.mockResolvedValue([
      collaboration(
        grant(PERMISSIONS.REPORT_VIEW),
        grant(PERMISSIONS.REPORT_EXPORT, null, new Date(NOW.getTime() + HOUR_MS)),
      ),
    ]);
    const { listOwnPermissions } = await loadService(prisma);

    const active = await listOwnPermissions(buildUser(), { type: 'program', id: 'p1' });
    expect(active.permissions.map((entry) => entry.name)).toEqual([
      PERMISSIONS.REPORT_EXPORT,
      PERMISSIONS.REPORT_VIEW,
    ]);

    vi.setSystemTime(new Date(NOW.getTime() + HOUR_MS));
    const expired = await listOwnPermissions(buildUser(), { type: 'program', id: 'p1' });
    expect(expired.permissions).toEqual([
      { name: PERMISSIONS.REPORT_VIEW, origin: 'LOCAL', validFrom: null, validUntil: null },
    ]);

    expect(prisma.collaborationPermission.create).not.toHaveBeenCalled();
    expect(prisma.collaborationPermission.update).not.toHaveBeenCalled();
    expect(prisma.collaborationPermission.deleteMany).not.toHaveBeenCalled();
  });
});
