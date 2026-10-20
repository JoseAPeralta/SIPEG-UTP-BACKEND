import { createServer, type Server } from 'node:http';

import { logger } from '../config/logger.js';
import type { Metrics } from './metrics.js';

const METRICS_PATH = '/metrics';
const ALLOWED_METHODS = 'GET, HEAD';

export const createMetricsServer = (metrics: Metrics): Server =>
  createServer(async (req, res) => {
    if (req.url !== METRICS_PATH) {
      res.statusCode = 404;
      res.end('Not Found');
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.statusCode = 405;
      res.setHeader('Allow', ALLOWED_METHODS);
      res.end('Method Not Allowed');
      return;
    }

    try {
      const body = await metrics.registry.metrics();

      res.statusCode = 200;
      res.setHeader('Content-Type', metrics.registry.contentType);
      res.setHeader('Cache-Control', 'no-store');
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch (error) {
      logger.error(
        { event: 'app.metrics.error', logType: 'infrastructure', err: error },
        'app.metrics.error',
      );

      if (res.headersSent) {
        res.destroy();
        return;
      }

      res.statusCode = 500;
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.end('Internal Server Error');
    }
  });
