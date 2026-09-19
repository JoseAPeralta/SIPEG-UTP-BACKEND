import type { RequestHandler } from 'express';

import type { ListActivitiesQuery } from '../modules/activities/activities.schemas.js';
import { listUpcomingActivities } from '../modules/activities/activities.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { successResponse } from '../utils/response.js';

export const getActivities: RequestHandler = asyncHandler(async (req, res) => {
  const query = req.query as unknown as ListActivitiesQuery;
  const result = await listUpcomingActivities(query);

  res.status(200).json(successResponse('Activities retrieved successfully.', result));
});
