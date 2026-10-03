import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../utils/ApiError.js';
import { methodNotAllowed } from './methodNotAllowed.middleware.js';

describe('methodNotAllowed middleware', () => {
  it('sets the Allow header and forwards a 405 error', () => {
    const set = vi.fn();
    const next = vi.fn();

    methodNotAllowed(['GET', 'POST'])({} as Request, { set } as unknown as Response, next);

    expect(set).toHaveBeenCalledWith('Allow', 'GET, POST');
    const error = next.mock.calls[0]?.[0] as ApiError | undefined;
    expect(error).toBeInstanceOf(ApiError);
    expect(error?.statusCode).toBe(405);
    expect(error?.message).toBe('Method not allowed.');
  });
});
