import { afterEach, describe, expect, it, vi } from 'vitest';

interface UserModelMock {
  findUnique: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
}

interface FacultyModelMock {
  findUnique: ReturnType<typeof vi.fn>;
}

interface CareerModelMock {
  findUnique: ReturnType<typeof vi.fn>;
}

interface PrismaMock {
  user: UserModelMock;
  faculty: FacultyModelMock;
  career: CareerModelMock;
}

const createPrismaMock = (): PrismaMock => ({
  user: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  faculty: {
    findUnique: vi.fn(),
  },
  career: {
    findUnique: vi.fn(),
  },
});

const loadService = async (prisma: PrismaMock) => {
  vi.resetModules();
  vi.doMock('../../config/prisma.js', () => ({
    getPrismaClient: () => prisma,
  }));

  return import('./users.service.js');
};

const profileRecord = {
  id: 'user-001',
  firstName: 'Juan',
  lastName: 'Perez',
  identificationNumber: '8-123-4567',
  email: 'juan.perez@example.com',
  globalRole: 'USER',
  faculty: { id: 'fac-001', name: 'Ingenieria', code: 'FIS' },
  career: { id: 'car-001', name: 'Sistemas', code: 'SIS' },
};

const currentUserRecord = {
  id: 'user-001',
  facultyId: 'fac-001',
  careerId: 'car-001',
  career: { facultyId: 'fac-001' },
};

describe('users service', () => {
  afterEach(() => {
    vi.doUnmock('../../config/prisma.js');
  });

  it('returns the profile of an existing user', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(profileRecord);
    const { getProfile } = await loadService(prisma);

    const profile = await getProfile('user-001');

    expect(profile).toEqual({
      id: 'user-001',
      firstName: 'Juan',
      lastName: 'Perez',
      identificationNumber: '8-123-4567',
      email: 'juan.perez@example.com',
      globalRole: 'USER',
      faculty: { id: 'fac-001', name: 'Ingenieria', code: 'FIS' },
      career: { id: 'car-001', name: 'Sistemas', code: 'SIS' },
    });
  });

  it('fails when the profile does not exist', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(null);
    const { getProfile } = await loadService(prisma);

    await expect(getProfile('missing')).rejects.toMatchObject({
      statusCode: 404,
      message: 'User not found.',
    });
  });

  it('updates first and last name', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(currentUserRecord);
    prisma.user.update.mockResolvedValue({
      ...profileRecord,
      firstName: 'Juana',
      lastName: 'Pereza',
    });
    const { updateProfile } = await loadService(prisma);

    const profile = await updateProfile('user-001', { firstName: 'Juana', lastName: 'Pereza' });

    expect(profile.firstName).toBe('Juana');
    expect(profile.lastName).toBe('Pereza');
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-001' },
        data: { firstName: 'Juana', lastName: 'Pereza' },
      }),
    );
  });

  it('rejects an unavailable faculty', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(currentUserRecord);
    prisma.faculty.findUnique.mockResolvedValue({ id: 'fac-002', isActive: false });
    const { updateProfile } = await loadService(prisma);

    await expect(updateProfile('user-001', { facultyId: 'fac-002' })).rejects.toMatchObject({
      statusCode: 400,
      message: 'Faculty is not available.',
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects an unavailable career', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(currentUserRecord);
    prisma.faculty.findUnique.mockResolvedValue({ id: 'fac-001', isActive: true });
    prisma.career.findUnique.mockResolvedValue({
      id: 'car-002',
      facultyId: 'fac-001',
      isActive: false,
    });
    const { updateProfile } = await loadService(prisma);

    await expect(updateProfile('user-001', { careerId: 'car-002' })).rejects.toMatchObject({
      statusCode: 400,
      message: 'Career is not available.',
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects a career that does not belong to the selected faculty', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(currentUserRecord);
    prisma.career.findUnique.mockResolvedValue({
      id: 'car-002',
      facultyId: 'fac-002',
      isActive: true,
    });
    const { updateProfile } = await loadService(prisma);

    await expect(updateProfile('user-001', { careerId: 'car-002' })).rejects.toMatchObject({
      statusCode: 400,
      message: 'Career does not belong to the selected faculty.',
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('derives the faculty from the career when no faculty is set', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-001',
      facultyId: null,
      careerId: null,
      career: null,
    });
    prisma.career.findUnique.mockResolvedValue({
      id: 'car-002',
      facultyId: 'fac-002',
      isActive: true,
    });
    prisma.user.update.mockResolvedValue(profileRecord);
    const { updateProfile } = await loadService(prisma);

    await updateProfile('user-001', { careerId: 'car-002' });

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { facultyId: 'fac-002', careerId: 'car-002' },
      }),
    );
  });

  it('clears the career when the faculty changes', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(currentUserRecord);
    prisma.faculty.findUnique.mockResolvedValue({ id: 'fac-002', isActive: true });
    prisma.user.update.mockResolvedValue(profileRecord);
    const { updateProfile } = await loadService(prisma);

    await updateProfile('user-001', { facultyId: 'fac-002' });

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { facultyId: 'fac-002', careerId: null },
      }),
    );
  });

  it('keeps the career when the faculty does not change', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(currentUserRecord);
    prisma.faculty.findUnique.mockResolvedValue({ id: 'fac-001', isActive: true });
    prisma.user.update.mockResolvedValue(profileRecord);
    const { updateProfile } = await loadService(prisma);

    await updateProfile('user-001', { facultyId: 'fac-001' });

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { facultyId: 'fac-001' },
      }),
    );
  });

  it('fails when updating a missing user', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(null);
    const { updateProfile } = await loadService(prisma);

    await expect(updateProfile('missing', { firstName: 'Juana' })).rejects.toMatchObject({
      statusCode: 404,
    });
  });
});
