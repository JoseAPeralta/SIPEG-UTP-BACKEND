import type { RequestHandler } from 'express';
import { ZodError, type ZodType } from 'zod';

import { ApiError } from '../utils/ApiError.js';

interface RequestParts {
  body?: unknown;
  params?: unknown;
  query?: unknown;
}

export const validate = (schema: ZodType<RequestParts>): RequestHandler => {
  return (req, _res, next) => {
    try {
      const parsed = schema.parse({
        body: req.body,
        params: req.params,
        query: req.query,
      });

      if ('body' in parsed) {
        req.body = parsed.body;
      }

      if ('params' in parsed) {
        req.params = parsed.params as typeof req.params;
      }

      if ('query' in parsed) {
        req.query = parsed.query as typeof req.query;
      }

      next();
    } catch (error) {
      if (error instanceof ZodError) {
        next(
          new ApiError(
            400,
            'Validation error.',
            error.issues.map((issue) => ({
              field: issue.path.join('.'),
              message: issue.message,
            })),
          ),
        );
        return;
      }

      next(error);
    }
  };
};
