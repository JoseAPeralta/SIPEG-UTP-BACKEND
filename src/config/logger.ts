import pino, { stdSerializers, stdTimeFunctions } from 'pino';
import type { Logger, LoggerOptions } from 'pino';

import { getLogContext } from '../lib/log-context.js';
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

/**
 * Propiedades que `body-parser` y `http-errors` adjuntan al error y que nunca
 * deben aterrizar en un log: `body` es el cuerpo crudo de la peticion y
 * `headers` puede traer `authorization` o `cookie`. `redact` no las cubre porque
 * sus rutas asumen `req.headers.*`, no `err.headers.*`.
 */
const ERROR_PAYLOAD_PROPERTIES = ['body', 'headers'] as const;

export async function createLogger(options: CreateLoggerOptions): Promise<Logger> {
  const loggerOptions: LoggerOptions = {
    level: options.level,
    timestamp: stdTimeFunctions.isoTime,
    base: {
      service: options.serviceName,
      version: options.version,
      environment: options.environment,
    },
    // Pino emits `level` as a number (30, 40, ...). Loki and Grafana can only
    // index textual levels, and its detection ignores numeric JSON fields and
    // then falls back to grepping words out of the line, which would mislabel
    // events such as `auth.login.failed`. Emitting the name is a conscious
    // trade-off: pino recommends a transport for human-readable output instead.
    formatters: {
      level: (label) => ({ level: label }),
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
        // Fuera de produccion se conserva `message` y `stack` para diagnosticar,
        // pero no la carga util de la peticion. El pipeline de desarrollo tambien
        // ingiere estos logs en Loki, asi que la exclusion no es solo local.
        for (const property of ERROR_PAYLOAD_PROPERTIES) {
          delete serialized[property];
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

export function createChildLogger(bindings: Record<string, string>, base: Logger = logger): Logger {
  return base.child(bindings);
}

/**
 * Returns a child logger carrying the `requestId` of the current request, when
 * there is one, plus the given bindings. Security events are emitted from
 * middlewares and services deep in the stack; this is what keeps them
 * correlatable with their access log line (`X-Request-ID`) without threading a
 * logger through every call.
 */
export function createRequestLogger(
  bindings: Record<string, unknown> = {},
  base: Logger = logger,
): Logger {
  const { requestId } = getLogContext();
  return base.child(requestId ? { requestId, ...bindings } : bindings);
}
