import { createDocument, type ZodOpenApiObject } from 'zod-openapi';

import { activitiesPaths } from '../modules/activities/activities.openapi.js';
import { authPaths } from '../modules/auth/auth.openapi.js';
import { eventProgramsPaths } from '../modules/event-programs/event-programs.openapi.js';
import { usersPaths } from '../modules/users/users.openapi.js';
import { healthPaths } from './health.openapi.js';
import { bearerAuthSecurityScheme } from './schemas.js';

const document: ZodOpenApiObject = {
  openapi: '3.1.0',
  info: {
    title: 'SIPEG UTP API',
    version: '1.0.0',
    description:
      'Backend REST API for SIPEG UTP: users, event programs, activities, attendance, certificates, classrooms, speakers and reports.',
  },
  servers: [{ url: 'http://localhost:3000', description: 'Local development' }],
  tags: [
    { name: 'Auth', description: 'Authentication and session flows.' },
    { name: 'Users', description: 'Authenticated user profile.' },
    { name: 'Activities', description: 'Event activities.' },
    { name: 'Event Programs', description: 'Event program management.' },
    { name: 'Health', description: 'Service health.' },
  ],
  paths: {
    ...authPaths,
    ...usersPaths,
    ...activitiesPaths,
    ...eventProgramsPaths,
    ...healthPaths,
  },
  components: {
    securitySchemes: {
      bearerAuth: bearerAuthSecurityScheme,
    },
  },
};

export const openApiDocument = createDocument(document);
