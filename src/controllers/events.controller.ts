import type { RequestHandler } from 'express';

import type { ListEventsQuery } from '../modules/events/events.schemas.js';
import { listUpcomingEvents } from '../modules/events/events.service.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { successResponse } from '../utils/response.js';

export const getEvents: RequestHandler = asyncHandler(async (req, res) => {
  const query = req.query as unknown as ListEventsQuery;
  const result = await listUpcomingEvents(query);

  res.status(200).json(successResponse('Events retrieved successfully.', result));
});
