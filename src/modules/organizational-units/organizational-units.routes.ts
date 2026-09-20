import { Router } from 'express';

import { authenticate } from '../../middlewares/authenticate.middleware.js';
import { requireAdmin } from '../../middlewares/authorize.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import {
  createOrganizationalUnit,
  deactivateOrganizationalUnit,
  getOrganizationalUnit,
  getOrganizationalUnits,
  reactivateOrganizationalUnit,
  updateOrganizationalUnit,
} from './organizational-units.controller.js';
import {
  createOrganizationalUnitSchema,
  listOrganizationalUnitsQuerySchema,
  organizationalUnitParamsSchema,
  updateOrganizationalUnitSchema,
} from './organizational-units.schemas.js';

export const organizationalUnitsRoutes = Router();

organizationalUnitsRoutes.get(
  '/organizational-units',
  validate(listOrganizationalUnitsQuerySchema),
  getOrganizationalUnits,
);

organizationalUnitsRoutes.get(
  '/organizational-units/:id',
  validate(organizationalUnitParamsSchema),
  getOrganizationalUnit,
);

organizationalUnitsRoutes.post(
  '/organizational-units',
  authenticate,
  requireAdmin,
  validate(createOrganizationalUnitSchema),
  createOrganizationalUnit,
);

organizationalUnitsRoutes.patch(
  '/organizational-units/:id',
  authenticate,
  requireAdmin,
  validate(updateOrganizationalUnitSchema),
  updateOrganizationalUnit,
);

organizationalUnitsRoutes.post(
  '/organizational-units/:id/deactivate',
  authenticate,
  requireAdmin,
  validate(organizationalUnitParamsSchema),
  deactivateOrganizationalUnit,
);

organizationalUnitsRoutes.post(
  '/organizational-units/:id/reactivate',
  authenticate,
  requireAdmin,
  validate(organizationalUnitParamsSchema),
  reactivateOrganizationalUnit,
);
