import type { ActivityStatus } from '../../generated/prisma/enums.js';
import {
  getInstitutionalTimeOfDay,
  startOfInstitutionalDay,
  toInstitutionalInstant,
} from '../../utils/date.js';

export const PUBLISHED_ACTIVITY_STATUSES: ActivityStatus[] = ['SCHEDULED', 'ONGOING', 'COMPLETED'];

export interface ActivityTemporalState {
  status: ActivityStatus;
  date: Date;
  startTime: Date;
  endTime: Date;
}

export const resolveActivityStatus = (
  activity: ActivityTemporalState,
  now: Date,
): ActivityStatus => {
  if (activity.status === 'DRAFT') {
    return 'DRAFT';
  }
  if (activity.status === 'CANCELLED') {
    return 'CANCELLED';
  }

  const start = toInstitutionalInstant(activity.date, activity.startTime);
  const end = toInstitutionalInstant(activity.date, activity.endTime);

  if (now < start) {
    return 'SCHEDULED';
  }
  if (now < end) {
    return 'ONGOING';
  }

  return 'COMPLETED';
};

export const buildEffectiveStatusWhere = (
  status: ActivityStatus,
  now: Date,
): Record<string, unknown> => {
  const today = startOfInstitutionalDay(now);
  const nowTime = getInstitutionalTimeOfDay(now);
  const published = { in: [...PUBLISHED_ACTIVITY_STATUSES] };

  switch (status) {
    case 'DRAFT':
      return { status: 'DRAFT' };
    case 'CANCELLED':
      return { status: 'CANCELLED' };
    case 'SCHEDULED':
      return {
        status: published,
        OR: [{ date: { gt: today } }, { date: today, startTime: { gt: nowTime } }],
      };
    case 'ONGOING':
      return {
        status: published,
        date: today,
        startTime: { lte: nowTime },
        endTime: { gt: nowTime },
      };
    case 'COMPLETED':
      return {
        status: published,
        OR: [{ date: { lt: today } }, { date: today, endTime: { lte: nowTime } }],
      };
  }
};

export const buildReservingActivityWhere = (now: Date): Record<string, unknown> => {
  const today = startOfInstitutionalDay(now);
  const nowTime = getInstitutionalTimeOfDay(now);

  return {
    status: { in: [...PUBLISHED_ACTIVITY_STATUSES] },
    OR: [{ date: { gt: today } }, { date: today, endTime: { gt: nowTime } }],
  };
};
