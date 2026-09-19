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
  faculty: UserProfileOrganization | null;
  career: UserProfileOrganization | null;
}

export interface UpdateProfileInput {
  firstName?: string | undefined;
  lastName?: string | undefined;
  facultyId?: string | undefined;
  careerId?: string | undefined;
}
