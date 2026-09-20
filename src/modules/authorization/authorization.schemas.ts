import { z } from 'zod';

import type { CollaboratorDetail, CollaboratorList } from './authorization.types.js';

const scopeIdSchema = z
  .string()
  .trim()
  .min(1, 'Event program or activity id is required.')
  .max(100, 'Identifier cannot exceed 100 characters.');

export const collaboratorParamsSchema = z.object({
  params: z.object({ id: scopeIdSchema }),
});

export const addCollaboratorSchema = z.object({
  params: z.object({ id: scopeIdSchema }),
  body: z
    .object({
      userId: z
        .string()
        .trim()
        .min(1, 'User is required.')
        .max(100, 'User identifier cannot exceed 100 characters.'),
      role: z.enum(['VIEWER', 'EDITOR', 'ORGANIZER'], 'Role is invalid.'),
    })
    .strict(),
});

export type AddCollaboratorBody = z.infer<typeof addCollaboratorSchema>['body'];

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

export const collaboratorListSchema = z.object({ items: z.array(collaboratorSchema) }).meta({
  id: 'CollaboratorList',
  description: 'Local collaborators of an event program or activity scope.',
}) satisfies z.ZodType<CollaboratorList>;
