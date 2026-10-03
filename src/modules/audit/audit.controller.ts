import type { RequestHandler } from 'express';

import { asyncHandler } from '../../utils/asyncHandler.js';
import { successResponse } from '../../utils/response.js';
import { listAuditEvents as listAuditEventsService } from './audit.service.js';
import type { ListAuditEventsQuery } from './audit.schemas.js';

export const getAuditEvents: RequestHandler = asyncHandler(async (req, res) => {
  const query = req.query as unknown as ListAuditEventsQuery;
  const result = await listAuditEventsService(query);

  res.status(200).json(successResponse('Audit events retrieved successfully.', result));
});
