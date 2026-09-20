import type { RequestHandler } from 'express';

import { asyncHandler } from '../../utils/asyncHandler.js';
import { successResponse } from '../../utils/response.js';
import type {
  CreateOrganizationalUnitBody,
  ListOrganizationalUnitsQuery,
  UpdateOrganizationalUnitBody,
} from './organizational-units.schemas.js';
import {
  createOrganizationalUnit as createOrganizationalUnitService,
  deactivateOrganizationalUnit as deactivateOrganizationalUnitService,
  getOrganizationalUnitById,
  listOrganizationalUnits as listOrganizationalUnitsService,
  reactivateOrganizationalUnit as reactivateOrganizationalUnitService,
  updateOrganizationalUnit as updateOrganizationalUnitService,
} from './organizational-units.service.js';

export const getOrganizationalUnits: RequestHandler = asyncHandler(async (req, res) => {
  const query = req.query as unknown as ListOrganizationalUnitsQuery;
  const result = await listOrganizationalUnitsService(query);

  res.status(200).json(successResponse('Organizational units retrieved successfully.', result));
});

export const getOrganizationalUnit: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params as { id: string };
  const result = await getOrganizationalUnitById(id);

  res.status(200).json(successResponse('Organizational unit retrieved successfully.', result));
});

export const createOrganizationalUnit: RequestHandler = asyncHandler(async (req, res) => {
  const body = req.body as CreateOrganizationalUnitBody;
  const result = await createOrganizationalUnitService(body);

  res.status(201).json(successResponse('Organizational unit created successfully.', result));
});

export const updateOrganizationalUnit: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params as { id: string };
  const body = req.body as UpdateOrganizationalUnitBody;
  const result = await updateOrganizationalUnitService(id, body);

  res.status(200).json(successResponse('Organizational unit updated successfully.', result));
});

export const deactivateOrganizationalUnit: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params as { id: string };
  const result = await deactivateOrganizationalUnitService(id);

  res.status(200).json(successResponse('Organizational unit deactivated successfully.', result));
});

export const reactivateOrganizationalUnit: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params as { id: string };
  const result = await reactivateOrganizationalUnitService(id);

  res.status(200).json(successResponse('Organizational unit reactivated successfully.', result));
});
