export const INSTITUTIONAL_TIME_ZONE = 'America/Panama';

const dateKeyFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: INSTITUTIONAL_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

export const getInstitutionalDateKey = (instant: Date): string => {
  return dateKeyFormatter.format(instant);
};

export const startOfInstitutionalDay = (instant: Date): Date => {
  return new Date(`${getInstitutionalDateKey(instant)}T00:00:00.000Z`);
};
