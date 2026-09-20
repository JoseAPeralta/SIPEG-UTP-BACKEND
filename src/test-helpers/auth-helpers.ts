import { SignJWT, generateKeyPair, exportJWK, calculateJwkThumbprint, type CryptoKey } from 'jose';

export interface TestJwks {
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  kid: string;
  publicJwk: unknown;
}

export const createTestJwks = async (): Promise<TestJwks> => {
  const { privateKey, publicKey } = await generateKeyPair('EdDSA', { crv: 'Ed25519' });
  const publicJwk = await exportJWK(publicKey);
  const kid = await calculateJwkThumbprint(publicJwk);
  publicJwk.kid = kid;
  publicJwk.alg = 'EdDSA';
  return { privateKey, publicKey, kid, publicJwk };
};

export interface SignTestTokenInput {
  privateKey: CryptoKey;
  kid: string;
  issuer: string;
  audience: string;
  subject: string;
  payload: Record<string, unknown>;
  expiresIn?: string;
}

export const signTestToken = async (input: SignTestTokenInput): Promise<string> => {
  return new SignJWT({ ...input.payload })
    .setProtectedHeader({ alg: 'EdDSA', kid: input.kid, typ: 'JWT' })
    .setIssuer(input.issuer)
    .setAudience(input.audience)
    .setSubject(input.subject)
    .setIssuedAt()
    .setExpirationTime(input.expiresIn ?? '15m')
    .sign(input.privateKey);
};
