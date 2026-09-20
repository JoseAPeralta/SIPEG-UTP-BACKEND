import type { RequestHandler } from 'express';

import { asyncHandler } from '../../utils/asyncHandler.js';
import { successResponse } from '../../utils/response.js';
import type { CreateCareerBody, ListCareersQuery, UpdateCareerBody } from './careers.schemas.js';
import {
  createCareer as createCareerService,
  deleteCareer as deleteCareerService,
  listCareers as listCareersService,
  updateCareer as updateCareerService,
} from './careers.service.js';

export const getCareers: RequestHandler = asyncHandler(async (req, res) => {
  const query = req.query as unknown as ListCareersQuery;
  const result = await listCareersService(query);

  res.status(200).json(successResponse('Careers retrieved successfully.', result));
});

export const createCareer: RequestHandler = asyncHandler(async (req, res) => {
  const body = req.body as CreateCareerBody;
  const result = await createCareerService(body);

  res.status(201).json(successResponse('Career created successfully.', result));
});

export const updateCareer: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params as { id: string };
  const body = req.body as UpdateCareerBody;
  const result = await updateCareerService(id, body);

  res.status(200).json(successResponse('Career updated successfully.', result));
});

export const deleteCareer: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params as { id: string };
  await deleteCareerService(id);

  res.status(204).send();
});
