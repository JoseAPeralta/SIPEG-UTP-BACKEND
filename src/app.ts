import { apiReference } from '@scalar/express-api-reference';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { toNodeHandler } from 'better-auth/node';

import { auth } from './lib/auth.js';
import { env } from './config/env.js';
import { createRequestLogger } from './config/logger.js';
import { openApiDocument } from './docs/openapi.js';
import { errorHandler } from './middlewares/error.middleware.js';
import { notFoundHandler } from './middlewares/notFound.middleware.js';
import { apiRoutes } from './routes.js';
import { requestLogger } from './middlewares/requestLogger.middleware.js';
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

app.use(requestLogger);

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

      createRequestLogger({ event: 'security.cors.denied', logType: 'security', origin }).warn(
        'security.cors.denied',
      );
      callback(new ApiError(403, 'CORS origin is not allowed.'));
    },
    credentials: true,
    exposedHeaders: ['X-Request-ID'],
  }),
);

app.get('/api/auth/jwks', toNodeHandler(auth));
app.all('/api/auth/*splat', notFoundHandler);

// Necesario para leer la cookie de refresco en /api/v1/auth. `cookie-parser` no
// expone su valor a la respuesta ni lo registra, y la cookie esta marcada como
// HttpOnly, asi que el access log nunca la ve. Va despues de CORS para que un
// origen no permitido se rechace antes de analizar cabeceras.
app.use(cookieParser());

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
