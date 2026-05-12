import { createServer } from 'node:http';

import { app } from './app.js';
import { env } from './config/env.js';
import { disconnectPrisma } from './config/prisma.js';

const server = createServer(app);

server.listen(env.PORT, () => {
  console.log(`SIPEG UTP API listening on port ${env.PORT}`);
});

const shutdown = (signal: NodeJS.Signals): void => {
  console.log(`${signal} received. Shutting down gracefully.`);

  server.close(async (error) => {
    await disconnectPrisma();

    if (error) {
      console.error(error);
      process.exit(1);
    }

    process.exit(0);
  });

  setTimeout(() => {
    console.error('Forced shutdown after timeout.');
    process.exit(1);
  }, 10_000).unref();
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
