import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

const jwtSecret = 'test-access-secret-with-enough-entropy';

interface PrismaMock {
  user: { findUnique: ReturnType<typeof vi.fn> };
  collaboration: { findFirst: ReturnType<typeof vi.fn> };
  activity: { findUnique: ReturnType<typeof vi.fn> };
}

const createPrismaMock = (): PrismaMock => ({
  user: { findUnique: vi.fn() },
  collaboration: { findFirst: vi.fn() },
  activity: { findUnique: vi.fn() },
});

const authUserRecord = {
  id: 'user-001',
  firstName: 'Juan',
  lastName: 'Perez',
  email: 'juan.perez@example.com',
  globalRole: 'USER',
  isActive: true,
};

const accessToken = jwt.sign({ email: authUserRecord.email }, jwtSecret, {
  algorithm: 'HS256',
  audience: 'sipeg-utp-api',
  expiresIn: '15m',
  issuer: 'sipeg-utp-backend',
  subject: authUserRecord.id,
});

const permissions = (names: string[]) => ({
  permissions: names.map((name) => ({ permission: { name } })),
});

const loadTestApp = async (prisma: PrismaMock) => {
  process.env['NODE_ENV'] = 'test';
  process.env['JWT_ACCESS_SECRET'] = jwtSecret;
  process.env['JWT_ACCESS_EXPIRES_IN'] = '15m';
  vi.resetModules();
  vi.doMock('../config/prisma.js', () => ({
    getPrismaClient: () => prisma,
  }));

  const [
    { authenticate },
    { requireActivityRole, requireProgramRole },
    { errorHandler },
    expressModule,
  ] = await Promise.all([
    import('./auth.middleware.js'),
    import('./authorize.middleware.js'),
    import('./error.middleware.js'),
    import('express'),
  ]);

  const express = expressModule.default;
  const app = express();

  app.get(
    '/event-programs/:eventProgramId/protected',
    authenticate,
    requireProgramRole('EDITOR'),
    (_req, res) => {
      res.status(200).json({ ok: true });
    },
  );

  app.get('/event-programs', authenticate, requireProgramRole('EDITOR'), (_req, res) => {
    res.status(200).json({ ok: true });
  });

  app.get(
    '/activities/:activityId/protected',
    authenticate,
    requireActivityRole('EDITOR'),
    (_req, res) => {
      res.status(200).json({ ok: true });
    },
  );

  app.use(errorHandler);

  return app;
};

describe('requireProgramRole middleware', () => {
  afterEach(() => {
    vi.doUnmock('../config/prisma.js');
  });

  it('rejects unauthenticated requests', async () => {
    const prisma = createPrismaMock();
    const app = await loadTestApp(prisma);

    await request(app).get('/event-programs/program-001/protected').expect(401);
    expect(prisma.collaboration.findFirst).not.toHaveBeenCalled();
  });

  it('requires the event program id route parameter', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(authUserRecord);
    const app = await loadTestApp(prisma);

    const response = await request(app)
      .get('/event-programs')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(400);

    expect(response.body).toEqual({
      success: false,
      message: 'Event program ID is required.',
      errors: [],
    });
  });

  it('denies users without a program collaboration', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(authUserRecord);
    prisma.collaboration.findFirst.mockResolvedValue(null);
    const app = await loadTestApp(prisma);

    const response = await request(app)
      .get('/event-programs/program-001/protected')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(403);

    expect(response.body).toEqual({
      success: false,
      message: 'You do not have permission to perform this action.',
      errors: [],
    });
  });

  it('denies collaborators with an insufficient role', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(authUserRecord);
    prisma.collaboration.findFirst.mockResolvedValue({
      role: 'VIEWER',
      ...permissions([]),
    });
    const app = await loadTestApp(prisma);

    await request(app)
      .get('/event-programs/program-001/protected')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(403);
  });

  it('allows collaborators with the required role', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(authUserRecord);
    prisma.collaboration.findFirst.mockResolvedValue({
      role: 'EDITOR',
      ...permissions(['activity.create']),
    });
    const app = await loadTestApp(prisma);

    await request(app)
      .get('/event-programs/program-001/protected')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
  });

  it('allows global administrators without a program collaboration', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue({ ...authUserRecord, globalRole: 'ADMIN' });
    const app = await loadTestApp(prisma);

    await request(app)
      .get('/event-programs/program-001/protected')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(prisma.collaboration.findFirst).not.toHaveBeenCalled();
  });
});

describe('requireActivityRole middleware', () => {
  afterEach(() => {
    vi.doUnmock('../config/prisma.js');
  });

  it('denies users with only inherited viewer access', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(authUserRecord);
    prisma.activity.findUnique.mockResolvedValue({
      collaborations: [],
      eventProgram: {
        collaborations: [{ role: 'VIEWER', ...permissions(['report.view']) }],
      },
    });
    const app = await loadTestApp(prisma);

    await request(app)
      .get('/activities/activity-001/protected')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(403);
  });

  it('allows users with local editor collaboration', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(authUserRecord);
    prisma.activity.findUnique.mockResolvedValue({
      collaborations: [{ role: 'EDITOR', ...permissions(['attendance.manage']) }],
      eventProgram: { collaborations: [] },
    });
    const app = await loadTestApp(prisma);

    await request(app)
      .get('/activities/activity-001/protected')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
  });

  it('allows global administrators', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue({ ...authUserRecord, globalRole: 'ADMIN' });
    const app = await loadTestApp(prisma);

    await request(app)
      .get('/activities/activity-001/protected')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(prisma.activity.findUnique).not.toHaveBeenCalled();
  });
});
