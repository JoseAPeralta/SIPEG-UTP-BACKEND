import 'dotenv/config';

import { z } from 'zod';

const optionalNonEmptyString = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().min(1).optional(),
);

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    DATABASE_URL: optionalNonEmptyString,
    JWT_ACCESS_SECRET: optionalNonEmptyString,
    JWT_REFRESH_SECRET: optionalNonEmptyString,
    JWT_ACCESS_EXPIRES_IN: z.string().min(1).default('15m'),
    JWT_REFRESH_EXPIRES_IN: z.string().min(1).default('7d'),
    CORS_ORIGIN: z.string().min(1).default('http://localhost:5173'),
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
  });

const parsedEnv = envSchema.safeParse(process.env);

if (!parsedEnv.success) {
  const details = parsedEnv.error.issues
    .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
    .join('; ');

  throw new Error(`Invalid environment configuration. ${details}`);
}

export const env = parsedEnv.data;
