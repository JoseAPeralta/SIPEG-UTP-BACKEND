import type { CollaborationRole, PermissionGrantSource } from '../../generated/prisma/enums.js';

export interface AuthorizationScope {
  eventProgramId?: string;
  activityId?: string;
}

export interface ResolvedScope {
  eventProgramId: string;
  activityId?: string;
}

export interface GrantEnvelope {
  validFrom: Date | null;
  validUntil: Date | null;
}

export interface CollaboratorPermissionDetail {
  name: string;
  source: PermissionGrantSource;
  validFrom: string | null;
  validUntil: string | null;
}

export interface CollaboratorDetail {
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  role: CollaborationRole;
  createdAt: string;
  permissions: CollaboratorPermissionDetail[];
}

export interface CollaboratorList {
  items: CollaboratorDetail[];
}
