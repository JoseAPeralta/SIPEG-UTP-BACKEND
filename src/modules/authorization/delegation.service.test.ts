import { afterEach, describe, expect, it, vi } from 'vitest';

import { PERMISSIONS, ROLE_DEFAULTS, type PermissionName } from './permissions.js';

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
  collaboration: {
    findMany: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    findUniqueOrThrow: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  collaborationPermission: {
    upsert: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
    createMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
  };
  activity: { findUnique: ReturnType<typeof vi.fn> };
  eventProgram: { findUnique: ReturnType<typeof vi.fn> };
  user: { findUnique: ReturnType<typeof vi.fn> };
  permission: { findMany: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn> };
  auditEvent: { create: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
}

const createPrismaMock = (): PrismaMock => {
  const prisma: PrismaMock = {
    collaboration: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    collaborationPermission: {
      upsert: vi.fn(),
      deleteMany: vi.fn(),
      createMany: vi.fn(),
      findUnique: vi.fn(),
    },
    activity: { findUnique: vi.fn() },
    eventProgram: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    permission: { findMany: vi.fn(), findUnique: vi.fn() },
    auditEvent: { create: vi.fn() },
    $transaction: vi.fn(),
  };

  prisma.$transaction.mockImplementation(
    async (callback: (client: PrismaMock) => Promise<unknown>) => callback(prisma),
  );

  return prisma;
};

const loadService = async (prisma: PrismaMock) => {
  vi.resetModules();
  vi.doMock('../../config/prisma.js', () => ({
    getPrismaClient: () => prisma,
  }));

  return import('./delegation.service.js');
};

const buildUser = (
  overrides: Partial<Express.AuthenticatedUser> = {},
): Express.AuthenticatedUser => ({
  id: 'actor-001',
  email: 'actor@example.com',
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

const collaboratorRecord = (overrides: Record<string, unknown> = {}) => ({
  userId: 'user-002',
  role: 'VIEWER',
  createdAt: new Date('2026-09-19T12:00:00.000Z'),
  eventProgramId: 'p1',
  activityId: null,
  user: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
  permissions: [
    {
      source: 'ROLE_DEFAULT',
      validFrom: null,
      validUntil: null,
      permission: { name: PERMISSIONS.ACTIVITY_READ },
    },
  ],
  ...overrides,
});

const permissionRecords = (names: readonly PermissionName[]) =>
  names.map((name, index) => ({ id: `perm-${index}`, name }));

const NOW = new Date('2026-09-19T12:00:00.000Z');

describe('delegation service', () => {
  afterEach(() => {
    vi.doUnmock('../../config/prisma.js');
  });

  it('rejects delegation without permission:grant', async () => {
    const prisma = createPrismaMock();
    prisma.collaboration.findMany.mockResolvedValue([
      collaboration(grant(PERMISSIONS.PROGRAM_READ)),
    ]);
    const { addCollaborator } = await loadService(prisma);

    await expect(
      addCollaborator(buildUser(), { eventProgramId: 'p1' }, 'user-002', 'VIEWER', NOW),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(prisma.collaboration.create).not.toHaveBeenCalled();
  });

  it('rejects granting a permission the actor does not hold', async () => {
    const prisma = createPrismaMock();
    prisma.collaboration.findMany.mockResolvedValue([
      collaboration(grant(PERMISSIONS.PERMISSION_GRANT)),
    ]);
    prisma.collaboration.findFirst.mockResolvedValue({ id: 'collab-001' });
    const { grantPermission } = await loadService(prisma);

    await expect(
      grantPermission(
        buildUser(),
        { eventProgramId: 'p1' },
        'user-002',
        PERMISSIONS.ACTIVITY_UPDATE,
        {},
        NOW,
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(prisma.collaborationPermission.upsert).not.toHaveBeenCalled();
  });

  it('rejects a grant window wider than the actor envelope', async () => {
    const prisma = createPrismaMock();
    prisma.collaboration.findMany.mockResolvedValue([
      collaboration(
        grant(PERMISSIONS.PERMISSION_GRANT),
        grant(
          PERMISSIONS.ACTIVITY_UPDATE,
          new Date('2026-09-19T10:00:00.000Z'),
          new Date('2026-09-20T10:00:00.000Z'),
        ),
      ),
    ]);
    prisma.collaboration.findFirst.mockResolvedValue({ id: 'collab-001' });
    const { grantPermission } = await loadService(prisma);

    await expect(
      grantPermission(
        buildUser(),
        { eventProgramId: 'p1' },
        'user-002',
        PERMISSIONS.ACTIVITY_UPDATE,
        { validUntil: new Date('2026-09-25T10:00:00.000Z') },
        NOW,
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(prisma.collaborationPermission.upsert).not.toHaveBeenCalled();
  });

  it('rejects an unbounded grant when the actor is time bounded', async () => {
    const prisma = createPrismaMock();
    prisma.collaboration.findMany.mockResolvedValue([
      collaboration(
        grant(PERMISSIONS.PERMISSION_GRANT),
        grant(PERMISSIONS.ACTIVITY_UPDATE, null, new Date('2026-09-20T10:00:00.000Z')),
      ),
    ]);
    prisma.collaboration.findFirst.mockResolvedValue({ id: 'collab-001' });
    const { grantPermission } = await loadService(prisma);

    await expect(
      grantPermission(
        buildUser(),
        { eventProgramId: 'p1' },
        'user-002',
        PERMISSIONS.ACTIVITY_UPDATE,
        {},
        NOW,
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('rejects an inverted grant window', async () => {
    const prisma = createPrismaMock();
    const actor = buildUser({ globalRole: 'ADMIN' });
    const { grantPermission } = await loadService(prisma);

    await expect(
      grantPermission(
        actor,
        { eventProgramId: 'p1' },
        'user-002',
        PERMISSIONS.ACTIVITY_UPDATE,
        {
          validFrom: new Date('2026-09-20T10:00:00.000Z'),
          validUntil: new Date('2026-09-19T10:00:00.000Z'),
        },
        NOW,
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects assigning a role whose defaults exceed the actor permissions', async () => {
    const prisma = createPrismaMock();
    prisma.collaboration.findMany.mockResolvedValue([
      collaboration(grant(PERMISSIONS.PERMISSION_GRANT)),
    ]);
    const { addCollaborator } = await loadService(prisma);

    await expect(
      addCollaborator(buildUser(), { eventProgramId: 'p1' }, 'user-002', 'VIEWER', NOW),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('creates the collaboration and materializes ROLE_DEFAULT rows', async () => {
    const prisma = createPrismaMock();
    prisma.permission.findMany.mockResolvedValue(permissionRecords(ROLE_DEFAULTS.VIEWER));
    prisma.user.findUnique.mockResolvedValue({ id: 'user-002', isActive: true });
    prisma.collaboration.findFirst.mockResolvedValue(null);
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
    prisma.collaboration.create.mockResolvedValue(collaboratorRecord());
    const { addCollaborator } = await loadService(prisma);

    await addCollaborator(
      buildUser({ globalRole: 'ADMIN' }),
      { eventProgramId: 'p1' },
      'user-002',
      'VIEWER',
      NOW,
    );

    expect(prisma.collaboration.create).toHaveBeenCalledTimes(1);
    const createArgs = prisma.collaboration.create.mock.calls[0]?.[0] as {
      data: {
        role: string;
        eventProgramId: string | null;
        activityId: string | null;
        userId: string;
        permissions: { create: { source: string; grantedById: string }[] };
      };
    };
    expect(createArgs.data).toMatchObject({
      role: 'VIEWER',
      eventProgramId: 'p1',
      activityId: null,
      userId: 'user-002',
    });
    expect(createArgs.data.permissions.create).toHaveLength(ROLE_DEFAULTS.VIEWER.length);
    for (const row of createArgs.data.permissions.create) {
      expect(row).toMatchObject({ source: 'ROLE_DEFAULT', grantedById: 'actor-001' });
    }
  });

  it('rejects adding a collaborator that already exists in the scope', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
    prisma.user.findUnique.mockResolvedValue({ id: 'user-002', isActive: true });
    prisma.collaboration.findFirst.mockResolvedValue({ id: 'collab-001' });
    const { addCollaborator } = await loadService(prisma);

    await expect(
      addCollaborator(
        buildUser({ globalRole: 'ADMIN' }),
        { eventProgramId: 'p1' },
        'user-002',
        'VIEWER',
        NOW,
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('rejects adding an inactive user', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
    prisma.user.findUnique.mockResolvedValue({ id: 'user-002', isActive: false });
    const { addCollaborator } = await loadService(prisma);

    await expect(
      addCollaborator(
        buildUser({ globalRole: 'ADMIN' }),
        { eventProgramId: 'p1' },
        'user-002',
        'VIEWER',
        NOW,
      ),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('writes OVERRIDE rows with grantedById set', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
    prisma.collaboration.findFirst.mockResolvedValue({ id: 'collab-001' });
    prisma.permission.findUnique.mockResolvedValue({
      id: 'perm-grant',
      name: PERMISSIONS.PERMISSION_GRANT,
    });
    prisma.collaborationPermission.upsert.mockResolvedValue({});
    prisma.collaboration.findUniqueOrThrow.mockResolvedValue(collaboratorRecord());
    const { grantPermission } = await loadService(prisma);

    await grantPermission(
      buildUser({ globalRole: 'ADMIN' }),
      { eventProgramId: 'p1' },
      'user-002',
      PERMISSIONS.PERMISSION_GRANT,
      { validUntil: new Date('2026-09-30T00:00:00.000Z') },
      NOW,
    );

    expect(prisma.collaborationPermission.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          collaborationId_permissionId: {
            collaborationId: 'collab-001',
            permissionId: 'perm-grant',
          },
        },
        create: expect.objectContaining({
          source: 'OVERRIDE',
          grantedById: 'actor-001',
          validUntil: new Date('2026-09-30T00:00:00.000Z'),
        }),
      }),
    );
  });

  it('allows delegating permission:grant when the actor holds it', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
    prisma.collaboration.findMany.mockResolvedValue([
      collaboration(grant(PERMISSIONS.PERMISSION_GRANT)),
    ]);
    prisma.collaboration.findFirst.mockResolvedValue({ id: 'collab-001' });
    prisma.permission.findUnique.mockResolvedValue({
      id: 'perm-grant',
      name: PERMISSIONS.PERMISSION_GRANT,
    });
    prisma.collaborationPermission.upsert.mockResolvedValue({});
    prisma.collaboration.findUniqueOrThrow.mockResolvedValue(collaboratorRecord());
    const { grantPermission } = await loadService(prisma);

    await grantPermission(
      buildUser(),
      { eventProgramId: 'p1' },
      'user-002',
      PERMISSIONS.PERMISSION_GRANT,
      {},
      NOW,
    );

    expect(prisma.collaborationPermission.upsert).toHaveBeenCalledTimes(1);
  });

  it('rejects granting to a missing collaboration', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
    prisma.collaboration.findFirst.mockResolvedValue(null);
    const { grantPermission } = await loadService(prisma);

    await expect(
      grantPermission(
        buildUser({ globalRole: 'ADMIN' }),
        { eventProgramId: 'p1' },
        'user-002',
        PERMISSIONS.ACTIVITY_UPDATE,
        {},
        NOW,
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('rejects grants on a missing event program', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue(null);
    const { grantPermission } = await loadService(prisma);

    await expect(
      grantPermission(
        buildUser({ globalRole: 'ADMIN' }),
        { eventProgramId: 'p1' },
        'user-002',
        PERMISSIONS.ACTIVITY_UPDATE,
        {},
        NOW,
      ),
    ).rejects.toMatchObject({ statusCode: 404, message: 'Event program not found.' });
    expect(prisma.collaborationPermission.upsert).not.toHaveBeenCalled();
  });

  it('rejects grants on an archived event program', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ARCHIVED' });
    const { grantPermission } = await loadService(prisma);

    await expect(
      grantPermission(
        buildUser({ globalRole: 'ADMIN' }),
        { eventProgramId: 'p1' },
        'user-002',
        PERMISSIONS.ACTIVITY_UPDATE,
        {},
        NOW,
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: 'Archived event programs cannot be modified.',
    });
    expect(prisma.collaborationPermission.upsert).not.toHaveBeenCalled();
  });

  it('resolves the activity scope to its parent program before granting', async () => {
    const prisma = createPrismaMock();
    prisma.activity.findUnique.mockResolvedValue({ eventProgramId: 'p1' });
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
    prisma.collaboration.findFirst.mockResolvedValue({ id: 'collab-001' });
    prisma.permission.findUnique.mockResolvedValue({
      id: 'perm-update',
      name: PERMISSIONS.ACTIVITY_UPDATE,
    });
    prisma.collaboration.findUniqueOrThrow.mockResolvedValue(collaboratorRecord());
    const { grantPermission } = await loadService(prisma);

    await grantPermission(
      buildUser({ globalRole: 'ADMIN' }),
      { activityId: 'a1' },
      'user-002',
      PERMISSIONS.ACTIVITY_UPDATE,
      {},
      NOW,
    );

    expect(prisma.collaboration.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-002', activityId: 'a1' } }),
    );
  });

  it('returns the updated collaborator detail after granting', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
    prisma.collaboration.findFirst.mockResolvedValue({ id: 'collab-001' });
    prisma.permission.findUnique.mockResolvedValue({
      id: 'perm-update',
      name: PERMISSIONS.ACTIVITY_UPDATE,
    });
    prisma.collaborationPermission.upsert.mockResolvedValue({});
    prisma.collaboration.findUniqueOrThrow.mockResolvedValue(
      collaboratorRecord({
        permissions: [
          {
            source: 'OVERRIDE',
            validFrom: null,
            validUntil: new Date('2026-09-30T00:00:00.000Z'),
            permission: { name: PERMISSIONS.ACTIVITY_UPDATE },
          },
        ],
      }),
    );
    const { grantPermission } = await loadService(prisma);

    const result = await grantPermission(
      buildUser({ globalRole: 'ADMIN' }),
      { eventProgramId: 'p1' },
      'user-002',
      PERMISSIONS.ACTIVITY_UPDATE,
      { validUntil: new Date('2026-09-30T00:00:00.000Z') },
      NOW,
    );

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      userId: 'user-002',
      permissions: [
        {
          name: PERMISSIONS.ACTIVITY_UPDATE,
          source: 'OVERRIDE',
          validUntil: '2026-09-30T00:00:00.000Z',
        },
      ],
    });
  });

  it('revokes only permissions the actor also holds', async () => {
    const prisma = createPrismaMock();
    prisma.collaboration.findMany.mockResolvedValue([
      collaboration(grant(PERMISSIONS.PERMISSION_GRANT)),
    ]);
    prisma.collaboration.findFirst.mockResolvedValue({ id: 'collab-001' });
    const { revokePermission } = await loadService(prisma);

    await expect(
      revokePermission(
        buildUser(),
        { eventProgramId: 'p1' },
        'user-002',
        PERMISSIONS.ACTIVITY_UPDATE,
        NOW,
      ),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(prisma.collaborationPermission.deleteMany).not.toHaveBeenCalled();
  });

  it('revokes when the actor holds the permission', async () => {
    const prisma = createPrismaMock();
    prisma.collaboration.findMany.mockResolvedValue([
      collaboration(grant(PERMISSIONS.PERMISSION_GRANT), grant(PERMISSIONS.ACTIVITY_UPDATE)),
    ]);
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
    prisma.permission.findUnique.mockResolvedValue({
      id: 'perm-update',
      name: PERMISSIONS.ACTIVITY_UPDATE,
    });
    prisma.collaboration.findFirst.mockResolvedValue({
      id: 'collab-001',
      user: { globalRole: 'USER', isActive: true },
      permissions: [
        { validFrom: null, validUntil: null, permission: { name: PERMISSIONS.ACTIVITY_UPDATE } },
      ],
    });
    prisma.collaborationPermission.deleteMany.mockResolvedValue({ count: 1 });
    const { revokePermission } = await loadService(prisma);

    await revokePermission(
      buildUser(),
      { eventProgramId: 'p1' },
      'user-002',
      PERMISSIONS.ACTIVITY_UPDATE,
      NOW,
    );

    expect(prisma.collaborationPermission.deleteMany).toHaveBeenCalledWith({
      where: { collaborationId: 'collab-001', permissionId: 'perm-update' },
    });
  });

  it('returns 404 when the revoked grant does not exist', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
    prisma.permission.findUnique.mockResolvedValue({ id: 'perm-update' });
    prisma.collaboration.findFirst.mockResolvedValue({
      id: 'collab-001',
      user: { globalRole: 'USER', isActive: true },
      permissions: [],
    });
    const { revokePermission } = await loadService(prisma);

    await expect(
      revokePermission(
        buildUser({ globalRole: 'ADMIN' }),
        { eventProgramId: 'p1' },
        'user-002',
        PERMISSIONS.ACTIVITY_UPDATE,
        NOW,
      ),
    ).rejects.toMatchObject({ statusCode: 404, message: 'Permission grant not found.' });
    expect(prisma.collaborationPermission.deleteMany).not.toHaveBeenCalled();
  });

  it('rejects revoking a permission on a missing event program', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue(null);
    const { revokePermission } = await loadService(prisma);

    await expect(
      revokePermission(
        buildUser({ globalRole: 'ADMIN' }),
        { eventProgramId: 'missing' },
        'user-002',
        PERMISSIONS.ACTIVITY_UPDATE,
        NOW,
      ),
    ).rejects.toMatchObject({ statusCode: 404, message: 'Event program not found.' });
    expect(prisma.collaborationPermission.deleteMany).not.toHaveBeenCalled();
  });

  it('rejects revoking a permission on an archived event program', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ARCHIVED' });
    const { revokePermission } = await loadService(prisma);

    await expect(
      revokePermission(
        buildUser({ globalRole: 'ADMIN' }),
        { eventProgramId: 'p1' },
        'user-002',
        PERMISSIONS.ACTIVITY_UPDATE,
        NOW,
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: 'Archived event programs cannot be modified.',
    });
    expect(prisma.collaborationPermission.deleteMany).not.toHaveBeenCalled();
  });

  it('returns 404 when revoking from a missing collaborator', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
    prisma.permission.findUnique.mockResolvedValue({ id: 'perm-update' });
    prisma.collaboration.findFirst.mockResolvedValue(null);
    const { revokePermission } = await loadService(prisma);

    await expect(
      revokePermission(
        buildUser({ globalRole: 'ADMIN' }),
        { eventProgramId: 'p1' },
        'user-002',
        PERMISSIONS.ACTIVITY_UPDATE,
        NOW,
      ),
    ).rejects.toMatchObject({ statusCode: 404, message: 'Collaborator not found.' });
  });

  it('resolves the activity scope to its parent program before revoking', async () => {
    const prisma = createPrismaMock();
    prisma.activity.findUnique.mockResolvedValue({ eventProgramId: 'p1' });
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
    prisma.permission.findUnique.mockResolvedValue({ id: 'perm-update' });
    prisma.collaboration.findFirst.mockResolvedValue({
      id: 'collab-001',
      user: { globalRole: 'USER', isActive: true },
      permissions: [
        { validFrom: null, validUntil: null, permission: { name: PERMISSIONS.ACTIVITY_UPDATE } },
      ],
    });
    prisma.collaborationPermission.deleteMany.mockResolvedValue({ count: 1 });
    const { revokePermission } = await loadService(prisma);

    await revokePermission(
      buildUser({ globalRole: 'ADMIN' }),
      { activityId: 'a1' },
      'user-002',
      PERMISSIONS.ACTIVITY_UPDATE,
      NOW,
    );

    expect(prisma.collaboration.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'user-002', activityId: 'a1' } }),
    );
  });

  it('refuses to revoke a permission inherited from the event program', async () => {
    const prisma = createPrismaMock();
    prisma.activity.findUnique.mockResolvedValue({ eventProgramId: 'p1' });
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
    prisma.permission.findUnique.mockResolvedValue({ id: 'perm-export' });
    prisma.collaboration.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ permissions: [{ validFrom: null, validUntil: null }] });
    const { revokePermission } = await loadService(prisma);

    await expect(
      revokePermission(
        buildUser({ globalRole: 'ADMIN' }),
        { activityId: 'a1' },
        'user-002',
        PERMISSIONS.REPORT_EXPORT,
        NOW,
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: 'Cannot revoke a permission inherited from the event program.',
    });
    expect(prisma.collaborationPermission.deleteMany).not.toHaveBeenCalled();
  });

  it('ignores expired program grants when checking inheritance', async () => {
    const prisma = createPrismaMock();
    prisma.activity.findUnique.mockResolvedValue({ eventProgramId: 'p1' });
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
    prisma.permission.findUnique.mockResolvedValue({ id: 'perm-export' });
    prisma.collaboration.findFirst
      .mockResolvedValueOnce({
        id: 'collab-001',
        user: { globalRole: 'USER', isActive: true },
        permissions: [],
      })
      .mockResolvedValueOnce({
        permissions: [{ validFrom: null, validUntil: new Date('2026-09-18T12:00:00.000Z') }],
      });
    const { revokePermission } = await loadService(prisma);

    await expect(
      revokePermission(
        buildUser({ globalRole: 'ADMIN' }),
        { activityId: 'a1' },
        'user-002',
        PERMISSIONS.REPORT_EXPORT,
        NOW,
      ),
    ).rejects.toMatchObject({ statusCode: 404, message: 'Permission grant not found.' });
    expect(prisma.collaborationPermission.deleteMany).not.toHaveBeenCalled();
  });

  it('revokes a local activity grant even when the program also grants the permission', async () => {
    const prisma = createPrismaMock();
    prisma.activity.findUnique.mockResolvedValue({ eventProgramId: 'p1' });
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
    prisma.permission.findUnique.mockResolvedValue({ id: 'perm-export' });
    prisma.collaboration.findFirst.mockResolvedValue({
      id: 'collab-001',
      user: { globalRole: 'USER', isActive: true },
      permissions: [
        { validFrom: null, validUntil: null, permission: { name: PERMISSIONS.REPORT_EXPORT } },
      ],
    });
    prisma.collaborationPermission.deleteMany.mockResolvedValue({ count: 1 });
    const { revokePermission } = await loadService(prisma);

    await revokePermission(
      buildUser({ globalRole: 'ADMIN' }),
      { activityId: 'a1' },
      'user-002',
      PERMISSIONS.REPORT_EXPORT,
      NOW,
    );

    expect(prisma.collaboration.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.collaborationPermission.deleteMany).toHaveBeenCalledWith({
      where: { collaborationId: 'collab-001', permissionId: 'perm-export' },
    });
  });

  it('blocks revoking the last active delegation permission', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
    prisma.permission.findUnique.mockResolvedValue({
      id: 'perm-grant',
      name: PERMISSIONS.PERMISSION_GRANT,
    });
    prisma.collaboration.findFirst.mockResolvedValue({
      id: 'collab-001',
      user: { globalRole: 'USER', isActive: true },
      permissions: [
        { validFrom: null, validUntil: null, permission: { name: PERMISSIONS.PERMISSION_GRANT } },
      ],
    });
    prisma.collaboration.findMany.mockResolvedValue([
      {
        userId: 'user-002',
        eventProgramId: 'p1',
        activityId: null,
        user: { globalRole: 'USER', isActive: true },
        permissions: [
          { validFrom: null, validUntil: null, permission: { name: PERMISSIONS.PERMISSION_GRANT } },
        ],
      },
    ]);
    const { revokePermission } = await loadService(prisma);

    await expect(
      revokePermission(
        buildUser({ globalRole: 'ADMIN' }),
        { eventProgramId: 'p1' },
        'user-002',
        PERMISSIONS.PERMISSION_GRANT,
        NOW,
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: 'Cannot revoke the last delegation permission in this scope.',
    });
    expect(prisma.collaborationPermission.deleteMany).not.toHaveBeenCalled();
  });

  it('allows revoking permission:grant when another delegator remains', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
    prisma.permission.findUnique.mockResolvedValue({ id: 'perm-grant' });
    prisma.collaboration.findFirst.mockResolvedValue({
      id: 'collab-001',
      user: { globalRole: 'USER', isActive: true },
      permissions: [
        { validFrom: null, validUntil: null, permission: { name: PERMISSIONS.PERMISSION_GRANT } },
      ],
    });
    prisma.collaboration.findMany.mockResolvedValue([
      {
        userId: 'user-002',
        eventProgramId: 'p1',
        activityId: null,
        user: { globalRole: 'USER', isActive: true },
        permissions: [
          { validFrom: null, validUntil: null, permission: { name: PERMISSIONS.PERMISSION_GRANT } },
        ],
      },
      {
        userId: 'actor-001',
        eventProgramId: 'p1',
        activityId: null,
        user: { globalRole: 'USER', isActive: true },
        permissions: [
          { validFrom: null, validUntil: null, permission: { name: PERMISSIONS.PERMISSION_GRANT } },
        ],
      },
    ]);
    prisma.collaborationPermission.deleteMany.mockResolvedValue({ count: 1 });
    const { revokePermission } = await loadService(prisma);

    await revokePermission(
      buildUser({ globalRole: 'ADMIN' }),
      { eventProgramId: 'p1' },
      'user-002',
      PERMISSIONS.PERMISSION_GRANT,
      NOW,
    );

    expect(prisma.collaborationPermission.deleteMany).toHaveBeenCalledTimes(1);
  });

  it('counts inherited program delegators when revoking an activity grant', async () => {
    const prisma = createPrismaMock();
    prisma.activity.findUnique.mockResolvedValue({ eventProgramId: 'p1' });
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
    prisma.permission.findUnique.mockResolvedValue({ id: 'perm-grant' });
    prisma.collaboration.findFirst.mockResolvedValue({
      id: 'collab-activity',
      user: { globalRole: 'USER', isActive: true },
      permissions: [
        { validFrom: null, validUntil: null, permission: { name: PERMISSIONS.PERMISSION_GRANT } },
      ],
    });
    prisma.collaboration.findMany.mockResolvedValue([
      {
        userId: 'user-002',
        eventProgramId: null,
        activityId: 'a1',
        user: { globalRole: 'USER', isActive: true },
        permissions: [
          { validFrom: null, validUntil: null, permission: { name: PERMISSIONS.PERMISSION_GRANT } },
        ],
      },
      {
        userId: 'user-002',
        eventProgramId: 'p1',
        activityId: null,
        user: { globalRole: 'USER', isActive: true },
        permissions: [
          { validFrom: null, validUntil: null, permission: { name: PERMISSIONS.PERMISSION_GRANT } },
        ],
      },
    ]);
    prisma.collaborationPermission.deleteMany.mockResolvedValue({ count: 1 });
    const { revokePermission } = await loadService(prisma);

    await revokePermission(
      buildUser({ globalRole: 'ADMIN' }),
      { activityId: 'a1' },
      'user-002',
      PERMISSIONS.PERMISSION_GRANT,
      NOW,
    );

    expect(prisma.collaborationPermission.deleteMany).toHaveBeenCalledTimes(1);
  });

  it('skips the delegator guard when revoking an inactive delegation grant', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
    prisma.permission.findUnique.mockResolvedValue({ id: 'perm-grant' });
    prisma.collaboration.findFirst.mockResolvedValue({
      id: 'collab-001',
      user: { globalRole: 'USER', isActive: true },
      permissions: [
        {
          validFrom: null,
          validUntil: new Date('2026-09-18T12:00:00.000Z'),
          permission: { name: PERMISSIONS.PERMISSION_GRANT },
        },
      ],
    });
    prisma.collaborationPermission.deleteMany.mockResolvedValue({ count: 1 });
    const { revokePermission } = await loadService(prisma);

    await revokePermission(
      buildUser({ globalRole: 'ADMIN' }),
      { eventProgramId: 'p1' },
      'user-002',
      PERMISSIONS.PERMISSION_GRANT,
      NOW,
    );

    expect(prisma.collaboration.findMany).not.toHaveBeenCalled();
    expect(prisma.collaborationPermission.deleteMany).toHaveBeenCalledTimes(1);
  });

  it('does not scan delegators when revoking another permission', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
    prisma.permission.findUnique.mockResolvedValue({ id: 'perm-update' });
    prisma.collaboration.findFirst.mockResolvedValue({
      id: 'collab-001',
      user: { globalRole: 'USER', isActive: true },
      permissions: [
        { validFrom: null, validUntil: null, permission: { name: PERMISSIONS.ACTIVITY_UPDATE } },
      ],
    });
    prisma.collaborationPermission.deleteMany.mockResolvedValue({ count: 1 });
    const { revokePermission } = await loadService(prisma);

    await revokePermission(
      buildUser({ globalRole: 'ADMIN' }),
      { eventProgramId: 'p1' },
      'user-002',
      PERMISSIONS.ACTIVITY_UPDATE,
      NOW,
    );

    expect(prisma.collaboration.findMany).not.toHaveBeenCalled();
    expect(prisma.collaborationPermission.deleteMany).toHaveBeenCalledTimes(1);
  });

  it('replaces ROLE_DEFAULT rows and preserves OVERRIDE rows on role change', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
    prisma.collaboration.findFirst.mockResolvedValue({
      id: 'collab-001',
      permissions: [{ permission: { name: PERMISSIONS.ACTIVITY_READ } }],
    });
    prisma.permission.findMany.mockResolvedValue(permissionRecords(ROLE_DEFAULTS.EDITOR));
    prisma.collaboration.update.mockResolvedValue({});
    prisma.collaborationPermission.deleteMany.mockResolvedValue({ count: 1 });
    prisma.collaborationPermission.createMany.mockResolvedValue({ count: 11 });
    prisma.collaboration.findUniqueOrThrow.mockResolvedValue(
      collaboratorRecord({ role: 'EDITOR' }),
    );
    const { updateCollaboratorRole } = await loadService(prisma);

    const result = await updateCollaboratorRole(
      buildUser({ globalRole: 'ADMIN' }),
      { eventProgramId: 'p1' },
      'user-002',
      'EDITOR',
      NOW,
    );

    expect(prisma.collaborationPermission.deleteMany).toHaveBeenCalledWith({
      where: { collaborationId: 'collab-001', source: 'ROLE_DEFAULT' },
    });
    const createArgs = prisma.collaborationPermission.createMany.mock.calls[0]?.[0] as {
      data: { source: string; grantedById: string; collaborationId: string }[];
    };
    expect(createArgs.data).toHaveLength(ROLE_DEFAULTS.EDITOR.length);
    for (const row of createArgs.data) {
      expect(row).toMatchObject({
        source: 'ROLE_DEFAULT',
        grantedById: 'actor-001',
        collaborationId: 'collab-001',
      });
    }
    expect(prisma.collaboration.update).toHaveBeenCalledWith({
      where: { id: 'collab-001' },
      data: { role: 'EDITOR' },
    });
    expect(prisma.collaboration.delete).not.toHaveBeenCalled();
    expect(result).toEqual({
      userId: 'user-002',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      role: 'EDITOR',
      createdAt: '2026-09-19T12:00:00.000Z',
      permissions: [
        {
          name: PERMISSIONS.ACTIVITY_READ,
          source: 'ROLE_DEFAULT',
          validFrom: null,
          validUntil: null,
        },
      ],
    });
  });

  it('returns 404 when updating the role in a missing event program', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue(null);
    const { updateCollaboratorRole } = await loadService(prisma);

    await expect(
      updateCollaboratorRole(
        buildUser({ globalRole: 'ADMIN' }),
        { eventProgramId: 'missing' },
        'user-002',
        'VIEWER',
        NOW,
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(prisma.collaboration.update).not.toHaveBeenCalled();
  });

  it('rejects role changes on archived event programs', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ARCHIVED' });
    const { updateCollaboratorRole } = await loadService(prisma);

    await expect(
      updateCollaboratorRole(
        buildUser({ globalRole: 'ADMIN' }),
        { eventProgramId: 'p1' },
        'user-002',
        'VIEWER',
        NOW,
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: 'Archived event programs cannot be modified.',
    });
    expect(prisma.collaboration.update).not.toHaveBeenCalled();
  });

  it('returns 404 when the role change targets a missing collaborator', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
    prisma.collaboration.findFirst.mockResolvedValue(null);
    const { updateCollaboratorRole } = await loadService(prisma);

    await expect(
      updateCollaboratorRole(
        buildUser({ globalRole: 'ADMIN' }),
        { eventProgramId: 'p1' },
        'user-002',
        'VIEWER',
        NOW,
      ),
    ).rejects.toMatchObject({ statusCode: 404, message: 'Collaborator not found.' });
  });

  it('rejects a role change that strips ROLE_DEFAULT grants the actor does not hold', async () => {
    const prisma = createPrismaMock();
    prisma.collaboration.findMany.mockResolvedValue([
      collaboration(
        grant(PERMISSIONS.PERMISSION_GRANT),
        ...ROLE_DEFAULTS.VIEWER.map((name) => grant(name)),
      ),
    ]);
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
    prisma.collaboration.findFirst.mockResolvedValue({
      id: 'collab-001',
      permissions: [{ permission: { name: PERMISSIONS.ACTIVITY_UPDATE } }],
    });
    const { updateCollaboratorRole } = await loadService(prisma);

    await expect(
      updateCollaboratorRole(buildUser(), { eventProgramId: 'p1' }, 'user-002', 'VIEWER', NOW),
    ).rejects.toMatchObject({
      statusCode: 403,
      message: 'Cannot remove a collaborator with permissions you do not hold.',
    });
    expect(prisma.collaboration.update).not.toHaveBeenCalled();
  });

  it('rejects assigning a role that exceeds the actor permissions on role change', async () => {
    const prisma = createPrismaMock();
    prisma.collaboration.findMany.mockResolvedValue([
      collaboration(grant(PERMISSIONS.PERMISSION_GRANT)),
    ]);
    const { updateCollaboratorRole } = await loadService(prisma);

    await expect(
      updateCollaboratorRole(buildUser(), { eventProgramId: 'p1' }, 'user-002', 'EDITOR', NOW),
    ).rejects.toMatchObject({
      statusCode: 403,
      message: 'Cannot assign a role that exceeds your own permissions.',
    });
    expect(prisma.eventProgram.findUnique).not.toHaveBeenCalled();
  });

  it('rejects removing a collaborator holding permissions the actor lacks', async () => {
    const prisma = createPrismaMock();
    prisma.collaboration.findMany.mockResolvedValue([
      collaboration(grant(PERMISSIONS.PERMISSION_GRANT)),
    ]);
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
    prisma.collaboration.findFirst.mockResolvedValue({
      id: 'collab-001',
      permissions: [{ permission: { name: PERMISSIONS.ACTIVITY_UPDATE } }],
    });
    const { removeCollaborator } = await loadService(prisma);

    await expect(
      removeCollaborator(buildUser(), { eventProgramId: 'p1' }, 'user-002', NOW),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(prisma.collaboration.delete).not.toHaveBeenCalled();
  });

  it('lets ADMIN remove any collaborator', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
    prisma.collaboration.findFirst.mockResolvedValue({
      id: 'collab-001',
      user: { globalRole: 'USER', isActive: true },
      permissions: [{ permission: { name: PERMISSIONS.ACTIVITY_UPDATE } }],
    });
    prisma.collaboration.delete.mockResolvedValue({});
    const { removeCollaborator } = await loadService(prisma);

    await removeCollaborator(
      buildUser({ globalRole: 'ADMIN' }),
      { eventProgramId: 'p1' },
      'user-002',
      NOW,
    );

    expect(prisma.collaboration.findMany).not.toHaveBeenCalled();
    expect(prisma.collaboration.delete).toHaveBeenCalledWith({ where: { id: 'collab-001' } });
  });

  it('returns 404 when the collaborator does not exist', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
    prisma.collaboration.findFirst.mockResolvedValue(null);
    const { removeCollaborator } = await loadService(prisma);

    await expect(
      removeCollaborator(
        buildUser({ globalRole: 'ADMIN' }),
        { eventProgramId: 'p1' },
        'user-002',
        NOW,
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('returns 404 when removing from a missing event program', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue(null);
    const { removeCollaborator } = await loadService(prisma);

    await expect(
      removeCollaborator(
        buildUser({ globalRole: 'ADMIN' }),
        { eventProgramId: 'missing' },
        'user-002',
        NOW,
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(prisma.collaboration.delete).not.toHaveBeenCalled();
  });

  it('rejects removing collaborators from archived event programs', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ARCHIVED' });
    const { removeCollaborator } = await loadService(prisma);

    await expect(
      removeCollaborator(
        buildUser({ globalRole: 'ADMIN' }),
        { eventProgramId: 'p1' },
        'user-002',
        NOW,
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: 'Archived event programs cannot be modified.',
    });
    expect(prisma.collaboration.delete).not.toHaveBeenCalled();
  });

  it('blocks removing the last collaborator able to delegate', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
    prisma.collaboration.findFirst.mockResolvedValue({
      id: 'collab-001',
      user: { globalRole: 'USER', isActive: true },
      permissions: [
        { validFrom: null, validUntil: null, permission: { name: PERMISSIONS.PERMISSION_GRANT } },
      ],
    });
    prisma.collaboration.findMany.mockResolvedValue([]);
    const { removeCollaborator } = await loadService(prisma);

    await expect(
      removeCollaborator(
        buildUser({ globalRole: 'ADMIN' }),
        { eventProgramId: 'p1' },
        'user-002',
        NOW,
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: 'Cannot remove the last collaborator able to delegate in this scope.',
    });
    expect(prisma.collaboration.delete).not.toHaveBeenCalled();
  });

  it('allows removal when another active delegator remains', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
    prisma.collaboration.findFirst.mockResolvedValue({
      id: 'collab-001',
      user: { globalRole: 'USER', isActive: true },
      permissions: [
        { validFrom: null, validUntil: null, permission: { name: PERMISSIONS.PERMISSION_GRANT } },
      ],
    });
    prisma.collaboration.findMany.mockResolvedValue([
      {
        user: { globalRole: 'USER', isActive: true },
        permissions: [{ validFrom: null, validUntil: null }],
      },
    ]);
    prisma.collaboration.delete.mockResolvedValue({});
    const { removeCollaborator } = await loadService(prisma);

    await removeCollaborator(
      buildUser({ globalRole: 'ADMIN' }),
      { eventProgramId: 'p1' },
      'user-002',
      NOW,
    );

    expect(prisma.collaboration.delete).toHaveBeenCalledWith({ where: { id: 'collab-001' } });
  });

  it('ignores expired delegator grants when counting remaining delegators', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
    prisma.collaboration.findFirst.mockResolvedValue({
      id: 'collab-001',
      user: { globalRole: 'USER', isActive: true },
      permissions: [
        { validFrom: null, validUntil: null, permission: { name: PERMISSIONS.PERMISSION_GRANT } },
      ],
    });
    prisma.collaboration.findMany.mockResolvedValue([
      {
        user: { globalRole: 'USER', isActive: true },
        permissions: [{ validFrom: null, validUntil: new Date('2026-09-18T12:00:00.000Z') }],
      },
    ]);
    const { removeCollaborator } = await loadService(prisma);

    await expect(
      removeCollaborator(
        buildUser({ globalRole: 'ADMIN' }),
        { eventProgramId: 'p1' },
        'user-002',
        NOW,
      ),
    ).rejects.toMatchObject({ statusCode: 409 });
  });

  it('counts ADMIN collaborators and ignores inactive collaborators', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
    prisma.collaboration.findFirst.mockResolvedValue({
      id: 'collab-001',
      user: { globalRole: 'USER', isActive: true },
      permissions: [
        { validFrom: null, validUntil: null, permission: { name: PERMISSIONS.PERMISSION_GRANT } },
      ],
    });
    prisma.collaboration.findMany.mockResolvedValue([
      {
        user: { globalRole: 'USER', isActive: false },
        permissions: [{ validFrom: null, validUntil: null }],
      },
      { user: { globalRole: 'ADMIN', isActive: true }, permissions: [] },
    ]);
    prisma.collaboration.delete.mockResolvedValue({});
    const { removeCollaborator } = await loadService(prisma);

    await removeCollaborator(
      buildUser({ globalRole: 'ADMIN' }),
      { eventProgramId: 'p1' },
      'user-002',
      NOW,
    );

    expect(prisma.collaboration.delete).toHaveBeenCalledTimes(1);
  });

  it('counts inherited program delegators for activity scopes', async () => {
    const prisma = createPrismaMock();
    prisma.activity.findUnique.mockResolvedValue({ eventProgramId: 'p1' });
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
    prisma.collaboration.findFirst.mockResolvedValue({
      id: 'collab-001',
      user: { globalRole: 'USER', isActive: true },
      permissions: [
        { validFrom: null, validUntil: null, permission: { name: PERMISSIONS.PERMISSION_GRANT } },
      ],
    });
    prisma.collaboration.findMany.mockResolvedValue([
      {
        user: { globalRole: 'USER', isActive: true },
        permissions: [{ validFrom: null, validUntil: null }],
      },
    ]);
    prisma.collaboration.delete.mockResolvedValue({});
    const { removeCollaborator } = await loadService(prisma);

    await removeCollaborator(
      buildUser({ globalRole: 'ADMIN' }),
      { activityId: 'a1' },
      'user-002',
      NOW,
    );

    expect(prisma.collaboration.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [{ activityId: 'a1' }, { eventProgramId: 'p1' }],
          userId: { not: 'user-002' },
        },
      }),
    );
    expect(prisma.collaboration.delete).toHaveBeenCalledTimes(1);
  });

  it('skips the delegator guard when the target cannot delegate', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
    prisma.collaboration.findFirst.mockResolvedValue({
      id: 'collab-001',
      user: { globalRole: 'USER', isActive: true },
      permissions: [
        { validFrom: null, validUntil: null, permission: { name: PERMISSIONS.ACTIVITY_UPDATE } },
      ],
    });
    prisma.collaboration.delete.mockResolvedValue({});
    const { removeCollaborator } = await loadService(prisma);

    await removeCollaborator(
      buildUser({ globalRole: 'ADMIN' }),
      { eventProgramId: 'p1' },
      'user-002',
      NOW,
    );

    expect(prisma.collaboration.findMany).not.toHaveBeenCalled();
    expect(prisma.collaboration.delete).toHaveBeenCalledTimes(1);
  });

  it('blocks a non-admin from removing themselves as the last delegator', async () => {
    const prisma = createPrismaMock();
    prisma.collaboration.findMany
      .mockResolvedValueOnce([collaboration(grant(PERMISSIONS.PERMISSION_GRANT))])
      .mockResolvedValueOnce([]);
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
    prisma.collaboration.findFirst.mockResolvedValue({
      id: 'collab-001',
      user: { globalRole: 'USER', isActive: true },
      permissions: [
        { validFrom: null, validUntil: null, permission: { name: PERMISSIONS.PERMISSION_GRANT } },
      ],
    });
    const { removeCollaborator } = await loadService(prisma);

    await expect(
      removeCollaborator(buildUser(), { eventProgramId: 'p1' }, 'actor-001', NOW),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: 'Cannot remove the last collaborator able to delegate in this scope.',
    });
    expect(prisma.collaboration.delete).not.toHaveBeenCalled();
  });

  it('rejects listing collaborators without permission:grant', async () => {
    const prisma = createPrismaMock();
    prisma.collaboration.findMany.mockResolvedValue([
      collaboration(grant(PERMISSIONS.PROGRAM_READ)),
    ]);
    const { listCollaborators } = await loadService(prisma);

    await expect(
      listCollaborators(buildUser(), { eventProgramId: 'p1' }, NOW),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(prisma.collaboration.findMany).toHaveBeenCalledTimes(1);
  });

  it('returns 404 when listing a missing event program', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue(null);
    const { listCollaborators } = await loadService(prisma);

    await expect(
      listCollaborators(buildUser({ globalRole: 'ADMIN' }), { eventProgramId: 'missing' }, NOW),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(prisma.collaboration.findMany).not.toHaveBeenCalled();
  });

  it('lists the local collaborators of a program with their grants sorted by name', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
    prisma.collaboration.findMany.mockResolvedValue([
      collaboratorRecord({
        permissions: [
          {
            source: 'OVERRIDE',
            validFrom: new Date('2026-09-19T10:00:00.000Z'),
            validUntil: new Date('2026-09-30T10:00:00.000Z'),
            permission: { name: PERMISSIONS.REPORT_EXPORT },
          },
          {
            source: 'ROLE_DEFAULT',
            validFrom: null,
            validUntil: null,
            permission: { name: PERMISSIONS.ACTIVITY_READ },
          },
          {
            source: 'ROLE_DEFAULT',
            validFrom: null,
            validUntil: null,
            permission: { name: 'legacy:unknown' },
          },
        ],
      }),
    ]);
    const { listCollaborators } = await loadService(prisma);

    const result = await listCollaborators(
      buildUser({ globalRole: 'ADMIN' }),
      { eventProgramId: 'p1' },
      NOW,
    );

    expect(prisma.collaboration.findMany).toHaveBeenCalledWith({
      where: { eventProgramId: 'p1' },
      orderBy: [{ createdAt: 'asc' }, { userId: 'asc' }],
      select: expect.any(Object),
    });
    expect(result).toEqual({
      items: [
        {
          userId: 'user-002',
          firstName: 'Ada',
          lastName: 'Lovelace',
          email: 'ada@example.com',
          role: 'VIEWER',
          createdAt: '2026-09-19T12:00:00.000Z',
          permissions: [
            {
              name: PERMISSIONS.ACTIVITY_READ,
              source: 'ROLE_DEFAULT',
              origin: 'LOCAL',
              validFrom: null,
              validUntil: null,
              effective: true,
            },
            {
              name: PERMISSIONS.REPORT_EXPORT,
              source: 'OVERRIDE',
              origin: 'LOCAL',
              validFrom: '2026-09-19T10:00:00.000Z',
              validUntil: '2026-09-30T10:00:00.000Z',
              effective: true,
            },
          ],
        },
      ],
    });
    expect(JSON.stringify(result)).not.to.include('grantedById');
    expect(JSON.stringify(result)).not.to.include('grantedAt');
  });

  it('lists activity-local collaborators using the activity scope', async () => {
    const prisma = createPrismaMock();
    prisma.activity.findUnique.mockResolvedValue({ eventProgramId: 'p1' });
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
    prisma.collaboration.findMany.mockResolvedValue([]);
    const { listCollaborators } = await loadService(prisma);

    const result = await listCollaborators(
      buildUser({ globalRole: 'ADMIN' }),
      { activityId: 'a1' },
      NOW,
    );

    expect(result).toEqual({ items: [] });
    expect(prisma.collaboration.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { activityId: 'a1' },
      }),
    );
  });

  it('marks inherited program permissions in an activity scope', async () => {
    const prisma = createPrismaMock();
    prisma.activity.findUnique.mockResolvedValue({ eventProgramId: 'p1' });
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
    prisma.collaboration.findMany
      .mockResolvedValueOnce([
        collaboratorRecord({
          eventProgramId: null,
          activityId: 'a1',
          permissions: [
            {
              source: 'ROLE_DEFAULT',
              validFrom: null,
              validUntil: null,
              permission: { name: PERMISSIONS.ACTIVITY_READ },
            },
          ],
        }),
      ])
      .mockResolvedValueOnce([
        {
          userId: 'user-002',
          eventProgramId: 'p1',
          activityId: null,
          permissions: [
            {
              validFrom: null,
              validUntil: null,
              permission: { name: PERMISSIONS.ACTIVITY_READ },
            },
            {
              validFrom: null,
              validUntil: null,
              permission: { name: PERMISSIONS.PERMISSION_GRANT },
              source: 'OVERRIDE',
            },
          ],
        },
      ]);
    const { listCollaborators } = await loadService(prisma);

    const result = await listCollaborators(
      buildUser({ globalRole: 'ADMIN' }),
      { activityId: 'a1' },
      NOW,
    );

    expect(prisma.collaboration.findMany).toHaveBeenNthCalledWith(1, {
      where: { activityId: 'a1' },
      orderBy: [{ createdAt: 'asc' }, { userId: 'asc' }],
      select: expect.any(Object),
    });
    expect(prisma.collaboration.findMany).toHaveBeenNthCalledWith(2, {
      where: { eventProgramId: 'p1' },
      select: expect.any(Object),
    });
    expect(result).toEqual({
      items: [
        expect.objectContaining({
          userId: 'user-002',
          permissions: [
            {
              name: PERMISSIONS.ACTIVITY_READ,
              source: 'ROLE_DEFAULT',
              origin: 'BOTH',
              validFrom: null,
              validUntil: null,
              effective: true,
            },
            {
              name: PERMISSIONS.PERMISSION_GRANT,
              source: 'OVERRIDE',
              origin: 'INHERITED',
              validFrom: null,
              validUntil: null,
              effective: true,
            },
          ],
        }),
      ],
    });
  });

  it('omits expired and future local grants while keeping active inheritance', async () => {
    const prisma = createPrismaMock();
    prisma.activity.findUnique.mockResolvedValue({ eventProgramId: 'p1' });
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
    prisma.collaboration.findMany
      .mockResolvedValueOnce([
        collaboratorRecord({
          eventProgramId: null,
          activityId: 'a1',
          permissions: [
            {
              source: 'OVERRIDE',
              validFrom: null,
              validUntil: new Date('2026-09-19T11:59:59.000Z'),
              permission: { name: PERMISSIONS.ACTIVITY_UPDATE },
            },
            {
              source: 'ROLE_DEFAULT',
              validFrom: new Date('2026-09-19T12:00:01.000Z'),
              validUntil: null,
              permission: { name: PERMISSIONS.ATTENDANCE_CHECKIN },
            },
          ],
        }),
      ])
      .mockResolvedValueOnce([
        {
          userId: 'user-002',
          eventProgramId: 'p1',
          activityId: null,
          permissions: [
            {
              validFrom: null,
              validUntil: null,
              permission: { name: PERMISSIONS.ACTIVITY_UPDATE },
              source: 'ROLE_DEFAULT',
            },
          ],
        },
      ]);
    const { listCollaborators } = await loadService(prisma);

    const result = await listCollaborators(
      buildUser({ globalRole: 'ADMIN' }),
      { activityId: 'a1' },
      NOW,
    );

    expect(result).toEqual({
      items: [
        expect.objectContaining({
          userId: 'user-002',
          permissions: [
            {
              name: PERMISSIONS.ACTIVITY_UPDATE,
              source: 'ROLE_DEFAULT',
              origin: 'INHERITED',
              validFrom: null,
              validUntil: null,
              effective: true,
            },
          ],
        }),
      ],
    });
    expect(JSON.stringify(result)).not.to.include('attendance:checkin');
  });

  it('keeps program grants as local and ignores expired ones', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
    prisma.collaboration.findMany
      .mockResolvedValueOnce([
        collaboratorRecord({
          permissions: [
            {
              source: 'ROLE_DEFAULT',
              validFrom: null,
              validUntil: null,
              permission: { name: PERMISSIONS.REPORT_VIEW },
            },
            {
              source: 'OVERRIDE',
              validFrom: null,
              validUntil: new Date('2026-09-19T11:59:59.000Z'),
              permission: { name: PERMISSIONS.REPORT_EXPORT },
            },
          ],
        }),
      ])
      .mockResolvedValueOnce([]);
    const { listCollaborators } = await loadService(prisma);

    const result = await listCollaborators(
      buildUser({ globalRole: 'ADMIN' }),
      { eventProgramId: 'p1' },
      NOW,
    );

    expect(prisma.collaboration.findMany).toHaveBeenCalledTimes(2);
    expect(result).toEqual({
      items: [
        expect.objectContaining({
          userId: 'user-002',
          permissions: [
            {
              name: PERMISSIONS.REPORT_VIEW,
              source: 'ROLE_DEFAULT',
              origin: 'LOCAL',
              validFrom: null,
              validUntil: null,
              effective: true,
            },
          ],
        }),
      ],
    });
  });

  it('lists each activity collaborator once even when it also collaborates in the program', async () => {
    const prisma = createPrismaMock();
    prisma.activity.findUnique.mockResolvedValue({ eventProgramId: 'p1' });
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
    prisma.collaboration.findMany
      .mockResolvedValueOnce([
        collaboratorRecord({
          eventProgramId: null,
          activityId: 'a1',
          permissions: [
            {
              source: 'ROLE_DEFAULT',
              validFrom: null,
              validUntil: null,
              permission: { name: PERMISSIONS.ATTENDANCE_CHECKIN },
            },
          ],
        }),
      ])
      .mockResolvedValueOnce([
        {
          userId: 'user-002',
          eventProgramId: 'p1',
          activityId: null,
          permissions: [
            {
              source: 'ROLE_DEFAULT',
              validFrom: null,
              validUntil: null,
              permission: { name: PERMISSIONS.ATTENDANCE_CHECKIN },
            },
          ],
        },
      ]);
    const { listCollaborators } = await loadService(prisma);

    const result = await listCollaborators(
      buildUser({ globalRole: 'ADMIN' }),
      { activityId: 'a1' },
      NOW,
    );

    expect(result.items).toHaveLength(1);
    expect(prisma.collaboration.findMany).toHaveBeenNthCalledWith(1, {
      where: { activityId: 'a1' },
      orderBy: [{ createdAt: 'asc' }, { userId: 'asc' }],
      select: expect.any(Object),
    });
  });

  it('prefers the OVERRIDE source when a local override is active', async () => {
    const prisma = createPrismaMock();
    prisma.activity.findUnique.mockResolvedValue({ eventProgramId: 'p1' });
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
    prisma.collaboration.findMany
      .mockResolvedValueOnce([
        collaboratorRecord({
          eventProgramId: null,
          activityId: 'a1',
          permissions: [
            {
              source: 'OVERRIDE',
              validFrom: null,
              validUntil: null,
              permission: { name: PERMISSIONS.CERTIFICATE_GENERATE },
            },
            {
              source: 'ROLE_DEFAULT',
              validFrom: null,
              validUntil: null,
              permission: { name: PERMISSIONS.ATTENDANCE_CHECKIN },
            },
          ],
        }),
      ])
      .mockResolvedValueOnce([
        {
          userId: 'user-002',
          eventProgramId: 'p1',
          activityId: null,
          permissions: [
            {
              source: 'ROLE_DEFAULT',
              validFrom: null,
              validUntil: null,
              permission: { name: PERMISSIONS.CERTIFICATE_GENERATE },
            },
            {
              source: 'ROLE_DEFAULT',
              validFrom: null,
              validUntil: null,
              permission: { name: PERMISSIONS.ATTENDANCE_CHECKIN },
            },
          ],
        },
      ]);
    const { listCollaborators } = await loadService(prisma);

    const result = await listCollaborators(
      buildUser({ globalRole: 'ADMIN' }),
      { activityId: 'a1' },
      NOW,
    );

    expect(result).toEqual({
      items: [
        expect.objectContaining({
          userId: 'user-002',
          permissions: [
            {
              name: PERMISSIONS.ATTENDANCE_CHECKIN,
              source: 'ROLE_DEFAULT',
              origin: 'BOTH',
              validFrom: null,
              validUntil: null,
              effective: true,
            },
            {
              name: PERMISSIONS.CERTIFICATE_GENERATE,
              source: 'OVERRIDE',
              origin: 'BOTH',
              validFrom: null,
              validUntil: null,
              effective: true,
            },
          ],
        }),
      ],
    });
  });

  it('returns 404 when adding a collaborator to a missing event program', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue(null);
    const { addCollaborator } = await loadService(prisma);

    await expect(
      addCollaborator(
        buildUser({ globalRole: 'ADMIN' }),
        { eventProgramId: 'missing' },
        'user-002',
        'VIEWER',
        NOW,
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(prisma.collaboration.create).not.toHaveBeenCalled();
  });

  it('rejects adding collaborators to an archived event program', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ARCHIVED' });
    const { addCollaborator } = await loadService(prisma);

    await expect(
      addCollaborator(
        buildUser({ globalRole: 'ADMIN' }),
        { eventProgramId: 'p1' },
        'user-002',
        'VIEWER',
        NOW,
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: 'Archived event programs cannot be modified.',
    });
    expect(prisma.collaboration.create).not.toHaveBeenCalled();
  });

  it('returns the created collaborator as a DTO', async () => {
    const prisma = createPrismaMock();
    prisma.permission.findMany.mockResolvedValue(permissionRecords(ROLE_DEFAULTS.VIEWER));
    prisma.user.findUnique.mockResolvedValue({ id: 'user-002', isActive: true });
    prisma.collaboration.findFirst.mockResolvedValue(null);
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
    prisma.collaboration.create.mockResolvedValue(collaboratorRecord());
    const { addCollaborator } = await loadService(prisma);

    const result = await addCollaborator(
      buildUser({ globalRole: 'ADMIN' }),
      { eventProgramId: 'p1' },
      'user-002',
      'VIEWER',
      NOW,
    );

    expect(result).toEqual({
      userId: 'user-002',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      role: 'VIEWER',
      createdAt: '2026-09-19T12:00:00.000Z',
      permissions: [
        {
          name: PERMISSIONS.ACTIVITY_READ,
          source: 'ROLE_DEFAULT',
          validFrom: null,
          validUntil: null,
        },
      ],
    });
  });
});

