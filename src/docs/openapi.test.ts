import { describe, expect, it } from 'vitest';

import { openApiDocument } from './openapi.js';

const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace'] as const;

const expectedOperations = [
  'POST /api/v1/auth/login',
  'POST /api/v1/auth/register',
  'POST /api/v1/auth/refresh',
  'POST /api/v1/auth/logout',
  'POST /api/v1/auth/verify-email',
  'POST /api/v1/auth/forgot-password',
  'POST /api/v1/auth/reset-password',
  'POST /api/v1/auth/change-password',
  'GET /api/v1/users/me',
  'PATCH /api/v1/users/me',
  'GET /api/v1/admin/users',
  'POST /api/v1/admin/users',
  'GET /api/v1/admin/users/{id}',
  'PATCH /api/v1/admin/users/{id}',
  'GET /api/v1/activities',
  'POST /api/v1/activities',
  'GET /api/v1/activities/{id}/collaborators',
  'POST /api/v1/activities/{id}/collaborators',
  'GET /api/v1/event-programs',
  'POST /api/v1/event-programs',
  'PATCH /api/v1/event-programs/{id}',
  'GET /api/v1/event-programs/{id}/collaborators',
  'POST /api/v1/event-programs/{id}/collaborators',
  'GET /api/v1/organizational-units',
  'POST /api/v1/organizational-units',
  'GET /api/v1/organizational-units/{id}',
  'PATCH /api/v1/organizational-units/{id}',
  'POST /api/v1/organizational-units/{id}/deactivate',
  'POST /api/v1/organizational-units/{id}/reactivate',
  'GET /api/v1/careers',
  'POST /api/v1/careers',
  'PATCH /api/v1/careers/{id}',
  'DELETE /api/v1/careers/{id}',
  'GET /api/v1/classrooms',
  'POST /api/v1/classrooms',
  'GET /api/v1/classrooms/available',
  'GET /api/v1/classrooms/{id}',
  'PATCH /api/v1/classrooms/{id}',
  'POST /api/v1/classrooms/{id}/amenities',
  'DELETE /api/v1/classrooms/{id}/amenities/{amenity}',
  'POST /api/v1/classrooms/{id}/availability',
  'DELETE /api/v1/classrooms/{id}/availability/{availabilityId}',
  'GET /api/v1/health',
].sort();

const documentedOperations = (): string[] => {
  const operations: string[] = [];

  for (const [path, pathItem] of Object.entries(openApiDocument.paths ?? {})) {
    for (const method of HTTP_METHODS) {
      if (pathItem[method]) {
        operations.push(`${method.toUpperCase()} ${path}`);
      }
    }
  }

  return operations.sort();
};

