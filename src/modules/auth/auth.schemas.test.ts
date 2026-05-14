import { describe, expect, it } from 'vitest';

import { registerUserSchema } from './auth.schemas.js';

const validRegistrationBody = {
  nombre: 'Juan',
  apellido: 'Perez',
  cedula: '8-123-4567',
  correo: 'juan.perez@example.com',
  contrasenia: 'Password123',
};

describe('auth schemas', () => {
  it.each([
    '8-123-4567',
    '13-12-123456',
    'E-8-12345',
    'N-12-3456',
    'PE-1-1234',
    'AV-1-1234',
    'PI-1-1234',
  ])('accepts Panamanian cedula format %s', (cedula) => {
    const result = registerUserSchema.safeParse({
      body: {
        ...validRegistrationBody,
        cedula,
      },
    });

    expect(result.success).toBe(true);
  });

  it('rejects invalid cedula formats', () => {
    const result = registerUserSchema.safeParse({
      body: {
        ...validRegistrationBody,
        cedula: 'ABC-123',
      },
    });

    expect(result.success).toBe(false);
  });
});
