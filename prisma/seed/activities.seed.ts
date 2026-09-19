import type { PrismaClient } from '../../src/generated/prisma/client.js';
import type { ActivityStatus, ActivityType } from '../../src/generated/prisma/enums.js';
import { dateOffset, logStep, requireEntry, seedId, timeOfDay } from './helpers.js';
import type { OrganizationCatalog } from './organizations.seed.js';
import type { SeedProgram } from './programs.seed.js';
import type { SeedUser } from './users.seed.js';

type ProgramRef = { type: 'unit'; unitKey: string } | { type: 'additional'; programKey: string };

interface ActivityCatalogEntry {
  key: string;
  program: ProgramRef;
  name: string;
  description: string;
  type: ActivityType;
  dayOffset: number;
  startHour: number;
  endHour: number;
  maxCapacity: number;
  classroomKey: string | null;
  speakerKey: string | null;
  status: ActivityStatus;
  equipment: readonly string[];
}

export const ACTIVITIES: readonly ActivityCatalogEntry[] = [
  {
    key: 'fic-charla-puentes',
    program: { type: 'unit', unitKey: 'fic' },
    name: 'Charla: Innovación en Puentes',
    description: 'Charla técnica sobre nuevas metodologías de diseño de puentes.',
    type: 'TALK',
    dayOffset: -30,
    startHour: 10,
    endHour: 12,
    maxCapacity: 60,
    classroomKey: 'aula-101',
    speakerKey: 'speaker-carlos',
    status: 'COMPLETED',
    equipment: ['Proyector', 'Pizarra'],
  },
  {
    key: 'fic-taller-drones',
    program: { type: 'unit', unitKey: 'fic' },
    name: 'Taller de Topografía con Drones',
    description: 'Taller práctico de levantamiento topográfico con drones.',
    type: 'WORKSHOP',
    dayOffset: 14,
    startHour: 9,
    endHour: 12,
    maxCapacity: 24,
    classroomKey: 'lab-electronica',
    speakerKey: 'org-fic',
    status: 'SCHEDULED',
    equipment: ['Dron', 'Proyector', 'Estación total'],
  },
  {
    key: 'fic-charla-cancelada',
    program: { type: 'unit', unitKey: 'fic' },
    name: 'Charla: Gestión de Proyectos Viales',
    description: 'Charla cancelada por reprogramación del ponente.',
    type: 'TALK',
    dayOffset: 7,
    startHour: 8,
    endHour: 10,
    maxCapacity: 40,
    classroomKey: 'aula-101',
    speakerKey: 'speaker-carlos',
    status: 'CANCELLED',
    equipment: ['Proyector'],
  },
  {
    key: 'fie-seminario-smartgrids',
    program: { type: 'unit', unitKey: 'fie' },
    name: 'Seminario de Smart Grids',
    description: 'Seminario sobre redes eléctricas inteligentes y almacenamiento.',
    type: 'SEMINAR',
    dayOffset: 18,
    startHour: 9,
    endHour: 11,
    maxCapacity: 120,
    classroomKey: 'auditorio',
    speakerKey: 'speaker-carlos',
    status: 'SCHEDULED',
    equipment: ['Proyector', 'Micrófono'],
  },
  {
    key: 'fii-taller-logistica',
    program: { type: 'unit', unitKey: 'fii' },
    name: 'Taller de Logística 4.0',
    description: 'Taller de optimización de cadenas de suministro con analítica.',
    type: 'WORKSHOP',
    dayOffset: -25,
    startHour: 14,
    endHour: 17,
    maxCapacity: 35,
    classroomKey: 'aula-201',
    speakerKey: 'speaker-diana',
    status: 'COMPLETED',
    equipment: ['Proyector', 'Computadoras'],
  },
  {
    key: 'fii-charla-seguridad',
    program: { type: 'unit', unitKey: 'fii' },
    name: 'Charla de Seguridad Industrial',
    description: 'Buenas prácticas de seguridad e higiene ocupacional.',
    type: 'TALK',
    dayOffset: 21,
    startHour: 10,
    endHour: 12,
    maxCapacity: 40,
    classroomKey: 'aula-102',
    speakerKey: 'org-fii',
    status: 'SCHEDULED',
    equipment: ['Proyector'],
  },
  {
    key: 'fim-charla-mantenimiento',
    program: { type: 'unit', unitKey: 'fim' },
    name: 'Charla de Mantenimiento Predictivo',
    description: 'Introducción al mantenimiento predictivo con sensores IoT.',
    type: 'TALK',
    dayOffset: 25,
    startHour: 9,
    endHour: 11,
    maxCapacity: 35,
    classroomKey: 'aula-201',
    speakerKey: 'org-fim',
    status: 'SCHEDULED',
    equipment: ['Proyector', 'Sensores'],
  },
  {
    key: 'fisc-workshop-ciberseguridad',
    program: { type: 'unit', unitKey: 'fisc' },
    name: 'Workshop de Ciberseguridad Defensiva',
    description: 'Ejercicios de respuesta a incidentes y análisis de vulnerabilidades.',
    type: 'WORKSHOP',
    dayOffset: -21,
    startHour: 14,
    endHour: 17,
    maxCapacity: 25,
    classroomKey: 'lab-redes',
    speakerKey: 'speaker-ana',
    status: 'COMPLETED',
    equipment: ['Computadoras', 'Proyector'],
  },
  {
    key: 'fisc-charla-ia',
    program: { type: 'unit', unitKey: 'fisc' },
    name: 'Charla de Inteligencia Artificial Aplicada',
    description: 'Casos de uso de IA en la industria panameña.',
    type: 'TALK',
    dayOffset: 0,
    startHour: 8,
    endHour: 17,
    maxCapacity: 80,
    classroomKey: null,
    speakerKey: 'speaker-ana',
    status: 'ONGOING',
    equipment: ['Proyector', 'Micrófono'],
  },
  {
    key: 'fct-seminario-alimentos',
    program: { type: 'unit', unitKey: 'fct' },
    name: 'Seminario de Alimentos Funcionales',
    description: 'Avances en alimentos funcionales y nutracéuticos.',
    type: 'SEMINAR',
    dayOffset: 28,
    startHour: 9,
    endHour: 11,
    maxCapacity: 24,
    classroomKey: 'lab-quimica',
    speakerKey: 'speaker-ivan',
    status: 'SCHEDULED',
    equipment: ['Proyector', 'Mesas'],
  },
  {
    key: 'sub-acad-taller-curriculo',
    program: { type: 'unit', unitKey: 'sub-acad' },
    name: 'Taller de Diseño Curricular por Competencias',
    description: 'Taller para coordinadores académicos sobre diseño curricular.',
    type: 'WORKSHOP',
    dayOffset: 30,
    startHour: 8,
    endHour: 12,
    maxCapacity: 60,
    classroomKey: 'sala-conferencias',
    speakerKey: 'org-sub-acad',
    status: 'SCHEDULED',
    equipment: ['Proyector', 'Pizarra'],
  },
  {
    key: 'sub-admin-induccion',
    program: { type: 'unit', unitKey: 'sub-admin' },
    name: 'Inducción de Procesos Administrativos',
    description: 'Inducción al personal administrativo de nuevo ingreso.',
    type: 'TALK',
    dayOffset: -18,
    startHour: 8,
    endHour: 10,
    maxCapacity: 40,
    classroomKey: 'aula-102',
    speakerKey: 'org-sub-admin',
    status: 'COMPLETED',
    equipment: ['Proyector'],
  },
  {
    key: 'sub-vida-salud-mental',
    program: { type: 'unit', unitKey: 'sub-vida' },
    name: 'Jornada de Salud Mental',
    description: 'Charla sobre manejo del estrés y bienestar emocional.',
    type: 'TALK',
    dayOffset: 32,
    startHour: 14,
    endHour: 16,
    maxCapacity: 120,
    classroomKey: 'auditorio',
    speakerKey: 'org-sub-vida',
    status: 'SCHEDULED',
    equipment: ['Proyector', 'Micrófono'],
  },
  {
    key: 'sub-ipe-propiedad-intelectual',
    program: { type: 'unit', unitKey: 'sub-ipe' },
    name: 'Seminario de Propiedad Intelectual',
    description: 'Protección de resultados de investigación y transferencia.',
    type: 'SEMINAR',
    dayOffset: 35,
    startHour: 13,
    endHour: 15,
    maxCapacity: 60,
    classroomKey: 'sala-conferencias',
    speakerKey: 'org-sub-ipe',
    status: 'SCHEDULED',
    equipment: ['Proyector'],
  },
  {
    key: 'semana-ic-taller-estructuras',
    program: { type: 'additional', programKey: 'semana-ic' },
    name: 'Taller de Análisis Estructural',
    description: 'Taller de modelado estructural asistido por computadora.',
    type: 'WORKSHOP',
    dayOffset: -33,
    startHour: 9,
    endHour: 12,
    maxCapacity: 20,
    classroomKey: 'lab-mecanica',
    speakerKey: 'org-fic',
    status: 'COMPLETED',
    equipment: ['Computadoras', 'Mesa de ensayos'],
  },
  {
    key: 'semana-ic-charla-puentes',
    program: { type: 'additional', programKey: 'semana-ic' },
    name: 'Conferencia de Puentes y Estructuras',
    description: 'Conferencia magistral sobre puentes de gran luz.',
    type: 'TALK',
    dayOffset: -31,
    startHour: 10,
    endHour: 12,
    maxCapacity: 40,
    classroomKey: 'aula-101',
    speakerKey: 'speaker-carlos',
    status: 'COMPLETED',
    equipment: ['Proyector'],
  },
  {
    key: 'semana-ic-taller-topografia',
    program: { type: 'additional', programKey: 'semana-ic' },
    name: 'Taller de Topografía Satelital',
    description: 'Uso de GNSS en levantamientos topográficos.',
    type: 'WORKSHOP',
    dayOffset: -29,
    startHour: 14,
    endHour: 17,
    maxCapacity: 24,
    classroomKey: 'lab-electronica',
    speakerKey: 'org-fic',
    status: 'COMPLETED',
    equipment: ['GNSS', 'Proyector'],
  },
  {
    key: 'cit-conferencia-ia',
    program: { type: 'additional', programKey: 'congreso-cit' },
    name: 'Conferencia Magistral de IA',
    description: 'Conferencia inaugural del congreso sobre inteligencia artificial.',
    type: 'TALK',
    dayOffset: 16,
    startHour: 9,
    endHour: 11,
    maxCapacity: 120,
    classroomKey: 'auditorio',
    speakerKey: 'speaker-ana',
    status: 'SCHEDULED',
    equipment: ['Proyector', 'Micrófono', 'Streaming'],
  },
  {
    key: 'cit-taller-ciberseguridad',
    program: { type: 'additional', programKey: 'congreso-cit' },
    name: 'Taller de Ciberseguridad Ofensiva',
    description: 'Laboratorio controlado de pruebas de penetración.',
    type: 'WORKSHOP',
    dayOffset: 18,
    startHour: 14,
    endHour: 17,
    maxCapacity: 25,
    classroomKey: 'lab-redes',
    speakerKey: 'speaker-ana',
    status: 'SCHEDULED',
    equipment: ['Computadoras', 'Proyector'],
  },
  {
    key: 'cit-panel-blockchain',
    program: { type: 'additional', programKey: 'congreso-cit' },
    name: 'Panel de Blockchain y Fintech',
    description: 'Panel de discusión con expertos en tecnología financiera.',
    type: 'SEMINAR',
    dayOffset: 20,
    startHour: 10,
    endHour: 12,
    maxCapacity: 60,
    classroomKey: 'sala-conferencias',
    speakerKey: 'speaker-diana',
    status: 'SCHEDULED',
    equipment: ['Proyector', 'Micrófono'],
  },
  {
    key: 'bienestar-charla-salud-mental',
    program: { type: 'additional', programKey: 'jornada-bienestar' },
    name: 'Charla de Manejo del Estrés',
    description: 'Herramientas psicológicas para el manejo del estrés académico.',
    type: 'TALK',
    dayOffset: 23,
    startHour: 10,
    endHour: 12,
    maxCapacity: 120,
    classroomKey: 'auditorio',
    speakerKey: 'org-sub-vida',
    status: 'SCHEDULED',
    equipment: ['Proyector', 'Micrófono'],
  },
  {
    key: 'bienestar-taller-nutricion',
    program: { type: 'additional', programKey: 'jornada-bienestar' },
    name: 'Taller de Nutrición Saludable',
    description: 'Hábitos alimenticios para la vida universitaria.',
    type: 'WORKSHOP',
    dayOffset: 25,
    startHour: 14,
    endHour: 16,
    maxCapacity: 35,
    classroomKey: 'aula-201',
    speakerKey: 'org-sub-vida',
    status: 'SCHEDULED',
    equipment: ['Proyector', 'Muestras'],
  },
  {
    key: 'foro-ipe-conferencia-investigacion',
    program: { type: 'additional', programKey: 'foro-ipe' },
    name: 'Conferencia de Investigación Aplicada',
    description: 'Resultados de proyectos de investigación aplicada.',
    type: 'TALK',
    dayOffset: -320,
    startHour: 9,
    endHour: 11,
    maxCapacity: 60,
    classroomKey: 'sala-conferencias',
    speakerKey: 'org-sub-ipe',
    status: 'COMPLETED',
    equipment: ['Proyector'],
  },
  {
    key: 'foro-ipe-taller-publicaciones',
    program: { type: 'additional', programKey: 'foro-ipe' },
    name: 'Taller de Publicaciones Científicas',
    description: 'Cómo publicar en revistas indexadas.',
    type: 'WORKSHOP',
    dayOffset: -318,
    startHour: 14,
    endHour: 16,
    maxCapacity: 40,
    classroomKey: 'aula-102',
    speakerKey: 'org-sub-ipe',
    status: 'COMPLETED',
    equipment: ['Proyector', 'Pizarra'],
  },
];

