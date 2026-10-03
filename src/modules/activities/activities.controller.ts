import type { RequestHandler } from 'express';

import { asyncHandler } from '../../utils/asyncHandler.js';
import { toAuditContext } from '../../utils/audit-context.js';
import { successResponse } from '../../utils/response.js';
import type {
  ActivityParams,
  CancelActivityBody,
  CreateActivityBody,
  EventProgramActivitiesParams,
  ListActivitiesQuery,
  ListEventProgramActivitiesQuery,
  UpdateActivityBody,
} from './activities.schemas.js';
import {
  cancelActivity as cancelActivityService,
  createActivity as createActivityService,
  deleteActivity as deleteActivityService,
  getActivityById,
  listEventProgramActivities as listEventProgramActivitiesService,
  listUpcomingActivities,
  updateActivity as updateActivityService,
} from './activities.service.js';

export const getActivities: RequestHandler = asyncHandler(async (req, res) => {
  const query = req.query as unknown as ListActivitiesQuery;
  const result = await listUpcomingActivities(query);

  res.status(200).json(successResponse('Activities retrieved successfully.', result));
});

export const getEventProgramActivities: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params as EventProgramActivitiesParams;
  const query = req.query as unknown as ListEventProgramActivitiesQuery;
  const result = await listEventProgramActivitiesService(id, query, req.user ?? null);

  res.status(200).json(successResponse('Event program activities retrieved successfully.', result));
});

export const createActivity: RequestHandler = asyncHandler(async (req, res) => {
  const body = req.body as CreateActivityBody;
  const result = await createActivityService(body, toAuditContext(req));

  res.status(201).json(successResponse('Activity created successfully.', result));
});

export const getActivity: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params as ActivityParams;
  const result = await getActivityById(id, req.user);

  res.status(200).json(successResponse('Activity retrieved successfully.', result));
});

export const updateActivity: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params as ActivityParams;
  const body = req.body as UpdateActivityBody;
  const result = await updateActivityService(id, body, toAuditContext(req));

  res.status(200).json(successResponse('Activity updated successfully.', result));
});

export const cancelActivity: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params as ActivityParams;
  const body = req.body as CancelActivityBody;
  const result = await cancelActivityService(id, body.reason, toAuditContext(req));

  res.status(200).json(successResponse('Activity cancelled successfully.', result));
});

export const deleteActivity: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params as ActivityParams;

  await deleteActivityService(id, toAuditContext(req));

  res.status(204).send();
});
