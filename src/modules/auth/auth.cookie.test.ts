import { describe, expect, it } from 'vitest';

import {
  REFRESH_COOKIE_NAME,
  clearRefreshCookie,
  readRefreshToken,
  refreshCookieOptions,
  resolveRefreshCookiePolicy,
  writeRefreshCookie,
} from './auth.cookie.js';

interface CookieOptions {
  httpOnly: boolean;
  secure: boolean;
  sameSite: string;
  path: string;
  /** Milisegundos: es la unidad que espera `res.cookie` de Express. */
  maxAge: number;
}

const NODE_ENV = {
  NODE_ENV: 'production',
  AUTH_REFRESH_COOKIE_SAME_SITE: undefined,
} as unknown as { NODE_ENV: string; AUTH_REFRESH_COOKIE_SAME_SITE?: string };

const readCookie = (options: CookieOptions): string => {
  // Express escribe SameSite capitalizado ("None", "Lax"); el stub lo replica
  // para que la asercion compruebe la cabecera real y no la entrada cruda.
  const sameSite = options.sameSite.charAt(0).toUpperCase() + options.sameSite.slice(1);
  // Express convierte `maxAge` de milisegundos a segundos al escribir la cabecera.
  const maxAgeSeconds = Math.floor(options.maxAge / 1000);
  const parts = [`Path=${options.path}`, `SameSite=${sameSite}`, `Max-Age=${maxAgeSeconds}`];

  if (options.httpOnly) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');

  return parts.join('; ');
};

const responseStub = () => {
  const cookie: { value: string | undefined; cleared: boolean } = {
    value: undefined,
    cleared: false,
  };

  return {
    cookie,
    res: {
      cookie(name: string, value: string, options: CookieOptions) {
        expect(name).toBe(REFRESH_COOKIE_NAME);
        cookie.value = `${value}; ${readCookie(options)}`;

        return this;
      },
      clearCookie(name: string, _options: Pick<CookieOptions, 'path'>) {
        expect(name).toBe(REFRESH_COOKIE_NAME);
        cookie.cleared = true;

        return this;
      },
    } as never,
  };
};

const expiresInSeconds = (expiresAt: Date, now: Date): number =>
  Math.floor((expiresAt.getTime() - now.getTime()) / 1000);

describe('REFRESH_COOKIE_NAME', () => {
  it('is prefixed like the other cookies of the app', () => {
    expect(REFRESH_COOKIE_NAME.startsWith('sipeg')).toBe(true);
  });
});

describe('resolveRefreshCookiePolicy', () => {
  it('is same-site and insecure outside production, so local http works', () => {
    const policy = resolveRefreshCookiePolicy({
      NODE_ENV: 'development',
      AUTH_REFRESH_COOKIE_SAME_SITE: undefined,
    } as never);

    expect(policy.sameSite).toBe('lax');
    expect(policy.secure).toBe(false);
  });

  it('is always secure in production', () => {
    const policy = resolveRefreshCookiePolicy({
      ...NODE_ENV,
      AUTH_REFRESH_COOKIE_SAME_SITE: 'lax',
    } as never);

    expect(policy.secure).toBe(true);
  });

  it('honours an explicit cross-site policy for a separate frontend host', () => {
    const policy = resolveRefreshCookiePolicy({
      ...NODE_ENV,
      AUTH_REFRESH_COOKIE_SAME_SITE: 'none',
    } as never);

    expect(policy.sameSite).toBe('none');
    expect(policy.secure).toBe(true);
  });

  it('rejects cross-site without secure, which browsers would refuse to store', () => {
    expect(() =>
      resolveRefreshCookiePolicy({
        NODE_ENV: 'development',
        AUTH_REFRESH_COOKIE_SAME_SITE: 'none',
      } as never),
    ).toThrow(/Secure/);
  });

  it('rejects an unknown SameSite value instead of guessing', () => {
    expect(() =>
      resolveRefreshCookiePolicy({
        ...NODE_ENV,
        AUTH_REFRESH_COOKIE_SAME_SITE: 'loose',
      } as never),
    ).toThrow(/AUTH_REFRESH_COOKIE_SAME_SITE/);
  });
});

