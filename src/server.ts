import { createServer, type Server } from 'node:http';
import { pathToFileURL } from 'node:url';

import { app } from './app.js';
import { ensureJwks } from './lib/auth.js';
import { env } from './config/env.js';
import { disconnectPrisma } from './config/prisma.js';
import { logger } from './config/logger.js';

const exitWithFlush = (code: number): void => {
  logger.flush(() => process.exit(code));
};

export const createApiServer = (): Server => createServer(app);

export const startServer = async (server: Server, port: number = env.PORT): Promise<void> => {
  logger.info({ event: 'app.starting' }, 'app.starting');

  server.on('error', (error) => {
    logger.error({ event: 'app.fatal', err: error }, 'app.fatal');
    exitWithFlush(1);
  });

  server.listen(port, async () => {
    logger.info({ event: 'app.listening', port }, 'app.listening');
    try {
      await ensureJwks();
      logger.info({ event: 'app.jwks.ready' }, 'app.jwks.ready');
    } catch (error) {
      logger.error({ event: 'app.jwks.failed', err: error }, 'app.jwks.failed');
    }
  });
};

export const shutdown = (server: Server, signal: NodeJS.Signals): void => {
  logger.info({ event: 'app.shutdown.signal', signal }, 'app.shutdown.signal');

  server.closeIdleConnections();
  server.close(async (error) => {
    await disconnectPrisma();
    if (error) {
      logger.error({ event: 'app.shutdown.error', err: error }, 'app.shutdown.error');
      exitWithFlush(1);
    }
    logger.info({ event: 'app.shutdown.completed' }, 'app.shutdown.completed');
    exitWithFlush(0);
  });

  setTimeout(() => {
    logger.error({ event: 'app.shutdown.forced' }, 'app.shutdown.forced');
    exitWithFlush(1);
  }, 10_000).unref();
};

export const registerShutdownHandlers = (server: Server): void => {
  process.on('SIGINT', () => shutdown(server, 'SIGINT'));
  process.on('SIGTERM', () => shutdown(server, 'SIGTERM'));
};

export const registerFatalHandlers = (): void => {
  process.on('uncaughtException', (error) => {
    logger.error({ event: 'app.fatal', err: error }, 'app.fatal');
    exitWithFlush(1);
  });
  process.on('unhandledRejection', (reason) => {
    logger.error({ event: 'app.fatal', err: reason }, 'app.fatal');
    exitWithFlush(1);
  });
};

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  registerFatalHandlers();
  const server = createApiServer();
  registerShutdownHandlers(server);
  void startServer(server);
}
