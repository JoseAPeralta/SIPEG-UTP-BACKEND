import type { RequestHandler } from 'express';

import { asyncHandler } from '../../utils/asyncHandler.js';
import { successResponse } from '../../utils/response.js';
import type { CreateActivityBody, ListActivitiesQuery } from './activities.schemas.js';
import {
  createActivity as createActivityService,
  listUpcomingActivities,
} from './activities.service.js';

export const getActivities: RequestHandler = asyncHandler(async (req, res) => {
  const query = req.query as unknown as ListActivitiesQuery;
  const result = await listUpcomingActivities(query);

  res.status(200).json(successResponse('Activities retrieved successfully.', result));
});

export const createActivity: RequestHandler = asyncHandler(async (req, res) => {
  const body = req.body as CreateActivityBody;
  const result = await createActivityService(body);

  res.status(201).json(successResponse('Activity created successfully.', result));
});
