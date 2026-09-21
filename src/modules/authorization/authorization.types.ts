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

export type PermissionOrigin = 'LOCAL' | 'INHERITED' | 'BOTH';

export interface PermissionProvenance {
  envelope: GrantEnvelope;
  origin: PermissionOrigin;
}

export interface CollaboratorPermissionDetail {
  name: string;
  source: PermissionGrantSource;
  validFrom: string | null;
  validUntil: string | null;
}

export interface CollaboratorListPermissionDetail {
  name: string;
  source: PermissionGrantSource;
  origin: PermissionOrigin;
  validFrom: string | null;
  validUntil: string | null;
  effective: boolean;
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

export interface CollaboratorListDetail {
  userId: string;
  firstName: string;
  lastName: string;
  email: string;
  role: CollaborationRole;
  createdAt: string;
  permissions: CollaboratorListPermissionDetail[];
}

export interface CollaboratorList {
  items: CollaboratorListDetail[];
}

export interface OwnPermissionsScope {
  type: 'program' | 'activity';
  id: string;
}

export interface OwnPermissionEnvelope {
  name: string;
  origin: PermissionOrigin;
  validFrom: string | null;
  validUntil: string | null;
}

export interface OwnPermissions {
  scope: OwnPermissionsScope;
  permissions: OwnPermissionEnvelope[];
}
