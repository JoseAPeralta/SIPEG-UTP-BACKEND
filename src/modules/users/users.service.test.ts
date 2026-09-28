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

interface AuditEventModelMock {
  create: ReturnType<typeof vi.fn>;
}

interface PrismaMock {
  user: UserModelMock;
  organizationalUnit: OrganizationalUnitModelMock;
  career: CareerModelMock;
  account: AccountModelMock;
  session: SessionModelMock;
  auditEvent: AuditEventModelMock;
  $transaction: ReturnType<typeof vi.fn>;
}

const sendVerificationEmailMock = vi.fn();
const loggerErrorMock = vi.fn();

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
  vi.doMock('../../lib/auth.js', () => ({
    auth: { api: { sendVerificationEmail: sendVerificationEmailMock } },
  }));
  vi.doMock('../../config/logger.js', () => ({
    logger: { error: loggerErrorMock },
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
  firstName: 'Ana',
  lastName: 'Gomez',
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
  careerId: 'car-001',
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
    vi.doUnmock('../../config/logger.js');
    sendVerificationEmailMock.mockReset();
    loggerErrorMock.mockReset();
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
    isActive: true,
  };

  it('creates the user and the credential account with an Argon2id hash', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue(adminUserRecord);
    const { createUser } = await loadService(prisma);

    const created = await createUser(createInput, {
      actorId: 'user-admin',
      actorType: 'USER' as const,
      requestId: 'request-001',
    });

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

  it('forces USER when an untrusted caller supplies ADMIN', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue(adminUserRecord);
    const { createUser } = await loadService(prisma);

    await createUser(
      {
        ...createInput,
        globalRole: 'ADMIN',
      } as Parameters<typeof createUser>[0],
      { actorId: 'user-admin', actorType: 'USER' as const, requestId: 'request-001' },
    );

    expect(prisma.user.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ globalRole: 'USER' }) }),
    );
  });

  it('normalizes the email and sends the verification email', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue(adminUserRecord);
    const { createUser } = await loadService(prisma);

    await createUser(
      { ...createInput, email: '  Ana.Gomez@UTP.AC.PA  ' },
      { actorId: 'user-admin', actorType: 'USER' as const, requestId: 'request-001' },
    );

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

    await expect(
      createUser(createInput, {
        actorId: 'user-admin',
        actorType: 'USER' as const,
        requestId: 'request-001',
      }),
    ).rejects.toMatchObject({
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

    await expect(
      createUser(createInput, {
        actorId: 'user-admin',
        actorType: 'USER' as const,
        requestId: 'request-001',
      }),
    ).rejects.toMatchObject({
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

    await expect(
      createUser(
        { ...createInput, unitId: 'unit-002' },
        { actorId: 'user-admin', actorType: 'USER' as const, requestId: 'request-001' },
      ),
    ).rejects.toMatchObject({
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

    await expect(
      createUser(
        { ...createInput, careerId: 'car-404' },
        { actorId: 'user-admin', actorType: 'USER' as const, requestId: 'request-001' },
      ),
    ).rejects.toMatchObject({
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
      createUser(
        { ...createInput, unitId: 'unit-001', careerId: 'car-002' },
        { actorId: 'user-admin', actorType: 'USER' as const, requestId: 'request-001' },
      ),
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

    await createUser(
      { ...createInput, careerId: 'car-002' },
      { actorId: 'user-admin', actorType: 'USER' as const, requestId: 'request-001' },
    );

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

    await createUser(
      { ...createInput, unitId: null },
      { actorId: 'user-admin', actorType: 'USER' as const, requestId: 'request-001' },
    );

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

    await expect(
      createUser(
        { ...createInput, unitId: null },
        { actorId: 'user-admin', actorType: 'USER' as const, requestId: 'request-001' },
      ),
    ).rejects.toMatchObject({
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

    await expect(
      createUser(createInput, {
        actorId: 'user-admin',
        actorType: 'USER' as const,
        requestId: 'request-001',
      }),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: 'Email is already registered.',
    });
  });

  it('keeps the created user when the verification email fails', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue(adminUserRecord);
    sendVerificationEmailMock.mockRejectedValue(new Error('smtp down'));
    const { createUser } = await loadService(prisma);

    await expect(
      createUser(createInput, {
        actorId: 'user-admin',
        actorType: 'USER' as const,
        requestId: 'request-001',
      }),
    ).resolves.toEqual(adminUserRecord);
    expect(loggerErrorMock).toHaveBeenCalledWith(
      { event: 'mail.delivery.failed', logType: 'application' },
      'mail.delivery.failed',
    );
  });

  it('selects only safe fields for the created user', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue(adminUserRecord);
    const { createUser } = await loadService(prisma);

    await createUser(createInput, {
      actorId: 'user-admin',
      actorType: 'USER' as const,
      requestId: 'request-001',
    });

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

  it('promotes an active user and returns the administrative view', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(updateTargetRecord);
    prisma.user.update.mockResolvedValue({
      ...adminUserRecord,
      globalRole: 'ADMIN',
      isActive: true,
    });
    const { updateAdminUser } = await loadService(prisma);

    const updated = await updateAdminUser('user-admin', 'user-target', { globalRole: 'ADMIN' });

    expect(updated.globalRole).toBe('ADMIN');
    expect(updated.isActive).toBe(true);
    expect(prisma.user.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'user-target' },
        data: { globalRole: 'ADMIN' },
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

  it('rejects promoting an inactive user even when the request also reactivates it', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue({ ...updateTargetRecord, isActive: false });
    const { updateAdminUser } = await loadService(prisma);

    await expect(
      updateAdminUser('user-admin', 'user-target', { globalRole: 'ADMIN', isActive: true }),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: 'Only active users can be promoted to administrator.',
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects promoting and deactivating a user in the same request', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(updateTargetRecord);
    const { updateAdminUser } = await loadService(prisma);

    await expect(
      updateAdminUser('user-admin', 'user-target', { globalRole: 'ADMIN', isActive: false }),
    ).rejects.toMatchObject({
      statusCode: 409,
      message: 'Only active users can be promoted to administrator.',
    });
    expect(prisma.user.update).not.toHaveBeenCalled();
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

describe('users service audit trail', () => {
  const ADMIN_CONTEXT = {
    actorId: 'user-admin',
    actorType: 'USER' as const,
    requestId: 'request-001',
  };

  const auditInput = {
    email: 'ana.gomez@utp.ac.pa',
    password: 'SipegNueva2026*',
    firstName: 'Ana',
    lastName: 'Gomez',
    identificationNumber: '8-888-1234',
    isActive: true,
  };

  const auditPayloads = (prisma: PrismaMock) =>
    prisma.auditEvent.create.mock.calls.map(
      (call) => (call[0] as { data: Record<string, unknown> }).data,
    );

  const readyCreateMock = (prisma: PrismaMock) => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue(adminUserRecord);
    return prisma;
  };

  it('audits the administrative user creation with the initial state', async () => {
    const prisma = readyCreateMock(createPrismaMock());
    const { createUser } = await loadService(prisma);

    await createUser(auditInput, ADMIN_CONTEXT);

    const payloads = auditPayloads(prisma);
    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toMatchObject({
      action: 'user.admin_created',
      actorType: 'USER',
      actorId: 'user-admin',
      resourceType: 'user',
      resourceId: 'user-001',
      targetUserId: 'user-001',
      requestId: 'request-001',
    });
    expect(payloads[0]?.['changes']).toMatchObject({
      after: { globalRole: 'USER', isActive: true, unitId: 'unit-001', careerId: 'car-001' },
    });
  });

  it('never stores the new password or the email in the audit payload', async () => {
    const prisma = readyCreateMock(createPrismaMock());
    const { createUser } = await loadService(prisma);

    await createUser(auditInput, ADMIN_CONTEXT);

    const serialized = JSON.stringify(auditPayloads(prisma));
    expect(serialized).not.to.include('SipegNueva2026');
    expect(serialized).not.to.include('$argon2id$');
    expect(serialized).not.to.include('ana.gomez@utp.ac.pa');
    expect(serialized).not.to.include('8-888-1234');
  });

  it('does not audit a creation rejected by a duplicate email', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue({ id: 'user-existing' });
    const { createUser } = await loadService(prisma);

    await expect(createUser(auditInput, ADMIN_CONTEXT)).rejects.toMatchObject({
      statusCode: 409,
    });

    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it('does not audit a creation rejected by an unavailable organizational unit', async () => {
    const prisma = readyCreateMock(createPrismaMock());
    prisma.organizationalUnit.findUnique.mockResolvedValue(null);
    const { createUser } = await loadService(prisma);

    await expect(
      createUser({ ...auditInput, unitId: 'unit-002' }, ADMIN_CONTEXT),
    ).rejects.toMatchObject({ statusCode: 400 });

    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it('audits a global role change from the previous role', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(updateTargetRecord);
    prisma.user.update.mockResolvedValue({ ...adminUserRecord, globalRole: 'ADMIN' });
    const { updateAdminUser } = await loadService(prisma);

    await updateAdminUser('user-admin', 'user-target', { globalRole: 'ADMIN' }, ADMIN_CONTEXT);

    const payloads = auditPayloads(prisma);
    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toMatchObject({
      action: 'user.role_changed',
      actorId: 'user-admin',
      resourceType: 'user',
      resourceId: 'user-target',
      targetUserId: 'user-target',
      requestId: 'request-001',
    });
    expect(payloads[0]?.['changes']).toMatchObject({
      before: { globalRole: 'USER' },
      after: { globalRole: 'ADMIN' },
    });
  });

  it('audits a deactivation and revokes the sessions in the same transaction', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(updateTargetRecord);
    prisma.user.update.mockResolvedValue({ ...adminUserRecord, isActive: false });
    prisma.session.deleteMany.mockResolvedValue({ count: 2 });
    const { updateAdminUser } = await loadService(prisma);

    await updateAdminUser('user-admin', 'user-target', { isActive: false }, ADMIN_CONTEXT);

    const payloads = auditPayloads(prisma);
    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toMatchObject({
      action: 'user.deactivated',
      actorId: 'user-admin',
      resourceId: 'user-target',
    });
    expect(payloads[0]?.['changes']).toMatchObject({
      before: { isActive: true },
      after: { isActive: false },
    });
  });

  it('audits a reactivation', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue({ ...updateTargetRecord, isActive: false });
    prisma.user.update.mockResolvedValue(adminUserRecord);
    const { updateAdminUser } = await loadService(prisma);

    await updateAdminUser('user-admin', 'user-target', { isActive: true }, ADMIN_CONTEXT);

    const payloads = auditPayloads(prisma);
    expect(payloads).toHaveLength(1);
    expect(payloads[0]).toMatchObject({ action: 'user.activated' });
    expect(payloads[0]?.['changes']).toMatchObject({
      before: { isActive: false },
      after: { isActive: true },
    });
  });

  it('audits one event per transition when role and status change together', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue({ ...updateTargetRecord, globalRole: 'ADMIN' });
    prisma.user.count.mockResolvedValue(1);
    prisma.user.update.mockResolvedValue({
      ...adminUserRecord,
      globalRole: 'USER',
      isActive: false,
    });
    prisma.session.deleteMany.mockResolvedValue({ count: 1 });
    const { updateAdminUser } = await loadService(prisma);

    await updateAdminUser(
      'user-admin',
      'user-target',
      { globalRole: 'USER', isActive: false },
      ADMIN_CONTEXT,
    );

    const actions = auditPayloads(prisma).map((payload) => payload['action']);
    expect(actions).toEqual(['user.role_changed', 'user.deactivated']);
  });

  it('does not audit an update that leaves the role and the status unchanged', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(updateTargetRecord);
    prisma.user.update.mockResolvedValue(adminUserRecord);
    const { updateAdminUser } = await loadService(prisma);

    await updateAdminUser('user-admin', 'user-target', { globalRole: 'USER' }, ADMIN_CONTEXT);

    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it('does not audit an update rejected by the last active admin guard', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue({ ...activeAdminRecord, unitId: null, career: null });
    prisma.user.count.mockResolvedValue(0);
    const { updateAdminUser } = await loadService(prisma);

    await expect(
      updateAdminUser('user-admin', 'user-admin', { isActive: false }, ADMIN_CONTEXT),
    ).rejects.toMatchObject({ statusCode: 409 });

    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it('does not audit a self deactivation rejected by the service', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(updateTargetRecord);
    const { updateAdminUser } = await loadService(prisma);

    await expect(
      updateAdminUser('user-target', 'user-target', { isActive: false }, ADMIN_CONTEXT),
    ).rejects.toMatchObject({ statusCode: 409 });

    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });
});

describe('profile and organization assignment audit trail', () => {
  const PROFILE_CONTEXT = {
    actorId: 'user-001',
    actorType: 'USER' as const,
    requestId: 'request-profile',
  };

  it('records a profile update naming the changed fields without the values', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(currentUserRecord);
    prisma.user.update.mockResolvedValue({
      ...profileRecord,
      firstName: 'Juana',
      lastName: 'Pereza',
    });
    const { updateProfile } = await loadService(prisma);

    await updateProfile('user-001', { firstName: 'Juana', lastName: 'Pereza' }, PROFILE_CONTEXT);

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.auditEvent.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'user.profile_updated',
        actorId: 'user-001',
        resourceType: 'user',
        resourceId: 'user-001',
        targetUserId: 'user-001',
        requestId: 'request-profile',
        metadata: { changedFields: ['firstName', 'lastName'] },
      }),
    });
  });

  it('records a self-service organization reassignment', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(currentUserRecord);
    prisma.organizationalUnit.findUnique.mockResolvedValue({ id: 'unit-002', isActive: true });
    prisma.user.update.mockResolvedValue(profileRecord);
    const { updateProfile } = await loadService(prisma);

    await updateProfile('user-001', { unitId: 'unit-002' }, PROFILE_CONTEXT);

    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'user.organization_assignment_changed',
        changes: {
          before: { unitId: 'unit-001', careerId: 'car-001' },
          after: { unitId: 'unit-002', careerId: null },
        },
      }),
    });
  });

  it('emits both events when a single patch renames and reassigns', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(currentUserRecord);
    prisma.organizationalUnit.findUnique.mockResolvedValue({ id: 'unit-002', isActive: true });
    prisma.user.update.mockResolvedValue(profileRecord);
    const { updateProfile } = await loadService(prisma);

    await updateProfile('user-001', { firstName: 'Juana', unitId: 'unit-002' }, PROFILE_CONTEXT);

    expect(prisma.auditEvent.create).toHaveBeenCalledTimes(2);
    expect(prisma.auditEvent.create.mock.calls.map(([call]) => call.data.action)).toEqual([
      'user.profile_updated',
      'user.organization_assignment_changed',
    ]);
  });

  it('does not audit a profile patch that repeats the stored values', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(currentUserRecord);
    prisma.user.update.mockResolvedValue(profileRecord);
    const { updateProfile } = await loadService(prisma);

    await updateProfile('user-001', { firstName: 'Ana', lastName: 'Gomez' }, PROFILE_CONTEXT);

    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it('does not audit a profile patch rejected by validation', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(null);
    const { updateProfile } = await loadService(prisma);

    await expect(
      updateProfile('missing', { firstName: 'Juana' }, PROFILE_CONTEXT),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it('reverts the profile when the audit insert fails', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(currentUserRecord);
    prisma.user.update.mockResolvedValue(profileRecord);
    prisma.auditEvent.create.mockRejectedValue(new Error('audit insert failed'));
    const { updateProfile } = await loadService(prisma);

    await expect(
      updateProfile('user-001', { firstName: 'Juana' }, PROFILE_CONTEXT),
    ).rejects.toThrow('audit insert failed');
    expect(prisma.user.update).toHaveBeenCalledTimes(1);
  });

  it('records an administrative organization reassignment next to the role change', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(updateTargetRecord);
    prisma.organizationalUnit.findUnique.mockResolvedValue({ id: 'unit-002', isActive: true });
    prisma.user.update.mockResolvedValue(adminUserRecord);
    const { updateAdminUser } = await loadService(prisma);

    await updateAdminUser(
      'user-admin',
      'user-target',
      { globalRole: 'ADMIN', unitId: 'unit-002' },
      { actorId: 'user-admin', actorType: 'USER', requestId: 'request-002' },
    );

    expect(prisma.auditEvent.create.mock.calls.map(([call]) => call.data.action)).toEqual([
      'user.role_changed',
      'user.organization_assignment_changed',
    ]);
    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'user.organization_assignment_changed',
        resourceId: 'user-target',
        targetUserId: 'user-target',
        changes: {
          before: { unitId: 'unit-001' },
          after: { unitId: 'unit-002' },
        },
      }),
    });
  });

  it('does not audit an administrative patch that only repeats the assignment', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(updateTargetRecord);
    prisma.organizationalUnit.findUnique.mockResolvedValue({ id: 'unit-001', isActive: true });
    prisma.user.update.mockResolvedValue(adminUserRecord);
    const { updateAdminUser } = await loadService(prisma);

    await updateAdminUser(
      'user-admin',
      'user-target',
      { unitId: 'unit-001' },
      {
        actorId: 'user-admin',
        actorType: 'USER',
        requestId: 'request-003',
      },
    );

    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });
});
