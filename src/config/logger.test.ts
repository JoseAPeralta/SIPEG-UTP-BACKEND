import { Writable } from 'node:stream';

import type { Logger } from 'pino';

import { describe, expect, it, vi } from 'vitest';

import { createChildLogger, createLogger, logger } from './logger.js';

function createMemoryStream() {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  return { stream, output: () => chunks.join('') };
}

async function withLogger(environment: string, run: (log: Logger, output: () => string) => void) {
  const { stream, output } = createMemoryStream();
  const log = await createLogger({
    level: 'trace',
    environment,
    serviceName: 'sipeg-utp-backend',
    version: '1.0.0',
    stream,
  });
  run(log, output);
}

describe('logger', () => {
  it('emits a single-line JSON with base bindings', async () => {
    await withLogger('test', (log, output) => {
      log.info('hello');
      const lines = output().trim().split('\n');
      expect(lines).toHaveLength(1);
      const parsed = JSON.parse(lines[0]!);
      expect(parsed.msg).toBe('hello');
      expect(parsed.service).toBe('sipeg-utp-backend');
      expect(parsed.version).toBe('1.0.0');
      expect(parsed.environment).toBe('test');
      expect(typeof parsed.time).toBe('string');
    });
  });

  it('respects LOG_LEVEL: error suppresses info', async () => {
    const { stream, output } = createMemoryStream();
    const log = await createLogger({
      level: 'error',
      environment: 'test',
      serviceName: 'svc',
      version: '1.0.0',
      stream,
    });
    log.info('suppressed');
    log.error('shown');
    const lines = output().trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!).msg).toBe('shown');
  });

  it('redacts sensitive fields and nested wildcards', async () => {
    await withLogger('development', (log, output) => {
      log.info(
        {
          password: 'pw',
          token: 'tk',
          accessToken: 'at',
          refreshToken: 'rt',
          cookie: 'ck',
          authorization: 'az',
          nested: { password: 'deep' },
        },
        'redaction',
      );
      const parsed = JSON.parse(output().trim());
      for (const key of ['password', 'token', 'accessToken', 'refreshToken', 'cookie', 'authorization']) {
        expect(parsed[key]).toBe('[Redacted]');
      }
      expect(parsed.nested.password).toBe('[Redacted]');
    });
  });

  it('redacts request headers', async () => {
    await withLogger('development', (log, output) => {
      log.info(
        { req: { headers: { authorization: 'Bearer abc', cookie: 'sid=1', 'x-other': 'ok' } } },
        'request',
      );
      const parsed = JSON.parse(output().trim());
      expect(parsed.req.headers.authorization).toBe('[Redacted]');
      expect(parsed.req.headers.cookie).toBe('[Redacted]');
      expect(parsed.req.headers['x-other']).toBe('ok');
    });
  });

  it('keeps values with newlines on one valid JSON line', async () => {
    await withLogger('development', (log, output) => {
      log.info({ note: 'first\nsecond\rthird' }, 'multiline');
      const lines = output().trim().split('\n');
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0]!).note).toBe('first\nsecond\rthird');
    });
  });

  it('omits message and stack of errors in production', async () => {
    await withLogger('production', (log, output) => {
      log.error(new Error('boom'), 'unexpected');
      const parsed = JSON.parse(output().trim());
      expect(parsed.msg).toBe('unexpected');
      expect(parsed.err.type).toBe('Error');
      expect(parsed.err.message).toBeUndefined();
      expect(parsed.err.stack).toBeUndefined();
    });
  });

  it('includes message and stack of errors in development', async () => {
    await withLogger('development', (log, output) => {
      log.error(new Error('boom'), 'unexpected');
      const parsed = JSON.parse(output().trim());
      expect(parsed.err.message).toBe('boom');
      expect(typeof parsed.err.stack).toBe('string');
    });
  });

  it('exposes requestId via createChildLogger', async () => {
    const { stream, output } = createMemoryStream();
    const log = await createLogger({
      level: 'trace',
      environment: 'test',
      serviceName: 'svc',
      version: '1.0.0',
      stream,
    });
    createChildLogger({ requestId: 'req-42' }, log).info('child');
    expect(JSON.parse(output().trim()).requestId).toBe('req-42');
  });

  it('binds to the singleton logger by default', () => {
    const childSpy = vi.spyOn(logger, 'child');
    createChildLogger({ requestId: 'req-1' });
    expect(childSpy).toHaveBeenCalledWith({ requestId: 'req-1' });
  });
});
