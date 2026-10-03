import { describe, expect, it } from 'vitest';

import { captureAuthAuditSubject, withAuthAuditSubject } from './auth.audit.js';

describe('withAuthAuditSubject', () => {
  it('returns the result of the wrapped call', async () => {
    const { result } = await withAuthAuditSubject(async () => 'ok');

    expect(result).toBe('ok');
  });

  it('reports no subject when no hook captured one', async () => {
    const { userId } = await withAuthAuditSubject(async () => undefined);

    expect(userId).toBeUndefined();
  });

  it('reports the subject captured by the hook inside the call', async () => {
    const { userId } = await withAuthAuditSubject(async () => {
      captureAuthAuditSubject('user-1');
    });

    expect(userId).toBe('user-1');
  });

  it('captures a subject that arrives after an await inside the call', async () => {
    const { userId } = await withAuthAuditSubject(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      captureAuthAuditSubject('user-late');
    });

    expect(userId).toBe('user-late');
  });

  it('is a no-op when the hook fires outside any capturing call', () => {
    expect(() => {
      captureAuthAuditSubject('user-orphan');
    }).not.toThrow();
  });

  it('does not leak the subject into a later call', async () => {
    await withAuthAuditSubject(async () => {
      captureAuthAuditSubject('user-1');
    });

    const { userId } = await withAuthAuditSubject(async () => undefined);

    expect(userId).toBeUndefined();
  });

  it('keeps concurrent calls isolated', async () => {
    // Cada llamada tiene su propio marcador. Si compartieran estado, el id que
    // una escritura deja seria visible para las demas y los tres resultados no
    // podrian coincidir con los tres ids de entrada.
    const run = async (id: string, delay: number): Promise<string | undefined> => {
      const { userId } = await withAuthAuditSubject(async () => {
        await new Promise((resolve) => setTimeout(resolve, delay));
        captureAuthAuditSubject(id);
        await new Promise((resolve) => setTimeout(resolve, 5));
      });
      return userId;
    };

    const [a, b, c] = await Promise.all([run('user-a', 20), run('user-b', 5), run('user-c', 10)]);

    expect([a, b, c].sort()).toEqual(['user-a', 'user-b', 'user-c']);
  });

  it('propagates a rejection without capturing a subject', async () => {
    await expect(
      withAuthAuditSubject(async () => {
        throw new Error('provider failed');
      }),
    ).rejects.toThrow('provider failed');
  });

  it('keeps the subject captured before a throw inside the call', async () => {
    await expect(
      withAuthAuditSubject(async () => {
        captureAuthAuditSubject('user-1');
        throw new Error('later failure');
      }),
    ).rejects.toThrow('later failure');
  });
});
