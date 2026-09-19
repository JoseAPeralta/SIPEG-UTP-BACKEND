import 'dotenv/config';

import { z } from 'zod';

const optionalNonEmptyString = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().min(1).optional(),
);

const ttlSchema = z.string().regex(/^\d+[smhd]$/, 'Must match /\\d+[smhd]/.');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_URL: optionalNonEmptyString,
    CORS_ORIGIN: z.string().min(1).default('http://localhost:5173'),
    AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 chars.'),
    AUTH_URL: z.string().url().default('http://localhost:3000'),
    AUTH_ISSUER: z.string().min(1).optional(),
    AUTH_AUDIENCE: z.string().min(1).optional(),
    AUTH_TOKEN_TTL: ttlSchema.default('15m'),
    AUTH_REFRESH_TTL: ttlSchema.default('7d'),
    TRUSTED_ORIGINS: z.string().min(1).optional(),
    DOCS_ENABLED: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  })
  .superRefine((value, context) => {
    const corsOrigins = value.CORS_ORIGIN.split(',').map((origin) => origin.trim());

    if (value.NODE_ENV === 'production' && corsOrigins.includes('*')) {
      context.addIssue({
        code: 'custom',
        path: ['CORS_ORIGIN'],
        message: 'CORS_ORIGIN cannot use * in production.',
      });
    }

    if (value.NODE_ENV !== 'test' && !value.DATABASE_URL) {
      context.addIssue({
        code: 'custom',
        path: ['DATABASE_URL'],
        message: 'DATABASE_URL is required outside the test environment.',
      });
    }
  });

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  const details = parsedEnv.error.issues
    .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    .join('; ');

  throw new Error(`Invalid environment configuration. ${details}`);
}

export const env = parsedEnv.data;
