import { Router } from 'express';

import { authenticate } from '../../middlewares/authenticate.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { listMyCertificates } from './certificates.controller.js';
import { listMyCertificatesQuerySchema } from './certificates.schemas.js';

export const certificatesRoutes = Router();

certificatesRoutes.get(
  '/users/me/certificates',
  authenticate,
  validate(listMyCertificatesQuerySchema),
  listMyCertificates,
);
