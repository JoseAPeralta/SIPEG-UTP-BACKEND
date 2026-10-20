import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { logger } from './config/logger.js';
import { disconnectPrisma } from './config/prisma.js';
import { ensureJwks } from './lib/auth.js';
import { createMetrics } from './observability/metrics.js';
import { createMetricsServer } from './observability/metrics.server.js';

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

vi.mock('./app.js', () => ({
  app: (req: IncomingMessage, res: ServerResponse) => {
    if (req.url === '/api/v1/health') {
      res.statusCode = 200;
      res.end('ok');
      return;
    }

    res.statusCode = 404;
    res.end('Not Found');
  },
}));

import {
  createApiServer,
  registerFatalHandlers,
  shutdown,
  startApplication,
  startServer,
} from './server.js';

const mockedEnsureJwks = vi.mocked(ensureJwks);
const mockedDisconnectPrisma = vi.mocked(disconnectPrisma);

const closeServer = (server: Server): Promise<void> =>
  new Promise((resolve, reject) => {
    if (!server.listening) {
      resolve();
      return;
    }

    server.close((error) => (error ? reject(error) : resolve()));
  });

const openServers = new Set<Server>();

const trackServer = <T extends Server>(server: T): T => {
  openServers.add(server);
  return server;
};

const addressPort = (server: Server): number => {
  const address = server.address();

  if (address === null || typeof address === 'string') {
    throw new Error('Expected the server to listen on a TCP port.');
  }

  return address.port;
};

const createTestMetrics = () => {
  const metrics = createMetrics({
    collectDefaults: false,
    defaultLabels: { service: 'test-service', environment: 'test' },
  });

  metrics.httpRequestsTotal.inc({
    method: 'GET',
    route: '/api/v1/health',
    status_code: '200',
    request_kind: 'matched',
    outcome: 'completed',
  });

  return metrics;
};

