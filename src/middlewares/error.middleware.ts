import type { ErrorRequestHandler } from 'express';

import { createRequestLogger } from '../config/logger.js';
import { ApiError } from '../utils/ApiError.js';
import { errorResponse } from '../utils/response.js';

/**
 * Mensajes de la respuesta para errores de cliente. La tabla esta cerrada a
 * proposito: el `message` y el `type` que adjuntan las librerias HTTP describen
 * el cuerpo recibido y no se copian nunca a la respuesta.
 */
const CLIENT_ERROR_MESSAGES: Record<number, string> = {
  400: 'Malformed request body.',
  413: 'Request payload is too large.',
  415: 'Unsupported media type.',
};

const DEFAULT_CLIENT_ERROR_MESSAGE = 'Invalid request.';

/**
 * Lee el status que las librerias HTTP (`body-parser` via `http-errors`) adjuntan
 * al error. Solo se acepta un entero 4xx: un status de 5xx describe un fallo del
 * servidor y debe seguir tratandose como error inesperado, con su log `error`.
 */
function clientErrorStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) {
    return undefined;
  }

  const { status, statusCode } = error as { status?: unknown; statusCode?: unknown };

  for (const candidate of [status, statusCode]) {
    if (typeof candidate === 'number' && Number.isInteger(candidate)) {
      if (candidate >= 400 && candidate <= 499) {
        return candidate;
      }
      return undefined;
    }
  }

  return undefined;
}

export const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof ApiError) {
    res.status(error.statusCode).json(errorResponse(error.message, error.errors));
    return;
  }

  // Un cuerpo malformado o demasiado grande es entrada invalida del cliente, no
  // un fallo de la aplicacion: responde con su status y no emite log `error`.
  // Sin esto, un `SyntaxError` de `express.json()` devolvia 500 y contaminaba
  // tanto el panel de errores como la alerta de errores inesperados.
  const clientStatus = clientErrorStatus(error);
  if (clientStatus !== undefined) {
    res
      .status(clientStatus)
      .json(errorResponse(CLIENT_ERROR_MESSAGES[clientStatus] ?? DEFAULT_CLIENT_ERROR_MESSAGE));
    return;
  }

  createRequestLogger({
    event: 'http.error.unexpected',
    logType: 'application',
    err: error,
  }).error('http.error.unexpected');

  res.status(500).json(errorResponse('Internal server error.'));
};
