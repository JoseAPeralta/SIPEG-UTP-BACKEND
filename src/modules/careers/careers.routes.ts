import { Router } from 'express';

import { authenticate } from '../../middlewares/authenticate.middleware.js';
import { requireAdmin } from '../../middlewares/authorize.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { createCareer, deleteCareer, getCareers, updateCareer } from './careers.controller.js';
import {
  careerParamsSchema,
  createCareerSchema,
  listCareersQuerySchema,
  updateCareerSchema,
} from './careers.schemas.js';

export const careersRoutes = Router();

careersRoutes.get('/careers', validate(listCareersQuerySchema), getCareers);

careersRoutes.post(
  '/careers',
  authenticate,
  requireAdmin,
  validate(createCareerSchema),
  createCareer,
);

careersRoutes.patch(
  '/careers/:id',
  authenticate,
  requireAdmin,
  validate(updateCareerSchema),
  updateCareer,
);

careersRoutes.delete(
  '/careers/:id',
  authenticate,
  requireAdmin,
  validate(careerParamsSchema),
  deleteCareer,
);
