import type { ErrorRequestHandler } from 'express';

import { ApiError } from '../utils/ApiError.js';
import { errorResponse } from '../utils/response.js';

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof ApiError) {
    res.status(error.statusCode).json(errorResponse(error.message, error.errors));
    return;
  }

  res.status(500).json(errorResponse('Internal server error.'));
};
