import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { jwt } from 'better-auth/plugins';

import { getPrismaClient } from '../config/prisma.js';
import { logger } from '../config/logger.js';
import { env } from '../config/env.js';
import { parseTtlToSeconds } from '../utils/ttl.js';
import { sendPasswordResetEmail, sendVerificationEmail } from '../modules/auth/auth.email.js';
import { captureAuthAuditSubject } from '../modules/auth/auth.audit.js';
import {
  hashPassword,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  verifyPassword,
} from './password.js';

const splitOrigins = (value: string): string[] =>
  value
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

const trustedOrigins = [
  ...splitOrigins(env.CORS_ORIGIN),
  ...(env.TRUSTED_ORIGINS ? splitOrigins(env.TRUSTED_ORIGINS) : []),
  new URL(env.AUTH_PASSWORD_RESET_URL).origin,
].filter((origin, index, origins) => origins.indexOf(origin) === index);

const reportEmailDeliveryFailure = (): void => {
  logger.error({ event: 'mail.delivery.failed', logType: 'application' }, 'mail.delivery.failed');
};

/**
 * Los hooks de Better Auth solo identifican al sujeto; no escriben auditoria.
 *
 * Anotan el `userId` en el marcador de la llamada en curso y el servicio lo
 * consume despues, cuando la llamada del proveedor ya termino bien. La razon es
 * que `onPasswordReset` corre DESPUES de cambiar la contrasena pero ANTES de
 * revocar las sesiones: auditar ahi convertiria un fallo de la bitacora en
 * sesiones sin revocar. El hook no escribe en base de datos y no captura errores,
 * asi que nunca puede romper la autenticacion; si corre fuera de una llamada que
 * capture, no hace nada.
 */
const captureAuditSubject = (user: { id: string }): void => {
  captureAuthAuditSubject(user.id);
};

export const auth = betterAuth({
  appName: 'SIPEG UTP Backend',
  secret: env.AUTH_SECRET,
  baseURL: env.AUTH_URL,
  trustedOrigins,
  // El logger propio de Better Auth escribe texto plano por stdout, fuera de pino:
  // esas lineas no son JSON, asi que Alloy no les pone `service` ni `logType` y
  // caen en un stream aparte que no se puede filtrar en Grafana. Ademas su
  // "User not found" en un login fallido duplica un evento que la aplicacion ya
  // emite con mas contexto y con el sujeto pseudonimo (`auth.login.failed`,
  // logType `security`). El error real de autenticacion sigue registrandolo
  // `errorHandler` como `http.error.unexpected`.
  logger: { disabled: true },
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
      '/request-password-reset': { window: 60, max: 3 },
      '/reset-password': { window: 60, max: 5 },
    },
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    minPasswordLength: PASSWORD_MIN_LENGTH,
    maxPasswordLength: PASSWORD_MAX_LENGTH,
    autoSignIn: false,
    resetPasswordTokenExpiresIn: parseTtlToSeconds(env.AUTH_PASSWORD_RESET_TTL),
    revokeSessionsOnPasswordReset: true,
    onPasswordReset: async ({ user }) => {
      captureAuditSubject(user);
    },
    sendResetPassword: async ({ user, token }) => {
      void sendPasswordResetEmail(user.email, token).catch(reportEmailDeliveryFailure);
    },
    password: {
      hash: hashPassword,
      verify: ({ hash, password }) => verifyPassword(hash, password),
    },
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: false,
    expiresIn: parseTtlToSeconds(env.AUTH_EMAIL_VERIFICATION_TTL),
    afterEmailVerification: async (user) => {
      captureAuditSubject(user);
    },
    sendVerificationEmail: async ({ user, token }) => {
      void sendVerificationEmail(user.email, token).catch(reportEmailDeliveryFailure);
    },
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
      globalRole: { type: 'string', required: false, input: false, defaultValue: 'USER' },
      isActive: { type: 'boolean', required: false, input: false },
      unitId: { type: 'string', required: false, input: true },
      careerId: { type: 'string', required: false, input: true },
    },
  },
  session: {
    expiresIn: parseTtlToSeconds(env.AUTH_REFRESH_TTL),
    disableSessionRefresh: true,
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
              alg: row.alg ?? publicJwk['alg'] ?? null,
              crv: row.crv ?? publicJwk['crv'] ?? null,
              createdAt: row.createdAt,
              expiresAt: row.expiresAt,
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
            expiresAt?: Date;
          };
          await prisma.jwks.create({
            data: {
              id: data.id ?? crypto.randomUUID(),
              publicKey: data.publicKey,
              privateKey: data.privateKey,
              alg: data.alg ?? null,
              crv: data.crv ?? null,
              expiresAt: data.expiresAt ?? null,
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
