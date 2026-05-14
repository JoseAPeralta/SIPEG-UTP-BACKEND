import { asyncHandler } from '../../utils/asyncHandler.js';
import { successResponse } from '../../utils/response.js';
import { registerUser } from './auth.service.js';
import type { RegisterUserSchemaBody } from './auth.schemas.js';

export const register = asyncHandler(async (req, res) => {
  const result = await registerUser(req.body as RegisterUserSchemaBody);

  res.status(201).json(successResponse('User created successfully.', result));
});
