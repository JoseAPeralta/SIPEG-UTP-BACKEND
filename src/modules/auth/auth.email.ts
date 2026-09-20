import { env } from '../../config/env.js';
import { sendEmail } from '../../lib/email.js';

const tokenUrl = (baseUrl: string, token: string): string => {
  const url = new URL(baseUrl);
  url.searchParams.set('token', token);
  return url.toString();
};

export const sendVerificationEmail = async (email: string, token: string): Promise<void> => {
  const url = tokenUrl(env.AUTH_EMAIL_VERIFICATION_URL, token);
  await sendEmail({
    to: email,
    subject: 'Verifica tu correo de SIPEG UTP',
    text: [
      'Verifica tu correo para activar tu cuenta de SIPEG UTP.',
      '',
      url,
      '',
      `Este enlace vence en ${env.AUTH_EMAIL_VERIFICATION_TTL}.`,
      'Si no creaste esta cuenta, ignora este mensaje.',
    ].join('\n'),
  });
};

export const sendPasswordResetEmail = async (email: string, token: string): Promise<void> => {
  const url = tokenUrl(env.AUTH_PASSWORD_RESET_URL, token);
  await sendEmail({
    to: email,
    subject: 'Restablece tu contrasena de SIPEG UTP',
    text: [
      'Usa el siguiente enlace para restablecer tu contrasena de SIPEG UTP.',
      '',
      url,
      '',
      `Este enlace vence en ${env.AUTH_PASSWORD_RESET_TTL}.`,
      'Si no solicitaste este cambio, ignora este mensaje.',
    ].join('\n'),
  });
};
