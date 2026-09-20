import type { ProgramStatus, UnitType } from '../../generated/prisma/enums.js';

export interface EventProgramOrganizationalUnit {
  id: string;
  name: string;
  type: UnitType;
}

export interface EventProgramDetail {
  id: string;
  name: string;
  description: string | null;
  label: string | null;
  bannerUrl: string | null;
  isDefault: boolean;
  status: ProgramStatus;
  startDate: string | null;
  endDate: string | null;
  organizationalUnit: EventProgramOrganizationalUnit;
}

export interface PaginatedEventPrograms {
  items: EventProgramDetail[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
