import { Writable } from 'node:stream';

import type { Logger } from 'pino';

import { describe, expect, it, vi } from 'vitest';

import { runWithLogContext } from '../lib/log-context.js';
import { env } from './env.js';
import {
  createChildLogger,
  createLogger,
  createRequestLogger,
  logger,
  securityLogger,
} from './logger.js';

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
      for (const key of [
        'password',
        'token',
        'accessToken',
        'refreshToken',
        'cookie',
        'authorization',
      ]) {
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

  it('drops the request body and headers an http error carries outside production', async () => {
    await withLogger('development', (log, output) => {
      const error = Object.assign(new SyntaxError('Unexpected token } in JSON'), {
        status: 400,
        body: '{"email":"admin@sipeg.local","password":"hunter2"}',
        headers: { authorization: 'Bearer secret' },
      });
      log.error(error, 'unexpected');
      const parsed = JSON.parse(output().trim());
      expect(parsed.err.body).toBeUndefined();
      expect(parsed.err.headers).toBeUndefined();
      expect(output()).not.toContain('hunter2');
      expect(output()).not.toContain('Bearer secret');
      // El resto del error sigue siendo util para diagnosticar.
      expect(parsed.err.message).toBe('Unexpected token } in JSON');
      expect(parsed.err.status).toBe(400);
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

  it('emits the level as a string name, not a number', async () => {
    await withLogger('test', (log, output) => {
      log.info('hello');
      log.warn({ event: 'auth.token.invalid' }, 'auth.token.invalid');
      log.error(new Error('boom'), 'unexpected');
      const lines = output()
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      expect(lines.map((entry) => entry.level)).toEqual(['info', 'warn', 'error']);
    });
  });

  it('createRequestLogger inherits requestId from the log context', async () => {
    const { stream, output } = createMemoryStream();
    const log = await createLogger({
      level: 'trace',
      environment: 'test',
      serviceName: 'svc',
      version: '1.0.0',
      stream,
    });

    runWithLogContext({ requestId: 'req-7' }, () => {
      createRequestLogger({ event: 'http.error.unexpected', logType: 'application' }, log).error(
        new Error('boom'),
        'http.error.unexpected',
      );
    });

    const parsed = JSON.parse(output().trim());
    expect(parsed.requestId).toBe('req-7');
    expect(parsed.event).toBe('http.error.unexpected');
    expect(parsed.logType).toBe('application');
    expect(parsed.service).toBe('svc');
  });

  it('createRequestLogger omits requestId outside a request', async () => {
    const { stream, output } = createMemoryStream();
    const log = await createLogger({
      level: 'trace',
      environment: 'test',
      serviceName: 'svc',
      version: '1.0.0',
      stream,
    });

    createRequestLogger({ event: 'app.starting', logType: 'infrastructure' }, log).info('boot');

    const parsed = JSON.parse(output().trim());
    expect('requestId' in parsed).toBe(false);
    expect(parsed.event).toBe('app.starting');
  });

  it('routes security events through a logger independent from LOG_LEVEL', () => {
    const childSpy = vi.spyOn(securityLogger, 'child');
    const originalLevel = logger.level;
    logger.level = 'error';

    createRequestLogger({ event: 'auth.login.failed', logType: 'security' });

    expect(childSpy).toHaveBeenCalledWith({ event: 'auth.login.failed', logType: 'security' });
    logger.level = originalLevel;
  });

  it('silences the ambient singleton in the test environment', () => {
    // vitest.config.ts sets LOG_LEVEL=silent so the reporter output stays
    // readable. Tests that assert on log output raise the level explicitly,
    // as requestLogger.middleware.test.ts does.
    expect(env.LOG_LEVEL).toBe('silent');
    expect(logger.level).toBe('silent');
  });
});
