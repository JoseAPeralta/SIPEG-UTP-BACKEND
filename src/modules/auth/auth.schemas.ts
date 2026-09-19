import { z } from 'zod';

const trimmedString = z.string().trim();

export const loginSchema = z.object({
  body: z.object({
    email: z.string().email('Invalid email format.'),
    password: z.string().min(1, 'Password is required.'),
  }),
});

export const registerSchema = z.object({
  body: z.object({
    email: z.string().email('Invalid email format.'),
    password: z.string().min(12, 'Password must be at least 12 characters.').max(128),
    firstName: trimmedString.min(2).max(100),
    lastName: trimmedString.min(2).max(100),
    identificationNumber: trimmedString.min(5).max(30),
    facultyId: z.string().min(1).optional(),
    careerId: z.string().min(1).optional(),
  }),
});

export const refreshSchema = z.object({
  body: z.object({ refreshToken: z.string().min(1, 'Refresh token is required.') }),
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
    newPassword: z.string().min(12).max(128),
  }),
});

export const logoutSchema = z.object({
  body: z.object({ refreshToken: z.string().min(1, 'Refresh token is required.') }),
});

export type LoginBody = z.infer<typeof loginSchema>['body'];
export type RegisterBody = z.infer<typeof registerSchema>['body'];
export type RefreshBody = z.infer<typeof refreshSchema>['body'];
export type VerifyEmailBody = z.infer<typeof verifyEmailSchema>['body'];
export type ForgotPasswordBody = z.infer<typeof forgotPasswordSchema>['body'];
export type ResetPasswordBody = z.infer<typeof resetPasswordSchema>['body'];
export type LogoutBody = z.infer<typeof logoutSchema>['body'];
