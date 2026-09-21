import type { RequestHandler } from 'express';

import { ApiError } from '../utils/ApiError.js';

export const methodNotAllowed = (allowedMethods: string[]): RequestHandler => {
  return (_req, res, next) => {
    res.set('Allow', allowedMethods.join(', '));
    next(new ApiError(405, 'Method not allowed.'));
  };
};
