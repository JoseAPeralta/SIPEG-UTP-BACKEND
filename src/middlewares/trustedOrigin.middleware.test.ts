import { beforeEach, describe, expect, it, vi } from 'vitest';

import { requireTrustedOrigin } from './trustedOrigin.middleware.js';

// Los bindings del evento van a `createRequestLogger` y el mensaje a `.warn()`,
// asi que hay que observar el primero para ver el `event`.
const { loggerWarn, createRequestLogger } = vi.hoisted(() => ({
  loggerWarn: vi.fn(),
  createRequestLogger: vi.fn(() => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn() })),
}));

vi.mock('../config/logger.js', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: loggerWarn },
  createRequestLogger,
}));

// `CORS_ORIGIN` es un origen unico; los adicionales van en `TRUSTED_ORIGINS`.
vi.mock('../config/env.js', () => ({
  env: {
    CORS_ORIGIN: 'https://app.utp.ac.pa',
    TRUSTED_ORIGINS: 'https://admin.utp.ac.pa,http://localhost:5173',
    NODE_ENV: 'test',
  },
}));

const run = (origin?: string): { nextCalled: boolean; error?: unknown } => {
  let nextCalled = false;
  let captured: unknown;

  const req = { headers: origin === undefined ? {} : { origin } } as never;
  const res = {} as never;
  requireTrustedOrigin(req, res, ((error?: unknown) => {
    if (error) {
      captured = error;
      return;
    }
    nextCalled = true;
  }) as never);

  return { nextCalled, error: captured };
};

describe('requireTrustedOrigin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('deja pasar el origen principal', () => {
    expect(run('https://app.utp.ac.pa').nextCalled).toBe(true);
  });

  it('deja pasar un origen de TRUSTED_ORIGINS', () => {
    expect(run('https://admin.utp.ac.pa').nextCalled).toBe(true);
  });

  it('deja pasar el origen de desarrollo, que esta en TRUSTED_ORIGINS', () => {
    expect(run('http://localhost:5173').nextCalled).toBe(true);
  });

  it('deja pasar una peticion sin Origin, que es cualquier cliente que no sea un navegador', () => {
    // Bruno, curl y los tests no la envian. Un atacante desde otro sitio si la
    // envia, que es justo el caso que se quiere cerrar.
    expect(run(undefined).nextCalled).toBe(true);
  });

  it('rechaza un origen no permitido con 403', () => {
    const result = run('https://sitio-malicioso.example');

    expect(result.nextCalled).toBe(false);
    expect(result.error).toMatchObject({ statusCode: 403, message: 'CORS origin is not allowed.' });
  });

  it('rechaza un origen que se parece al permitido pero no lo es', () => {
    // Sin esta comprobacion, `evil-app.utp.ac.pa` o un origen con sufijo
    // colarian en la allowlist.
    expect(run('https://app.utp.ac.pa.malicioso.example').nextCalled).toBe(false);
    expect(run('https://otro.utp.ac.pa').nextCalled).toBe(false);
  });

  it('registra el origen rechazado como evento de seguridad', () => {
    run('https://sitio-malicioso.example');

    expect(createRequestLogger).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'security.cors.denied',
        logType: 'security',
        origin: 'https://sitio-malicioso.example',
      }),
    );
  });
});
