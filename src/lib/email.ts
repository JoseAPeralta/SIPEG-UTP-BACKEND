import nodemailer from 'nodemailer';

import { env } from '../config/env.js';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

let transporter: ReturnType<typeof nodemailer.createTransport> | undefined;

const getTransporter = (): ReturnType<typeof nodemailer.createTransport> => {
  transporter ??= nodemailer.createTransport({
    host: env.MAIL_HOST ?? '127.0.0.1',
    port: env.MAIL_PORT,
    secure: env.MAIL_SECURE,
    ...(env.NODE_ENV === 'production' && !env.MAIL_SECURE ? { requireTLS: true } : {}),
    ...(env.MAIL_USER && env.MAIL_PASSWORD
      ? { auth: { user: env.MAIL_USER, pass: env.MAIL_PASSWORD } }
      : {}),
    tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
  });
  return transporter;
};

export const sendEmail = async (message: EmailMessage): Promise<void> => {
  await getTransporter().sendMail({
    from: env.MAIL_FROM,
    to: message.to,
    subject: message.subject,
    text: message.text,
  });
};
