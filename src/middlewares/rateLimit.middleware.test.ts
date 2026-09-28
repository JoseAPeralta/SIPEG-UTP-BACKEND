import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../utils/ApiError.js';

const { loggerWarn, createRequestLoggerSpy } = vi.hoisted(() => {
  const loggerWarn = vi.fn();
  const createRequestLoggerSpy = vi.fn(() => ({
    error: vi.fn(),
    info: vi.fn(),
    warn: loggerWarn,
  }));
  return { loggerWarn, createRequestLoggerSpy };
});

vi.mock('../config/logger.js', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: loggerWarn },
  createChildLogger: vi.fn(() => ({ error: vi.fn(), info: vi.fn(), warn: loggerWarn })),
  createRequestLogger: createRequestLoggerSpy,
}));

const buildReq = (overrides: Partial<Request> = {}): Request =>
  ({ ip: '127.0.0.1', ...overrides }) as unknown as Request;
const buildRes = (): Response =>
  ({ status: vi.fn().mockReturnThis(), json: vi.fn(), setHeader: vi.fn() }) as unknown as Response;

describe('rate limit middleware', () => {
  it('returns 429 with ApiError when limit is exceeded', async () => {
    vi.resetModules();
    const expressRateLimit = vi.fn(({ handler }) => handler);
    vi.doMock('express-rate-limit', () => ({
      default: expressRateLimit,
      ipKeyGenerator: (ip: string) => ip,
    }));
    const { authRateLimit } = await import('./rateLimit.middleware.js');
    const middleware = authRateLimit({ windowMs: 60_000, max: 1 });
    const next = vi.fn();
    middleware(buildReq(), buildRes(), next);
    const error = next.mock.calls[0]?.[0] as ApiError | undefined;
    expect(error?.statusCode).toBe(429);
  });

  it('logs rate_limit.exceeded with the limiter name and no internal key', async () => {
    vi.resetModules();
    const expressRateLimit = vi.fn(({ handler }) => handler);
    vi.doMock('express-rate-limit', () => ({
      default: expressRateLimit,
      ipKeyGenerator: (ip: string) => ip,
    }));
    const { authRateLimit } = await import('./rateLimit.middleware.js');
    const middleware = authRateLimit({
      windowMs: 60_000,
      max: 1,
      name: 'login.email',
    });
    const next = vi.fn();
    middleware(buildReq({ body: { email: 'user@example.com' }, ip: '1.2.3.4' }), buildRes(), next);
    expect(createRequestLoggerSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'rate_limit.exceeded',
        logType: 'security',
        limiter: 'login.email',
      }),
    );
    expect(loggerWarn).toHaveBeenCalledWith('rate_limit.exceeded');
    const bindings = JSON.stringify(createRequestLoggerSpy.mock.calls);
    expect(bindings).not.toContain('user@example.com');
    expect(bindings).not.toContain('1.2.3.4');
  });

  it('prefers user id over ip when authenticated', async () => {
    vi.resetModules();
    let capturedKey: string | undefined;
    vi.doMock('express-rate-limit', () => ({
      default: vi.fn(({ keyGenerator }) => {
        capturedKey = keyGenerator({ ip: '1.1.1.1', user: { id: 'user-1' } } as unknown as Request);
        return () => {};
      }),
      ipKeyGenerator: (ip: string) => ip,
    }));
    const { authRateLimit } = await import('./rateLimit.middleware.js');
    authRateLimit({ windowMs: 60_000, max: 1 });
    expect(capturedKey).toBe('user:user-1');
  });

  it('exports independent limiters per password and email verification flow', async () => {
    vi.resetModules();
    vi.doMock('express-rate-limit', () => ({
      default: vi.fn(() => vi.fn()),
      ipKeyGenerator: (ip: string) => ip,
    }));
    const { emailVerificationRateLimit, forgotPasswordRateLimit, resetPasswordRateLimit } =
      await import('./rateLimit.middleware.js');

    expect(forgotPasswordRateLimit).toBeTypeOf('function');
    expect(resetPasswordRateLimit).toBeTypeOf('function');
    expect(emailVerificationRateLimit).toBeTypeOf('function');
    expect(forgotPasswordRateLimit).not.toBe(resetPasswordRateLimit);
    expect(forgotPasswordRateLimit).not.toBe(emailVerificationRateLimit);
    expect(resetPasswordRateLimit).not.toBe(emailVerificationRateLimit);
  });

  it('keys email limiters by normalized email and ip', async () => {
    vi.resetModules();
    let capturedKey: string | undefined;
    vi.doMock('express-rate-limit', () => ({
      default: vi.fn(({ keyGenerator }) => {
        capturedKey = keyGenerator({
          body: { email: '  User@Example.COM ' },
          ip: '::ffff:1.2.3.4',
        } as unknown as Request);
        return () => {};
      }),
      ipKeyGenerator: (ip: string) => ip,
    }));
    const { emailAuthRateLimit } = await import('./rateLimit.middleware.js');

    emailAuthRateLimit({ windowMs: 60_000, max: 1 });

    expect(capturedKey).toBe('email:user@example.com|ip:1.2.3.4');
  });

  it('falls back to the ip key when the body has no email', async () => {
    vi.resetModules();
    let capturedKey: string | undefined;
    vi.doMock('express-rate-limit', () => ({
      default: vi.fn(({ keyGenerator }) => {
        capturedKey = keyGenerator({ body: {}, ip: '1.2.3.4' } as unknown as Request);
        return () => {};
      }),
      ipKeyGenerator: (ip: string) => ip,
    }));
    const { emailAuthRateLimit } = await import('./rateLimit.middleware.js');

    emailAuthRateLimit({ windowMs: 60_000, max: 1 });

    expect(capturedKey).toBe('ip:1.2.3.4');
  });

  it('prefers the authenticated user id in email limiters', async () => {
    vi.resetModules();
    let capturedKey: string | undefined;
    vi.doMock('express-rate-limit', () => ({
      default: vi.fn(({ keyGenerator }) => {
        capturedKey = keyGenerator({
          body: { email: 'user@example.com' },
          ip: '1.2.3.4',
          user: { id: 'user-1' },
        } as unknown as Request);
        return () => {};
      }),
      ipKeyGenerator: (ip: string) => ip,
    }));
    const { emailAuthRateLimit } = await import('./rateLimit.middleware.js');

    emailAuthRateLimit({ windowMs: 60_000, max: 1 });

    expect(capturedKey).toBe('user:user-1');
  });

  it('runs chained limiters in order and stops on the first rejection', async () => {
    vi.resetModules();
    const seenMax: number[] = [];
    vi.doMock('express-rate-limit', () => ({
      default: vi.fn(
        ({ limit }) =>
          (_req: Request, _res: Response, next: (error?: unknown) => void) => {
            seenMax.push(limit as number);
            if (limit === 30) {
              next(new ApiError(429, 'Too many login attempts. Try again in one minute.'));
              return;
            }
            next();
          },
      ),
      ipKeyGenerator: (ip: string) => ip,
    }));
    const { loginRateLimit } = await import('./rateLimit.middleware.js');
    const next = vi.fn();

    loginRateLimit(buildReq(), buildRes(), next);

    expect(seenMax).toEqual([30]);
    expect((next.mock.calls[0]?.[0] as ApiError | undefined)?.statusCode).toBe(429);
  });
});