const HOUR_MS = 60 * 60 * 1000;

describe('delegation service expiry with the system clock and default now', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.doUnmock('../../config/prisma.js');
  });

  it('ignores a local grant that expires while the clock advances without deleting it', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
    const record = collaboratorRecord({
      permissions: [
        {
          source: 'OVERRIDE',
          validFrom: null,
          validUntil: new Date(NOW.getTime() + HOUR_MS),
          permission: { name: PERMISSIONS.REPORT_EXPORT },
        },
      ],
    });
    prisma.collaboration.findMany
      .mockResolvedValueOnce([record])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([record])
      .mockResolvedValueOnce([]);
    const { listCollaborators } = await loadService(prisma);

    const active = await listCollaborators(buildUser({ globalRole: 'ADMIN' }), {
      eventProgramId: 'p1',
    });
    expect(active.items[0]?.permissions.map((entry) => entry.name)).toEqual([
      PERMISSIONS.REPORT_EXPORT,
    ]);

    vi.setSystemTime(new Date(NOW.getTime() + HOUR_MS));
    const expired = await listCollaborators(buildUser({ globalRole: 'ADMIN' }), {
      eventProgramId: 'p1',
    });
    expect(expired.items[0]?.permissions).toEqual([]);

    expect(prisma.collaborationPermission.upsert).not.toHaveBeenCalled();
    expect(prisma.collaborationPermission.createMany).not.toHaveBeenCalled();
    expect(prisma.collaborationPermission.deleteMany).not.toHaveBeenCalled();
  });

  it('uses the system clock for the last delegator guard and does not delete on denial', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW.getTime() + HOUR_MS - 1));
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
    prisma.collaboration.findFirst.mockResolvedValue({
      id: 'collab-001',
      user: { globalRole: 'USER', isActive: true },
      permissions: [
        { validFrom: null, validUntil: null, permission: { name: PERMISSIONS.PERMISSION_GRANT } },
      ],
    });
    prisma.collaboration.findMany.mockResolvedValue([
      {
        user: { globalRole: 'USER', isActive: true },
        permissions: [{ validFrom: null, validUntil: new Date(NOW.getTime() + HOUR_MS) }],
      },
    ]);
    prisma.collaboration.delete.mockResolvedValue({});
    const { removeCollaborator } = await loadService(prisma);

    await removeCollaborator(
      buildUser({ globalRole: 'ADMIN' }),
      { eventProgramId: 'p1' },
      'user-002',
    );
    expect(prisma.collaboration.delete).toHaveBeenCalledTimes(1);

    prisma.collaboration.delete.mockClear();
    vi.setSystemTime(new Date(NOW.getTime() + HOUR_MS));

    await expect(
      removeCollaborator(buildUser({ globalRole: 'ADMIN' }), { eventProgramId: 'p1' }, 'user-002'),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect(prisma.collaboration.delete).not.toHaveBeenCalled();
  });
});

