import { describe, expect, it } from 'vitest';

import { ACTIVITIES } from './activities.seed.js';
import { PROGRAM_ALERTS } from './alerts.seed.js';
import { ATTENDANCE_GROUPS } from './attendance.seed.js';
import { CLASSROOMS } from './classrooms.seed.js';
import { OVERRIDE_GRANTS, PROGRAM_COLLABORATIONS } from './collaborations.seed.js';
import { CAREERS, UNITS } from './organizations.seed.js';
import { ADDITIONAL_PROGRAMS } from './programs.seed.js';
import { PROPOSALS } from './proposals.seed.js';
import { SPEAKERS } from './speakers.seed.js';
import { USERS } from './users.seed.js';

const keys = <T extends { key: string }>(entries: readonly T[]): string[] =>
  entries.map((entry) => entry.key);

const expectUnique = (values: readonly string[], label: string): void => {
  expect(new Set(values).size, `${label} must be unique`).toBe(values.length);
};

const collaborationScopeKey = (
  scope:
    | { type: 'unit'; unitKey: string }
    | { type: 'additional'; programKey: string }
    | { type: 'activity'; activityKey: string },
): string => {
  if (scope.type === 'unit') {
    return `unit_${scope.unitKey}`;
  }
  if (scope.type === 'additional') {
    return `program_${scope.programKey}`;
  }
  return `activity_${scope.activityKey}`;
};

