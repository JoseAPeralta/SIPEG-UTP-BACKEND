import type { ErrorRequestHandler } from 'express';

import { createRequestLogger } from '../config/logger.js';
import { ApiError } from '../utils/ApiError.js';
import { errorResponse } from '../utils/response.js';

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof ApiError) {
    res.status(error.statusCode).json(errorResponse(error.message, error.errors));
    return;
  }

  createRequestLogger({
    event: 'http.error.unexpected',
    logType: 'application',
    err: error,
  }).error('http.error.unexpected');

  res.status(500).json(errorResponse('Internal server error.'));
};
