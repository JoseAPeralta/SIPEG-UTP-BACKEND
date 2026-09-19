import type { PrismaClient } from '../../src/generated/prisma/client.js';
import type { AttendanceMethod } from '../../src/generated/prisma/enums.js';
import { logStep, requireEntry, seedId } from './helpers.js';
import type { SeedActivity } from './activities.seed.js';
import type { SeedUser } from './users.seed.js';

interface AttendanceGroupCatalogEntry {
  activityKey: string;
  attendeeKeys: readonly string[];
  checkedInCount: number;
  method: AttendanceMethod;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export const ATTENDANCE_GROUPS: readonly AttendanceGroupCatalogEntry[] = [
  {
    activityKey: 'fic-charla-puentes',
    attendeeKeys: [
      'student-08',
      'student-01',
      'student-02',
      'student-04',
      'student-06',
      'student-10',
    ],
    checkedInCount: 4,
    method: 'QR',
  },
  {
    activityKey: 'fii-taller-logistica',
    attendeeKeys: ['student-06', 'student-07', 'student-12', 'student-02', 'student-09'],
    checkedInCount: 4,
    method: 'QR',
  },
  {
    activityKey: 'fisc-workshop-ciberseguridad',
    attendeeKeys: [
      'student-01',
      'student-02',
      'student-03',
      'student-05',
      'student-07',
      'student-11',
      'student-06',
    ],
    checkedInCount: 6,
    method: 'MANUAL',
  },
  {
    activityKey: 'sub-admin-induccion',
    attendeeKeys: ['student-12', 'student-11', 'student-10', 'student-03'],
    checkedInCount: 3,
    method: 'MANUAL',
  },
  {
    activityKey: 'semana-ic-taller-estructuras',
    attendeeKeys: ['student-08', 'student-04', 'student-09', 'student-01', 'student-05'],
    checkedInCount: 4,
    method: 'QR',
  },
  {
    activityKey: 'semana-ic-charla-puentes',
    attendeeKeys: ['student-08', 'student-06', 'student-02', 'student-12'],
    checkedInCount: 3,
    method: 'MANUAL',
  },
  {
    activityKey: 'foro-ipe-conferencia-investigacion',
    attendeeKeys: ['student-03', 'student-11', 'student-10', 'student-07'],
    checkedInCount: 3,
    method: 'QR',
  },
];

export interface AttendanceSummary {
  registrations: number;
  checkIns: number;
  certificates: number;
}

export const seedAttendance = async (
  prisma: PrismaClient,
  input: { activities: Map<string, SeedActivity>; users: Map<string, SeedUser> },
): Promise<AttendanceSummary> => {
  logStep('Sembrando asistencias, certificados y alertas de certificado...');
  const summary: AttendanceSummary = { registrations: 0, checkIns: 0, certificates: 0 };

  for (const [activityIndex, group] of ATTENDANCE_GROUPS.entries()) {
    const activity = requireEntry(input.activities, group.activityKey, 'actividad');

    const registeredAt = new Date(activity.date.getTime() - 7 * DAY_MS);
    registeredAt.setUTCHours(9, 0, 0, 0);

    for (const [attendeeIndex, attendeeKey] of group.attendeeKeys.entries()) {
      const attendee = requireEntry(input.users, attendeeKey, 'usuario');
      const isCheckedIn = attendeeIndex < group.checkedInCount;

      const checkedInAt = new Date(activity.date.getTime());
      checkedInAt.setUTCHours(activity.startHour, 5 + attendeeIndex, 0, 0);

      const attendance = await prisma.attendance.upsert({
        where: {
          activityId_userId: {
            activityId: activity.id,
            userId: attendee.id,
          },
        },
        update: {
          registeredAt,
          method: isCheckedIn ? group.method : null,
          usedCode: isCheckedIn
            ? group.method === 'QR'
              ? activity.qrCode
              : activity.manualCode
            : null,
          checkedInAt: isCheckedIn ? checkedInAt : null,
        },
        create: {
          id: seedId('attendance', activity.key, attendeeKey),
          registeredAt,
          method: isCheckedIn ? group.method : null,
          usedCode: isCheckedIn
            ? group.method === 'QR'
              ? activity.qrCode
              : activity.manualCode
            : null,
          checkedInAt: isCheckedIn ? checkedInAt : null,
          activityId: activity.id,
          userId: attendee.id,
        },
        select: { id: true },
      });

      summary.registrations += 1;

      if (!isCheckedIn) {
        continue;
      }

      summary.checkIns += 1;

      const certificateCode = seedId(
        'cert',
        String(activityIndex + 1).padStart(2, '0'),
        String(attendeeIndex + 1).padStart(2, '0'),
      );

      const certificate = await prisma.certificate.upsert({
        where: { attendanceId: attendance.id },
        update: { code: certificateCode, pdfUrl: `/certificates/${certificateCode}.pdf` },
        create: {
          id: seedId('certificate', activity.key, attendeeKey),
          code: certificateCode,
          pdfUrl: `/certificates/${certificateCode}.pdf`,
          issuedAt: checkedInAt,
          attendanceId: attendance.id,
        },
        select: { id: true },
      });

      await prisma.alert.upsert({
        where: { id: seedId('alert', 'cert', activity.key, attendeeKey) },
        update: { isRead: false, recipientId: attendee.id, certificateId: certificate.id },
        create: {
          id: seedId('alert', 'cert', activity.key, attendeeKey),
          type: 'CERTIFICATE_ISSUED',
          isRead: false,
          recipientId: attendee.id,
          certificateId: certificate.id,
          createdAt: checkedInAt,
        },
      });

      summary.certificates += 1;
    }
  }

  return summary;
};
