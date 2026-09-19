import type { RequestHandler } from 'express';

import { requireAuthenticatedUser } from '../middlewares/authenticate.middleware.js';
import type { CreateEventProgramBody } from '../modules/event-programs/event-programs.schemas.js';
import { createEventProgram as createEventProgramService } from '../modules/event-programs/event-programs.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { successResponse } from '../utils/response.js';

export const createEventProgram: RequestHandler = asyncHandler(async (req, res) => {
  const body = req.body as CreateEventProgramBody;
  const user = requireAuthenticatedUser(req);
  const result = await createEventProgramService(body, user.id);

  res.status(201).json(successResponse('Event program created successfully.', result));
});
