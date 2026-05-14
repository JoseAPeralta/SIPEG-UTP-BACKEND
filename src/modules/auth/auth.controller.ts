import { asyncHandler } from '../../utils/asyncHandler.js';
import { successResponse } from '../../utils/response.js';
import { loginUser, registerUser } from './auth.service.js';
import type { LoginUserSchemaBody, RegisterUserSchemaBody } from './auth.schemas.js';

export const register = asyncHandler(async (req, res) => {
  const result = await registerUser(req.body as RegisterUserSchemaBody);

  res.status(201).json(successResponse('User created successfully.', result));
});

export const login = asyncHandler(async (req, res) => {
  const result = await loginUser(req.body as LoginUserSchemaBody);

  res.status(200).json(successResponse('Login successful.', result));
});
