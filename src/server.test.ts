import type { Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from './config/logger.js';
import { disconnectPrisma } from './config/prisma.js';
import { ensureJwks } from './lib/auth.js';

vi.mock('./config/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    flush: vi.fn((cb?: () => void) => cb?.()),
  },
}));

vi.mock('./config/prisma.js', () => ({
  disconnectPrisma: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./lib/auth.js', () => ({
  ensureJwks: vi.fn(),
}));

vi.mock('./app.js', () => ({ app: vi.fn() }));

import { createApiServer, registerFatalHandlers, shutdown, startServer } from './server.js';

const mockedEnsureJwks = vi.mocked(ensureJwks);
const mockedDisconnectPrisma = vi.mocked(disconnectPrisma);

const closeServer = (server: Server): Promise<void> =>
  new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });

describe('server lifecycle logging', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  });

  afterEach(() => {
    vi.useRealTimers();
    process.removeAllListeners('uncaughtException');
    process.removeAllListeners('unhandledRejection');
  });

  it('logs app.starting, app.listening and app.jwks.failed when jwks init fails', async () => {
    mockedEnsureJwks.mockRejectedValue(new Error('db down'));
    const server = createApiServer();

    await startServer(server, 0);

    expect(logger.info).toHaveBeenCalledWith({ event: 'app.starting' }, 'app.starting');
    await vi.waitFor(() => {
      expect(logger.info).toHaveBeenCalledWith({ event: 'app.listening', port: 0 }, 'app.listening');
    });
    await vi.waitFor(() => {
      expect(logger.error).toHaveBeenCalledWith(
        { event: 'app.jwks.failed', err: expect.any(Error) },
        'app.jwks.failed',
      );
    });

    await closeServer(server);
  });

  it('logs app.jwks.ready when jwks init succeeds', async () => {
    mockedEnsureJwks.mockResolvedValue(undefined);
    const server = createApiServer();

    await startServer(server, 0);

    await vi.waitFor(() => {
      expect(logger.info).toHaveBeenCalledWith({ event: 'app.jwks.ready' }, 'app.jwks.ready');
    });

    await closeServer(server);
  });

  it('logs app.fatal and exits when the HTTP server errors', async () => {
    const server = createApiServer();
    await startServer(server, 0);

    server.emit('error', new Error('EADDRINUSE'));

    expect(logger.error).toHaveBeenCalledWith(
      { event: 'app.fatal', err: expect.any(Error) },
      'app.fatal',
    );
    expect(exitSpy).toHaveBeenCalledWith(1);

    await closeServer(server);
  });

  it('logs the shutdown signal and completes gracefully', async () => {
    const close = vi.fn((callback: (error?: Error) => void) => callback(undefined));
    const server = { closeIdleConnections: vi.fn(), close } as unknown as Server;

    shutdown(server, 'SIGTERM');

    expect(logger.info).toHaveBeenCalledWith({ event: 'app.shutdown.signal', signal: 'SIGTERM' }, 'app.shutdown.signal');
    expect(close).toHaveBeenCalled();

    await vi.waitFor(() => {
      expect(mockedDisconnectPrisma).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith({ event: 'app.shutdown.completed' }, 'app.shutdown.completed');
      expect(exitSpy).toHaveBeenCalledWith(0);
    });
  });

  it('logs app.shutdown.error and exits 1 when server.close fails', async () => {
    const closeError = new Error('close failed');
    const close = vi.fn((callback: (error?: Error) => void) => callback(closeError));
    const server = { closeIdleConnections: vi.fn(), close } as unknown as Server;

    shutdown(server, 'SIGTERM');

    await vi.waitFor(() => {
      expect(logger.error).toHaveBeenCalledWith(
        { event: 'app.shutdown.error', err: closeError },
        'app.shutdown.error',
      );
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  it('forces shutdown after the 10s timeout when close never completes', async () => {
    vi.useFakeTimers();
    const close = vi.fn();
    const server = { closeIdleConnections: vi.fn(), close } as unknown as Server;

    shutdown(server, 'SIGTERM');
    await vi.advanceTimersByTimeAsync(10_000);

    expect(logger.error).toHaveBeenCalledWith({ event: 'app.shutdown.forced' }, 'app.shutdown.forced');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('logs app.fatal and exits on uncaughtException', () => {
    registerFatalHandlers();

    process.emit('uncaughtException', new Error('fatal boom'));

    expect(logger.error).toHaveBeenCalledWith(
      { event: 'app.fatal', err: expect.any(Error) },
      'app.fatal',
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('logs app.fatal and exits on unhandledRejection', () => {
    registerFatalHandlers();

    process.emit('unhandledRejection', new Error('rejected promise'), Promise.resolve());

    expect(logger.error).toHaveBeenCalledWith(
      { event: 'app.fatal', err: expect.any(Error) },
      'app.fatal',
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
