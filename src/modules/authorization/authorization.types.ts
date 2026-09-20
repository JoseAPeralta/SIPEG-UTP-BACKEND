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