export interface SeedActivity {
  id: string;
  key: string;
  programId: string;
  date: Date;
  startHour: number;
  endHour: number;
}

export interface SeedActivityInput {
  catalog: OrganizationCatalog;
  additionalPrograms: Map<string, SeedProgram>;
  users: Map<string, SeedUser>;
  classrooms: Map<string, string>;
}

const resolveProgramId = (
  program: ProgramRef,
  input: Pick<SeedActivityInput, 'catalog' | 'additionalPrograms'>,
): string => {
  if (program.type === 'unit') {
    return requireEntry(input.catalog.units, program.unitKey, 'unidad organizativa').programId;
  }
  return requireEntry(input.additionalPrograms, program.programKey, 'programa adicional').id;
};

export const seedActivities = async (
  prisma: PrismaClient,
  input: SeedActivityInput,
  now: Date = new Date(),
): Promise<Map<string, SeedActivity>> => {
  logStep('Sembrando actividades y equipamiento...');
  const activities = new Map<string, SeedActivity>();

  for (const activity of ACTIVITIES) {
    const programId = resolveProgramId(activity.program, input);
    const date = dateOffset(activity.dayOffset, now);
    const startTime = timeOfDay(activity.startHour);
    const endTime = timeOfDay(activity.endHour);
    const classroomId = activity.classroomKey
      ? requireEntry(input.classrooms, activity.classroomKey, 'aula')
      : null;
    const speakerId = activity.speakerKey
      ? requireEntry(input.users, activity.speakerKey, 'usuario').id
      : null;
    const activityId = seedId('activity', activity.key);

    const data = {
      name: activity.name,
      description: activity.description,
      type: activity.type,
      date,
      startTime,
      endTime,
      maxCapacity: activity.maxCapacity,
      status: activity.status,
      eventProgramId: programId,
      classroomId,
      speakerId,
    };

    const existing = await prisma.activity.findUnique({
      where: { id: activityId },
      select: { id: true },
    });

    const record = existing
      ? await prisma.activity.update({
          where: { id: existing.id },
          data,
          select: { id: true },
        })
      : await prisma.activity.create({
          data: { id: activityId, ...data },
          select: { id: true },
        });

    await prisma.activityEquipment.deleteMany({ where: { activityId: record.id } });
    await prisma.activityEquipment.createMany({
      data: activity.equipment.map((name) => ({ activityId: record.id, name })),
      skipDuplicates: true,
    });

    activities.set(activity.key, {
      id: record.id,
      key: activity.key,
      programId,
      date,
      startHour: activity.startHour,
      endHour: activity.endHour,
    });
  }

  return activities;
};
