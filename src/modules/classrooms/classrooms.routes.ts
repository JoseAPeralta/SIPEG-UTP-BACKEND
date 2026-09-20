import { Router } from 'express';

import { authenticate } from '../../middlewares/authenticate.middleware.js';
import { requireAdmin } from '../../middlewares/authorize.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import {
  addClassroomAmenity,
  addClassroomAvailability,
  createClassroom,
  getAvailableClassrooms,
  getClassroom,
  getClassrooms,
  removeClassroomAmenity,
  removeClassroomAvailability,
  updateClassroom,
} from './classrooms.controller.js';
import {
  addClassroomAmenitySchema,
  addClassroomAvailabilitySchema,
  availableClassroomsQuerySchema,
  classroomAmenityParamsSchema,
  classroomAvailabilityParamsSchema,
  classroomParamsSchema,
  createClassroomSchema,
  listClassroomsQuerySchema,
  updateClassroomSchema,
} from './classrooms.schemas.js';

export const classroomsRoutes = Router();

classroomsRoutes.get('/classrooms', validate(listClassroomsQuerySchema), getClassrooms);
classroomsRoutes.get(
  '/classrooms/available',
  validate(availableClassroomsQuerySchema),
  getAvailableClassrooms,
);
classroomsRoutes.get('/classrooms/:id', validate(classroomParamsSchema), getClassroom);

classroomsRoutes.post(
  '/classrooms',
  authenticate,
  requireAdmin,
  validate(createClassroomSchema),
  createClassroom,
);

classroomsRoutes.patch(
  '/classrooms/:id',
  authenticate,
  requireAdmin,
  validate(updateClassroomSchema),
  updateClassroom,
);

classroomsRoutes.post(
  '/classrooms/:id/amenities',
  authenticate,
  requireAdmin,
  validate(addClassroomAmenitySchema),
  addClassroomAmenity,
);

classroomsRoutes.delete(
  '/classrooms/:id/amenities/:amenity',
  authenticate,
  requireAdmin,
  validate(classroomAmenityParamsSchema),
  removeClassroomAmenity,
);

classroomsRoutes.post(
  '/classrooms/:id/availability',
  authenticate,
  requireAdmin,
  validate(addClassroomAvailabilitySchema),
  addClassroomAvailability,
);

classroomsRoutes.delete(
  '/classrooms/:id/availability/:availabilityId',
  authenticate,
  requireAdmin,
  validate(classroomAvailabilityParamsSchema),
  removeClassroomAvailability,
);
