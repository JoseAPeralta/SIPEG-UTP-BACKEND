import { afterEach, describe, expect, it, vi } from 'vitest';

import { PERMISSIONS, ROLE_DEFAULTS, type PermissionName } from './permissions.js';

interface GrantRecord {
  validFrom: Date | null;
  validUntil: Date | null;
  permission: { name: string };
}

interface CollaborationRecord {
  permissions: GrantRecord[];
}

interface PrismaMock {
  collaboration: {
    findMany: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
  };
  collaborationPermission: {
    upsert: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
    createMany: ReturnType<typeof vi.fn>;
  };
  activity: { findUnique: ReturnType<typeof vi.fn> };
  user: { findUnique: ReturnType<typeof vi.fn> };
  permission: { findMany: ReturnType<typeof vi.fn>; findUnique: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
}

const createPrismaMock = (): PrismaMock => {
  const prisma: PrismaMock = {
    collaboration: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    collaborationPermission: {
      upsert: vi.fn(),
      deleteMany: vi.fn(),
      createMany: vi.fn(),
    },
    activity: { findUnique: vi.fn() },
    user: { findUnique: vi.fn() },
    permission: { findMany: vi.fn(), findUnique: vi.fn() },
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
    prisma.collaboration.create.mockResolvedValue({ id: 'collab-001' });
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
    prisma.collaboration.findFirst.mockResolvedValue({ id: 'collab-001' });
    prisma.permission.findUnique.mockResolvedValue({
      id: 'perm-grant',
      name: PERMISSIONS.PERMISSION_GRANT,
    });
    prisma.collaborationPermission.upsert.mockResolvedValue({});
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
    prisma.collaboration.findMany.mockResolvedValue([
      collaboration(grant(PERMISSIONS.PERMISSION_GRANT)),
    ]);
    prisma.collaboration.findFirst.mockResolvedValue({ id: 'collab-001' });
    prisma.permission.findUnique.mockResolvedValue({
      id: 'perm-grant',
      name: PERMISSIONS.PERMISSION_GRANT,
    });
    prisma.collaborationPermission.upsert.mockResolvedValue({});
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
    prisma.collaboration.findFirst.mockResolvedValue({ id: 'collab-001' });
    prisma.permission.findUnique.mockResolvedValue({
      id: 'perm-update',
      name: PERMISSIONS.ACTIVITY_UPDATE,
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
    prisma.collaboration.findFirst.mockResolvedValue({ id: 'collab-001' });
    prisma.permission.findUnique.mockResolvedValue({ id: 'perm-update' });
    prisma.collaborationPermission.deleteMany.mockResolvedValue({ count: 0 });
    const { revokePermission } = await loadService(prisma);

    await expect(
      revokePermission(
        buildUser({ globalRole: 'ADMIN' }),
        { eventProgramId: 'p1' },
        'user-002',
        PERMISSIONS.ACTIVITY_UPDATE,
        NOW,
      ),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('replaces ROLE_DEFAULT rows and preserves OVERRIDE rows on role change', async () => {
    const prisma = createPrismaMock();
    prisma.collaboration.findFirst.mockResolvedValue({
      id: 'collab-001',
      permissions: [
        { permissionId: 'perm-0', source: 'ROLE_DEFAULT' },
        { permissionId: 'perm-x', source: 'OVERRIDE' },
      ],
    });
    prisma.permission.findMany.mockResolvedValue(permissionRecords(ROLE_DEFAULTS.EDITOR));
    prisma.collaboration.update.mockResolvedValue({});
    prisma.collaborationPermission.deleteMany.mockResolvedValue({ count: 1 });
    prisma.collaborationPermission.createMany.mockResolvedValue({ count: 11 });
    const { updateCollaboratorRole } = await loadService(prisma);

    await updateCollaboratorRole(
      buildUser({ globalRole: 'ADMIN' }),
      { eventProgramId: 'p1' },
      'user-002',
      'EDITOR',
      NOW,
    );

    expect(prisma.collaborationPermission.deleteMany).toHaveBeenCalledWith({
      where: { collaborationId: 'collab-001', source: 'ROLE_DEFAULT' },
    });
    expect(prisma.collaborationPermission.createMany).toHaveBeenCalledTimes(1);
    expect(prisma.collaboration.update).toHaveBeenCalledWith({
      where: { id: 'collab-001' },
      data: { role: 'EDITOR' },
    });
    expect(prisma.collaboration.delete).not.toHaveBeenCalled();
  });

  it('rejects removing a collaborator holding permissions the actor lacks', async () => {
    const prisma = createPrismaMock();
    prisma.collaboration.findMany.mockResolvedValue([
      collaboration(grant(PERMISSIONS.PERMISSION_GRANT)),
    ]);
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
    prisma.collaboration.findFirst.mockResolvedValue({
      id: 'collab-001',
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

    expect(prisma.collaboration.delete).toHaveBeenCalledWith({ where: { id: 'collab-001' } });
  });

  it('returns 404 when the collaborator does not exist', async () => {
    const prisma = createPrismaMock();
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
});
