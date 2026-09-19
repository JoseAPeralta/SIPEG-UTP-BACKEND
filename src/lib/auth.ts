import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { jwt } from 'better-auth/plugins';

import { getPrismaClient } from '../config/prisma.js';
import { env } from '../config/env.js';
import { hashPassword, verifyPassword } from './password.js';

const trustedOrigins = [
  env.CORS_ORIGIN,
  ...(env.TRUSTED_ORIGINS?.split(',')
    .map((o) => o.trim())
    .filter(Boolean) ?? []),
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
    requireEmailVerification: false,
    minPasswordLength: 12,
    maxPasswordLength: 128,
    autoSignIn: false,
    password: {
      hash: hashPassword,
      verify: ({ hash, password }) => verifyPassword(hash, password),
    },
  },
  emailVerification: {
    sendOnSignUp: false,
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
      unitId: { type: 'string', required: false, input: true },
      careerId: { type: 'string', required: false, input: true },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,
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
          unitId: (user as { unitId?: string | null }).unitId ?? null,
          careerId: (user as { careerId?: string | null }).careerId ?? null,
          isActive: (user as { isActive?: boolean }).isActive ?? true,
        }),
      },
      jwks: {
        keyPairConfig: { alg: 'EdDSA', crv: 'Ed25519' },
        disablePrivateKeyEncryption: true,
      },
      adapter: {
        getJwks: async () => {
          const prisma = getPrismaClient();
          const rows = await prisma.jwks.findMany();
          return rows.map((row) => {
            const publicJwk = JSON.parse(row.publicKey) as Record<string, unknown>;
            return {
              id: row.id,
              publicKey: row.publicKey,
              privateKey: row.privateKey,
              alg: publicJwk['alg'] ?? null,
              crv: publicJwk['crv'] ?? null,
              createdAt: row.createdAt,
            };
          }) as never;
        },
        createJwk: async (jwk, _ctx) => {
          const prisma = getPrismaClient();
          const data = jwk as unknown as {
            id?: string;
            publicKey: string;
            privateKey: string;
            alg?: string;
            crv?: string;
            createdAt?: Date;
          };
          await prisma.jwks.create({
            data: {
              id: data.id ?? crypto.randomUUID(),
              publicKey: data.publicKey,
              privateKey: data.privateKey,
            },
          });
          return data as never;
        },
      },
    }),
  ],
});

export type Auth = typeof auth;
export type Session = Auth['$Infer']['Session'];

export const ensureJwks = async (): Promise<void> => {
  const prisma = getPrismaClient();
  const existing = await prisma.jwks.count();
  if (existing > 0) return;
  await auth.api
    .getToken({
      headers: { origin: env.AUTH_URL },
      asResponse: false,
    })
    .catch(() => {
      // The first call may fail if there is no session; we only need it to trigger JWKS creation.
    });
  const after = await prisma.jwks.count();
  if (after === 0) {
    const response = await auth.handler(
      new Request(`${env.AUTH_URL}/api/auth/jwks`, { method: 'GET' }),
    );
    if (!response.ok && response.status !== 401) {
      throw new Error(`Failed to initialize JWKS: ${response.status}`);
    }
  }
};
