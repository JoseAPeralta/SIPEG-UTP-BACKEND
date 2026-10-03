import { describe, expect, it } from 'vitest';

import {
  addCollaboratorSchema,
  collaboratorListSchema,
  collaboratorParamsSchema,
  collaboratorUserParamsSchema,
  grantPermissionSchema,
  ownPermissionsQuerySchema,
  ownPermissionsSchema,
  revokePermissionSchema,
  updateCollaboratorRoleSchema,
} from './authorization.schemas.js';

describe('collaborator request schemas', () => {
  it('trims the scope identifier', () => {
    const parsed = collaboratorParamsSchema.parse({ params: { id: '  program-001  ' } });

    expect(parsed.params.id).toBe('program-001');
  });

  it('rejects a blank scope identifier', () => {
    expect(() => collaboratorParamsSchema.parse({ params: { id: '   ' } })).toThrow();
  });

  it('rejects a scope identifier longer than 100 characters', () => {
    expect(() => collaboratorParamsSchema.parse({ params: { id: 'a'.repeat(101) } })).toThrow();
  });

  it('parses a collaborator payload with a known role', () => {
    const parsed = addCollaboratorSchema.parse({
      params: { id: 'program-001' },
      body: { userId: ' user-002 ', role: 'EDITOR' },
    });

    expect(parsed.body).toEqual({ userId: 'user-002', role: 'EDITOR' });
  });

  it('rejects an unknown role', () => {
    expect(() =>
      addCollaboratorSchema.parse({
        params: { id: 'p1' },
        body: { userId: 'user-002', role: 'OWNER' },
      }),
    ).toThrow();
  });

  it('rejects a missing user', () => {
    expect(() =>
      addCollaboratorSchema.parse({ params: { id: 'p1' }, body: { role: 'VIEWER' } }),
    ).toThrow();
  });

  it('rejects unknown body keys', () => {
    expect(() =>
      addCollaboratorSchema.parse({
        params: { id: 'p1' },
        body: { userId: 'user-002', role: 'VIEWER', permissions: ['activity:read'] },
      }),
    ).toThrow();
  });
});

describe('collaborator user params schema', () => {
  it('trims the scope and user identifiers', () => {
    const parsed = collaboratorUserParamsSchema.parse({
      params: { id: '  program-001  ', userId: '  user-002  ' },
    });

    expect(parsed.params).toEqual({ id: 'program-001', userId: 'user-002' });
  });

  it('rejects a blank user identifier', () => {
    expect(() =>
      collaboratorUserParamsSchema.parse({ params: { id: 'p1', userId: '   ' } }),
    ).toThrow();
  });

  it('rejects a user identifier longer than 100 characters', () => {
    expect(() =>
      collaboratorUserParamsSchema.parse({ params: { id: 'p1', userId: 'a'.repeat(101) } }),
    ).toThrow();
  });
});

describe('update collaborator role schema', () => {
  it('trims the scope and user identifiers', () => {
    const parsed = updateCollaboratorRoleSchema.parse({
      params: { id: '  program-001  ', userId: '  user-002  ' },
      body: { role: 'EDITOR' },
    });

    expect(parsed.params).toEqual({ id: 'program-001', userId: 'user-002' });
    expect(parsed.body).toEqual({ role: 'EDITOR' });
  });

  it('rejects a blank user identifier', () => {
    expect(() =>
      updateCollaboratorRoleSchema.parse({
        params: { id: 'p1', userId: '   ' },
        body: { role: 'EDITOR' },
      }),
    ).toThrow();
  });

  it('rejects a user identifier longer than 100 characters', () => {
    expect(() =>
      updateCollaboratorRoleSchema.parse({
        params: { id: 'p1', userId: 'a'.repeat(101) },
        body: { role: 'EDITOR' },
      }),
    ).toThrow();
  });

  it('rejects an unknown role', () => {
    expect(() =>
      updateCollaboratorRoleSchema.parse({
        params: { id: 'p1', userId: 'user-002' },
        body: { role: 'OWNER' },
      }),
    ).toThrow();
  });

  it('rejects a missing role', () => {
    expect(() =>
      updateCollaboratorRoleSchema.parse({
        params: { id: 'p1', userId: 'user-002' },
        body: {},
      }),
    ).toThrow();
  });

  it('rejects unknown body keys', () => {
    expect(() =>
      updateCollaboratorRoleSchema.parse({
        params: { id: 'p1', userId: 'user-002' },
        body: { role: 'EDITOR', validUntil: '2026-12-31T00:00:00.000Z' },
      }),
    ).toThrow();
  });
});

describe('grant permission schema', () => {
  const body = {
    userId: 'user-002',
    permission: 'report:export',
    validFrom: '2026-09-20T00:00:00.000Z',
    validUntil: '2026-10-20T00:00:00.000Z',
  };

  it('trims the scope identifier and parses the windows into dates', () => {
    const parsed = grantPermissionSchema.parse({ params: { id: '  program-001  ' }, body });

    expect(parsed.params.id).toBe('program-001');
    expect(parsed.body.validFrom).toEqual(new Date('2026-09-20T00:00:00.000Z'));
    expect(parsed.body.validUntil).toEqual(new Date('2026-10-20T00:00:00.000Z'));
  });

  it('accepts an offset datetime and explicit null windows', () => {
    const parsed = grantPermissionSchema.parse({
      params: { id: 'p1' },
      body: {
        userId: 'user-002',
        permission: 'activity:read',
        validFrom: '2026-09-20T00:00:00-05:00',
        validUntil: null,
      },
    });

    expect(parsed.body.validFrom).toEqual(new Date('2026-09-20T05:00:00.000Z'));
    expect(parsed.body.validUntil).toBeNull();
  });

  it('rejects an unknown permission', () => {
    expect(() =>
      grantPermissionSchema.parse({
        params: { id: 'p1' },
        body: { ...body, permission: 'nope:nope' },
      }),
    ).toThrow();
  });

  it('rejects a malformed window', () => {
    expect(() =>
      grantPermissionSchema.parse({
        params: { id: 'p1' },
        body: { ...body, validUntil: 'tomorrow' },
      }),
    ).toThrow();
  });

  it('rejects unknown body keys', () => {
    expect(() =>
      grantPermissionSchema.parse({
        params: { id: 'p1' },
        body: { ...body, grantedById: 'admin-001' },
      }),
    ).toThrow();
  });

  it('rejects a blank user identifier', () => {
    expect(() =>
      grantPermissionSchema.parse({ params: { id: 'p1' }, body: { ...body, userId: '   ' } }),
    ).toThrow();
  });
});

