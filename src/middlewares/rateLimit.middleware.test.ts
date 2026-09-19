import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../utils/ApiError.js';

const buildReq = (overrides: Partial<Request> = {}): Request =>
  ({ ip: '127.0.0.1', ...overrides } as unknown as Request);
const buildRes = (): Response =>
  ({ status: vi.fn().mockReturnThis(), json: vi.fn(), setHeader: vi.fn() } as unknown as Response);

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
});
