import type { ErrorRequestHandler } from 'express';

import { createChildLogger, logger } from '../config/logger.js';
import { getLogContext } from '../lib/log-context.js';
import { ApiError } from '../utils/ApiError.js';
import { errorResponse } from '../utils/response.js';

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof ApiError) {
    res.status(error.statusCode).json(errorResponse(error.message, error.errors));
    return;
  }

  const { requestId } = getLogContext();
  const log = requestId ? createChildLogger({ requestId }) : logger;
  log.error({ event: 'http.error.unexpected', err: error }, 'http.error.unexpected');

  res.status(500).json(errorResponse('Internal server error.'));
};
