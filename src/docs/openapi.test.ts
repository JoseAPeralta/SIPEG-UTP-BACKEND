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
  'GET /api/v1/users/me',
  'PATCH /api/v1/users/me',
  'GET /api/v1/activities',
  'POST /api/v1/activities',
  'POST /api/v1/event-programs',
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

  it('keeps public operations without bearer security', () => {
    expect(openApiDocument.paths?.['/api/v1/activities']?.get?.security).toBeUndefined();
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

  it('documents rate limiting on the limited auth operations', () => {
    const limitedPaths = [
      '/api/v1/auth/login',
      '/api/v1/auth/register',
      '/api/v1/auth/refresh',
      '/api/v1/auth/forgot-password',
      '/api/v1/auth/reset-password',
    ];

    for (const path of limitedPaths) {
      expect(openApiDocument.paths?.[path]?.post?.responses?.['429']).toBeDefined();
    }
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
});
