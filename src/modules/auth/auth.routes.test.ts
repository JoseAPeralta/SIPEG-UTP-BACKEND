import jwt from 'jsonwebtoken';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';

const jwtSecret = 'test-access-secret-with-enough-entropy';

const validRegistrationBody = {
  nombre: 'Juan',
  apellido: 'Perez',
  cedula: '8-123-4567',
  correo: 'juan.perez@example.com',
  contrasenia: 'Password123',
};

interface UserModelMock {
  findFirst: ReturnType<typeof vi.fn>;
  create: ReturnType<typeof vi.fn>;
}

const createUserModelMock = (): UserModelMock => ({
  findFirst: vi.fn(),
  create: vi.fn(),
});

const loadApp = async (userModel: UserModelMock) => {
  process.env['NODE_ENV'] = 'test';
  process.env['JWT_ACCESS_SECRET'] = jwtSecret;
  process.env['JWT_ACCESS_EXPIRES_IN'] = '15m';
  vi.resetModules();
  vi.doMock('../../config/prisma.js', () => ({
    getPrismaClient: () => ({
      user: userModel,
    }),
  }));

  const { app } = await import('../../app.js');
  return app;
};

describe('auth routes', () => {
  afterEach(() => {
    vi.doUnmock('../../config/prisma.js');
  });

  it('registers a user and returns an access token', async () => {
    const userModel = createUserModelMock();
    userModel.findFirst.mockResolvedValue(null);
    userModel.create.mockImplementation(({ data }) => ({
      id: 'user-001',
      nombre: data.nombre,
      apellido: data.apellido,
      cedula: data.cedula,
      correo: data.correo,
      passwordHash: data.passwordHash,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    }));
    const app = await loadApp(userModel);

    const response = await request(app)
      .post('/api/v1/auth/register')
      .send(validRegistrationBody)
      .expect(201);

    expect(response.body).toEqual({
      success: true,
      message: 'User created successfully.',
      data: {
        user: {
          id: 'user-001',
          nombre: 'Juan',
          apellido: 'Perez',
          cedula: '8-123-4567',
          correo: 'juan.perez@example.com',
        },
        accessToken: expect.any(String),
      },
    });
    expect(response.body.data.user).not.toHaveProperty('passwordHash');
    expect(response.body.data.user).not.toHaveProperty('contrasenia');
    expect(userModel.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        nombre: 'Juan',
        apellido: 'Perez',
        cedula: '8-123-4567',
        correo: 'juan.perez@example.com',
        passwordHash: expect.any(String),
      }),
    });
    expect(userModel.create.mock.calls[0]?.[0].data.passwordHash).not.toBe('Password123');

    const decoded = jwt.verify(response.body.data.accessToken, jwtSecret, {
      algorithms: ['HS256'],
      issuer: 'sipeg-utp-backend',
      audience: 'sipeg-utp-api',
    });
    expect(typeof decoded).toBe('object');
    expect(decoded).toMatchObject({
      sub: 'user-001',
      correo: 'juan.perez@example.com',
    });
  });

  it('rejects invalid cedula formats', async () => {
    const userModel = createUserModelMock();
    const app = await loadApp(userModel);

    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({
        ...validRegistrationBody,
        cedula: 'ABC-123',
      })
      .expect(400);

    expect(response.body).toEqual({
      success: false,
      message: 'Validation error.',
      errors: expect.arrayContaining([
        expect.objectContaining({
          field: 'body.cedula',
        }),
      ]),
    });
    expect(userModel.create).not.toHaveBeenCalled();
  });

  it('rejects duplicated email addresses', async () => {
    const userModel = createUserModelMock();
    userModel.findFirst.mockResolvedValue({
      id: 'existing-user',
      correo: validRegistrationBody.correo,
      cedula: '9-999-9999',
    });
    const app = await loadApp(userModel);

    const response = await request(app)
      .post('/api/v1/auth/register')
      .send(validRegistrationBody)
      .expect(409);

    expect(response.body).toEqual({
      success: false,
      message: 'Email is already registered.',
      errors: [],
    });
    expect(userModel.create).not.toHaveBeenCalled();
  });

  it('rejects duplicated cedulas', async () => {
    const userModel = createUserModelMock();
    userModel.findFirst.mockResolvedValue({
      id: 'existing-user',
      correo: 'another@example.com',
      cedula: validRegistrationBody.cedula,
    });
    const app = await loadApp(userModel);

    const response = await request(app)
      .post('/api/v1/auth/register')
      .send(validRegistrationBody)
      .expect(409);

    expect(response.body).toEqual({
      success: false,
      message: 'Cedula is already registered.',
      errors: [],
    });
    expect(userModel.create).not.toHaveBeenCalled();
  });
});