describe('server lifecycle logging', () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never);
  });

  afterEach(async () => {
    vi.useRealTimers();
    process.removeAllListeners('uncaughtException');
    process.removeAllListeners('unhandledRejection');
    await Promise.all([...openServers].map((server) => closeServer(server)));
    openServers.clear();
  });

  it('logs app.starting, app.listening and app.jwks.failed when jwks init fails', async () => {
    mockedEnsureJwks.mockRejectedValue(new Error('db down'));
    const server = createApiServer();

    await startServer(server, 0);

    expect(logger.info).toHaveBeenCalledWith(
      { event: 'app.starting', logType: 'infrastructure' },
      'app.starting',
    );
    await vi.waitFor(() => {
      expect(logger.info).toHaveBeenCalledWith(
        { event: 'app.listening', logType: 'infrastructure', port: 0 },
        'app.listening',
      );
    });
    await vi.waitFor(() => {
      expect(logger.error).toHaveBeenCalledWith(
        { event: 'app.jwks.failed', logType: 'infrastructure', err: expect.any(Error) },
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
      expect(logger.info).toHaveBeenCalledWith(
        { event: 'app.jwks.ready', logType: 'infrastructure' },
        'app.jwks.ready',
      );
    });

    await closeServer(server);
  });

  it('logs app.fatal and exits when the HTTP server errors', async () => {
    const server = createApiServer();
    await startServer(server, 0);

    server.emit('error', new Error('EADDRINUSE'));

    expect(logger.error).toHaveBeenCalledWith(
      { event: 'app.fatal', logType: 'infrastructure', err: expect.any(Error) },
      'app.fatal',
    );
    expect(exitSpy).toHaveBeenCalledWith(1);

    await closeServer(server);
  });

  it('resolves startServer only after the server is listening', async () => {
    mockedEnsureJwks.mockResolvedValue(undefined);
    const server = trackServer(createApiServer());

    const started = startServer(server, 0, '127.0.0.1');

    expect(server.listening).toBe(false);
    await started;
    expect(server.listening).toBe(true);
  });

  it('starts both listeners and exposes /metrics only on the metrics listener', async () => {
    mockedEnsureJwks.mockResolvedValue(undefined);
    const apiServer = trackServer(createApiServer());
    const metricsServer = trackServer(createMetricsServer(createTestMetrics()));

    await startApplication(apiServer, metricsServer, {
      apiPort: 0,
      apiHost: '127.0.0.1',
      metricsPort: 0,
      metricsHost: '127.0.0.1',
    });

    expect(apiServer.listening).toBe(true);
    expect(metricsServer.listening).toBe(true);

    const metricsResponse = await fetch(`http://127.0.0.1:${addressPort(metricsServer)}/metrics`);
    expect(metricsResponse.status).toBe(200);
    expect(await metricsResponse.text()).toContain('sipeg_http_requests_total');

    const apiResponse = await fetch(`http://127.0.0.1:${addressPort(apiServer)}/metrics`);
    expect(apiResponse.status).toBe(404);
  });

  it('rejects and stops the API when the metrics port is occupied', async () => {
    mockedEnsureJwks.mockResolvedValue(undefined);
    const occupied = trackServer(createServer());
    await new Promise<void>((resolve) => occupied.listen(0, '127.0.0.1', resolve));

    const apiServer = trackServer(createApiServer());
    const metricsServer = trackServer(createMetricsServer(createTestMetrics()));

    await expect(
      startApplication(apiServer, metricsServer, {
        apiPort: 0,
        apiHost: '127.0.0.1',
        metricsPort: addressPort(occupied),
        metricsHost: '127.0.0.1',
      }),
    ).rejects.toThrow();

    expect(apiServer.listening).toBe(false);
    expect(logger.error).toHaveBeenCalledWith(
      { event: 'app.metrics.failed', logType: 'infrastructure', err: expect.any(Error) },
      'app.metrics.failed',
    );
  });

  it('closes both servers, disconnects Prisma once and exits 0', async () => {
    const apiClose = vi.fn((callback: (error?: Error) => void) => callback(undefined));
    const metricsClose = vi.fn((callback: (error?: Error) => void) => callback(undefined));
    const apiServer = {
      closeIdleConnections: vi.fn(),
      close: apiClose,
    } as unknown as Server;
    const metricsServer = {
      closeIdleConnections: vi.fn(),
      close: metricsClose,
    } as unknown as Server;

    shutdown(apiServer, 'SIGTERM', [metricsServer]);

    await vi.waitFor(() => {
      expect(apiClose).toHaveBeenCalledTimes(1);
      expect(metricsClose).toHaveBeenCalledTimes(1);
      expect(mockedDisconnectPrisma).toHaveBeenCalledTimes(1);
      expect(exitSpy).toHaveBeenCalledWith(0);
    });
    expect(logger.info).toHaveBeenCalledWith(
      { event: 'app.shutdown.completed', logType: 'infrastructure' },
      'app.shutdown.completed',
    );
  });

  it('ignores repeated shutdown requests while a shutdown is in progress', async () => {
    const apiClose = vi.fn((callback: (error?: Error) => void) => callback(undefined));
    const metricsClose = vi.fn((callback: (error?: Error) => void) => callback(undefined));
    const apiServer = {
      closeIdleConnections: vi.fn(),
      close: apiClose,
    } as unknown as Server;
    const metricsServer = {
      closeIdleConnections: vi.fn(),
      close: metricsClose,
    } as unknown as Server;

    shutdown(apiServer, 'SIGTERM', [metricsServer]);
    shutdown(apiServer, 'SIGTERM', [metricsServer]);

    await vi.waitFor(() => {
      expect(apiClose).toHaveBeenCalledTimes(1);
      expect(metricsClose).toHaveBeenCalledTimes(1);
      expect(mockedDisconnectPrisma).toHaveBeenCalledTimes(1);
      expect(exitSpy).toHaveBeenCalledTimes(1);
    });
  });

  it('logs the shutdown signal and completes gracefully', async () => {
    const close = vi.fn((callback: (error?: Error) => void) => callback(undefined));
    const server = { closeIdleConnections: vi.fn(), close } as unknown as Server;

    shutdown(server, 'SIGTERM');

    expect(logger.info).toHaveBeenCalledWith(
      { event: 'app.shutdown.signal', logType: 'infrastructure', signal: 'SIGTERM' },
      'app.shutdown.signal',
    );
    expect(close).toHaveBeenCalled();

    await vi.waitFor(() => {
      expect(mockedDisconnectPrisma).toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        { event: 'app.shutdown.completed', logType: 'infrastructure' },
        'app.shutdown.completed',
      );
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
        { event: 'app.shutdown.error', logType: 'infrastructure', err: closeError },
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

    expect(logger.error).toHaveBeenCalledWith(
      { event: 'app.shutdown.forced', logType: 'infrastructure' },
      'app.shutdown.forced',
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('logs app.fatal and exits on uncaughtException', () => {
    registerFatalHandlers();

    process.emit('uncaughtException', new Error('fatal boom'));

    expect(logger.error).toHaveBeenCalledWith(
      { event: 'app.fatal', logType: 'infrastructure', err: expect.any(Error) },
      'app.fatal',
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('logs app.fatal and exits on unhandledRejection', () => {
    registerFatalHandlers();

    process.emit('unhandledRejection', new Error('rejected promise'), Promise.resolve());

    expect(logger.error).toHaveBeenCalledWith(
      { event: 'app.fatal', logType: 'infrastructure', err: expect.any(Error) },
      'app.fatal',
    );
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});
