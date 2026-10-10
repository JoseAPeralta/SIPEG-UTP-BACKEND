import { z } from 'zod';

import type {
  CollaboratorDetail,
  CollaboratorList,
  CollaboratorListDetail,
  OwnPermissions,
  PaginatedUserScopes,
  UserScopeItem,
} from './authorization.types.js';
import { PERMISSION_NAMES } from './permissions.js';

const scopeIdSchema = z
  .string()
  .trim()
  .min(1, 'Event program or activity id is required.')
  .max(100, 'Identifier cannot exceed 100 characters.');

const userIdSchema = z
  .string()
  .trim()
  .min(1, 'User is required.')
  .max(100, 'User identifier cannot exceed 100 characters.');

export const collaboratorParamsSchema = z.object({
  params: z.object({ id: scopeIdSchema }),
});

export const addCollaboratorSchema = z.object({
  params: z.object({ id: scopeIdSchema }),
  body: z
    .object({
      userId: userIdSchema,
      role: z.enum(['VIEWER', 'EDITOR', 'ORGANIZER'], 'Role is invalid.'),
    })
    .strict(),
});

export type AddCollaboratorBody = z.infer<typeof addCollaboratorSchema>['body'];

export const collaboratorUserParamsSchema = z.object({
  params: z.object({ id: scopeIdSchema, userId: userIdSchema }),
});

export const updateCollaboratorRoleSchema = z.object({
  params: collaboratorUserParamsSchema.shape.params,
  body: z
    .object({
      role: z.enum(['VIEWER', 'EDITOR', 'ORGANIZER'], 'Role is invalid.'),
    })
    .strict(),
});

export type UpdateCollaboratorRoleBody = z.infer<typeof updateCollaboratorRoleSchema>['body'];

const grantWindowSchema = z.iso
  .datetime({ offset: true, error: 'Grant window must be an ISO 8601 datetime.' })
  .transform((value) => new Date(value));

export const grantPermissionSchema = z.object({
  params: z.object({ id: scopeIdSchema }),
  body: z
    .object({
      userId: userIdSchema,
      permission: z.enum(PERMISSION_NAMES, 'Permission is invalid.'),
      validFrom: grantWindowSchema.nullable().optional(),
      validUntil: grantWindowSchema.nullable().optional(),
    })
    .strict(),
});

export type GrantPermissionBody = z.infer<typeof grantPermissionSchema>['body'];

export const revokePermissionSchema = z.object({
  params: z.object({
    id: scopeIdSchema,
    permission: z.enum(PERMISSION_NAMES, 'Permission is invalid.'),
  }),
  query: z.object({ userId: userIdSchema }).strict(),
});

const collaboratorPermissionSchema = z
  .object({
    name: z.string(),
    source: z.enum(['ROLE_DEFAULT', 'OVERRIDE']),
    validFrom: z
      .string()
      .nullable()
      .meta({ description: 'ISO 8601 instant when the grant starts, or null when unbounded.' }),
    validUntil: z
      .string()
      .nullable()
      .meta({ description: 'ISO 8601 instant when the grant ends, or null when unbounded.' }),
  })
  .meta({
    id: 'CollaboratorPermission',
    description: 'Local permission grant materialized on a collaborator.',
  });

export const collaboratorSchema = z
  .object({
    userId: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    email: z.string(),
    role: z.enum(['VIEWER', 'EDITOR', 'ORGANIZER']),
    createdAt: z.string().meta({ description: 'ISO 8601 instant when the collaboration started.' }),
    permissions: z.array(collaboratorPermissionSchema),
  })
  .meta({
    id: 'Collaborator',
    description: 'Local collaborator of an event program or activity with its permission grants.',
  }) satisfies z.ZodType<CollaboratorDetail>;

export const collaboratorListPermissionSchema = z
  .object({
    name: z.string(),
    source: z
      .enum(['ROLE_DEFAULT', 'OVERRIDE'])
      .meta({ description: 'Local grant kind that carries the permission in this scope.' }),
    origin: z.enum(['LOCAL', 'INHERITED', 'BOTH']).meta({
      description:
        'Where the effective permission comes from: the scope itself (LOCAL), the parent event program (INHERITED) or both (BOTH).',
    }),
    validFrom: z
      .string()
      .nullable()
      .meta({ description: 'ISO 8601 instant when the effective grant starts, or null.' }),
    validUntil: z
      .string()
      .nullable()
      .meta({ description: 'ISO 8601 instant when the effective grant ends, or null.' }),
    effective: z
      .boolean()
      .meta({ description: 'True when the permission is active at response time.' }),
  })
  .meta({
    id: 'CollaboratorListPermission',
    description:
      'Local permission grant of a collaborator enriched with its effective provenance and window.',
  });

