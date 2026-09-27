import { afterEach, describe, expect, it, vi } from 'vitest';

const importPseudonymize = async () => {
  vi.resetModules();
  return import('./pseudonymize.js');
};

describe('pseudonymize', () => {
  afterEach(() => {
    delete process.env['LOG_PSEUDONYMIZATION_KEY'];
    vi.resetModules();
  });

  it('is deterministic for the same input and key', async () => {
    process.env['LOG_PSEUDONYMIZATION_KEY'] = 'a'.repeat(32);
    const { pseudonymize } = await importPseudonymize();

    expect(pseudonymize('user@example.com')).toBe(pseudonymize('user@example.com'));
  });

  it('produces different outputs for different inputs', async () => {
    process.env['LOG_PSEUDONYMIZATION_KEY'] = 'a'.repeat(32);
    const { pseudonymize } = await importPseudonymize();

    expect(pseudonymize('user@example.com')).not.toBe(pseudonymize('other@example.com'));
  });

  it('returns a 64-character hex string (sha256)', async () => {
    process.env['LOG_PSEUDONYMIZATION_KEY'] = 'a'.repeat(32);
    const { pseudonymize } = await importPseudonymize();

    const result = pseudonymize('user@example.com');

    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });

  it('does not contain the original value', async () => {
    process.env['LOG_PSEUDONYMIZATION_KEY'] = 'a'.repeat(32);
    const { pseudonymize } = await importPseudonymize();

    const value = 'super-secret-email@example.com';

    expect(pseudonymize(value)).not.toContain(value);
  });

  it('produces different outputs for different keys', async () => {
    process.env['LOG_PSEUDONYMIZATION_KEY'] = 'a'.repeat(32);
    const { pseudonymize: firstFn } = await importPseudonymize();
    const first = firstFn('user@example.com');

    process.env['LOG_PSEUDONYMIZATION_KEY'] = 'b'.repeat(32);
    const { pseudonymize: secondFn } = await importPseudonymize();
    const second = secondFn('user@example.com');

    expect(first).not.toBe(second);
  });
});
