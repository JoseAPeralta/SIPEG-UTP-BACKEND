import { z } from 'zod';

import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '../../lib/password.js';

const trimmedString = z.string().trim();

const passwordField = z
  .string()
  .min(PASSWORD_MIN_LENGTH, 'Password must be at least 12 characters.')
  .max(PASSWORD_MAX_LENGTH, 'Password must not exceed 20 characters.');

export const loginSchema = z.object({
  body: z.object({
    email: z.string().email('Invalid email format.'),
    password: z.string().min(1, 'Password is required.'),
  }),
});

export const registerSchema = z.object({
  body: z
    .object({
      email: z.string().email('Invalid email format.'),
      password: passwordField,
      firstName: trimmedString.min(2).max(100),
      lastName: trimmedString.min(2).max(100),
      identificationNumber: trimmedString.min(5).max(30),
      unitId: z.string().min(1).optional(),
      careerId: z.string().min(1).optional(),
    })
    .strict(),
});

export const refreshSchema = z.object({
  // Sin cuerpo: el refresh token viaja en la cookie HttpOnly. Se acepta un body
  // vacio o con claves desconocidas porque el cliente no necesita enviar nada.
  body: z.object({}).loose().optional().default({}),
});

export const verifyEmailSchema = z.object({
  body: z.object({ token: z.string().min(1, 'Verification token is required.') }),
});

export const forgotPasswordSchema = z.object({
  body: z.object({ email: z.string().email('Invalid email format.') }),
});

export const resetPasswordSchema = z.object({
  body: z.object({
    token: z.string().min(1, 'Reset token is required.'),
    newPassword: passwordField,
  }),
});

export const logoutSchema = z.object({
  // Sin cuerpo: el token viene de la cookie HttpOnly.
  body: z.object({}).loose().optional().default({}),
});

export const changePasswordSchema = z.object({
  // `refreshToken` ya no viaja en el body: la sesion actual se identifica con la
  // cookie HttpOnly, que el servidor lee. Enviarla aqui la expondría a JavaScript
  // sin ganar nada.
  body: z.object({
    currentPassword: z.string().min(1, 'Current password is required.'),
    newPassword: passwordField,
  }),
});

export const authTokensSchema = z
  .object({
    accessToken: z.string().meta({ description: 'Signed JWT access token (EdDSA).' }),
    accessTokenExpiresAt: z.iso
      .datetime()
      .meta({ description: 'ISO 8601 expiration timestamp of the access token.' }),
    refreshTokenExpiresAt: z.iso.datetime().meta({
      description:
        'ISO 8601 expiration timestamp of the refresh token. The token itself is delivered in an HttpOnly cookie, never in this body.',
    }),
    tokenType: z.literal('Bearer'),
  })
  // Estricto a proposito: el refresh token viaja en la cookie HttpOnly y no debe
  // poder reaparecer en el body. El contrato documentado sale con
  // `additionalProperties: false`.
  .strict()
  .meta({
    id: 'AuthTokens',
    description:
      'Access token issued by the login and refresh flows. The refresh token travels in an HttpOnly cookie and is never exposed to JavaScript.',
  });

export const registerResultSchema = z
  .object({ userId: z.string().meta({ description: 'Identifier of the new user.' }) })
  .meta({ id: 'RegisterResult', description: 'Result of a successful registration.' });

export type LoginBody = z.infer<typeof loginSchema>['body'];
export type RegisterBody = z.infer<typeof registerSchema>['body'];
export type RefreshBody = z.infer<typeof refreshSchema>['body'];
export type VerifyEmailBody = z.infer<typeof verifyEmailSchema>['body'];
export type ForgotPasswordBody = z.infer<typeof forgotPasswordSchema>['body'];
export type ResetPasswordBody = z.infer<typeof resetPasswordSchema>['body'];
export type LogoutBody = z.infer<typeof logoutSchema>['body'];
export type ChangePasswordBody = z.infer<typeof changePasswordSchema>['body'];