const collaboratorListDetailSchema = z
  .object({
    userId: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    email: z.string(),
    role: z.enum(['VIEWER', 'EDITOR', 'ORGANIZER']),
    createdAt: z.string().meta({ description: 'ISO 8601 instant when the collaboration started.' }),
    permissions: z.array(collaboratorListPermissionSchema),
  })
  .meta({
    id: 'CollaboratorListDetail',
    description:
      'Local collaborator of an event program or activity with its effective permission grants and provenance.',
  }) satisfies z.ZodType<CollaboratorListDetail>;

export const collaboratorListSchema = z
  .object({ items: z.array(collaboratorListDetailSchema) })
  .meta({
    id: 'CollaboratorList',
    description: 'Local collaborators of an event program or activity scope.',
  }) satisfies z.ZodType<CollaboratorList>;

export const ownPermissionsQuerySchema = z.object({
  query: z
    .object({
      scope: z.enum(['program', 'activity'], 'Scope is invalid.'),
      id: scopeIdSchema,
    })
    .strict(),
});

export type OwnPermissionsQuery = z.infer<typeof ownPermissionsQuerySchema>['query'];

const ownPermissionSchema = z
  .object({
    name: z.string(),
    origin: z.enum(['LOCAL', 'INHERITED', 'BOTH']).meta({
      description:
        'Where the effective permission comes from: the requested scope (LOCAL), the parent event program (INHERITED) or both (BOTH).',
    }),
    validFrom: z.string().nullable().meta({
      description: 'ISO 8601 instant when the permission starts, or null when unbounded.',
    }),
    validUntil: z
      .string()
      .nullable()
      .meta({ description: 'ISO 8601 instant when the permission ends, or null when unbounded.' }),
  })
  .meta({
    id: 'OwnPermission',
    description: 'Effective permission of the authenticated user with its temporal envelope.',
  });

export const ownPermissionsSchema = z
  .object({
    scope: z.object({
      type: z.enum(['program', 'activity']),
      id: z.string(),
    }),
    permissions: z.array(ownPermissionSchema),
  })
  .meta({
    id: 'OwnPermissions',
    description:
      'Effective permissions of the authenticated user in an event program or activity scope.',
  }) satisfies z.ZodType<OwnPermissions>;

const userScopeTypes = ['program', 'activity'] as const;

export const listUserScopesQuerySchema = z.object({
  query: z
    .object({
      type: z.enum(userScopeTypes, 'Scope type is invalid.').optional(),
      page: z.coerce
        .number('Page must be a number.')
        .int('Page must be an integer.')
        .min(1, 'Page must be at least 1.')
        .default(1),
      limit: z.coerce
        .number('Limit must be a number.')
        .int('Limit must be an integer.')
        .min(1, 'Limit must be at least 1.')
        .max(50, 'Limit cannot exceed 50.')
        .default(20),
    })
    .strict(),
});

export type ListUserScopesQueryInput = z.infer<typeof listUserScopesQuerySchema>['query'];

const userScopeEventProgramSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    label: z.string().nullable(),
    status: z.enum(['DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'ARCHIVED']),
  })
  .meta({
    id: 'UserScopeEventProgram',
    description: 'Parent event program of an activity scope.',
  });

const userScopeOrganizationalUnitSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    type: z.enum(['FACULTY', 'SUBDIRECTORATE']),
  })
  .meta({
    id: 'UserScopeOrganizationalUnit',
    description: 'Owning organizational unit of a program or activity scope.',
  });

export const userScopeSchema = z
  .object({
    type: z.enum(userScopeTypes),
    id: z.string(),
    name: z.string(),
    status: z.enum([
      'DRAFT',
      'ACTIVE',
      'COMPLETED',
      'CANCELLED',
      'ARCHIVED',
      'SCHEDULED',
      'ONGOING',
    ]),
    eventProgram: userScopeEventProgramSchema.nullable(),
    organizationalUnit: userScopeOrganizationalUnitSchema,
    permissions: z.array(ownPermissionSchema),
  })
  .meta({
    id: 'UserScope',
    description:
      'Program or activity scope where the authenticated user holds at least one effective permission.',
  }) satisfies z.ZodType<UserScopeItem>;

export const paginatedUserScopesSchema = z
  .object({
    items: z.array(userScopeSchema),
    page: z.number().int(),
    limit: z.number().int(),
    total: z.number().int(),
    totalPages: z.number().int(),
  })
  .meta({
    id: 'PaginatedUserScopes',
    description: 'Paginated scopes of the authenticated user.',
  }) satisfies z.ZodType<PaginatedUserScopes>;
