export const AUDIT_ACTIONS = [
  'authorization.collaborator_added',
  'authorization.collaborator_role_changed',
  'authorization.collaborator_removed',
  'authorization.permission_granted',
  'authorization.permission_replaced',
  'authorization.permission_revoked',
  'user.admin_created',
  'user.role_changed',
  'user.activated',
  'user.deactivated',
  'auth.password_changed',
  'auth.other_sessions_revoked',
  'organizational_unit.deactivated',
  'organizational_unit.reactivated',
  'event_program.published',
  'event_program.archived',
  'event_program.reactivated',
  'activity.scheduled',
  'activity.unpublished',
  'activity.schedule_changed',
  'activity.cancelled',
  'activity.deleted',
  'classroom.activated',
  'classroom.deactivated',
  'career.deleted',
  'organizational_unit.created',
  'organizational_unit.updated',
  'career.created',
  'career.updated',
  'classroom.created',
  'classroom.updated',
  'event_program.created',
  'event_program.updated',
  'activity.created',
  'activity.updated',
  'user.profile_updated',
  'user.organization_assignment_changed',
  'classroom.amenity_added',
  'classroom.amenity_removed',
  'classroom.availability_added',
  'classroom.availability_removed',
  'user.registered',
  'auth.email_verified',
  'auth.password_reset',
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_ACTOR_TYPES = ['USER', 'ANONYMOUS', 'SYSTEM'] as const;

export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number];

export const AUDIT_SCOPE_TYPES = ['event_program', 'activity'] as const;

export type AuditScopeType = (typeof AUDIT_SCOPE_TYPES)[number];

export const AUDIT_RESOURCE_TYPES = [
  'collaboration',
  'collaboration_permission',
  'user',
  'organizational_unit',
  'event_program',
  'activity',
  'classroom',
  'career',
] as const;

export type AuditResourceType = (typeof AUDIT_RESOURCE_TYPES)[number];

export type AuditScalar = string | number | boolean | null;

export interface AuditSnapshot {
  before?: Record<string, AuditScalar>;
  after?: Record<string, AuditSnapshotValue>;
}

export type AuditSnapshotValue = AuditScalar | AuditScalar[];

export interface AuditMetadata {
  [key: string]: AuditSnapshotValue;
}

export interface AuditContext {
  actorId?: string | undefined;
  actorType?: AuditActorType | undefined;
  requestId?: string | undefined;
}

export type AuditValue = AuditScalar | AuditScalar[];

export interface AuditReadChanges {
  before?: Record<string, AuditValue> | undefined;
  after?: Record<string, AuditValue> | undefined;
}

export interface AuditEventResponse {
  id: string;
  action: string;
  occurredAt: string;
  actorType: AuditActorType;
  actorId: string | null;
  resourceType: string;
  resourceId: string | null;
  scopeType: string | null;
  scopeId: string | null;
  targetUserId: string | null;
  requestId: string | null;
  changes: AuditReadChanges | null;
  metadata: Record<string, AuditValue> | null;
}

export interface AuditEventPage {
  items: AuditEventResponse[];
  limit: number;
  hasMore: boolean;
  nextCursor: string | null;
}

export interface AuditEventInput extends AuditContext {
  action: AuditAction;
  resourceType: AuditResourceType | (string & {});
  resourceId?: string | undefined;
  scopeType?: AuditScopeType | (string & {});
  scopeId?: string | undefined;
  targetUserId?: string | undefined;
  changes?: AuditSnapshot | undefined;
  metadata?: AuditMetadata | undefined;
}

export const AUDIT_ALLOWED_SNAPSHOT_KEYS = [
  'role',
  'permission',
  'permissions',
  'validFrom',
  'validUntil',
  'source',
  'globalRole',
  'isActive',
  'unitId',
  'careerId',
  'revokedSessionCount',
  'status',
  'date',
  'startTime',
  'endTime',
  'classroomId',
  'maxCapacity',
  'code',
  'type',
  'capacity',
  'floor',
  'headId',
  'amenity',
  'dayOfWeek',
  'organizationalUnitId',
  'eventProgramId',
  'startDate',
  'endDate',
] as const;

const allowedSnapshotKeys = new Set<string>(AUDIT_ALLOWED_SNAPSHOT_KEYS);

export const AUDIT_ALLOWED_METADATA_KEYS = [
  'revokedSessionCount',
  'hasCancelReason',
  'hasPeriod',
  'hasLabel',
  'changedFields',
] as const;

const allowedMetadataKeys = new Set<string>(AUDIT_ALLOWED_METADATA_KEYS);

export const AUDIT_FORBIDDEN_VALUE_PATTERNS = [
  'password',
  'passwd',
  'token',
  'secret',
  'hash',
  'authorization',
  'cookie',
  'credential',
  'apikey',
  'bearer',
  'jwt',
  'sessionid',
  'identificationnumber',
] as const;

export const AUDIT_FORBIDDEN_VALUE_CHARS = ['@'] as const;

export const isAllowedSnapshotKey = (key: string): boolean => allowedSnapshotKeys.has(key);

export const isAllowedMetadataKey = (key: string): boolean => allowedMetadataKeys.has(key);

const normalize = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]/g, '');

export const looksLikeSecret = (value: string): boolean => {
  const normalized = normalize(value);

  if (AUDIT_FORBIDDEN_VALUE_CHARS.some((char) => value.includes(char))) {
    return true;
  }

  return AUDIT_FORBIDDEN_VALUE_PATTERNS.some((pattern) => normalized.includes(pattern));
};
