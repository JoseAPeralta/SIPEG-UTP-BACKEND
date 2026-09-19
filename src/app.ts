import { apiReference } from '@scalar/express-api-reference';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { toNodeHandler } from 'better-auth/node';

import { auth } from './lib/auth.js';
import { env } from './config/env.js';
import { openApiDocument } from './docs/openapi.js';
import { errorHandler } from './middlewares/error.middleware.js';
import { notFoundHandler } from './middlewares/notFound.middleware.js';
import { apiRoutes } from './routes/index.js';
import { ApiError } from './utils/ApiError.js';

const allowedOrigins = [
  env.CORS_ORIGIN,
  ...(env.TRUSTED_ORIGINS?.split(',')
    .map((o) => o.trim())
    .filter(Boolean) ?? []),
];

const docsEnabled = env.DOCS_ENABLED ?? env.NODE_ENV !== 'production';

export const app = express();

app.set('trust proxy', 1);

app.use(
  helmet({
    contentSecurityPolicy: env.NODE_ENV === 'production',
    crossOriginResourcePolicy: { policy: 'same-site' },
    hsts:
      env.NODE_ENV === 'production'
        ? { maxAge: 31_536_000, includeSubDomains: true, preload: true }
        : false,
    referrerPolicy: { policy: 'no-referrer' },
  }),
);
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new ApiError(403, 'CORS origin is not allowed.'));
    },
    credentials: true,
  }),
);

app.all('/api/auth/*splat', toNodeHandler(auth));

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

app.use('/api/v1', apiRoutes);

if (docsEnabled) {
  app.get('/api/openapi.json', (_req, res) => {
    res.json(openApiDocument);
  });
  app.get('/api/docs', apiReference({ content: openApiDocument }));
}

app.use(notFoundHandler);
app.use(errorHandler);
