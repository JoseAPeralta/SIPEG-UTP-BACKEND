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
    DATABASE_POOL_MAX: z.coerce.number().int().positive().max(100).default(9),
    DATABASE_POOL_CONNECTION_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
    DATABASE_POOL_IDLE_TIMEOUT_MS: z.coerce.number().int().nonnegative().default(30_000),
    CORS_ORIGIN: z.string().min(1).default('http://localhost:5173'),
    AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 chars.'),
    AUTH_URL: z.string().url().default('http://localhost:3000'),
    AUTH_ISSUER: z.string().min(1).optional(),
    AUTH_AUDIENCE: z.string().min(1).optional(),
    AUTH_TOKEN_TTL: ttlSchema.default('15m'),
    AUTH_REFRESH_TTL: ttlSchema.default('7d'),
    AUTH_EMAIL_VERIFICATION_URL: z.string().url().default('http://localhost:5173/verify-email'),
    AUTH_PASSWORD_RESET_URL: z.string().url().default('http://localhost:5173/reset-password'),
    AUTH_EMAIL_VERIFICATION_TTL: ttlSchema.default('24h'),
    AUTH_PASSWORD_RESET_TTL: ttlSchema.default('1h'),
    MAIL_HOST: optionalNonEmptyString,
    MAIL_PORT: z.coerce.number().int().positive().max(65_535).default(1025),
    MAIL_SECURE: z
      .enum(['true', 'false'])
      .default('false')
      .transform((value) => value === 'true'),
    MAIL_USER: optionalNonEmptyString,
    MAIL_PASSWORD: optionalNonEmptyString,
    MAIL_FROM: z.string().min(1).default('SIPEG UTP <no-reply@sipeg.local>'),
    TRUSTED_ORIGINS: z.string().min(1).optional(),
    DOCS_ENABLED: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    LOG_PRETTY: z
      .enum(['true', 'false'])
      .transform((value) => value === 'true')
      .optional(),
    LOG_PSEUDONYMIZATION_KEY: z
      .string()
      .min(32, 'LOG_PSEUDONYMIZATION_KEY must be at least 32 chars.')
      .optional(),
    LOG_SERVICE_NAME: z.string().min(1).default('sipeg-utp-backend'),
    APP_VERSION: z.string().min(1).default('1.0.0'),
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

    if (value.NODE_ENV === 'production' && !value.MAIL_HOST) {
      context.addIssue({
        code: 'custom',
        path: ['MAIL_HOST'],
        message: 'MAIL_HOST is required in production.',
      });
    }

    if (Boolean(value.MAIL_USER) !== Boolean(value.MAIL_PASSWORD)) {
      context.addIssue({
        code: 'custom',
        path: ['MAIL_USER'],
        message: 'MAIL_USER and MAIL_PASSWORD must be provided together.',
      });
    }

    if (value.NODE_ENV === 'production' && !value.LOG_PSEUDONYMIZATION_KEY) {
      context.addIssue({
        code: 'custom',
        path: ['LOG_PSEUDONYMIZATION_KEY'],
        message: 'LOG_PSEUDONYMIZATION_KEY is required in production.',
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
