import type { ActivityType } from '../../generated/prisma/enums.js';

export interface EventSpeakerSummary {
  id: string;
  firstName: string;
  lastName: string;
}

export interface EventClassroomSummary {
  id: string;
  name: string;
  building: string | null;
}

export interface EventProgramSummary {
  id: string;
  name: string;
  label: string | null;
}

export interface EventOrganizationalUnit {
  type: 'FACULTY' | 'SUBDIRECTORATE';
  id: string;
  name: string;
}

export interface EventListItem {
  id: string;
  name: string;
  description: string | null;
  type: ActivityType;
  date: string;
  startTime: string;
  endTime: string;
  capacity: number | null;
  bannerUrl: string | null;
  speaker: EventSpeakerSummary | null;
  classroom: EventClassroomSummary | null;
  eventProgram: EventProgramSummary;
  organizationalUnit: EventOrganizationalUnit;
}

export interface PaginatedEvents {
  items: EventListItem[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
