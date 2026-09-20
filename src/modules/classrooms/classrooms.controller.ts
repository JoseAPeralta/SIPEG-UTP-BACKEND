import type { RequestHandler } from 'express';

import { asyncHandler } from '../../utils/asyncHandler.js';
import { successResponse } from '../../utils/response.js';
import type {
  AddClassroomAmenityBody,
  AddClassroomAvailabilityBody,
  AvailableClassroomsQuery,
  ClassroomAmenityParams,
  ClassroomAvailabilityParams,
  CreateClassroomBody,
  ListClassroomsQuery,
  UpdateClassroomBody,
} from './classrooms.schemas.js';
import {
  addClassroomAmenity as addClassroomAmenityService,
  addClassroomAvailability as addClassroomAvailabilityService,
  createClassroom as createClassroomService,
  findAvailableClassrooms,
  getClassroomById,
  listClassrooms as listClassroomsService,
  removeClassroomAmenity as removeClassroomAmenityService,
  removeClassroomAvailability as removeClassroomAvailabilityService,
  updateClassroom as updateClassroomService,
} from './classrooms.service.js';

export const getClassrooms: RequestHandler = asyncHandler(async (req, res) => {
  const query = req.query as unknown as ListClassroomsQuery;
  const result = await listClassroomsService(query);

  res.status(200).json(successResponse('Classrooms retrieved successfully.', result));
});

export const getAvailableClassrooms: RequestHandler = asyncHandler(async (req, res) => {
  const query = req.query as unknown as AvailableClassroomsQuery;
  const result = await findAvailableClassrooms(query);

  res.status(200).json(successResponse('Available classrooms retrieved successfully.', result));
});

export const getClassroom: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params as { id: string };
  const result = await getClassroomById(id);

  res.status(200).json(successResponse('Classroom retrieved successfully.', result));
});

export const createClassroom: RequestHandler = asyncHandler(async (req, res) => {
  const body = req.body as CreateClassroomBody;
  const result = await createClassroomService(body);

  res.status(201).json(successResponse('Classroom created successfully.', result));
});

export const updateClassroom: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params as { id: string };
  const body = req.body as UpdateClassroomBody;
  const result = await updateClassroomService(id, body);

  res.status(200).json(successResponse('Classroom updated successfully.', result));
});

export const addClassroomAmenity: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params as { id: string };
  const body = req.body as AddClassroomAmenityBody;
  const result = await addClassroomAmenityService(id, body.amenity);

  res.status(201).json(successResponse('Classroom amenity added successfully.', result));
});

export const removeClassroomAmenity: RequestHandler = asyncHandler(async (req, res) => {
  const { id, amenity } = req.params as ClassroomAmenityParams;
  const result = await removeClassroomAmenityService(id, amenity);

  res.status(200).json(successResponse('Classroom amenity removed successfully.', result));
});

export const addClassroomAvailability: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params as { id: string };
  const body = req.body as AddClassroomAvailabilityBody;
  const result = await addClassroomAvailabilityService(id, body);

  res.status(201).json(successResponse('Classroom availability added successfully.', result));
});

export const removeClassroomAvailability: RequestHandler = asyncHandler(async (req, res) => {
  const { id, availabilityId } = req.params as ClassroomAvailabilityParams;
  const result = await removeClassroomAvailabilityService(id, availabilityId);

  res.status(200).json(successResponse('Classroom availability removed successfully.', result));
});
