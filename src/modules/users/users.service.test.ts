import { afterEach, describe, expect, it, vi } from 'vitest';

import { verifyPassword } from '../../lib/password.js';

interface UserModelMock {
  findUnique: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  findMany: ReturnType<typeof vi.fn>;
  count: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
}

interface OrganizationalUnitModelMock {
  findUnique: ReturnType<typeof vi.fn>;
}

interface CareerModelMock {
  findUnique: ReturnType<typeof vi.fn>;
}

interface AccountModelMock {
  create: ReturnType<typeof vi.fn>;
}

interface SessionModelMock {
  deleteMany: ReturnType<typeof vi.fn>;
}

interface PrismaMock {
  user: UserModelMock;
  organizationalUnit: OrganizationalUnitModelMock;
  career: CareerModelMock;
  account: AccountModelMock;
  session: SessionModelMock;
  $transaction: ReturnType<typeof vi.fn>;
}

const sendVerificationEmailMock = vi.fn();

const createPrismaMock = (): PrismaMock => {
  const prisma: PrismaMock = {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
    },
    organizationalUnit: {
      findUnique: vi.fn(),
    },
    career: {
      findUnique: vi.fn(),
    },
    account: { create: vi.fn() },
    session: { deleteMany: vi.fn() },
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
  vi.doMock('../../lib/auth.js', () => ({
    auth: { api: { sendVerificationEmail: sendVerificationEmailMock } },
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
  unit: { id: 'unit-001', name: 'Ingenieria', code: 'FIS' },
  career: { id: 'car-001', name: 'Sistemas', code: 'SIS' },
};

const currentUserRecord = {
  id: 'user-001',
  unitId: 'unit-001',
  careerId: 'car-001',
  career: { unitId: 'unit-001' },
};

const adminUserRecord = {
  id: 'user-001',
  firstName: 'Juan',
  lastName: 'Perez',
  identificationNumber: '8-123-4567',
  email: 'juan.perez@example.com',
  globalRole: 'USER',
  isActive: true,
  unit: { id: 'unit-001', name: 'Ingenieria', code: 'FIS' },
  career: { id: 'car-001', name: 'Sistemas', code: 'SIS' },
};

const updateTargetRecord = {
  id: 'user-target',
  globalRole: 'USER',
  isActive: true,
  unitId: 'unit-001',
  career: { unitId: 'unit-001' },
};

const activeAdminRecord = {
  id: 'user-admin-target',
  globalRole: 'ADMIN',
  isActive: true,
  unitId: null,
  career: null,
};

describe('users service', () => {
  afterEach(() => {
    vi.doUnmock('../../config/prisma.js');
    vi.doUnmock('../../lib/auth.js');
    sendVerificationEmailMock.mockReset();
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
      unit: { id: 'unit-001', name: 'Ingenieria', code: 'FIS' },
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

  it('rejects an unavailable organizational unit', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(currentUserRecord);
    prisma.organizationalUnit.findUnique.mockResolvedValue({ id: 'unit-002', isActive: false });
    const { updateProfile } = await loadService(prisma);

    await expect(updateProfile('user-001', { unitId: 'unit-002' })).rejects.toMatchObject({
      statusCode: 400,
      message: 'Organizational unit is not available.',
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects an unknown career', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(currentUserRecord);
    prisma.career.findUnique.mockResolvedValue(null);
    const { updateProfile } = await loadService(prisma);

    await expect(updateProfile('user-001', { careerId: 'car-404' })).rejects.toMatchObject({
      statusCode: 400,
      message: 'Career not found.',
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects a career that does not belong to the selected unit', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(currentUserRecord);
    prisma.career.findUnique.mockResolvedValue({
      id: 'car-002',
      unitId: 'unit-002',
    });
    const { updateProfile } = await loadService(prisma);

    await expect(updateProfile('user-001', { careerId: 'car-002' })).rejects.toMatchObject({
      statusCode: 400,
      message: 'Career does not belong to the selected unit.',
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('accepts a global career with any unit', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(currentUserRecord);
    prisma.career.findUnique.mockResolvedValue({ id: 'car-otros', unitId: null });
    prisma.user.update.mockResolvedValue(profileRecord);
    const { updateProfile } = await loadService(prisma);

    await updateProfile('user-001', { careerId: 'car-otros' });

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { careerId: 'car-otros' },
      }),
    );
  });

  it('forces the global OTROS career when the unit is null', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(currentUserRecord);
    prisma.career.findUnique.mockResolvedValue({
      id: 'car-otros',
      unitId: null,
      code: 'OTROS',
    });
    prisma.user.update.mockResolvedValue(profileRecord);
    const { updateProfile } = await loadService(prisma);

    await updateProfile('user-001', { unitId: null });

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { unitId: null, careerId: 'car-otros' },
      }),
    );
  });

  it('rejects a career that conflicts with the null unit', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(currentUserRecord);
    prisma.career.findUnique.mockImplementation(
      ({ where }: { where: { id?: string; code?: string } }) =>
        Promise.resolve(
          where.code === 'OTROS'
            ? { id: 'car-otros', unitId: null, code: 'OTROS' }
            : { id: 'car-002', unitId: 'unit-001' },
        ),
    );
    const { updateProfile } = await loadService(prisma);

    await expect(
      updateProfile('user-001', { unitId: null, careerId: 'car-002' }),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: 'Only the Otros career is allowed when no organizational unit is selected.',
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('fails when the global OTROS career is not configured', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(currentUserRecord);
    prisma.career.findUnique.mockResolvedValue(null);
    const { updateProfile } = await loadService(prisma);

    await expect(updateProfile('user-001', { unitId: null })).rejects.toMatchObject({
      statusCode: 409,
      message: 'The global Otros career is not configured.',
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('keeps the global career when switching to a real unit', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-001',
      unitId: null,
      careerId: 'car-otros',
      career: { unitId: null },
    });
    prisma.organizationalUnit.findUnique.mockResolvedValue({ id: 'unit-001', isActive: true });
    prisma.user.update.mockResolvedValue(profileRecord);
    const { updateProfile } = await loadService(prisma);

    await updateProfile('user-001', { unitId: 'unit-001' });

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { unitId: 'unit-001' },
      }),
    );
  });

  it('derives the unit from the career when no unit is set', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-001',
      unitId: null,
      careerId: null,
      career: null,
    });
    prisma.career.findUnique.mockResolvedValue({
      id: 'car-002',
      unitId: 'unit-002',
    });
    prisma.user.update.mockResolvedValue(profileRecord);
    const { updateProfile } = await loadService(prisma);

    await updateProfile('user-001', { careerId: 'car-002' });

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { unitId: 'unit-002', careerId: 'car-002' },
      }),
    );
  });

  it('clears the career when the unit changes', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(currentUserRecord);
    prisma.organizationalUnit.findUnique.mockResolvedValue({ id: 'unit-002', isActive: true });
    prisma.user.update.mockResolvedValue(profileRecord);
    const { updateProfile } = await loadService(prisma);

    await updateProfile('user-001', { unitId: 'unit-002' });

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { unitId: 'unit-002', careerId: null },
      }),
    );
  });

  it('keeps the career when the unit does not change', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(currentUserRecord);
    prisma.organizationalUnit.findUnique.mockResolvedValue({ id: 'unit-001', isActive: true });
    prisma.user.update.mockResolvedValue(profileRecord);
    const { updateProfile } = await loadService(prisma);

    await updateProfile('user-001', { unitId: 'unit-001' });

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { unitId: 'unit-001' },
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

  it('lists users with offset pagination metadata', async () => {
    const prisma = createPrismaMock();
    prisma.user.findMany.mockResolvedValue([adminUserRecord]);
    prisma.user.count.mockResolvedValue(21);
    const { listUsers } = await loadService(prisma);

    const result = await listUsers({ page: 2, limit: 10 });

    expect(result).toEqual({
      items: [adminUserRecord],
      page: 2,
      limit: 10,
      total: 21,
      totalPages: 3,
    });
    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        skip: 10,
        take: 10,
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }, { id: 'asc' }],
      }),
    );
    expect(prisma.user.count).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.any(Object) }),
    );
  });

  it('applies role, status, unit, career and search filters', async () => {
    const prisma = createPrismaMock();
    prisma.user.findMany.mockResolvedValue([]);
    prisma.user.count.mockResolvedValue(0);
    const { listUsers } = await loadService(prisma);

    await listUsers({
      page: 1,
      limit: 20,
      globalRole: 'ADMIN',
      isActive: false,
      unitId: 'unit-001',
      careerId: 'car-001',
      q: 'perez',
    });

    expect(prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          globalRole: 'ADMIN',
          isActive: false,
          unitId: 'unit-001',
          careerId: 'car-001',
          OR: [
            { firstName: { contains: 'perez', mode: 'insensitive' } },
            { lastName: { contains: 'perez', mode: 'insensitive' } },
            { email: { contains: 'perez', mode: 'insensitive' } },
            { identificationNumber: { contains: 'perez', mode: 'insensitive' } },
          ],
        },
      }),
    );
  });

  it('returns an empty page when no users match', async () => {
    const prisma = createPrismaMock();
    prisma.user.findMany.mockResolvedValue([]);
    prisma.user.count.mockResolvedValue(0);
    const { listUsers } = await loadService(prisma);

    const result = await listUsers({ page: 1, limit: 20 });

    expect(result).toEqual({ items: [], page: 1, limit: 20, total: 0, totalPages: 0 });
  });

  it('selects only safe user fields', async () => {
    const prisma = createPrismaMock();
    let capturedArgs: { select: Record<string, unknown> } | undefined;
    prisma.user.findMany.mockImplementation((args: { select: Record<string, unknown> }) => {
      capturedArgs = args;
      return Promise.resolve([]);
    });
    prisma.user.count.mockResolvedValue(0);
    const { listUsers } = await loadService(prisma);

    await listUsers({ page: 1, limit: 20 });

    expect(capturedArgs?.select).toMatchObject({ id: true, isActive: true });
    expect(capturedArgs?.select).not.toHaveProperty('name');
    expect(capturedArgs?.select).not.toHaveProperty('accounts');
    expect(capturedArgs?.select).not.toHaveProperty('password');
    expect(capturedArgs?.select).not.toHaveProperty('passwordHash');
    expect(capturedArgs?.select).not.toHaveProperty('emailVerified');
  });

  it('returns the administrative view of an existing user', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminUserRecord);
    const { getUserById } = await loadService(prisma);

    const user = await getUserById('user-001');

    expect(user).toEqual(adminUserRecord);
    expect(prisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: 'user-001' },
      select: expect.objectContaining({ id: true, isActive: true }),
    });
  });

  it('fails when the requested user does not exist', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(null);
    const { getUserById } = await loadService(prisma);

    await expect(getUserById('missing')).rejects.toMatchObject({
      statusCode: 404,
      message: 'User not found.',
    });
  });

  it('selects only safe fields for the administrative detail', async () => {
    const prisma = createPrismaMock();
    let capturedArgs: { select: Record<string, unknown> } | undefined;
    prisma.user.findUnique.mockImplementation((args: { select: Record<string, unknown> }) => {
      capturedArgs = args;
      return Promise.resolve(adminUserRecord);
    });
    const { getUserById } = await loadService(prisma);

    await getUserById('user-001');

    expect(capturedArgs?.select).toMatchObject({ id: true, isActive: true });
    expect(capturedArgs?.select).not.toHaveProperty('name');
    expect(capturedArgs?.select).not.toHaveProperty('accounts');
    expect(capturedArgs?.select).not.toHaveProperty('password');
    expect(capturedArgs?.select).not.toHaveProperty('passwordHash');
    expect(capturedArgs?.select).not.toHaveProperty('emailVerified');
  });

  const createInput = {
    email: 'ana.gomez@utp.ac.pa',
    password: 'SipegNueva2026*',
    firstName: 'Ana',
    lastName: 'Gomez',
    identificationNumber: '8-888-1234',
    globalRole: 'USER' as const,
    isActive: true,
  };

  it('creates the user and the credential account with an Argon2id hash', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue(adminUserRecord);
    const { createUser } = await loadService(prisma);

    const created = await createUser(createInput);

    expect(created).toEqual(adminUserRecord);
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        email: 'ana.gomez@utp.ac.pa',
        name: 'Ana Gomez',
        firstName: 'Ana',
        lastName: 'Gomez',
        identificationNumber: '8-888-1234',
        emailVerified: false,
        globalRole: 'USER',
        isActive: true,
        unitId: null,
        careerId: null,
      }),
      select: expect.objectContaining({ id: true, isActive: true }),
    });

    const accountArgs = prisma.account.create.mock.calls[0]?.[0] as {
      data: { id: string; accountId: string; providerId: string; userId: string; password: string };
    };
    expect(accountArgs.data.id).toEqual(expect.any(String));
    expect(accountArgs.data.accountId).toBe('user-001');
    expect(accountArgs.data.providerId).toBe('credential');
    expect(accountArgs.data.userId).toBe('user-001');
    expect(accountArgs.data.password.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(accountArgs.data.password, createInput.password)).toBe(true);
  });

  it('normalizes the email and sends the verification email', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue(adminUserRecord);
    const { createUser } = await loadService(prisma);

    await createUser({ ...createInput, email: '  Ana.Gomez@UTP.AC.PA  ' });

    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ email: 'ana.gomez@utp.ac.pa' }) }),
    );
    expect(sendVerificationEmailMock).toHaveBeenCalledWith({
      body: { email: 'ana.gomez@utp.ac.pa' },
    });
  });

  it('rejects a duplicate email before writing', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockImplementation(({ where }: { where: { email?: string } }) =>
      Promise.resolve(where.email ? { id: 'existing' } : null),
    );
    const { createUser } = await loadService(prisma);

    await expect(createUser(createInput)).rejects.toMatchObject({
      statusCode: 409,
      message: 'Email is already registered.',
    });
    expect(prisma.user.create).not.toHaveBeenCalled();
    expect(prisma.account.create).not.toHaveBeenCalled();
  });

  it('rejects a duplicate identification number before writing', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockImplementation(
      ({ where }: { where: { email?: string; identificationNumber?: string } }) =>
        Promise.resolve(where.identificationNumber ? { id: 'existing' } : null),
    );
    const { createUser } = await loadService(prisma);

    await expect(createUser(createInput)).rejects.toMatchObject({
      statusCode: 409,
      message: 'Identification number is already registered.',
    });
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('rejects an unavailable organizational unit', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.organizationalUnit.findUnique.mockResolvedValue({ id: 'unit-002', isActive: false });
    const { createUser } = await loadService(prisma);

    await expect(createUser({ ...createInput, unitId: 'unit-002' })).rejects.toMatchObject({
      statusCode: 400,
      message: 'Organizational unit is not available.',
    });
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('rejects an unknown career', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.career.findUnique.mockResolvedValue(null);
    const { createUser } = await loadService(prisma);

    await expect(createUser({ ...createInput, careerId: 'car-404' })).rejects.toMatchObject({
      statusCode: 400,
      message: 'Career not found.',
    });
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('rejects a career that does not belong to the selected unit', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.organizationalUnit.findUnique.mockResolvedValue({ id: 'unit-001', isActive: true });
    prisma.career.findUnique.mockResolvedValue({ id: 'car-002', unitId: 'unit-002' });
    const { createUser } = await loadService(prisma);

    await expect(
      createUser({ ...createInput, unitId: 'unit-001', careerId: 'car-002' }),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: 'Career does not belong to the selected unit.',
    });
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('derives the unit from the career when no unit is given', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.career.findUnique.mockResolvedValue({ id: 'car-002', unitId: 'unit-002' });
    prisma.user.create.mockResolvedValue(adminUserRecord);
    const { createUser } = await loadService(prisma);

    await createUser({ ...createInput, careerId: 'car-002' });

    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ unitId: 'unit-002', careerId: 'car-002' }),
      }),
    );
  });

  it('forces the global OTROS career when the unit is null', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.career.findUnique.mockResolvedValue({ id: 'car-otros', unitId: null, code: 'OTROS' });
    prisma.user.create.mockResolvedValue(adminUserRecord);
    const { createUser } = await loadService(prisma);

    await createUser({ ...createInput, unitId: null });

    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ unitId: null, careerId: 'car-otros' }),
      }),
    );
  });

  it('fails when the global OTROS career is not configured', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.career.findUnique.mockResolvedValue(null);
    const { createUser } = await loadService(prisma);

    await expect(createUser({ ...createInput, unitId: null })).rejects.toMatchObject({
      statusCode: 409,
      message: 'The global Otros career is not configured.',
    });
    expect(prisma.user.create).not.toHaveBeenCalled();
  });

  it('maps a unique constraint race to a conflict', async () => {
    const prisma = createPrismaMock();
    let emailLookups = 0;
    prisma.user.findUnique.mockImplementation(({ where }: { where: { email?: string } }) => {
      if (!where.email) return Promise.resolve(null);
      emailLookups += 1;
      return Promise.resolve(emailLookups > 1 ? { id: 'racer' } : null);
    });
    prisma.$transaction.mockRejectedValue(new Error('Unique constraint failed'));
    const { createUser } = await loadService(prisma);

    await expect(createUser(createInput)).rejects.toMatchObject({
      statusCode: 409,
      message: 'Email is already registered.',
    });
  });

  it('keeps the created user when the verification email fails', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue(adminUserRecord);
    sendVerificationEmailMock.mockRejectedValue(new Error('smtp down'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { createUser } = await loadService(prisma);

    await expect(createUser(createInput)).resolves.toEqual(adminUserRecord);
    expect(errorSpy).toHaveBeenCalledWith('Failed to send account verification email.');
    errorSpy.mockRestore();
  });

  it('selects only safe fields for the created user', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue(adminUserRecord);
    const { createUser } = await loadService(prisma);

    await createUser(createInput);

    const createArgs = prisma.user.create.mock.calls[0]?.[0] as {
      select: Record<string, unknown>;
    };
    expect(createArgs.select).toMatchObject({ id: true, isActive: true });
    expect(createArgs.select).not.toHaveProperty('name');
    expect(createArgs.select).not.toHaveProperty('accounts');
    expect(createArgs.select).not.toHaveProperty('password');
    expect(createArgs.select).not.toHaveProperty('passwordHash');
    expect(createArgs.select).not.toHaveProperty('emailVerified');
  });

  it('updates role and status and returns the administrative view', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(updateTargetRecord);
    prisma.user.update.mockResolvedValue({
      ...adminUserRecord,
      globalRole: 'ADMIN',
      isActive: false,
    });
    const { updateAdminUser } = await loadService(prisma);

    const updated = await updateAdminUser('user-admin', 'user-target', {
      globalRole: 'ADMIN',
      isActive: false,
    });

    expect(updated.globalRole).toBe('ADMIN');
    expect(updated.isActive).toBe(false);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-target' },
        data: { globalRole: 'ADMIN', isActive: false },
      }),
    );
  });

  it('deletes every session of a deactivated user inside a transaction', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(updateTargetRecord);
    prisma.user.update.mockResolvedValue({ ...adminUserRecord, isActive: false });
    prisma.session.deleteMany.mockResolvedValue({ count: 2 });
    const { updateAdminUser } = await loadService(prisma);

    await updateAdminUser('user-admin', 'user-target', { isActive: false });

    expect(prisma.$transaction).toHaveBeenCalled();
    expect(prisma.session.deleteMany).toHaveBeenCalledWith({ where: { userId: 'user-target' } });
  });

  it('does not delete sessions when the user stays active', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(updateTargetRecord);
    prisma.user.update.mockResolvedValue(adminUserRecord);
    const { updateAdminUser } = await loadService(prisma);

    await updateAdminUser('user-admin', 'user-target', { globalRole: 'ADMIN' });

    expect(prisma.session.deleteMany).not.toHaveBeenCalled();
  });

  it('fails when the requested user does not exist', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(null);
    const { updateAdminUser } = await loadService(prisma);

    await expect(
      updateAdminUser('user-admin', 'missing', { isActive: false }),
    ).rejects.toMatchObject({ statusCode: 404, message: 'User not found.' });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects self-deactivation', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue({
      ...updateTargetRecord,
      id: 'user-admin',
      globalRole: 'ADMIN',
    });
    const { updateAdminUser } = await loadService(prisma);

    await expect(
      updateAdminUser('user-admin', 'user-admin', { isActive: false }),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: 'You cannot deactivate your own account.',
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects self-demotion', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue({
      ...updateTargetRecord,
      id: 'user-admin',
      globalRole: 'ADMIN',
    });
    const { updateAdminUser } = await loadService(prisma);

    await expect(
      updateAdminUser('user-admin', 'user-admin', { globalRole: 'USER' }),
    ).rejects.toMatchObject({ statusCode: 409, message: 'You cannot change your own role.' });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects demoting or deactivating the last active administrator', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(activeAdminRecord);
    prisma.user.count.mockResolvedValue(0);
    const { updateAdminUser } = await loadService(prisma);

    await expect(
      updateAdminUser('user-admin', 'user-admin-target', { globalRole: 'USER' }),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: 'At least one active administrator is required.',
    });

    await expect(
      updateAdminUser('user-admin', 'user-admin-target', { isActive: false }),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: 'At least one active administrator is required.',
    });

    expect(prisma.user.count).toHaveBeenCalledWith({
      where: { globalRole: 'ADMIN', isActive: true, id: { not: 'user-admin-target' } },
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('allows demoting an administrator when another active administrator exists', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(activeAdminRecord);
    prisma.user.count.mockResolvedValue(1);
    prisma.user.update.mockResolvedValue({ ...adminUserRecord, globalRole: 'USER' });
    const { updateAdminUser } = await loadService(prisma);

    await updateAdminUser('user-admin', 'user-admin-target', { globalRole: 'USER' });

    expect(prisma.user.count).toHaveBeenCalled();
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { globalRole: 'USER' } }),
    );
  });

  it('does not check the administrator count for regular users', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(updateTargetRecord);
    prisma.user.update.mockResolvedValue({ ...adminUserRecord, isActive: false });
    const { updateAdminUser } = await loadService(prisma);

    await updateAdminUser('user-admin', 'user-target', { isActive: false });

    expect(prisma.user.count).not.toHaveBeenCalled();
  });

  it('rejects an unavailable organizational unit when updating a user', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(updateTargetRecord);
    prisma.organizationalUnit.findUnique.mockResolvedValue({ id: 'unit-002', isActive: false });
    const { updateAdminUser } = await loadService(prisma);

    await expect(
      updateAdminUser('user-admin', 'user-target', { unitId: 'unit-002' }),
    ).rejects.toMatchObject({
      statusCode: 400,
      message: 'Organizational unit is not available.',
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('forces the global OTROS career when the unit is null', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(updateTargetRecord);
    prisma.career.findUnique.mockResolvedValue({ id: 'car-otros', unitId: null, code: 'OTROS' });
    prisma.user.update.mockResolvedValue({ ...adminUserRecord, unit: null, career: null });
    const { updateAdminUser } = await loadService(prisma);

    await updateAdminUser('user-admin', 'user-target', { unitId: null });

    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { unitId: null, careerId: 'car-otros' } }),
    );
  });

  it('selects only safe fields for the administrative update response', async () => {
    const prisma = createPrismaMock();
    let capturedArgs: { select: Record<string, unknown> } | undefined;
    prisma.user.findUnique.mockResolvedValue(updateTargetRecord);
    prisma.user.update.mockImplementation((args: { select: Record<string, unknown> }) => {
      capturedArgs = args;
      return Promise.resolve(adminUserRecord);
    });
    const { updateAdminUser } = await loadService(prisma);

    await updateAdminUser('user-admin', 'user-target', { isActive: false });

    expect(capturedArgs?.select).toMatchObject({ id: true, isActive: true });
    expect(capturedArgs?.select).not.toHaveProperty('name');
    expect(capturedArgs?.select).not.toHaveProperty('accounts');
    expect(capturedArgs?.select).not.toHaveProperty('password');
    expect(capturedArgs?.select).not.toHaveProperty('passwordHash');
    expect(capturedArgs?.select).not.toHaveProperty('emailVerified');
  });
});
