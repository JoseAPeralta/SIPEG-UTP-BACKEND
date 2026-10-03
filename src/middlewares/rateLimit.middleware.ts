import type { Request, RequestHandler } from 'express';
import { createHash } from 'node:crypto';

import rateLimit from 'express-rate-limit';

import { createRequestLogger } from '../config/logger.js';
import { readRefreshToken } from '../modules/auth/auth.cookie.js';
import { ApiError } from '../utils/ApiError.js';

interface AuthRateLimitOptions {
  windowMs: number;
  max: number;
  message?: string;
  keyGenerator?: (req: Request) => string;
  name?: string;
}

const MAX_EMAIL_LENGTH = 254;

const LOGIN_MESSAGE = 'Too many login attempts. Try again in one minute.';
const REGISTER_MESSAGE = 'Too many registration attempts. Try again in one minute.';
const PASSWORD_RESET_MESSAGE = 'Too many password reset attempts. Try again in one minute.';
const EMAIL_VERIFICATION_MESSAGE = 'Too many email verification attempts. Try again in one minute.';
const CHANGE_PASSWORD_MESSAGE = 'Too many password change attempts. Try again in one minute.';

const normalizeIp = (req: Request): string => {
  const ip = req.ip ?? 'unknown';
  return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
};

const keyByUserOrIp = (req: Request): string => {
  if (req.user?.id) return `user:${req.user.id}`;
  return `ip:${normalizeIp(req)}`;
};

const normalizeEmail = (req: Request): string | null => {
  const body: unknown = req.body;
  if (typeof body !== 'object' || body === null) return null;

  const email = (body as { email?: unknown }).email;
  if (typeof email !== 'string') return null;

  const normalized = email.trim().toLowerCase().slice(0, MAX_EMAIL_LENGTH);
  return normalized.length > 0 ? normalized : null;
};

const keyByEmailAndIp = (req: Request): string => {
  if (req.user?.id) return `user:${req.user.id}`;

  const ip = normalizeIp(req);
  const email = normalizeEmail(req);
  return email ? `email:${email}|ip:${ip}` : `ip:${ip}`;
};

export const authRateLimit = ({
  windowMs,
  max,
  message,
  keyGenerator,
  name,
}: AuthRateLimitOptions): RequestHandler => {
  return rateLimit({
    windowMs,
    limit: max,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: keyGenerator ?? keyByUserOrIp,
    handler: (_req, _res, next) => {
      createRequestLogger({
        event: 'rate_limit.exceeded',
        logType: 'security',
        limiter: name ?? 'default',
      }).warn('rate_limit.exceeded');
      next(new ApiError(429, message ?? 'Too many requests, please try again later.'));
    },
  });
};

export const emailAuthRateLimit = (options: AuthRateLimitOptions): RequestHandler =>
  authRateLimit({ ...options, keyGenerator: keyByEmailAndIp });

const chain = (...handlers: readonly RequestHandler[]): RequestHandler => {
  return (req, res, next) => {
    let index = 0;

    const run = (): void => {
      const handler = handlers[index];
      index += 1;

      if (!handler) {
        next();
        return;
      }

      handler(req, res, (error?: unknown) => {
        if (error) {
          next(error);
          return;
        }
        run();
      });
    };

    run();
  };
};

export const loginRateLimit = chain(
  authRateLimit({ windowMs: 60_000, max: 30, message: LOGIN_MESSAGE, name: 'login.ip' }),
  emailAuthRateLimit({ windowMs: 60_000, max: 5, message: LOGIN_MESSAGE, name: 'login.email' }),
);

export const registerRateLimit = chain(
  authRateLimit({ windowMs: 60_000, max: 30, message: REGISTER_MESSAGE, name: 'register.ip' }),
  emailAuthRateLimit({
    windowMs: 60_000,
    max: 3,
    message: REGISTER_MESSAGE,
    name: 'register.email',
  }),
);

export const forgotPasswordRateLimit = chain(
  authRateLimit({
    windowMs: 60_000,
    max: 10,
    message: PASSWORD_RESET_MESSAGE,
    name: 'forgot_password.ip',
  }),
  emailAuthRateLimit({
    windowMs: 60_000,
    max: 3,
    message: PASSWORD_RESET_MESSAGE,
    name: 'forgot_password.email',
  }),
);

export const resetPasswordRateLimit = authRateLimit({
  windowMs: 60_000,
  max: 3,
  message: PASSWORD_RESET_MESSAGE,
  name: 'reset_password',
});

export const emailVerificationRateLimit = authRateLimit({
  windowMs: 60_000,
  max: 5,
  message: EMAIL_VERIFICATION_MESSAGE,
  name: 'email_verification',
});

export const changePasswordRateLimit = authRateLimit({
  windowMs: 60_000,
  max: 5,
  message: CHANGE_PASSWORD_MESSAGE,
  name: 'change_password',
});

/**
 * Limitador del refresh, con clave por sesion en lugar de por IP.
 *
 * Antes reutilizaba `loginRateLimit`, cuyo segundo cubo es "email + IP". El
 * refresh no lleva email, asi que ese cubo caia a clave por IP y el limite
 * efectivo eran 5 rotaciones por minuto **compartidas**. Detras de un proxy, o
 * con el personal en una misma red, cinco usuarios podian expulsarse entre ellos.
 *
 * Con la cookie, el identificador natural es la propia sesion: cada usuario rota
 * contra su cubo. Se hashea antes de usarlo como clave para que el token no
 * quede en memoria del limiter ni en un volcado, y se acota a 32 caracteres para
 * no engordar la tabla de claves.
 *
 * El limite es holgado a proposito: con un solo refresco por rotacion y un access
 * token de 15 minutos, un usuario legitimo no llega nunca a 12 en un minuto.
 *
 * Que limite y que no, con exactitud, porque la clave rota:
 *
 * - **Si contiene**: ráfagas contra un token *fijo*. Es el caso de la colision
 *   entre pestanas, donde todas reenvian el mismo token vencido hasta que la API
 *   responde 401. Es la exibicion que nos ocupa.
 * - **No contiene**: una sesion que rote sin parar. Cada rotacion valida emite un
 *   `Set-Cookie` nuevo, la siguiente peticion llega con otro token y por tanto con
 *   otro cubo, de modo que el contador nunca acumula. Un bucle asi se defiende en
 *   el cliente (single-flight y epoch), no aqui.
 *
 * Poner un limite por IP en paralelo no serviria: la institucion comparte IP
 * publica, que es justo el falso positivo que este cambio elimina.
 */
const REFRESH_BUCKET_MAX = 12;

const keyByRefreshSession = (req: Request): string => {
  const token = readRefreshToken(req);

  if (token === undefined) {
    return `none:${normalizeIp(req)}`;
  }

  return `session:${createHash('sha256').update(token).digest('hex').slice(0, 32)}`;
};

export const refreshRateLimit = authRateLimit({
  windowMs: 60_000,
  max: REFRESH_BUCKET_MAX,
  message: LOGIN_MESSAGE,
  name: 'refresh.session',
  keyGenerator: keyByRefreshSession,
});
