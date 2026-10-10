import type { AlertType } from '../../generated/prisma/enums.js';

export type AlertTarget =
  | { kind: 'PROPOSAL'; id: string }
  | { kind: 'EVENT_PROGRAM'; id: string }
  | { kind: 'ACTIVITY'; id: string }
  | { kind: 'CERTIFICATE'; id: string };

export interface AlertResponse {
  id: string;
  type: AlertType;
  isRead: boolean;
  createdAt: string;
  target: AlertTarget;
}

export interface PaginatedAlerts {
  items: AlertResponse[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface MarkAllAlertsReadResult {
  updatedCount: number;
}

export type CreateAlertInput =
  | {
      recipientId: string;
      type: 'PROPOSAL_RECEIVED' | 'PROPOSAL_UPDATED' | 'PROPOSAL_RESPONDED';
      target: { kind: 'PROPOSAL'; id: string };
    }
  | {
      recipientId: string;
      type: 'PROGRAM_UPDATED' | 'PROGRAM_ARCHIVED';
      target: { kind: 'EVENT_PROGRAM'; id: string };
    }
  | {
      recipientId: string;
      type: 'ACTIVITY_UPDATED' | 'ACTIVITY_CANCELLED';
      target: { kind: 'ACTIVITY'; id: string };
    }
  | {
      recipientId: string;
      type: 'CERTIFICATE_ISSUED';
      target: { kind: 'CERTIFICATE'; id: string };
    };
