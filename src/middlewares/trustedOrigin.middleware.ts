import type { RequestHandler } from 'express';

import { env } from '../config/env.js';
import { createRequestLogger } from '../config/logger.js';
import { ApiError } from '../utils/ApiError.js';

const allowedOrigins = new Set(
  [env.CORS_ORIGIN, ...(env.TRUSTED_ORIGINS?.split(',') ?? [])]
    .map((origin) => origin.trim())
    .filter(Boolean),
);

/**
 * Rechaza las peticiones que llegan con un `Origin` no permitido.
 *
 * CORS ya cubre el caso habitual: un `POST` con `Content-Type: application/json`
 * dispara preflight, y si el origen no esta en la lista el navegador nunca envia
 * la peticion real. El hueco es el otro: una "simple request" (sin preflight,
 * tipicamente por no llevar `Content-Type`) si llega con la cookie adjunta, y
 * CORS no la detiene. Con `SameSite=None`, que es lo que exige un frontend
 * desplegado aparte, la cookie viaja en esas peticiones.
 *
 * Con `SameSite=Lax` la cookie no se envia en un POST iniciado desde otro sitio,
 * asi que esto es defensa en profundidad. Se aplica igual en ambos casos porque
 * el coste es una comparacion y el fallo que evita es perder la sesion del
 * usuario.
 *
 * **Ausencia de `Origin` se permite.** No la envia ningun cliente que no sea un
 * navegador (curl, Bruno, tests), y un atacante desde otro sitio siempre la
 * envia: es exactamente el caso que se quiere cerrar.
 */
export const requireTrustedOrigin: RequestHandler = (req, _res, next) => {
  const origin = req.headers.origin;

  if (origin === undefined) {
    next();
    return;
  }

  if (allowedOrigins.has(origin)) {
    next();
    return;
  }

  createRequestLogger({
    event: 'security.cors.denied',
    logType: 'security',
    origin,
  }).warn('security.cors.denied');
  next(new ApiError(403, 'CORS origin is not allowed.'));
};
