import { rateLimit } from 'express-rate-limit';

import { errorResponse } from '../utils/response.js';

export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  handler: (_req, res) => {
    res
      .status(429)
      .json(errorResponse('Too many authentication requests. Please try again later.'));
  },
});
