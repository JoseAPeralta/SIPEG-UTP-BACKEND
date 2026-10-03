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

export const getInstitutionalDayOfWeek = (dateKey: string): number => {
  const [year, month, day] = dateKey.split('-').map(Number);
  const dayOfWeek = new Date(
    Date.UTC(year as number, (month as number) - 1, day as number),
  ).getUTCDay();

  return dayOfWeek === 0 ? 7 : dayOfWeek;
};

const zoneOffsetFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: INSTITUTIONAL_TIME_ZONE,
  timeZoneName: 'longOffset',
});

const getZoneOffsetMilliseconds = (instant: Date): number => {
  const offset = zoneOffsetFormatter
    .formatToParts(instant)
    .find((part) => part.type === 'timeZoneName')?.value;

  if (!offset) {
    throw new Error('Unable to resolve the institutional time zone offset.');
  }

  const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(offset);

  if (!match) {
    throw new Error('Unexpected institutional time zone offset format.');
  }

  const [, sign, hours, minutes] = match;
  const totalMinutes = Number(hours) * 60 + Number(minutes);

  return (sign === '-' ? -totalMinutes : totalMinutes) * 60_000;
};

export const getInstitutionalDayRange = (
  dateKey: string,
): {
  start: Date;
  endExclusive: Date;
} => {
  const [year, month, day] = dateKey.split('-').map(Number);
  const calendarStartUtc = Date.UTC(year as number, (month as number) - 1, day as number);
  const start = new Date(calendarStartUtc - getZoneOffsetMilliseconds(new Date(calendarStartUtc)));

  return {
    start,
    // Panama no aplica horario de verano (ADR-0002), asi que el dia institucional
    // dura 86400000 ms exactos y el limite superior es el inicio del dia siguiente.
    endExclusive: new Date(start.getTime() + 24 * 60 * 60 * 1000),
  };
};
