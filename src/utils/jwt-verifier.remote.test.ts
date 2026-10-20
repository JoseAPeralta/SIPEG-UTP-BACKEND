import { createServer, type Server } from 'node:http';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestJwks, signTestToken, type TestJwks } from '../test-helpers/auth-helpers.js';

const publicIdentity = 'https://api.sipeg-utp.com';

describe('JWT verification with an internal JWKS endpoint', () => {
  let server: Server;
  let baseUrl: string;
  let jwks: TestJwks;
  let publicEndpointStatus: number;
  let requests: string[];

  beforeAll(async () => {
    jwks = await createTestJwks();
    server = createServer((req, res) => {
      const path = req.url ?? '/';
      requests.push(path);
      if (path === '/internal-jwks' || publicEndpointStatus === 200) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ keys: [jwks.publicJwk] }));
        return;
      }

      res.writeHead(403, { 'cf-mitigated': 'challenge' });
      res.end('Cloudflare challenge');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('Missing test HTTP server address.');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
      server.closeAllConnections();
    });
  });

  beforeEach(() => {
    requests = [];
    publicEndpointStatus = 403;
    vi.stubEnv('NODE_ENV', 'test');
    vi.stubEnv('AUTH_SECRET', 'a'.repeat(32));
    vi.stubEnv('CORS_ORIGIN', 'http://localhost:5173');
    vi.stubEnv('AUTH_PASSWORD_RESET_URL', 'http://localhost:5173/reset-password');
    vi.stubEnv('AUTH_URL', baseUrl);
    vi.stubEnv('AUTH_ISSUER', publicIdentity);
    vi.stubEnv('AUTH_AUDIENCE', publicIdentity);
    vi.stubEnv('AUTH_JWKS_URL', `${baseUrl}/internal-jwks`);
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  const signToken = (issuer = publicIdentity, audience = publicIdentity) =>
    signTestToken({
      privateKey: jwks.privateKey,
      kid: jwks.kid,
      issuer,
      audience,
      subject: 'user-1',
      payload: { email: 'test@example.invalid', role: 'USER' },
    });

  it('validates a publicly issued token without requesting the challenged public JWKS', async () => {
    const { createJwtVerifier } = await import('./jwt-verifier.js');
    const token = await signToken();

    const payload = await createJwtVerifier().verify(token);

    expect(payload.sub).toBe('user-1');
    expect(payload.iss).toBe(publicIdentity);
    expect(payload.aud).toBe(publicIdentity);
    expect(requests).toEqual(['/internal-jwks']);
  });

  it('keeps using the internal endpoint after refreshing the resolver', async () => {
    const { createJwtVerifier } = await import('./jwt-verifier.js');
    const verifier = createJwtVerifier();
    const token = await signToken();
    await verifier.verify(token);
    await verifier.refresh();

    await expect(verifier.verify(token)).resolves.toMatchObject({ sub: 'user-1' });
    expect(requests).toEqual(['/internal-jwks', '/internal-jwks']);
  });

  it.each(['issuer', 'audience'] as const)(
    'rejects the internal endpoint as token %s',
    async (claim) => {
      const { createJwtVerifier } = await import('./jwt-verifier.js');
      const internalUrl = `${baseUrl}/internal-jwks`;
      const token = await signToken(
        claim === 'issuer' ? internalUrl : publicIdentity,
        claim === 'audience' ? internalUrl : publicIdentity,
      );

      await expect(createJwtVerifier().verify(token)).rejects.toMatchObject({ statusCode: 401 });
      expect(requests).toEqual(['/internal-jwks']);
    },
  );

  it.each([undefined, ''])('falls back to AUTH_URL when AUTH_JWKS_URL is %s', async (value) => {
    vi.stubEnv('AUTH_JWKS_URL', value);
    publicEndpointStatus = 200;
    const { createJwtVerifier } = await import('./jwt-verifier.js');
    const token = await signToken();

    await expect(createJwtVerifier().verify(token)).resolves.toMatchObject({ sub: 'user-1' });
    expect(requests).toEqual(['/api/auth/jwks']);
  });
});