describe('revoke permission schema', () => {
  it('parses the scope, the permission and the user query', () => {
    const parsed = revokePermissionSchema.parse({
      params: { id: '  program-001  ', permission: 'report:export' },
      query: { userId: ' user-002 ' },
    });

    expect(parsed.params).toEqual({ id: 'program-001', permission: 'report:export' });
    expect(parsed.query).toEqual({ userId: 'user-002' });
  });

  it('rejects an unknown permission', () => {
    expect(() =>
      revokePermissionSchema.parse({
        params: { id: 'p1', permission: 'nope:nope' },
        query: { userId: 'user-002' },
      }),
    ).toThrow();
  });

  it('rejects a blank user query', () => {
    expect(() =>
      revokePermissionSchema.parse({
        params: { id: 'p1', permission: 'report:export' },
        query: { userId: '   ' },
      }),
    ).toThrow();
  });

  it('rejects a missing user query', () => {
    expect(() =>
      revokePermissionSchema.parse({
        params: { id: 'p1', permission: 'report:export' },
        query: {},
      }),
    ).toThrow();
  });

  it('rejects unknown query keys', () => {
    expect(() =>
      revokePermissionSchema.parse({
        params: { id: 'p1', permission: 'report:export' },
        query: { userId: 'user-002', grantedById: 'admin-001' },
      }),
    ).toThrow();
  });
});

describe('own permissions query schema', () => {
  it('trims the scope identifier', () => {
    const parsed = ownPermissionsQuerySchema.parse({
      query: { scope: 'program', id: '  program-001  ' },
    });

    expect(parsed.query).toEqual({ scope: 'program', id: 'program-001' });
  });

  it('accepts the activity scope', () => {
    const parsed = ownPermissionsQuerySchema.parse({
      query: { scope: 'activity', id: 'activity-001' },
    });

    expect(parsed.query.scope).toBe('activity');
  });

  it('rejects an unknown scope', () => {
    expect(() => ownPermissionsQuerySchema.parse({ query: { scope: 'team', id: 'p1' } })).toThrow();
  });

  it('rejects a missing identifier', () => {
    expect(() => ownPermissionsQuerySchema.parse({ query: { scope: 'program' } })).toThrow();
  });

  it('rejects a blank identifier', () => {
    expect(() =>
      ownPermissionsQuerySchema.parse({ query: { scope: 'program', id: '   ' } }),
    ).toThrow();
  });

  it('rejects unknown query keys', () => {
    expect(() =>
      ownPermissionsQuerySchema.parse({
        query: { scope: 'program', id: 'p1', userId: 'user-002' },
      }),
    ).toThrow();
  });
});

describe('collaborator list response schema', () => {
  it('accepts permission entries with provenance and effective flag', () => {
    const parsed = collaboratorListSchema.parse({
      items: [
        {
          userId: 'user-002',
          firstName: 'Ada',
          lastName: 'Lovelace',
          email: 'ada@example.com',
          role: 'VIEWER',
          createdAt: '2026-09-19T12:00:00.000Z',
          permissions: [
            {
              name: 'activity:read',
              source: 'ROLE_DEFAULT',
              origin: 'INHERITED',
              validFrom: null,
              validUntil: null,
              effective: true,
            },
          ],
        },
      ],
    });

    expect(parsed.items[0]?.permissions[0]).toEqual({
      name: 'activity:read',
      source: 'ROLE_DEFAULT',
      origin: 'INHERITED',
      validFrom: null,
      validUntil: null,
      effective: true,
    });
  });

  it('rejects an unknown origin', () => {
    expect(() =>
      collaboratorListSchema.parse({
        items: [
          {
            userId: 'user-002',
            firstName: 'Ada',
            lastName: 'Lovelace',
            email: 'ada@example.com',
            role: 'VIEWER',
            createdAt: '2026-09-19T12:00:00.000Z',
            permissions: [
              {
                name: 'activity:read',
                source: 'ROLE_DEFAULT',
                origin: 'REMOTE',
                validFrom: null,
                validUntil: null,
                effective: true,
              },
            ],
          },
        ],
      }),
    ).toThrow();
  });
});

describe('own permissions response schema', () => {
  it('accepts permission entries with origin', () => {
    const parsed = ownPermissionsSchema.parse({
      scope: { type: 'activity', id: 'activity-001' },
      permissions: [{ name: 'activity:read', origin: 'LOCAL', validFrom: null, validUntil: null }],
    });

    expect(parsed.permissions[0]?.origin).toBe('LOCAL');
  });

  it('rejects a permission without origin', () => {
    expect(() =>
      ownPermissionsSchema.parse({
        scope: { type: 'program', id: 'program-001' },
        permissions: [{ name: 'activity:read', validFrom: null, validUntil: null }],
      }),
    ).toThrow();
  });
});