describe('delegation service audit minimization', () => {
  afterEach(() => {
    vi.doUnmock('../../config/prisma.js');
  });

  it('strips audit fields from listed rows and never selects them', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
    prisma.collaboration.findMany.mockResolvedValue([
      collaboratorRecord({
        grantedById: 'actor-001',
        grantedAt: new Date('2026-09-19T10:00:00.000Z'),
        permissions: [
          {
            source: 'ROLE_DEFAULT',
            validFrom: null,
            validUntil: null,
            grantedById: 'actor-001',
            grantedAt: new Date('2026-09-19T10:00:00.000Z'),
            permission: { name: PERMISSIONS.ACTIVITY_READ },
          },
        ],
      }),
    ]);
    const { listCollaborators } = await loadService(prisma);

    const result = await listCollaborators(
      buildUser({ globalRole: 'ADMIN' }),
      { eventProgramId: 'p1' },
      NOW,
    );

    const serialized = JSON.stringify(result);
    expect(serialized).not.to.include('grantedBy');
    expect(serialized).not.to.include('grantedAt');
    for (const call of prisma.collaboration.findMany.mock.calls) {
      const args = call[0] as { select: unknown };
      expect(JSON.stringify(args.select)).not.to.include('grantedBy');
      expect(JSON.stringify(args.select)).not.to.include('grantedAt');
    }
  });

  it('strips audit fields from the created collaborator response', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
    prisma.user.findUnique.mockResolvedValue({ id: 'user-002', isActive: true });
    prisma.collaboration.findFirst.mockResolvedValue(null);
    prisma.permission.findMany.mockResolvedValue(permissionRecords(ROLE_DEFAULTS.VIEWER));
    prisma.collaboration.create.mockResolvedValue(
      collaboratorRecord({
        grantedById: 'actor-001',
        grantedAt: new Date('2026-09-19T12:00:00.000Z'),
        permissions: [
          {
            source: 'ROLE_DEFAULT',
            validFrom: null,
            validUntil: null,
            grantedById: 'actor-001',
            grantedAt: new Date('2026-09-19T12:00:00.000Z'),
            permission: { name: PERMISSIONS.ACTIVITY_READ },
          },
        ],
      }),
    );
    const { addCollaborator } = await loadService(prisma);

    const result = await addCollaborator(
      buildUser({ globalRole: 'ADMIN' }),
      { eventProgramId: 'p1' },
      'user-002',
      'VIEWER',
      NOW,
    );

    const serialized = JSON.stringify(result);
    expect(serialized).not.to.include('grantedBy');
    expect(serialized).not.to.include('grantedAt');
    const createArgs = prisma.collaboration.create.mock.calls[0]?.[0] as {
      select: unknown;
      data: unknown;
    };
    expect(JSON.stringify(createArgs.select)).not.to.include('grantedBy');
    expect(JSON.stringify(createArgs.data)).to.include('grantedById');
  });

  it('strips audit fields from the role update response', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
    prisma.collaboration.findFirst.mockResolvedValue({
      id: 'collab-001',
      permissions: [{ permission: { name: PERMISSIONS.ACTIVITY_READ } }],
    });
    prisma.permission.findMany.mockResolvedValue(permissionRecords(ROLE_DEFAULTS.EDITOR));
    prisma.collaboration.update.mockResolvedValue({});
    prisma.collaborationPermission.deleteMany.mockResolvedValue({ count: 1 });
    prisma.collaborationPermission.createMany.mockResolvedValue({ count: 11 });
    prisma.collaboration.findUniqueOrThrow.mockResolvedValue(
      collaboratorRecord({
        role: 'EDITOR',
        grantedById: 'actor-001',
        grantedAt: new Date('2026-09-19T12:00:00.000Z'),
      }),
    );
    const { updateCollaboratorRole } = await loadService(prisma);

    const result = await updateCollaboratorRole(
      buildUser({ globalRole: 'ADMIN' }),
      { eventProgramId: 'p1' },
      'user-002',
      'EDITOR',
      NOW,
    );

    const serialized = JSON.stringify(result);
    expect(serialized).not.to.include('grantedBy');
    expect(serialized).not.to.include('grantedAt');
    const readArgs = prisma.collaboration.findUniqueOrThrow.mock.calls[0]?.[0] as {
      select: unknown;
    };
    expect(JSON.stringify(readArgs.select)).not.to.include('grantedBy');
    const createManyArgs = prisma.collaborationPermission.createMany.mock.calls[0]?.[0] as {
      data: unknown;
    };
    expect(JSON.stringify(createManyArgs.data)).to.include('grantedById');
  });

  it('strips audit fields from the grant response while persisting them', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
    prisma.collaboration.findFirst.mockResolvedValue({ id: 'collab-001' });
    prisma.permission.findUnique.mockResolvedValue({
      id: 'perm-grant',
      name: PERMISSIONS.PERMISSION_GRANT,
    });
    prisma.collaborationPermission.upsert.mockResolvedValue({});
    prisma.collaboration.findUniqueOrThrow.mockResolvedValue(
      collaboratorRecord({
        grantedById: 'actor-001',
        grantedAt: new Date('2026-09-19T12:00:00.000Z'),
      }),
    );
    const { grantPermission } = await loadService(prisma);

    const result = await grantPermission(
      buildUser({ globalRole: 'ADMIN' }),
      { eventProgramId: 'p1' },
      'user-002',
      PERMISSIONS.PERMISSION_GRANT,
      {},
      NOW,
    );

    const serialized = JSON.stringify(result);
    expect(serialized).not.to.include('grantedBy');
    expect(serialized).not.to.include('grantedAt');
    expect(prisma.collaborationPermission.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ grantedById: 'actor-001', grantedAt: NOW }),
      }),
    );
    const readArgs = prisma.collaboration.findUniqueOrThrow.mock.calls[0]?.[0] as {
      select: unknown;
    };
    expect(JSON.stringify(readArgs.select)).not.to.include('grantedBy');
  });
});

