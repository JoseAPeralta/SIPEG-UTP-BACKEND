import { createServer, type Server } from 'node:http';
import { pathToFileURL } from 'node:url';

import { app } from './app.js';
import { ensureJwks } from './lib/auth.js';
import { env } from './config/env.js';
import { disconnectPrisma } from './config/prisma.js';
import { logger } from './config/logger.js';
import { metrics, metricsConfig } from './config/metrics.js';
import { createMetricsServer } from './observability/metrics.server.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;

export interface StartApplicationOptions {
  apiPort?: number;
  apiHost?: string;
  metricsPort?: number;
  metricsHost?: string;
}

const exitWithFlush = (code: number): void => {
  logger.flush(() => process.exit(code));
};

const listen = (server: Server, port: number, host?: string): Promise<void> =>
  new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };

    server.once('error', onError);
    server.once('listening', onListening);

    if (host === undefined) {
      server.listen(port);
    } else {
      server.listen(port, host);
    }
  });

const closeServer = (server: Server): Promise<void> =>
  new Promise((resolve, reject) => {
    if (typeof server.closeIdleConnections === 'function') {
      server.closeIdleConnections();
    }

    server.close((error) => (error ? reject(error) : resolve()));
  });

const initializeJwks = async (): Promise<void> => {
  try {
    await ensureJwks();
    logger.info({ event: 'app.jwks.ready', logType: 'infrastructure' }, 'app.jwks.ready');
  } catch (error) {
    logger.error(
      { event: 'app.jwks.failed', logType: 'infrastructure', err: error },
      'app.jwks.failed',
    );
  }
};

export const createApiServer = (): Server => createServer(app);

export const startServer = async (
  server: Server,
  port: number = env.PORT,
  host?: string,
): Promise<void> => {
  logger.info({ event: 'app.starting', logType: 'infrastructure' }, 'app.starting');

  await listen(server, port, host);

  server.on('error', (error) => {
    logger.error({ event: 'app.fatal', logType: 'infrastructure', err: error }, 'app.fatal');
    exitWithFlush(1);
  });

  logger.info(
    {
      event: 'app.listening',
      logType: 'infrastructure',
      port,
      ...(host === undefined ? {} : { host }),
    },
    'app.listening',
  );

  void initializeJwks();
};

export const startMetricsServer = async (
  server: Server,
  port: number = env.METRICS_PORT,
  host: string = env.METRICS_HOST,
): Promise<void> => {
  await listen(server, port, host);

  server.on('error', (error) => {
    logger.error(
      { event: 'app.metrics.failed', logType: 'infrastructure', err: error },
      'app.metrics.failed',
    );
    exitWithFlush(1);
  });

  logger.info(
    { event: 'app.metrics.listening', logType: 'infrastructure', port, host },
    'app.metrics.listening',
  );
};

export const startApplication = async (
  apiServer: Server,
  metricsServer?: Server,
  options: StartApplicationOptions = {},
): Promise<void> => {
  await startServer(apiServer, options.apiPort ?? env.PORT, options.apiHost);

  if (metricsServer === undefined) {
    return;
  }

  try {
    await startMetricsServer(
      metricsServer,
      options.metricsPort ?? env.METRICS_PORT,
      options.metricsHost ?? env.METRICS_HOST,
    );
  } catch (error) {
    logger.error(
      { event: 'app.metrics.failed', logType: 'infrastructure', err: error },
      'app.metrics.failed',
    );

    try {
      await closeServer(apiServer);
    } catch (closeError) {
      logger.error(
        { event: 'app.shutdown.error', logType: 'infrastructure', err: closeError },
        'app.shutdown.error',
      );
    }

    throw error;
  }
};

const shuttingDownServers = new WeakSet<Server>();

export const shutdown = (
  server: Server,
  signal: NodeJS.Signals,
  extraServers: Server[] = [],
): void => {
  const servers = [...new Set([server, ...extraServers])];

  if (servers.some((candidate) => shuttingDownServers.has(candidate))) {
    return;
  }

  for (const candidate of servers) {
    shuttingDownServers.add(candidate);
  }

  logger.info(
    { event: 'app.shutdown.signal', logType: 'infrastructure', signal },
    'app.shutdown.signal',
  );

  const deadline = setTimeout(() => {
    logger.error(
      { event: 'app.shutdown.forced', logType: 'infrastructure' },
      'app.shutdown.forced',
    );
    exitWithFlush(1);
  }, SHUTDOWN_TIMEOUT_MS);
  deadline.unref();

  void (async () => {
    let exitCode = 0;
    const results = await Promise.allSettled(servers.map((candidate) => closeServer(candidate)));

    for (const result of results) {
      if (result.status === 'rejected') {
        exitCode = 1;
        logger.error(
          { event: 'app.shutdown.error', logType: 'infrastructure', err: result.reason },
          'app.shutdown.error',
        );
      }
    }

    try {
      await disconnectPrisma();
    } catch (error) {
      exitCode = 1;
      logger.error(
        { event: 'app.shutdown.error', logType: 'infrastructure', err: error },
        'app.shutdown.error',
      );
    }

    clearTimeout(deadline);

    if (exitCode === 0) {
      logger.info(
        { event: 'app.shutdown.completed', logType: 'infrastructure' },
        'app.shutdown.completed',
      );
    }

    exitWithFlush(exitCode);
  })();
};

export const registerShutdownHandlers = (server: Server, extraServers: Server[] = []): void => {
  process.on('SIGINT', () => shutdown(server, 'SIGINT', extraServers));
  process.on('SIGTERM', () => shutdown(server, 'SIGTERM', extraServers));
};

export const registerFatalHandlers = (): void => {
  process.on('uncaughtException', (error) => {
    logger.error({ event: 'app.fatal', logType: 'infrastructure', err: error }, 'app.fatal');
    exitWithFlush(1);
  });
  process.on('unhandledRejection', (reason) => {
    logger.error({ event: 'app.fatal', logType: 'infrastructure', err: reason }, 'app.fatal');
    exitWithFlush(1);
  });
};

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  registerFatalHandlers();
  const server = createApiServer();
  const metricsServer =
    metricsConfig.enabled && metrics !== undefined ? createMetricsServer(metrics) : undefined;

  registerShutdownHandlers(server, metricsServer === undefined ? [] : [metricsServer]);

  void startApplication(server, metricsServer).catch((error) => {
    logger.error({ event: 'app.fatal', logType: 'infrastructure', err: error }, 'app.fatal');
    exitWithFlush(1);
  });
}
