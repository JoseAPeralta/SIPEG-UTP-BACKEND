import { requireAuthenticatedUser } from '../../middlewares/authenticate.middleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { successResponse } from '../../utils/response.js';
import type { ListAlertsQuery } from './alerts.schemas.js';
import { getAlertById, listAlerts, markAlertRead, markAllAlertsRead } from './alerts.service.js';

export const getAlerts = asyncHandler(async (req, res) => {
  const user = requireAuthenticatedUser(req);
  const query = req.query as unknown as ListAlertsQuery;
  const result = await listAlerts(user.id, query);

  res.status(200).json(successResponse('Alerts retrieved successfully.', result));
});

export const getAlert = asyncHandler(async (req, res) => {
  const user = requireAuthenticatedUser(req);
  const { id } = req.params as { id: string };
  const alert = await getAlertById(user.id, id);

  res.status(200).json(successResponse('Alert retrieved successfully.', alert));
});

export const markAlertAsRead = asyncHandler(async (req, res) => {
  const user = requireAuthenticatedUser(req);
  const { id } = req.params as { id: string };
  const alert = await markAlertRead(user.id, id);

  res.status(200).json(successResponse('Alert marked as read successfully.', alert));
});

export const markAllAlertsAsRead = asyncHandler(async (req, res) => {
  const user = requireAuthenticatedUser(req);
  const result = await markAllAlertsRead(user.id);

  res.status(200).json(successResponse('Alerts marked as read successfully.', result));
});
