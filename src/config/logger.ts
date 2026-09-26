import pino, { stdSerializers, stdTimeFunctions } from 'pino';
import type { Logger, LoggerOptions } from 'pino';

import { env } from './env.js';

export interface CreateLoggerOptions {
  level: string;
  environment: string;
  serviceName: string;
  version: string;
  pseudonymizationKey?: string | undefined;
  pretty?: boolean | undefined;
  stream?: NodeJS.WritableStream | undefined;
}

const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'authorization',
  'cookie',
  'password',
  'token',
  'accessToken',
  'refreshToken',
  '*.password',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
];

export async function createLogger(options: CreateLoggerOptions): Promise<Logger> {
  const loggerOptions: LoggerOptions = {
    level: options.level,
    timestamp: stdTimeFunctions.isoTime,
    base: {
      service: options.serviceName,
      version: options.version,
      environment: options.environment,
    },
    redact: {
      paths: REDACT_PATHS,
      censor: '[Redacted]',
    },
    serializers: {
      err: (error: Error) => {
        const serialized = stdSerializers.err(error);
        if (options.environment === 'production') {
          return { type: serialized.type };
        }
        return serialized;
      },
    },
  };

  const stream = options.stream ?? process.stdout;

  if (options.pretty && options.environment !== 'production') {
    const { default: prettyFactory } = await import('pino-pretty');
    const prettyStream = prettyFactory({ translateTime: 'SYS:standard' });
    return pino(loggerOptions, prettyStream);
  }

  return pino(loggerOptions, stream);
}

export const logger = await createLogger({
  level: env.LOG_LEVEL,
  environment: env.NODE_ENV,
  serviceName: env.LOG_SERVICE_NAME,
  version: env.APP_VERSION,
  pseudonymizationKey: env.LOG_PSEUDONYMIZATION_KEY,
  pretty: env.LOG_PRETTY,
});

export function createChildLogger(
  bindings: Record<string, string>,
  base: Logger = logger,
): Logger {
  return base.child(bindings);
}
