import type { RequestHandler } from 'express';

import { requireAuthenticatedUser } from '../../middlewares/authenticate.middleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { successResponse } from '../../utils/response.js';
import type {
  AddCollaboratorBody,
  GrantPermissionBody,
  OwnPermissionsQuery,
  UpdateCollaboratorRoleBody,
} from './authorization.schemas.js';
import { listOwnPermissions as listOwnPermissionsService } from './authorization.service.js';
import {
  addCollaborator as addCollaboratorService,
  grantPermission as grantPermissionService,
  listCollaborators as listCollaboratorsService,
  removeCollaborator as removeCollaboratorService,
  revokePermission as revokePermissionService,
  updateCollaboratorRole as updateCollaboratorRoleService,
} from './delegation.service.js';
import type { PermissionName } from './permissions.js';

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

export const updateEventProgramCollaboratorRole: RequestHandler = asyncHandler(async (req, res) => {
  const { id, userId } = req.params as { id: string; userId: string };
  const body = req.body as UpdateCollaboratorRoleBody;
  const user = requireAuthenticatedUser(req);
  const result = await updateCollaboratorRoleService(
    user,
    { eventProgramId: id },
    userId,
    body.role,
  );

  res.status(200).json(successResponse('Collaborator role updated successfully.', result));
});

export const updateActivityCollaboratorRole: RequestHandler = asyncHandler(async (req, res) => {
  const { id, userId } = req.params as { id: string; userId: string };
  const body = req.body as UpdateCollaboratorRoleBody;
  const user = requireAuthenticatedUser(req);
  const result = await updateCollaboratorRoleService(user, { activityId: id }, userId, body.role);

  res.status(200).json(successResponse('Collaborator role updated successfully.', result));
});

export const removeEventProgramCollaborator: RequestHandler = asyncHandler(async (req, res) => {
  const { id, userId } = req.params as { id: string; userId: string };
  const user = requireAuthenticatedUser(req);
  await removeCollaboratorService(user, { eventProgramId: id }, userId);

  res.status(204).send();
});

export const removeActivityCollaborator: RequestHandler = asyncHandler(async (req, res) => {
  const { id, userId } = req.params as { id: string; userId: string };
  const user = requireAuthenticatedUser(req);
  await removeCollaboratorService(user, { activityId: id }, userId);

  res.status(204).send();
});

export const grantEventProgramPermission: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params as { id: string };
  const body = req.body as GrantPermissionBody;
  const user = requireAuthenticatedUser(req);
  const result = await grantPermissionService(
    user,
    { eventProgramId: id },
    body.userId,
    body.permission,
    { validFrom: body.validFrom ?? null, validUntil: body.validUntil ?? null },
  );

  res.status(200).json(successResponse('Permission granted successfully.', result));
});

export const grantActivityPermission: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params as { id: string };
  const body = req.body as GrantPermissionBody;
  const user = requireAuthenticatedUser(req);
  const result = await grantPermissionService(
    user,
    { activityId: id },
    body.userId,
    body.permission,
    { validFrom: body.validFrom ?? null, validUntil: body.validUntil ?? null },
  );

  res.status(200).json(successResponse('Permission granted successfully.', result));
});

export const revokeEventProgramPermission: RequestHandler = asyncHandler(async (req, res) => {
  const { id, permission } = req.params as { id: string; permission: PermissionName };
  const { userId } = req.query as { userId: string };
  const user = requireAuthenticatedUser(req);
  await revokePermissionService(user, { eventProgramId: id }, userId, permission);

  res.status(204).send();
});

export const revokeActivityPermission: RequestHandler = asyncHandler(async (req, res) => {
  const { id, permission } = req.params as { id: string; permission: PermissionName };
  const { userId } = req.query as { userId: string };
  const user = requireAuthenticatedUser(req);
  await revokePermissionService(user, { activityId: id }, userId, permission);

  res.status(204).send();
});

export const getOwnPermissions: RequestHandler = asyncHandler(async (req, res) => {
  const query = req.query as unknown as OwnPermissionsQuery;
  const user = requireAuthenticatedUser(req);
  const result = await listOwnPermissionsService(user, { type: query.scope, id: query.id });

  res.status(200).json(successResponse('Permissions retrieved successfully.', result));
});
