import type { CookieOptions, Request, Response } from 'express';

/**
 * Cookie de refresco `HttpOnly`. Es la unica credencial de larga duracion que
 * maneja el navegador, y por eso no es visible para JavaScript.
 *
 * Antes el `refreshToken` viajaba en el body de la respuesta y cada pestana lo
 * guardaba en su `sessionStorage`. Eso hacia que la sesion fuera por pestana y
 * expedia el token a cualquier XSS. Con la cookie:
 *
 * - **La sesion se comparte entre pestanas** sin sincronizacion, porque la cookie
 *   es del origen.
 * - **Un XSS ya no puede leer la credencial.** Puede usarla, pero no extraerla.
 * - **Una colision de rotacion se auto-repara**: la respuesta escribe la cookie
 *   nueva para todas las pestanas, asi que un 401 por un refresco concurrente se
 *   resuelve con un reintento. Con el token en el body, el valor viejo muria para
 *   siempre.
 *
 * `path` se limita a `/api/v1/auth` para que la cookie no viaje en cada llamada
 * de negocio. `SameSite` depende de donde se despliegue el frontend: mismo
 * dominio que la API permite `lax`, y un frontend aparte (Workers, Vercel) exige
 * `none`, que a su vez obliga a `Secure` y a validar el `Origin` en el servidor.
 * Ver `resolveRefreshCookiePolicy`.
 */
export const REFRESH_COOKIE_NAME = 'sipeg-refresh';

const AUTH_COOKIE_PATH = '/api/v1/auth';

export interface RefreshCookiePolicy {
  sameSite: 'lax' | 'strict' | 'none';
  secure: boolean;
}

type EnvSource = {
  NODE_ENV: string;
  AUTH_REFRESH_COOKIE_SAME_SITE?: string | undefined;
};

const SAME_SITE_VALUES = ['lax', 'strict', 'none'] as const;

export const resolveRefreshCookiePolicy = (env: EnvSource): RefreshCookiePolicy => {
  const configured = env.AUTH_REFRESH_COOKIE_SAME_SITE?.trim();
  const sameSite = configured === undefined || configured === '' ? 'lax' : configured;

  if (!SAME_SITE_VALUES.includes(sameSite as (typeof SAME_SITE_VALUES)[number])) {
    throw new Error(
      `AUTH_REFRESH_COOKIE_SAME_SITE must be one of ${SAME_SITE_VALUES.join('|')}, not "${sameSite}".`,
    );
  }

  const resolved = sameSite as RefreshCookiePolicy['sameSite'];
  // En produccion siempre `Secure`. Fuera de ella se permite no marcarlo, porque
  // el desarrollo local sirve por http y un `Secure` sobre http://localhost
  // dependeria del navegador.
  const secure = env.NODE_ENV === 'production';

  if (resolved === 'none' && !secure) {
    throw new Error(
      'AUTH_REFRESH_COOKIE_SAME_SITE=none requires a Secure cookie, which needs NODE_ENV=production (or HTTPS).',
    );
  }

  return { sameSite: resolved, secure };
};

/**
 * `maxAgeMs` esta en MILESEGUNDOS porque es lo que espera `res.cookie` de
 * Express. Pasarlo en segundos parece correcto y no lo es: Express lo convertiria
 * otra vez y la cookie duraria mil veces menos (7 dias -> 10 minutos).
 */
export const refreshCookieOptions = (
  policy: RefreshCookiePolicy & { maxAgeMs: number },
): CookieOptions => ({
  httpOnly: true,
  secure: policy.secure,
  sameSite: policy.sameSite,
  path: AUTH_COOKIE_PATH,
  // Sin `domain`: la cookie se queda en el host de la API, no en los registros
  // superiores, para no ampliar su alcance a subdominios hermanos.
  maxAge: Math.max(0, Math.floor(policy.maxAgeMs)),
});

export const writeRefreshCookie = (
  res: Response,
  token: string,
  expiresAt: Date,
  now: Date,
  policy: RefreshCookiePolicy,
): void => {
  const maxAgeMs = expiresAt.getTime() - now.getTime();

  res.cookie(REFRESH_COOKIE_NAME, token, refreshCookieOptions({ ...policy, maxAgeMs }));
};

export const clearRefreshCookie = (res: Response): void => {
  res.clearCookie(REFRESH_COOKIE_NAME, { path: AUTH_COOKIE_PATH });
};

export const readRefreshToken = (req: Request): string | undefined => {
  const raw = (req as { cookies?: Record<string, unknown> }).cookies?.[REFRESH_COOKIE_NAME];

  if (typeof raw !== 'string') {
    return undefined;
  }

  const trimmed = raw.trim();

  return trimmed === '' ? undefined : trimmed;
};
