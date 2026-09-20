import type { ProgramStatus, UnitType } from '../../generated/prisma/enums.js';

export interface OrganizationalUnitHead {
  id: string;
  firstName: string;
  lastName: string;
}

export interface OrganizationalUnitCareer {
  id: string;
  name: string;
  code: string;
}

export interface DefaultEventProgram {
  id: string;
  name: string;
  status: ProgramStatus;
}

export interface OrganizationalUnitSummary {
  id: string;
  name: string;
  code: string;
  description: string | null;
  type: UnitType;
  isActive: boolean;
  head: OrganizationalUnitHead | null;
}

export interface OrganizationalUnitDetail extends OrganizationalUnitSummary {
  careers: OrganizationalUnitCareer[];
  defaultProgram: DefaultEventProgram | null;
}

export interface PaginatedOrganizationalUnits {
  items: OrganizationalUnitSummary[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface CreateOrganizationalUnitInput {
  name: string;
  code: string;
  description?: string | null | undefined;
  type: UnitType;
  headId?: string | null | undefined;
}

export interface UpdateOrganizationalUnitInput {
  name?: string | undefined;
  description?: string | null | undefined;
  headId?: string | null | undefined;
}
