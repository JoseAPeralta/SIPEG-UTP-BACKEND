import { afterEach, describe, expect, it, vi } from 'vitest';

interface CollaborationModelMock {
  findFirst: ReturnType<typeof vi.fn>;
}

interface ActivityModelMock {
  findUnique: ReturnType<typeof vi.fn>;
}

interface PrismaMock {
  collaboration: CollaborationModelMock;
  activity: ActivityModelMock;
}

const createPrismaMock = (): PrismaMock => ({
  collaboration: { findFirst: vi.fn() },
  activity: { findUnique: vi.fn() },
});

const loadService = async (prisma: PrismaMock) => {
  vi.resetModules();
  vi.doMock('../config/prisma.js', () => ({
    getPrismaClient: () => prisma,
  }));

  return import('./authorization.service.js');
};

const collaboratorPermissions = (names: string[]) => ({
  permissions: names.map((name) => ({ permission: { name } })),
});

describe('authorization service', () => {
  afterEach(() => {
    vi.doUnmock('../config/prisma.js');
  });

  describe('resolveProgramAccess', () => {
    it('grants full access to global administrators without querying collaborations', async () => {
      const prisma = createPrismaMock();
      const { resolveProgramAccess } = await loadService(prisma);

      const access = await resolveProgramAccess(
        { id: 'admin-001', globalRole: 'ADMIN' },
        'program-001',
      );

      expect(access).toEqual({
        role: 'ORGANIZER',
        permissions: [],
        inheritedPermissions: [],
        localPermissions: [],
        source: 'admin',
      });
      expect(prisma.collaboration.findFirst).not.toHaveBeenCalled();
    });

    it('resolves the collaborator role and permissions of an event program', async () => {
      const prisma = createPrismaMock();
      prisma.collaboration.findFirst.mockResolvedValue({
        role: 'EDITOR',
        ...collaboratorPermissions(['activity.create', 'report.view']),
      });
      const { resolveProgramAccess } = await loadService(prisma);

      const access = await resolveProgramAccess(
        { id: 'user-001', globalRole: 'USER' },
        'program-001',
      );

      expect(prisma.collaboration.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { eventProgramId: 'program-001', userId: 'user-001' },
        }),
      );
      expect(access).toEqual({
        role: 'EDITOR',
        permissions: expect.arrayContaining(['activity.create', 'report.view']),
        inheritedPermissions: [],
        localPermissions: expect.arrayContaining(['activity.create', 'report.view']),
        source: 'program',
      });
    });

    it('returns null when the user is not a program collaborator', async () => {
      const prisma = createPrismaMock();
      prisma.collaboration.findFirst.mockResolvedValue(null);
      const { resolveProgramAccess } = await loadService(prisma);

      const access = await resolveProgramAccess(
        { id: 'user-001', globalRole: 'USER' },
        'program-001',
      );

      expect(access).toBeNull();
    });
  });

  describe('resolveActivityAccess', () => {
    it('returns null when the activity does not exist', async () => {
      const prisma = createPrismaMock();
      prisma.activity.findUnique.mockResolvedValue(null);
      const { resolveActivityAccess } = await loadService(prisma);

      const access = await resolveActivityAccess(
        { id: 'user-001', globalRole: 'USER' },
        'activity-001',
      );

      expect(access).toBeNull();
    });

    it('returns null when the user has neither local nor inherited access', async () => {
      const prisma = createPrismaMock();
      prisma.activity.findUnique.mockResolvedValue({
        collaborations: [],
        eventProgram: { collaborations: [] },
      });
      const { resolveActivityAccess } = await loadService(prisma);

      const access = await resolveActivityAccess(
        { id: 'user-001', globalRole: 'USER' },
        'activity-001',
      );

      expect(access).toBeNull();
    });

    it('inherits the event program role and permissions when there is no local collaboration', async () => {
      const prisma = createPrismaMock();
      prisma.activity.findUnique.mockResolvedValue({
        collaborations: [],
        eventProgram: {
          collaborations: [{ role: 'VIEWER', ...collaboratorPermissions(['report.view']) }],
        },
      });
      const { resolveActivityAccess } = await loadService(prisma);

      const access = await resolveActivityAccess(
        { id: 'user-001', globalRole: 'USER' },
        'activity-001',
      );

      expect(access).toEqual({
        role: 'VIEWER',
        permissions: ['report.view'],
        inheritedPermissions: ['report.view'],
        localPermissions: [],
        source: 'inherited',
      });
    });

    it('gives local collaboration precedence over inherited access', async () => {
      const prisma = createPrismaMock();
      prisma.activity.findUnique.mockResolvedValue({
        collaborations: [{ role: 'EDITOR', ...collaboratorPermissions(['attendance.manage']) }],
        eventProgram: {
          collaborations: [{ role: 'VIEWER', ...collaboratorPermissions(['report.view']) }],
        },
      });
      const { resolveActivityAccess } = await loadService(prisma);

      const access = await resolveActivityAccess(
        { id: 'user-001', globalRole: 'USER' },
        'activity-001',
      );

      expect(access).toEqual({
        role: 'EDITOR',
        permissions: expect.arrayContaining(['attendance.manage', 'report.view']),
        inheritedPermissions: ['report.view'],
        localPermissions: ['attendance.manage'],
        source: 'local',
      });
    });

    it('grants full access to global administrators', async () => {
      const prisma = createPrismaMock();
      const { resolveActivityAccess } = await loadService(prisma);

      const access = await resolveActivityAccess(
        { id: 'admin-001', globalRole: 'ADMIN' },
        'activity-001',
      );

      expect(access).toMatchObject({ role: 'ORGANIZER', source: 'admin' });
      expect(prisma.activity.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('hasRequiredRole', () => {
    it('compares collaboration roles by privilege level', async () => {
      const prisma = createPrismaMock();
      const { hasRequiredRole } = await loadService(prisma);

      expect(hasRequiredRole('ORGANIZER', 'EDITOR')).toBe(true);
      expect(hasRequiredRole('EDITOR', 'EDITOR')).toBe(true);
      expect(hasRequiredRole('EDITOR', 'ORGANIZER')).toBe(false);
      expect(hasRequiredRole('VIEWER', 'EDITOR')).toBe(false);
    });
  });
});
