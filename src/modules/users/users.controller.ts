import { requireAuthenticatedUser } from '../../middlewares/authenticate.middleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { successResponse } from '../../utils/response.js';
import type { UpdateProfileSchemaBody } from './users.schemas.js';
import { getProfile, updateProfile } from './users.service.js';

export const getCurrentUser = asyncHandler(async (req, res) => {
  const user = requireAuthenticatedUser(req);
  const profile = await getProfile(user.id);

  res.status(200).json(successResponse('Profile retrieved successfully.', profile));
});

export const updateCurrentUser = asyncHandler(async (req, res) => {
  const user = requireAuthenticatedUser(req);
  const profile = await updateProfile(user.id, req.body as UpdateProfileSchemaBody);

  res.status(200).json(successResponse('Profile updated successfully.', profile));
});