describe('openApiDocument', () => {
  it('declares OpenAPI 3.1', () => {
    expect(openApiDocument.openapi).toBe('3.1.0');
  });

  it('contains exactly the expected operations', () => {
    expect(documentedOperations()).toEqual(expectedOperations);
  });

  it('marks the private user operations with bearer security', () => {
    const pathItem = openApiDocument.paths?.['/api/v1/users/me'];

    expect(pathItem?.get?.security).toEqual([{ bearerAuth: [] }]);
    expect(pathItem?.patch?.security).toEqual([{ bearerAuth: [] }]);
  });

  it('documents the Otros career conflict on profile update', () => {
    const pathItem = openApiDocument.paths?.['/api/v1/users/me'];

    expect(pathItem?.patch?.responses?.['409']).toBeDefined();
  });

  it('keeps public operations without bearer security', () => {
    expect(openApiDocument.paths?.['/api/v1/activities']?.get?.security).toBeUndefined();
    expect(openApiDocument.paths?.['/api/v1/event-programs']?.get?.security).toBeUndefined();
    expect(openApiDocument.paths?.['/api/v1/health']?.get?.security).toBeUndefined();
  });

  it('marks the create activity operation with bearer security and a 201 response', () => {
    const operation = openApiDocument.paths?.['/api/v1/activities']?.post;

    expect(operation?.security).toEqual([{ bearerAuth: [] }]);
    expect(operation?.responses?.['201']).toBeDefined();
    expect(openApiDocument.components?.schemas).toHaveProperty('ActivityDetail');
  });

  it('marks event program creation with bearer security and a 201 response', () => {
    const operation = openApiDocument.paths?.['/api/v1/event-programs']?.post;

    expect(operation?.security).toEqual([{ bearerAuth: [] }]);
    expect(operation?.responses?.['201']).toBeDefined();
    expect(openApiDocument.components?.schemas).toHaveProperty('EventProgramDetail');
  });

  it('marks event program update with bearer security, a path param and a 200 response', () => {
    const operation = openApiDocument.paths?.['/api/v1/event-programs/{id}']?.patch;
    const parameters = operation?.parameters ?? [];
    const names = parameters.map((parameter) => ('name' in parameter ? parameter.name : undefined));

    expect(operation?.security).toEqual([{ bearerAuth: [] }]);
    expect(names).toContain('id');
    expect(operation?.responses?.['200']).toBeDefined();
    expect(operation?.responses?.['409']).toBeDefined();
  });

  it('documents collaborator delegation with bearer security and conflict responses', () => {
    const programPost = openApiDocument.paths?.['/api/v1/event-programs/{id}/collaborators']?.post;
    const programGet = openApiDocument.paths?.['/api/v1/event-programs/{id}/collaborators']?.get;
    const activityGet = openApiDocument.paths?.['/api/v1/activities/{id}/collaborators']?.get;

    expect(programPost?.security).toEqual([{ bearerAuth: [] }]);
    expect(programPost?.responses?.['201']).toBeDefined();
    expect(programPost?.responses?.['409']).toBeDefined();
    expect(programGet?.security).toEqual([{ bearerAuth: [] }]);
    expect(activityGet?.security).toEqual([{ bearerAuth: [] }]);
    expect(openApiDocument.components?.schemas).toHaveProperty('Collaborator');
    expect(openApiDocument.components?.schemas).toHaveProperty('CollaboratorPermission');
    expect(openApiDocument.components?.schemas).toHaveProperty('CollaboratorList');
  });

  it('documents rate limiting on the limited auth operations', () => {
    const limitedPaths = [
      '/api/v1/auth/login',
      '/api/v1/auth/register',
      '/api/v1/auth/refresh',
      '/api/v1/auth/verify-email',
      '/api/v1/auth/forgot-password',
      '/api/v1/auth/reset-password',
      '/api/v1/auth/change-password',
    ];

    for (const path of limitedPaths) {
      expect(openApiDocument.paths?.[path]?.post?.responses?.['429']).toBeDefined();
    }
  });

  it('documents email verification and password reset failures', () => {
    const loginResponses = openApiDocument.paths?.['/api/v1/auth/login']?.post?.responses;
    const verificationResponses =
      openApiDocument.paths?.['/api/v1/auth/verify-email']?.post?.responses;
    const resetResponses = openApiDocument.paths?.['/api/v1/auth/reset-password']?.post?.responses;

    expect(loginResponses?.['403']).toBeDefined();
    expect(verificationResponses?.['400']).toBeDefined();
    expect(verificationResponses?.['429']).toBeDefined();
    expect(resetResponses?.['400']).toBeDefined();
    expect(resetResponses?.['429']).toBeDefined();
  });

  it('marks change password with bearer security and documents its failures', () => {
    const operation = openApiDocument.paths?.['/api/v1/auth/change-password']?.post;

    expect(operation?.security).toEqual([{ bearerAuth: [] }]);
    expect(operation?.responses?.['200']).toBeDefined();
    expect(operation?.responses?.['400']).toBeDefined();
    expect(operation?.responses?.['401']).toBeDefined();
    expect(operation?.responses?.['403']).toBeDefined();
    expect(operation?.responses?.['429']).toBeDefined();
  });

  it('registers the shared envelope and security components', () => {
    expect(openApiDocument.components?.schemas).toHaveProperty('ApiErrorResponse');
    expect(openApiDocument.components?.schemas).toHaveProperty('ValidationIssue');
    expect(openApiDocument.components?.securitySchemes).toHaveProperty('bearerAuth');
  });

  it('documents the activity pagination query parameters', () => {
    const parameters = openApiDocument.paths?.['/api/v1/activities']?.get?.parameters ?? [];
    const names = parameters.map((parameter) => ('name' in parameter ? parameter.name : undefined));

    expect(names).toContain('page');
    expect(names).toContain('limit');
  });

  it('documents the event program list query parameters', () => {
    const parameters = openApiDocument.paths?.['/api/v1/event-programs']?.get?.parameters ?? [];
    const names = parameters.map((parameter) => ('name' in parameter ? parameter.name : undefined));

    expect(names).toEqual(
      expect.arrayContaining(['page', 'limit', 'organizationalUnitId', 'unitType', 'q']),
    );
    expect(openApiDocument.components?.schemas).toHaveProperty('PaginatedEventPrograms');
  });

  it('marks the admin user list with bearer security and a paginated response', () => {
    const operation = openApiDocument.paths?.['/api/v1/admin/users']?.get;

    expect(operation?.security).toEqual([{ bearerAuth: [] }]);
    expect(operation?.responses?.['200']).toBeDefined();
    expect(operation?.responses?.['401']).toBeDefined();
    expect(operation?.responses?.['403']).toBeDefined();
    expect(openApiDocument.components?.schemas).toHaveProperty('AdminUser');
    expect(openApiDocument.components?.schemas).toHaveProperty('PaginatedUsers');
  });

  it('documents the admin user list query parameters', () => {
    const parameters = openApiDocument.paths?.['/api/v1/admin/users']?.get?.parameters ?? [];
    const names = parameters.map((parameter) => ('name' in parameter ? parameter.name : undefined));

    expect(names).toEqual(
      expect.arrayContaining([
        'page',
        'limit',
        'globalRole',
        'isActive',
        'unitId',
        'careerId',
        'q',
      ]),
    );
  });

  it('marks the admin user detail with bearer security and a 404 response', () => {
    const operation = openApiDocument.paths?.['/api/v1/admin/users/{id}']?.get;

    expect(operation?.security).toEqual([{ bearerAuth: [] }]);
    expect(operation?.responses?.['200']).toBeDefined();
    expect(operation?.responses?.['401']).toBeDefined();
    expect(operation?.responses?.['403']).toBeDefined();
    expect(operation?.responses?.['404']).toBeDefined();
    expect(openApiDocument.components?.schemas).toHaveProperty('AdminUser');
  });

  it('documents the admin user detail path parameter', () => {
    const parameters = openApiDocument.paths?.['/api/v1/admin/users/{id}']?.get?.parameters ?? [];
    const names = parameters.map((parameter) => ('name' in parameter ? parameter.name : undefined));

    expect(names).toContain('id');
  });

  it('marks admin user creation with bearer security and a 201 response', () => {
    const operation = openApiDocument.paths?.['/api/v1/admin/users']?.post;

    expect(operation?.security).toEqual([{ bearerAuth: [] }]);
    expect(operation?.responses?.['201']).toBeDefined();
    expect(operation?.responses?.['400']).toBeDefined();
    expect(operation?.responses?.['401']).toBeDefined();
    expect(operation?.responses?.['403']).toBeDefined();
    expect(operation?.responses?.['409']).toBeDefined();
    expect(openApiDocument.components?.schemas).toHaveProperty('AdminUserCreate');
  });

  it('documents the admin user creation body', () => {
    const schema = openApiDocument.components?.schemas?.['AdminUserCreate'] as
      { properties?: Record<string, unknown>; required?: string[] } | undefined;

    expect(schema?.properties).toHaveProperty('email');
    expect(schema?.properties).toHaveProperty('password');
    expect(schema?.properties).toHaveProperty('unitId');
    expect(schema?.required).toEqual(
      expect.arrayContaining([
        'email',
        'password',
        'firstName',
        'lastName',
        'identificationNumber',
      ]),
    );
  });

  it('keeps public organizational unit reads without bearer security', () => {
    expect(openApiDocument.paths?.['/api/v1/organizational-units']?.get?.security).toBeUndefined();
    expect(
      openApiDocument.paths?.['/api/v1/organizational-units/{id}']?.get?.security,
    ).toBeUndefined();
  });

  it('marks organizational unit management with bearer security', () => {
    const collection = openApiDocument.paths?.['/api/v1/organizational-units'];
    const detail = openApiDocument.paths?.['/api/v1/organizational-units/{id}'];
    const deactivate =
      openApiDocument.paths?.['/api/v1/organizational-units/{id}/deactivate']?.post;
    const reactivate =
      openApiDocument.paths?.['/api/v1/organizational-units/{id}/reactivate']?.post;

    expect(collection?.post?.security).toEqual([{ bearerAuth: [] }]);
    expect(detail?.patch?.security).toEqual([{ bearerAuth: [] }]);
    expect(deactivate?.security).toEqual([{ bearerAuth: [] }]);
    expect(reactivate?.security).toEqual([{ bearerAuth: [] }]);
    expect(collection?.post?.responses?.['201']).toBeDefined();
    expect(collection?.post?.responses?.['409']).toBeDefined();
    expect(deactivate?.responses?.['409']).toBeDefined();
    expect(reactivate?.responses?.['409']).toBeDefined();
  });

  it('documents the organizational unit components and params', () => {
    expect(openApiDocument.components?.schemas).toHaveProperty('OrganizationalUnitSummary');
    expect(openApiDocument.components?.schemas).toHaveProperty('OrganizationalUnitDetail');
    expect(openApiDocument.components?.schemas).toHaveProperty('PaginatedOrganizationalUnits');

    const listParameters =
      openApiDocument.paths?.['/api/v1/organizational-units']?.get?.parameters ?? [];
    const listNames = listParameters.map((parameter) =>
      'name' in parameter ? parameter.name : undefined,
    );

    expect(listNames).toEqual(expect.arrayContaining(['page', 'limit', 'type', 'isActive', 'q']));

    const detailParameters =
      openApiDocument.paths?.['/api/v1/organizational-units/{id}']?.patch?.parameters ?? [];
    const detailNames = detailParameters.map((parameter) =>
      'name' in parameter ? parameter.name : undefined,
    );

    expect(detailNames).toContain('id');
  });

  it('marks the admin user update with bearer security and conflict responses', () => {
    const operation = openApiDocument.paths?.['/api/v1/admin/users/{id}']?.patch;

    expect(operation?.security).toEqual([{ bearerAuth: [] }]);
    expect(operation?.responses?.['200']).toBeDefined();
    expect(operation?.responses?.['400']).toBeDefined();
    expect(operation?.responses?.['401']).toBeDefined();
    expect(operation?.responses?.['403']).toBeDefined();
    expect(operation?.responses?.['404']).toBeDefined();
    expect(operation?.responses?.['409']).toBeDefined();
    expect(openApiDocument.components?.schemas).toHaveProperty('AdminUser');
  });

  it('documents the admin user update path parameter and request body', () => {
    const operation = openApiDocument.paths?.['/api/v1/admin/users/{id}']?.patch;
    const parameters = operation?.parameters ?? [];
    const names = parameters.map((parameter) => ('name' in parameter ? parameter.name : undefined));

    expect(names).toContain('id');
    expect(operation?.requestBody).toBeDefined();
  });

  it('keeps public career reads without bearer security', () => {
    expect(openApiDocument.paths?.['/api/v1/careers']?.get?.security).toBeUndefined();
  });

  it('marks career management with bearer security and the delete 204', () => {
    const collection = openApiDocument.paths?.['/api/v1/careers'];
    const detail = openApiDocument.paths?.['/api/v1/careers/{id}'];

    expect(collection?.post?.security).toEqual([{ bearerAuth: [] }]);
    expect(collection?.post?.responses?.['201']).toBeDefined();
    expect(collection?.post?.responses?.['409']).toBeDefined();
    expect(detail?.patch?.security).toEqual([{ bearerAuth: [] }]);
    expect(detail?.delete?.security).toEqual([{ bearerAuth: [] }]);
    expect(detail?.delete?.responses?.['204']).toBeDefined();
    expect(detail?.delete?.responses?.['409']).toBeDefined();
  });

  it('documents the career components and query params', () => {
    expect(openApiDocument.components?.schemas).toHaveProperty('CareerUnit');
    expect(openApiDocument.components?.schemas).toHaveProperty('CareerSummary');
    expect(openApiDocument.components?.schemas).toHaveProperty('PaginatedCareers');

    const listParameters = openApiDocument.paths?.['/api/v1/careers']?.get?.parameters ?? [];
    const listNames = listParameters.map((parameter) =>
      'name' in parameter ? parameter.name : undefined,
    );

    expect(listNames).toEqual(expect.arrayContaining(['page', 'limit', 'unitId', 'q']));

    const deleteParameters =
      openApiDocument.paths?.['/api/v1/careers/{id}']?.delete?.parameters ?? [];
    const deleteNames = deleteParameters.map((parameter) =>
      'name' in parameter ? parameter.name : undefined,
    );

    expect(deleteNames).toContain('id');
  });

  it('keeps public classroom reads without bearer security', () => {
    expect(openApiDocument.paths?.['/api/v1/classrooms']?.get?.security).toBeUndefined();
    expect(openApiDocument.paths?.['/api/v1/classrooms/available']?.get?.security).toBeUndefined();
    expect(openApiDocument.paths?.['/api/v1/classrooms/{id}']?.get?.security).toBeUndefined();
  });

  it('marks classroom management with bearer security and conflict responses', () => {
    const collection = openApiDocument.paths?.['/api/v1/classrooms'];
    const detail = openApiDocument.paths?.['/api/v1/classrooms/{id}'];
    const amenities = openApiDocument.paths?.['/api/v1/classrooms/{id}/amenities'];
    const amenity = openApiDocument.paths?.['/api/v1/classrooms/{id}/amenities/{amenity}'];
    const availability = openApiDocument.paths?.['/api/v1/classrooms/{id}/availability'];
    const availabilityItem =
      openApiDocument.paths?.['/api/v1/classrooms/{id}/availability/{availabilityId}'];

    expect(collection?.post?.security).toEqual([{ bearerAuth: [] }]);
    expect(collection?.post?.responses?.['201']).toBeDefined();
    expect(detail?.patch?.security).toEqual([{ bearerAuth: [] }]);
    expect(detail?.patch?.responses?.['409']).toBeDefined();
    expect(amenities?.post?.security).toEqual([{ bearerAuth: [] }]);
    expect(amenities?.post?.responses?.['201']).toBeDefined();
    expect(amenities?.post?.responses?.['409']).toBeDefined();
    expect(amenity?.delete?.security).toEqual([{ bearerAuth: [] }]);
    expect(amenity?.delete?.responses?.['200']).toBeDefined();
    expect(availability?.post?.security).toEqual([{ bearerAuth: [] }]);
    expect(availability?.post?.responses?.['201']).toBeDefined();
    expect(availability?.post?.responses?.['409']).toBeDefined();
    expect(availabilityItem?.delete?.security).toEqual([{ bearerAuth: [] }]);
    expect(availabilityItem?.delete?.responses?.['200']).toBeDefined();
  });

  it('documents the classroom components and query params', () => {
    expect(openApiDocument.components?.schemas).toHaveProperty('ClassroomSummary');
    expect(openApiDocument.components?.schemas).toHaveProperty('ClassroomDetail');
    expect(openApiDocument.components?.schemas).toHaveProperty('ClassroomAvailability');
    expect(openApiDocument.components?.schemas).toHaveProperty('PaginatedClassrooms');

    const listParameters = openApiDocument.paths?.['/api/v1/classrooms']?.get?.parameters ?? [];
    const listNames = listParameters.map((parameter) =>
      'name' in parameter ? parameter.name : undefined,
    );

    expect(listNames).toEqual(
      expect.arrayContaining(['page', 'limit', 'type', 'minCapacity', 'amenity', 'isActive']),
    );

    const availableParameters =
      openApiDocument.paths?.['/api/v1/classrooms/available']?.get?.parameters ?? [];
    const availableNames = availableParameters.map((parameter) =>
      'name' in parameter ? parameter.name : undefined,
    );

    expect(availableNames).toEqual(
      expect.arrayContaining(['date', 'startTime', 'endTime', 'minCapacity', 'type', 'amenity']),
    );
  });
});
