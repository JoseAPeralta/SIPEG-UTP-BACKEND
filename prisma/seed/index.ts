import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { hashDemoPassword, logStep, requireEntry, resolveDemoPassword } from './helpers.js';
import { seedOrganizations } from './organizations.seed.js';
import { ADMIN_KEY, seedUsers } from './users.seed.js';
import { seedSpeakers } from './speakers.seed.js';
import { seedClassrooms } from './classrooms.seed.js';
import { finalizeAdditionalPrograms, seedAdditionalPrograms } from './programs.seed.js';
import { seedActivities } from './activities.seed.js';
import { seedCollaborations } from './collaborations.seed.js';
import { seedAttendance } from './attendance.seed.js';
import { seedProposals } from './proposals.seed.js';
import { seedProgramAlerts } from './alerts.seed.js';

export const seedDatabase = async (prisma: PrismaClient, now: Date = new Date()): Promise<void> => {
  resolveDemoPassword();
  const passwordHash = await hashDemoPassword();

  const catalog = await seedOrganizations(prisma, 'sync');
  const users = await seedUsers(prisma, catalog, passwordHash);
  const adminUserId = requireEntry(users, ADMIN_KEY, 'usuario administrador').id;

  const speakers = await seedSpeakers(prisma, { users });
  const classrooms = await seedClassrooms(prisma, 'sync');
  const additionalPrograms = await seedAdditionalPrograms(prisma, catalog, adminUserId, now);

  const activities = await seedActivities(
    prisma,
    { catalog, additionalPrograms, speakers, classrooms },
    now,
  );

  await seedCollaborations(
    prisma,
    { catalog, users, additionalPrograms, activities, adminUserId },
    now,
  );

  await finalizeAdditionalPrograms(prisma, additionalPrograms, now);

  const attendance = await seedAttendance(prisma, { activities, users });
  await seedProposals(prisma, { catalog, users, speakers }, now);
  await seedProgramAlerts(prisma, { users, activities, additionalPrograms }, now);

  const [
    units,
    careers,
    userCount,
    programCount,
    activityCount,
    speakerCount,
    classroomCount,
    attendanceCount,
    certificateCount,
    proposalCount,
    alertCount,
  ] = await Promise.all([
    prisma.organizationalUnit.count(),
    prisma.career.count(),
    prisma.user.count(),
    prisma.eventProgram.count(),
    prisma.activity.count(),
    prisma.speaker.count(),
    prisma.classroom.count(),
    prisma.attendance.count(),
    prisma.certificate.count(),
    prisma.speakerProposal.count(),
    prisma.alert.count(),
  ]);

  logStep('Seed completado.');
  logStep(`  unidades organizativas: ${units}`);
  logStep(`  carreras: ${careers}`);
  logStep(`  usuarios: ${userCount}`);
  logStep(`  programas de eventos: ${programCount}`);
  logStep(`  actividades: ${activityCount}`);
  logStep(`  ponentes: ${speakerCount}`);
  logStep(`  aulas: ${classroomCount}`);
  logStep(`  asistencias: ${attendanceCount} (${attendance.checkIns} check-in)`);
  logStep(`  certificados: ${certificateCount}`);
  logStep(`  propuestas: ${proposalCount}`);
  logStep(`  alertas: ${alertCount}`);
};
