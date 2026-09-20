export interface CareerUnit {
  id: string;
  name: string;
  code: string;
}

export interface CareerSummary {
  id: string;
  name: string;
  code: string;
  description: string | null;
  unit: CareerUnit | null;
}

export interface PaginatedCareers {
  items: CareerSummary[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface CreateCareerInput {
  name: string;
  code: string;
  description?: string | null | undefined;
  unitId?: string | null | undefined;
}

export interface UpdateCareerInput {
  name?: string | undefined;
  code?: string | undefined;
  description?: string | null | undefined;
  unitId?: string | null | undefined;
}
