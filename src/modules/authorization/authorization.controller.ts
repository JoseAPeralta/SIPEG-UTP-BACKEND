import type { RequestHandler } from 'express';

import { requireAuthenticatedUser } from '../../middlewares/authenticate.middleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { successResponse } from '../../utils/response.js';
import type { AddCollaboratorBody } from './authorization.schemas.js';
import {
  addCollaborator as addCollaboratorService,
  listCollaborators as listCollaboratorsService,
} from './delegation.service.js';

export const getEventProgramCollaborators: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params as { id: string };
  const user = requireAuthenticatedUser(req);
  const result = await listCollaboratorsService(user, { eventProgramId: id });

  res.status(200).json(successResponse('Collaborators retrieved successfully.', result));
});

export const getActivityCollaborators: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params as { id: string };
  const user = requireAuthenticatedUser(req);
  const result = await listCollaboratorsService(user, { activityId: id });

  res.status(200).json(successResponse('Collaborators retrieved successfully.', result));
});

export const addEventProgramCollaborator: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params as { id: string };
  const body = req.body as AddCollaboratorBody;
  const user = requireAuthenticatedUser(req);
  const result = await addCollaboratorService(user, { eventProgramId: id }, body.userId, body.role);

  res.status(201).json(successResponse('Collaborator added successfully.', result));
});

export const addActivityCollaborator: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params as { id: string };
  const body = req.body as AddCollaboratorBody;
  const user = requireAuthenticatedUser(req);
  const result = await addCollaboratorService(user, { activityId: id }, body.userId, body.role);

  res.status(201).json(successResponse('Collaborator added successfully.', result));
});
