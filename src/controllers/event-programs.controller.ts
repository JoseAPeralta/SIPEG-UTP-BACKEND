import type { RequestHandler } from 'express';

import { requireAuthenticatedUser } from '../middlewares/authenticate.middleware.js';
import type {
  CreateEventProgramBody,
  ListEventProgramsQuery,
  UpdateEventProgramBody,
} from '../modules/event-programs/event-programs.schemas.js';
import {
  createEventProgram as createEventProgramService,
  listEventPrograms as listEventProgramsService,
  updateEventProgram as updateEventProgramService,
} from '../modules/event-programs/event-programs.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { successResponse } from '../utils/response.js';

export const getEventPrograms: RequestHandler = asyncHandler(async (req, res) => {
  const query = req.query as unknown as ListEventProgramsQuery;
  const result = await listEventProgramsService(query);

  res.status(200).json(successResponse('Event programs retrieved successfully.', result));
});

export const createEventProgram: RequestHandler = asyncHandler(async (req, res) => {
  const body = req.body as CreateEventProgramBody;
  const user = requireAuthenticatedUser(req);
  const result = await createEventProgramService(body, user.id);

  res.status(201).json(successResponse('Event program created successfully.', result));
});

export const updateEventProgram: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params as { id: string };
  const body = req.body as UpdateEventProgramBody;
  const result = await updateEventProgramService(id, body);

  res.status(200).json(successResponse('Event program updated successfully.', result));
});
