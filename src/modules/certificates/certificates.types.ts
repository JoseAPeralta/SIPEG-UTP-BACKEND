import type { ActivityType } from '../../generated/prisma/enums.js';

export interface MyCertificateActivity {
  id: string;
  name: string;
  date: string;
  type: ActivityType;
}

export interface MyCertificateEventProgram {
  id: string;
  name: string;
}

export interface MyCertificateSummary {
  id: string;
  code: string;
  issuedAt: string;
  activity: MyCertificateActivity;
  eventProgram: MyCertificateEventProgram;
}

export interface PaginatedMyCertificates {
  items: MyCertificateSummary[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