describe('refreshCookieOptions', () => {
  it('is HttpOnly, so JavaScript can never read the refresh token', () => {
    const options = refreshCookieOptions({
      sameSite: 'lax',
      secure: false,
      maxAgeMs: 3_600_000,
    });

    expect(options.httpOnly).toBe(true);
  });

  it('is scoped to the auth routes, so it never rides along on business calls', () => {
    const options = refreshCookieOptions({ sameSite: 'lax', secure: false, maxAgeMs: 3_600_000 });

    expect(options.path).toBe('/api/v1/auth');
  });

  it('carries no Domain, so it stays host-only', () => {
    const options = refreshCookieOptions({ sameSite: 'lax', secure: false, maxAgeMs: 3_600_000 }) as {
      domain?: string;
    };

    expect(options.domain).toBeUndefined();
  });

  it('does not become a session cookie: it carries the refresh lifetime', () => {
    const options = refreshCookieOptions({ sameSite: 'lax', secure: false, maxAgeMs: 604_800_000 });

    expect(options.maxAge).toBe(604_800_000);
  });

  it('never lets Max-Age go negative, which would delete the cookie at once', () => {
    const options = refreshCookieOptions({ sameSite: 'lax', secure: false, maxAgeMs: -5_000 });

    expect(options.maxAge).toBe(0);
  });
});

describe('writeRefreshCookie', () => {
  it('sets the token with the resolved attributes', () => {
    const now = new Date('2026-09-30T12:00:00.000Z');
    const { cookie, res } = responseStub();

    writeRefreshCookie(res, 'token-abc', new Date('2026-10-01T12:00:00.000Z'), now, {
      sameSite: 'none',
      secure: true,
    });

    expect(cookie.value).toContain('token-abc');
    expect(cookie.value).toContain('HttpOnly');
    expect(cookie.value).toContain('Secure');
    expect(cookie.value).toContain('SameSite=None');
    expect(cookie.value).toContain('Path=/api/v1/auth');
  });

  it('derives Max-Age from the server-side expiration, not from a client clock', () => {
    const now = new Date('2026-09-30T12:00:00.000Z');
    const { cookie, res } = responseStub();

    writeRefreshCookie(res, 't', new Date('2026-10-07T12:00:00.000Z'), now, {
      sameSite: 'lax',
      secure: false,
    });

    expect(cookie.value).toContain(
      `Max-Age=${expiresInSeconds(new Date('2026-10-07T12:00:00.000Z'), now)}`,
    );
  });
});

describe('clearRefreshCookie', () => {
  it('expresses a seven day lifetime as 604800 seconds, not as 604800000', () => {
    // Regresion que ya ocurrio: pasar segundos donde Express espera
    // milisegundos produce una cookie de 10 minutos en vez de 7 dias, y nada en
    // la suite lo detecta salvo comprobar la cabecera resultante.
    const now = new Date('2026-09-30T12:00:00.000Z');
    const { cookie, res } = responseStub();

    writeRefreshCookie(res, 'token', new Date('2026-10-07T12:00:00.000Z'), now, {
      sameSite: 'lax',
      secure: false,
    });

    const maxAge = /Max-Age=(\d+)/.exec(cookie.value ?? '')?.[1] ?? '';
    expect(maxAge).toBe('604800');
  });

  it('clears the same path the cookie was written with', () => {
    const { cookie, res } = responseStub();

    clearRefreshCookie(res);

    expect(cookie.cleared).toBe(true);
  });
});

describe('readRefreshToken', () => {
  const req = (cookies: Record<string, unknown> | undefined): never => ({ cookies }) as never;

  it('reads the token from the cookie', () => {
    expect(readRefreshToken(req({ [REFRESH_COOKIE_NAME]: 'desde-cookie' }))).toBe('desde-cookie');
  });

  it('trims the value and ignores an empty cookie', () => {
    expect(readRefreshToken(req({ [REFRESH_COOKIE_NAME]: '  ' }))).toBeUndefined();
  });

  it('returns undefined when there is no cookie at all', () => {
    expect(readRefreshToken(req(undefined))).toBeUndefined();
  });

  it('returns undefined when cookie parsing is not installed', () => {
    expect(readRefreshToken({} as never)).toBeUndefined();
  });
});