describe('catalogos del seed demo', () => {
  it('usa claves unicas en cada catalogo', () => {
    expectUnique(keys(USERS), 'users');
    expectUnique(keys(SPEAKERS), 'speakers');
    expectUnique(keys(CLASSROOMS), 'classrooms');
    expectUnique(keys(ADDITIONAL_PROGRAMS), 'additional programs');
    expectUnique(keys(ACTIVITIES), 'activities');
    expectUnique(keys(PROPOSALS), 'proposals');
    expectUnique(keys(PROGRAM_ALERTS), 'alerts');
    expectUnique(keys(UNITS), 'organizational units');
  });

  it('mantiene identificaciones y correos de usuario unicos', () => {
    expectUnique(
      USERS.map((user) => user.email.toLowerCase()),
      'emails',
    );
    expectUnique(
      USERS.map((user) => user.identificationNumber),
      'identification numbers',
    );
  });

  it('resuelve unidad y carrera de cada usuario', () => {
    const unitKeys = new Set(keys(UNITS));
    const careerCodes = new Set(CAREERS.map((career) => career.code));

    for (const user of USERS) {
      if (user.unitKey) {
        expect(unitKeys.has(user.unitKey), `${user.key}:${user.unitKey}`).toBe(true);
      }
      if (user.careerCode) {
        expect(careerCodes.has(user.careerCode), `${user.key}:${user.careerCode}`).toBe(true);
      }
    }
  });

  it('resuelve los usuarios de los ponentes con cuenta', () => {
    const userKeys = new Set(keys(USERS));

    for (const speaker of SPEAKERS) {
      if (speaker.userKey !== undefined) {
        expect(userKeys.has(speaker.userKey), `${speaker.key}:${speaker.userKey}`).toBe(true);
      }
    }
  });

  it('resuelve el programa, aula y ponentes de cada actividad', () => {
    const unitKeys = new Set(keys(UNITS));
    const programKeys = new Set(keys(ADDITIONAL_PROGRAMS));
    const classroomKeys = new Set(keys(CLASSROOMS));
    const speakerKeys = new Set(keys(SPEAKERS));

    for (const activity of ACTIVITIES) {
      if (activity.program.type === 'unit') {
        expect(unitKeys.has(activity.program.unitKey), activity.key).toBe(true);
      } else {
        expect(programKeys.has(activity.program.programKey), activity.key).toBe(true);
      }

      if (activity.classroomKey) {
        expect(
          classroomKeys.has(activity.classroomKey),
          `${activity.key}:${activity.classroomKey}`,
        ).toBe(true);
      }

      for (const speakerKey of activity.speakerKeys) {
        expect(speakerKeys.has(speakerKey), `${activity.key}:${speakerKey}`).toBe(true);
      }
    }
  });

  it('no solapa aula, fecha y horario entre actividades SCHEDULED/ONGOING', () => {
    const bookings = new Map<string, { key: string; startHour: number; endHour: number }[]>();

    for (const activity of ACTIVITIES) {
      if (!activity.classroomKey) {
        continue;
      }
      if (activity.status !== 'SCHEDULED' && activity.status !== 'ONGOING') {
        continue;
      }

      const groupKey = `${activity.classroomKey}|${activity.dayOffset}`;
      const group = bookings.get(groupKey) ?? [];
      group.push({ key: activity.key, startHour: activity.startHour, endHour: activity.endHour });
      bookings.set(groupKey, group);
    }

    for (const [groupKey, group] of bookings) {
      for (let i = 0; i < group.length; i += 1) {
        for (let j = i + 1; j < group.length; j += 1) {
          const first = group[i]!;
          const second = group[j]!;
          const overlaps = first.startHour < second.endHour && second.startHour < first.endHour;
          expect(overlaps, `${groupKey}: ${first.key} vs ${second.key}`).toBe(false);
        }
      }
    }
  });

  it('referencia actividades y asistentes existentes en las asistencias', () => {
    const activityKeys = new Set(keys(ACTIVITIES));
    const userKeys = new Set(keys(USERS));
    const seen = new Set<string>();

    for (const group of ATTENDANCE_GROUPS) {
      expect(activityKeys.has(group.activityKey), group.activityKey).toBe(true);
      expect(group.checkedInCount).toBeGreaterThanOrEqual(0);
      expect(group.checkedInCount).toBeLessThanOrEqual(group.attendeeKeys.length);

      for (const attendeeKey of group.attendeeKeys) {
        expect(userKeys.has(attendeeKey), `${group.activityKey}:${attendeeKey}`).toBe(true);

        const pair = `${group.activityKey}|${attendeeKey}`;
        expect(seen.has(pair), `duplicate attendance ${pair}`).toBe(false);
        seen.add(pair);

        const code = `seed_code_${group.activityKey}_${attendeeKey}`;
        expect(code.length, code).toBeLessThanOrEqual(64);
      }
    }
  });

  it('resuelve unidad, ponente y revisor de cada propuesta', () => {
    const unitKeys = new Set(keys(UNITS));
    const speakerKeys = new Set(keys(SPEAKERS));
    const userKeys = new Set(keys(USERS));

    for (const proposal of PROPOSALS) {
      expect(unitKeys.has(proposal.unitKey), proposal.key).toBe(true);
      expect(speakerKeys.has(proposal.speakerKey), proposal.key).toBe(true);
      expect(userKeys.has(proposal.reviewerKey), proposal.key).toBe(true);
      expect(proposal.versions.length).toBeGreaterThan(0);

      for (const feedback of proposal.feedback) {
        expect(userKeys.has(feedback.authorKey), `${proposal.key}:${feedback.authorKey}`).toBe(
          true,
        );
      }
    }
  });

  it('resuelve los scopes y usuarios de colaboraciones y overrides', () => {
    const unitKeys = new Set(keys(UNITS));
    const programKeys = new Set(keys(ADDITIONAL_PROGRAMS));
    const activityKeys = new Set(keys(ACTIVITIES));
    const userKeys = new Set(keys(USERS));

    expectUnique(
      PROGRAM_COLLABORATIONS.map(
        (entry) => `${collaborationScopeKey(entry.scope)}|${entry.userKey}`,
      ),
      'collaborations',
    );

    for (const entry of PROGRAM_COLLABORATIONS) {
      expect(userKeys.has(entry.userKey), entry.userKey).toBe(true);

      if (entry.scope.type === 'unit') {
        expect(unitKeys.has(entry.scope.unitKey), entry.scope.unitKey).toBe(true);
      } else if (entry.scope.type === 'additional') {
        expect(programKeys.has(entry.scope.programKey), entry.scope.programKey).toBe(true);
      } else {
        expect(activityKeys.has(entry.scope.activityKey), entry.scope.activityKey).toBe(true);
      }
    }

    const collaborationScopes = new Set(
      PROGRAM_COLLABORATIONS.map(
        (entry) => `${collaborationScopeKey(entry.scope)}|${entry.userKey}`,
      ),
    );

    for (const override of OVERRIDE_GRANTS) {
      expect(userKeys.has(override.userKey), override.userKey).toBe(true);
      expect(
        collaborationScopes.has(`${collaborationScopeKey(override.scope)}|${override.userKey}`),
        `${override.permission} for ${override.userKey}`,
      ).toBe(true);
    }
  });

  it('referencia destinatarios y objetivos existentes en las alertas', () => {
    const userKeys = new Set(keys(USERS));
    const activityKeys = new Set(keys(ACTIVITIES));
    const programKeys = new Set(keys(ADDITIONAL_PROGRAMS));

    for (const alert of PROGRAM_ALERTS) {
      expect(userKeys.has(alert.recipientKey), alert.key).toBe(true);

      if (alert.target.type === 'activity') {
        expect(activityKeys.has(alert.target.activityKey), alert.key).toBe(true);
      } else {
        expect(programKeys.has(alert.target.programKey), alert.key).toBe(true);
      }
    }
  });

  it('incluye las variantes de datos esperadas', () => {
    expect(USERS.some((user) => user.isActive === false)).toBe(true);
    expect(ACTIVITIES.some((activity) => activity.status === 'DRAFT')).toBe(true);
    expect(ACTIVITIES.some((activity) => activity.status === 'CANCELLED')).toBe(true);
    expect(ACTIVITIES.some((activity) => activity.maxCapacity === null)).toBe(true);
    expect(ACTIVITIES.some((activity) => activity.classroomKey === null)).toBe(true);
    expect(ACTIVITIES.some((activity) => activity.speakerKeys.length === 0)).toBe(true);
    expect(ACTIVITIES.some((activity) => activity.bannerUrl)).toBe(true);
    expect(ACTIVITIES.some((activity) => activity.cancelReason)).toBe(true);
    expect(CLASSROOMS.some((classroom) => classroom.floor === null)).toBe(true);
    expect(
      PROPOSALS.some((proposal) => proposal.feedback.some((feedback) => feedback.imageUrl)),
    ).toBe(true);

    const types = new Set<string>(ACTIVITIES.map((activity) => activity.type));
    for (const type of [
      'WORKSHOP',
      'SEMINAR',
      'TALK',
      'CONFERENCE',
      'PANEL',
      'COURSE',
      'COMPETITION',
      'OTHER',
    ]) {
      expect(types.has(type), `missing activity type ${type}`).toBe(true);
    }
  });
});
