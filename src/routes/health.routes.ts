import { Router } from 'express';

import { getHealth } from '../controllers/health.controller.js';

export const healthRoutes = Router();

healthRoutes.get('/health', getHealth);
