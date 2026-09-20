import type { GlobalRole } from '../../generated/prisma/enums.js';

export interface UserProfileOrganization {
  id: string;
  name: string;
  code: string;
}

export interface UserProfileResponse {
  id: string;
  firstName: string;
  lastName: string;
  identificationNumber: string;
  email: string;
  globalRole: GlobalRole;
  unit: UserProfileOrganization | null;
  career: UserProfileOrganization | null;
}

export interface UpdateProfileInput {
  firstName?: string | undefined;
  lastName?: string | undefined;
  unitId?: string | null | undefined;
  careerId?: string | undefined;
}

export interface CreateUserInput {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  identificationNumber: string;
  globalRole: GlobalRole;
  isActive: boolean;
  unitId?: string | null | undefined;
  careerId?: string | undefined;
}

export interface UpdateAdminUserInput {
  globalRole?: GlobalRole | undefined;
  isActive?: boolean | undefined;
  unitId?: string | null | undefined;
  careerId?: string | undefined;
}

export interface AdminUserResponse {
  id: string;
  firstName: string;
  lastName: string;
  identificationNumber: string;
  email: string;
  globalRole: GlobalRole;
  isActive: boolean;
  unit: UserProfileOrganization | null;
  career: UserProfileOrganization | null;
}

export interface PaginatedUsers {
  items: AdminUserResponse[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
