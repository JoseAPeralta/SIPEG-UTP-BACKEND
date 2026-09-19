import type { ActivityType } from '../../generated/prisma/enums.js';

export interface ActivitySpeakerSummary {
  id: string;
  firstName: string;
  lastName: string;
}

export interface ActivityClassroomSummary {
  id: string;
  name: string;
  building: string | null;
}

export interface ActivityProgramSummary {
  id: string;
  name: string;
  label: string | null;
}

export interface ActivityOrganizationalUnit {
  type: 'FACULTY' | 'SUBDIRECTORATE';
  id: string;
  name: string;
}

export interface ActivityListItem {
  id: string;
  name: string;
  description: string | null;
  type: ActivityType;
  date: string;
  startTime: string;
  endTime: string;
  capacity: number | null;
  bannerUrl: string | null;
  speaker: ActivitySpeakerSummary | null;
  classroom: ActivityClassroomSummary | null;
  eventProgram: ActivityProgramSummary;
  organizationalUnit: ActivityOrganizationalUnit;
}

export interface PaginatedActivities {
  items: ActivityListItem[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
