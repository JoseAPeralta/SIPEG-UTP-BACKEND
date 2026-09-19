import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { jwt } from 'better-auth/plugins';

import { getPrismaClient } from '../config/prisma.js';
import { env } from '../config/env.js';
import { hashPassword, verifyPassword } from './password.js';

const trustedOrigins = [
  env.CORS_ORIGIN,
  ...(env.TRUSTED_ORIGINS?.split(',').map((o) => o.trim()).filter(Boolean) ?? []),
];

export const auth = betterAuth({
  appName: 'SIPEG UTP Backend',
  secret: env.AUTH_SECRET,
  baseURL: env.AUTH_URL,
  trustedOrigins,
  database: prismaAdapter(getPrismaClient(), { provider: 'postgresql' }),
  advanced: {
    database: { joins: true },
    cookiePrefix: 'sipeg',
    useSecureCookies: env.NODE_ENV === 'production',
  },
  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    customRules: {
      '/sign-in/email': { window: 60, max: 5 },
      '/sign-up/email': { window: 60, max: 3 },
      '/forget-password': { window: 60, max: 3 },
      '/reset-password': { window: 60, max: 5 },
    },
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    minPasswordLength: 12,
    maxPasswordLength: 128,
    autoSignIn: false,
    password: {
      hash: hashPassword,
      verify: ({ hash, password }) => verifyPassword(hash, password),
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: true,
    expiresIn: 60 * 60 * 24,
  },
  user: {
    additionalFields: {
      firstName: { type: 'string', required: true, input: true },
      lastName: { type: 'string', required: true, input: true },
      identificationNumber: {
        type: 'string',
        required: true,
        input: true,
      },
      globalRole: { type: 'string', required: false, input: false },
      isActive: { type: 'boolean', required: false, input: false },
      facultyId: { type: 'string', required: false, input: true },
      careerId: { type: 'string', required: false, input: true },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
    cookieCache: { enabled: true, maxAge: 60 * 5 },
  },
  plugins: [
    jwt({
      jwt: {
        issuer: env.AUTH_ISSUER ?? env.AUTH_URL,
        audience: env.AUTH_AUDIENCE ?? env.AUTH_URL,
        expirationTime: env.AUTH_TOKEN_TTL,
        definePayload: ({ user }) => ({
          sub: user.id,
          email: user.email,
          role: (user as { globalRole?: string }).globalRole ?? 'USER',
          facultyId: (user as { facultyId?: string | null }).facultyId ?? null,
          careerId: (user as { careerId?: string | null }).careerId ?? null,
          isActive: (user as { isActive?: boolean }).isActive ?? true,
        }),
      },
      jwks: {
        keyPairConfig: { alg: 'EdDSA', crv: 'Ed25519' },
      },
    }),
  ],
});

export type Auth = typeof auth;
export type Session = Auth['$Infer']['Session'];
