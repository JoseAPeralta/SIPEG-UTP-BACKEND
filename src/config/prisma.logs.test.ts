import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type PrismaEventHandler = (event: { message: string }) => void;

const { loggerWarn, loggerError, prismaHandlers, clientOptions } = vi.hoisted(() => ({
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
  prismaHandlers: new Map<string, PrismaEventHandler>(),
  clientOptions: [] as unknown[],
}));

vi.mock('./logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: loggerWarn,
    error: loggerError,
    debug: vi.fn(),
  },
}));

vi.mock('./env.js', () => ({
  env: {
    DATABASE_URL: 'postgresql://user:password@localhost:5432/sipeg_utp',
    DATABASE_POOL_MAX: 9,
    DATABASE_POOL_CONNECTION_TIMEOUT_MS: 5000,
    DATABASE_POOL_IDLE_TIMEOUT_MS: 30000,
  },
}));

vi.mock('@prisma/adapter-pg', () => ({ PrismaPg: vi.fn() }));

vi.mock('../generated/prisma/client.js', () => ({
  PrismaClient: class {
    constructor(options: unknown) {
      clientOptions.push(options);
    }

    $on(event: string, handler: PrismaEventHandler): void {
      prismaHandlers.set(event, handler);
    }
  },
}));

const loadPrismaModule = async () => {
  vi.resetModules();
  globalThis.__sipegPrisma = undefined;
  return import('./prisma.js');
};

describe('prisma client log instrumentation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaHandlers.clear();
  });

  afterEach(() => {
    globalThis.__sipegPrisma = undefined;
  });

  it('logs prisma.warn with logType infrastructure', async () => {
    const { getPrismaClient } = await loadPrismaModule();
    getPrismaClient();

    prismaHandlers.get('warn')?.({ message: 'Query was slow' });

    expect(loggerWarn).toHaveBeenCalledTimes(1);
    expect(loggerWarn).toHaveBeenCalledWith(
      { event: 'prisma.warn', logType: 'infrastructure', message: 'Query was slow' },
      'prisma.warn',
    );
  });

  it('logs prisma.error with logType infrastructure', async () => {
    const { getPrismaClient } = await loadPrismaModule();
    getPrismaClient();

    prismaHandlers.get('error')?.({ message: 'Connection lost' });

    expect(loggerError).toHaveBeenCalledTimes(1);
    expect(loggerError).toHaveBeenCalledWith(
      { event: 'prisma.error', logType: 'infrastructure', message: 'Connection lost' },
      'prisma.error',
    );
  });

  it('never subscribes to the query level', async () => {
    const { getPrismaClient } = await loadPrismaModule();
    getPrismaClient();

    expect([...prismaHandlers.keys()].sort()).toEqual(['error', 'warn']);
    expect(clientOptions[0]).toMatchObject({
      log: [
        { emit: 'event', level: 'warn' },
        { emit: 'event', level: 'error' },
      ],
    });
  });
});
