import type { ClassroomType } from '../../generated/prisma/enums.js';

export interface ClassroomAvailabilitySlot {
  id: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  period: string | null;
}

export interface ClassroomSummary {
  id: string;
  name: string;
  type: ClassroomType;
  capacity: number;
  building: string | null;
  floor: number | null;
  isActive: boolean;
  amenities: string[];
}

export interface ClassroomDetail extends ClassroomSummary {
  availability: ClassroomAvailabilitySlot[];
}

export interface PaginatedClassrooms {
  items: ClassroomSummary[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface CreateClassroomInput {
  name: string;
  type: ClassroomType;
  capacity: number;
  building?: string | null | undefined;
  floor?: number | null | undefined;
  isActive?: boolean | undefined;
}

export interface UpdateClassroomInput {
  name?: string | undefined;
  type?: ClassroomType | undefined;
  capacity?: number | undefined;
  building?: string | null | undefined;
  floor?: number | null | undefined;
  isActive?: boolean | undefined;
}

export interface AddClassroomAvailabilityInput {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  period?: string | null | undefined;
}
