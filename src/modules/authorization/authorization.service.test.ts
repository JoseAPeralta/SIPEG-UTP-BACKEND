import { afterEach, describe, expect, it, vi } from 'vitest';

import type { GrantEnvelope } from './authorization.types.js';
import { PERMISSIONS, PERMISSION_NAMES, type PermissionName } from './permissions.js';

interface GrantRecord {
  validFrom: Date | null;
  validUntil: Date | null;
  permission: { name: string };
}

interface CollaborationRecord {
  permissions: GrantRecord[];
}

interface PrismaMock {
  collaboration: { findMany: ReturnType<typeof vi.fn> };
  activity: { findUnique: ReturnType<typeof vi.fn> };
}

const createPrismaMock = (): PrismaMock => ({
  collaboration: { findMany: vi.fn() },
  activity: { findUnique: vi.fn() },
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

const NOW = new Date('2026-09-19T12:00:00.000Z');

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
});
