import { requireAuthenticatedUser } from '../../middlewares/authenticate.middleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { successResponse } from '../../utils/response.js';
import type {
  CreateUserSchemaBody,
  ListUsersQuery,
  UpdateAdminUserBody,
  UpdateProfileSchemaBody,
} from './users.schemas.js';
import {
  createUser as createUserService,
  getProfile,
  getUserById as getUserByIdService,
  listUsers as listUsersService,
  updateAdminUser as updateAdminUserService,
  updateProfile,
} from './users.service.js';

export const createUser = asyncHandler(async (req, res) => {
  const body = req.body as CreateUserSchemaBody;
  const user = await createUserService(body);

  res.status(201).json(successResponse('User created successfully.', user));
});

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

export const listUsers = asyncHandler(async (req, res) => {
  const query = req.query as unknown as ListUsersQuery;
  const result = await listUsersService(query);

  res.status(200).json(successResponse('Users retrieved successfully.', result));
});

export const getUser = asyncHandler(async (req, res) => {
  const { id } = req.params as { id: string };
  const user = await getUserByIdService(id);

  res.status(200).json(successResponse('User retrieved successfully.', user));
});

export const updateUser = asyncHandler(async (req, res) => {
  const actor = requireAuthenticatedUser(req);
  const { id } = req.params as { id: string };
  const user = await updateAdminUserService(actor.id, id, req.body as UpdateAdminUserBody);

  res.status(200).json(successResponse('User updated successfully.', user));
});