describe('delegation service audit trail', () => {
  const AUDIT_CONTEXT = { requestId: 'request-001' };

  const auditPayloads = (prisma: PrismaMock) =>
    prisma.auditEvent.create.mock.calls.map(
      (call) => (call[0] as { data: Record<string, unknown> }).data,
    );

  const baseScope = { eventProgramId: 'p1' };

  afterEach(() => {
    vi.doUnmock('../../config/prisma.js');
  });

  it('audits a collaborator addition with role, scope and target user', async () => {
    const prisma = createPrismaMock();
    prisma.permission.findMany.mockResolvedValue(permissionRecords(ROLE_DEFAULTS.VIEWER));
    prisma.user.findUnique.mockResolvedValue({ id: 'user-002', isActive: true });
    prisma.collaboration.findFirst.mockResolvedValue(null);
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
    prisma.collaboration.create.mockResolvedValue(collaboratorRecord({ id: 'collab-009' }));
    const { addCollaborator } = await loadService(prisma);

    await addCollaborator(
      buildUser({ globalRole: 'ADMIN' }),
      baseScope,
      'user-002',
      'VIEWER',
      NOW,
      AUDIT_CONTEXT,
    );

    const payloads = auditPayloads(prisma);
    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toMatchObject({
      action: 'authorization.collaborator_added',
      actorType: 'USER',
      actorId: 'actor-001',
      resourceType: 'collaboration',
      resourceId: 'collab-009',
      scopeType: 'event_program',
      scopeId: 'p1',
      targetUserId: 'user-002',
      requestId: 'request-001',
    });
    expect(payloads[0]?.['changes']).toMatchObject({
      after: { role: 'VIEWER', permissions: ROLE_DEFAULTS.VIEWER },
    });
  });

  it('audits an activity scoped collaborator with the activity scope type', async () => {
    const prisma = createPrismaMock();
    prisma.permission.findMany.mockResolvedValue(permissionRecords(ROLE_DEFAULTS.VIEWER));
    prisma.user.findUnique.mockResolvedValue({ id: 'user-002', isActive: true });
    prisma.collaboration.findFirst.mockResolvedValue(null);
    prisma.activity.findUnique.mockResolvedValue({ id: 'act-1', eventProgramId: 'p1' });
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
    prisma.collaboration.create.mockResolvedValue(
      collaboratorRecord({ id: 'collab-010', activityId: 'act-1', eventProgramId: null }),
    );
    const { addCollaborator } = await loadService(prisma);

    await addCollaborator(
      buildUser({ globalRole: 'ADMIN' }),
      { activityId: 'act-1' },
      'user-002',
      'VIEWER',
      NOW,
      AUDIT_CONTEXT,
    );

    expect(auditPayloads(prisma)[0]).toMatchObject({
      action: 'authorization.collaborator_added',
      scopeType: 'activity',
      scopeId: 'act-1',
    });
  });

  it('does not audit a rejected collaborator addition', async () => {
    const prisma = createPrismaMock();
    prisma.permission.findMany.mockResolvedValue(permissionRecords(ROLE_DEFAULTS.VIEWER));
    prisma.user.findUnique.mockResolvedValue({ id: 'user-002', isActive: true });
    prisma.collaboration.findFirst.mockResolvedValue({ id: 'collab-001' });
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
    const { addCollaborator } = await loadService(prisma);

    await expect(
      addCollaborator(
        buildUser({ globalRole: 'ADMIN' }),
        baseScope,
        'user-002',
        'VIEWER',
        NOW,
        AUDIT_CONTEXT,
      ),
    ).rejects.toMatchObject({ statusCode: 409 });

    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it('does not audit when the actor cannot delegate', async () => {
    const prisma = createPrismaMock();
    prisma.collaboration.findMany.mockResolvedValue([
      collaboration(grant(PERMISSIONS.PROGRAM_READ)),
    ]);
    const { addCollaborator } = await loadService(prisma);

    await expect(
      addCollaborator(buildUser(), baseScope, 'user-002', 'VIEWER', NOW, AUDIT_CONTEXT),
    ).rejects.toMatchObject({ statusCode: 403 });

    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it('audits the collaborator role change from the previous role to the new one', async () => {
    const prisma = createPrismaMock();
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
    prisma.collaboration.findFirst.mockResolvedValue({
      id: 'collab-001',
      role: 'VIEWER',
      permissions: [{ permission: { name: PERMISSIONS.ACTIVITY_READ } }],
    });
    prisma.permission.findMany.mockResolvedValue(permissionRecords(ROLE_DEFAULTS.EDITOR));
    prisma.collaboration.update.mockResolvedValue({});
    prisma.collaborationPermission.deleteMany.mockResolvedValue({ count: 1 });
    prisma.collaborationPermission.createMany.mockResolvedValue({ count: 11 });
    prisma.collaboration.findUniqueOrThrow.mockResolvedValue(
      collaboratorRecord({ id: 'collab-001', role: 'EDITOR' }),
    );
    const { updateCollaboratorRole } = await loadService(prisma);

    await updateCollaboratorRole(
      buildUser({ globalRole: 'ADMIN' }),
      baseScope,
      'user-002',
      'EDITOR',
      NOW,
      AUDIT_CONTEXT,
    );

    const payloads = auditPayloads(prisma);
    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toMatchObject({
      action: 'authorization.collaborator_role_changed',
      actorId: 'actor-001',
      resourceType: 'collaboration',
      resourceId: 'collab-001',
      scopeType: 'event_program',
      scopeId: 'p1',
      targetUserId: 'user-002',
      requestId: 'request-001',
    });
    expect(payloads[0]?.['changes']).toMatchObject({
      before: { role: 'VIEWER' },
      after: { role: 'EDITOR' },
    });
  });

  it('does not audit a role change rejected by the envelope check', async () => {
    const prisma = createPrismaMock();
    prisma.collaboration.findMany.mockResolvedValue([
      collaboration(grant(PERMISSIONS.PERMISSION_GRANT)),
    ]);
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
    prisma.collaboration.findFirst.mockResolvedValue({
      id: 'collab-001',
      role: 'VIEWER',
      permissions: [{ permission: { name: PERMISSIONS.ACTIVITY_READ } }],
    });
    const { updateCollaboratorRole } = await loadService(prisma);

    await expect(
      updateCollaboratorRole(buildUser(), baseScope, 'user-002', 'ORGANIZER', NOW, AUDIT_CONTEXT),
    ).rejects.toMatchObject({ statusCode: 403 });

    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it('audits the collaborator removal with the removed role', async () => {
    const prisma = createPrismaMock();
    prisma.collaboration.findMany.mockResolvedValue([
      collaboration(grant(PERMISSIONS.PERMISSION_GRANT)),
    ]);
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
    prisma.collaboration.findFirst.mockResolvedValue({
      id: 'collab-001',
      role: 'EDITOR',
      user: { globalRole: 'USER', isActive: true },
      permissions: [grant(PERMISSIONS.ACTIVITY_READ)],
    });
    prisma.collaboration.delete.mockResolvedValue({});
    const { removeCollaborator } = await loadService(prisma);

    await removeCollaborator(
      buildUser({ globalRole: 'ADMIN' }),
      baseScope,
      'user-002',
      NOW,
      AUDIT_CONTEXT,
    );

    const payloads = auditPayloads(prisma);
    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toMatchObject({
      action: 'authorization.collaborator_removed',
      actorId: 'actor-001',
      resourceType: 'collaboration',
      resourceId: 'collab-001',
      scopeType: 'event_program',
      scopeId: 'p1',
      targetUserId: 'user-002',
      requestId: 'request-001',
    });
    expect(payloads[0]?.['changes']).toMatchObject({ before: { role: 'EDITOR' } });
  });

  it('does not audit a collaborator removal rejected by the last delegator guard', async () => {
    const prisma = createPrismaMock();
    prisma.collaboration.findMany.mockResolvedValue([
      collaboration(grant(PERMISSIONS.PERMISSION_GRANT)),
    ]);
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
    prisma.collaboration.findFirst.mockResolvedValue({
      id: 'collab-001',
      role: 'ORGANIZER',
      user: { globalRole: 'USER', isActive: true },
      permissions: [grant(PERMISSIONS.PERMISSION_GRANT)],
    });
    prisma.collaboration.findMany.mockResolvedValue([]);
    const { removeCollaborator } = await loadService(prisma);

    await expect(
      removeCollaborator(
        buildUser({ globalRole: 'ADMIN' }),
        baseScope,
        'user-002',
        NOW,
        AUDIT_CONTEXT,
      ),
    ).rejects.toMatchObject({ statusCode: 409 });

    expect(prisma.collaboration.delete).not.toHaveBeenCalled();
    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it('audits a new permission grant with its window', async () => {
    const prisma = createPrismaMock();
    prisma.collaboration.findMany.mockResolvedValue([
      collaboration(grant(PERMISSIONS.PERMISSION_GRANT)),
    ]);
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
    prisma.collaboration.findFirst.mockResolvedValue({ id: 'collab-001' });
    prisma.permission.findUnique.mockResolvedValue({ id: 'perm-1' });
    prisma.collaborationPermission.findUnique.mockResolvedValue(null);
    prisma.collaborationPermission.upsert.mockResolvedValue({});
    prisma.collaboration.findUniqueOrThrow.mockResolvedValue(collaboratorRecord());
    const validFrom = new Date('2026-09-20T10:00:00.000Z');
    const validUntil = new Date('2026-09-25T10:00:00.000Z');
    const { grantPermission } = await loadService(prisma);

    await grantPermission(
      buildUser({ globalRole: 'ADMIN' }),
      baseScope,
      'user-002',
      PERMISSIONS.ACTIVITY_UPDATE,
      { validFrom, validUntil },
      NOW,
      AUDIT_CONTEXT,
    );

    const payloads = auditPayloads(prisma);
    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toMatchObject({
      action: 'authorization.permission_granted',
      actorId: 'actor-001',
      resourceType: 'collaboration_permission',
      resourceId: 'collab-001',
      scopeType: 'event_program',
      scopeId: 'p1',
      targetUserId: 'user-002',
      requestId: 'request-001',
    });
    expect(payloads[0]?.['changes']).toMatchObject({
      after: {
        permission: PERMISSIONS.ACTIVITY_UPDATE,
        validFrom: validFrom.toISOString(),
        validUntil: validUntil.toISOString(),
      },
    });
  });

  it('audits a replaced permission grant from the previous window to the new one', async () => {
    const prisma = createPrismaMock();
    prisma.collaboration.findMany.mockResolvedValue([
      collaboration(grant(PERMISSIONS.PERMISSION_GRANT)),
    ]);
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
    prisma.collaboration.findFirst.mockResolvedValue({ id: 'collab-001' });
    prisma.permission.findUnique.mockResolvedValue({ id: 'perm-1' });
    prisma.collaborationPermission.findUnique.mockResolvedValue({
      source: 'OVERRIDE',
      validFrom: new Date('2026-09-19T08:00:00.000Z'),
      validUntil: new Date('2026-09-19T09:00:00.000Z'),
    });
    prisma.collaborationPermission.upsert.mockResolvedValue({});
    prisma.collaboration.findUniqueOrThrow.mockResolvedValue(collaboratorRecord());
    const validUntil = new Date('2026-09-25T10:00:00.000Z');
    const { grantPermission } = await loadService(prisma);

    await grantPermission(
      buildUser({ globalRole: 'ADMIN' }),
      baseScope,
      'user-002',
      PERMISSIONS.ACTIVITY_UPDATE,
      { validUntil },
      NOW,
      AUDIT_CONTEXT,
    );

    const payloads = auditPayloads(prisma);
    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toMatchObject({ action: 'authorization.permission_replaced' });
    expect(payloads[0]?.['changes']).toMatchObject({
      before: {
        permission: PERMISSIONS.ACTIVITY_UPDATE,
        source: 'OVERRIDE',
        validFrom: '2026-09-19T08:00:00.000Z',
        validUntil: '2026-09-19T09:00:00.000Z',
      },
      after: {
        permission: PERMISSIONS.ACTIVITY_UPDATE,
        validFrom: null,
        validUntil: validUntil.toISOString(),
      },
    });
  });

  it('does not audit a grant rejected by the envelope check', async () => {
    const prisma = createPrismaMock();
    prisma.collaboration.findMany.mockResolvedValue([
      collaboration(grant(PERMISSIONS.PERMISSION_GRANT)),
    ]);
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
    prisma.collaboration.findFirst.mockResolvedValue({ id: 'collab-001' });
    const { grantPermission } = await loadService(prisma);

    await expect(
      grantPermission(
        buildUser(),
        baseScope,
        'user-002',
        PERMISSIONS.ACTIVITY_UPDATE,
        {},
        NOW,
        AUDIT_CONTEXT,
      ),
    ).rejects.toMatchObject({ statusCode: 403 });

    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it('audits a permission revocation with the revoked window', async () => {
    const prisma = createPrismaMock();
    prisma.collaboration.findMany.mockResolvedValue([
      collaboration(grant(PERMISSIONS.PERMISSION_GRANT)),
    ]);
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
    prisma.collaboration.findFirst.mockResolvedValue({
      id: 'collab-001',
      user: { globalRole: 'USER', isActive: true },
      permissions: [
        {
          validFrom: new Date('2026-09-19T08:00:00.000Z'),
          validUntil: new Date('2026-09-19T09:00:00.000Z'),
          permission: { name: PERMISSIONS.ACTIVITY_UPDATE },
        },
      ],
    });
    prisma.permission.findUnique.mockResolvedValue({ id: 'perm-1' });
    prisma.collaborationPermission.deleteMany.mockResolvedValue({ count: 1 });
    const { revokePermission } = await loadService(prisma);

    await revokePermission(
      buildUser({ globalRole: 'ADMIN' }),
      baseScope,
      'user-002',
      PERMISSIONS.ACTIVITY_UPDATE,
      NOW,
      AUDIT_CONTEXT,
    );

    const payloads = auditPayloads(prisma);
    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toMatchObject({
      action: 'authorization.permission_revoked',
      actorId: 'actor-001',
      resourceType: 'collaboration_permission',
      resourceId: 'collab-001',
      scopeType: 'event_program',
      scopeId: 'p1',
      targetUserId: 'user-002',
      requestId: 'request-001',
    });
    expect(payloads[0]?.['changes']).toMatchObject({
      before: {
        permission: PERMISSIONS.ACTIVITY_UPDATE,
        validFrom: '2026-09-19T08:00:00.000Z',
        validUntil: '2026-09-19T09:00:00.000Z',
      },
    });
  });

  it('does not audit a revocation that deletes no row', async () => {
    const prisma = createPrismaMock();
    prisma.collaboration.findMany.mockResolvedValue([
      collaboration(grant(PERMISSIONS.PERMISSION_GRANT)),
    ]);
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
    prisma.collaboration.findFirst.mockResolvedValue({
      id: 'collab-001',
      user: { globalRole: 'USER', isActive: true },
      permissions: [
        {
          validFrom: null,
          validUntil: null,
          permission: { name: PERMISSIONS.ACTIVITY_UPDATE },
        },
      ],
    });
    prisma.permission.findUnique.mockResolvedValue({ id: 'perm-1' });
    prisma.collaborationPermission.deleteMany.mockResolvedValue({ count: 0 });
    const { revokePermission } = await loadService(prisma);

    await expect(
      revokePermission(
        buildUser({ globalRole: 'ADMIN' }),
        baseScope,
        'user-002',
        PERMISSIONS.ACTIVITY_UPDATE,
        NOW,
        AUDIT_CONTEXT,
      ),
    ).rejects.toMatchObject({ statusCode: 404 });

    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it('never stores collaborator personal data in the audit payload', async () => {
    const prisma = createPrismaMock();
    prisma.collaboration.findMany.mockResolvedValue([
      collaboration(grant(PERMISSIONS.PERMISSION_GRANT)),
    ]);
    prisma.eventProgram.findUnique.mockResolvedValue({ id: 'p1', status: 'ACTIVE' });
    prisma.collaboration.findFirst.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue({ id: 'user-002', isActive: true });
    prisma.permission.findMany.mockResolvedValue(permissionRecords(ROLE_DEFAULTS.VIEWER));
    prisma.collaboration.create.mockResolvedValue(
      collaboratorRecord({
        id: 'collab-011',
        user: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
      }),
    );
    const { addCollaborator } = await loadService(prisma);

    await addCollaborator(
      buildUser({ globalRole: 'ADMIN' }),
      baseScope,
      'user-002',
      'VIEWER',
      NOW,
      AUDIT_CONTEXT,
    );

    const serialized = JSON.stringify(auditPayloads(prisma));
    expect(serialized).not.to.include('Lovelace');
    expect(serialized).not.to.include('ada@example.com');
  });
});
