import type { PrismaClient } from '../../src/generated/prisma/client.js';
import type { ClassroomType } from '../../src/generated/prisma/enums.js';
import { logStep, seedId, timeOfDay, type SeedWriteMode } from './helpers.js';

interface AvailabilityEntry {
  dayOfWeek: number;
  startHour: number;
  endHour: number;
  period: string;
}

interface ClassroomCatalogEntry {
  key: string;
  name: string;
  type: ClassroomType;
  capacity: number;
  building: string | null;
  floor: number | null;
  amenities: readonly string[];
  availability: readonly AvailabilityEntry[];
}

const WEEKDAY_MORNING: readonly AvailabilityEntry[] = [
  { dayOfWeek: 1, startHour: 7, endHour: 12, period: 'Matutino' },
  { dayOfWeek: 2, startHour: 7, endHour: 12, period: 'Matutino' },
  { dayOfWeek: 3, startHour: 7, endHour: 12, period: 'Matutino' },
  { dayOfWeek: 4, startHour: 7, endHour: 12, period: 'Matutino' },
  { dayOfWeek: 5, startHour: 7, endHour: 12, period: 'Matutino' },
];

const WEEKDAY_AFTERNOON: readonly AvailabilityEntry[] = [
  { dayOfWeek: 1, startHour: 13, endHour: 17, period: 'Vespertino' },
  { dayOfWeek: 2, startHour: 13, endHour: 17, period: 'Vespertino' },
  { dayOfWeek: 3, startHour: 13, endHour: 17, period: 'Vespertino' },
  { dayOfWeek: 4, startHour: 13, endHour: 17, period: 'Vespertino' },
  { dayOfWeek: 5, startHour: 13, endHour: 17, period: 'Vespertino' },
];

const SATURDAY_MORNING: readonly AvailabilityEntry[] = [
  { dayOfWeek: 6, startHour: 8, endHour: 12, period: 'Sabatino' },
];

const STANDARD_AVAILABILITY = [...WEEKDAY_MORNING, ...WEEKDAY_AFTERNOON];
const LAB_AVAILABILITY = [...WEEKDAY_MORNING, ...WEEKDAY_AFTERNOON, ...SATURDAY_MORNING];

const AULA_KEYS = Array.from({ length: 17 }, (_, index) => index + 1);

const AULAS: readonly ClassroomCatalogEntry[] = AULA_KEYS.map((number): ClassroomCatalogEntry => ({
  key: `a-${number}`,
  name: `A-${number}`,
  type: 'CLASSROOM',
  capacity: 30,
  building: null,
  floor: null,
  amenities: ['Proyector'],
  availability: STANDARD_AVAILABILITY,
}));

const SPECIAL_ROOMS: readonly ClassroomCatalogEntry[] = [
  {
    key: 'lai',
    name: 'LAI',
    type: 'LABORATORY',
    capacity: 24,
    building: null,
    floor: null,
    amenities: ['Smart Board', 'Computadoras'],
    availability: LAB_AVAILABILITY,
  },
  {
    key: 'fisc',
    name: 'FISC',
    type: 'LABORATORY',
    capacity: 24,
    building: null,
    floor: null,
    amenities: ['Smart Board', 'Computadoras'],
    availability: LAB_AVAILABILITY,
  },
  {
    key: 'fim',
    name: 'FIM',
    type: 'LABORATORY',
    capacity: 1,
    building: null,
    floor: null,
    amenities: ['Proyector'],
    availability: STANDARD_AVAILABILITY,
  },
  {
    key: 'p1',
    name: 'P1',
    type: 'CLASSROOM',
    capacity: 1,
    building: null,
    floor: null,
    amenities: ['Smart Board'],
    availability: STANDARD_AVAILABILITY,
  },
  {
    key: 'p2',
    name: 'P2',
    type: 'LABORATORY',
    capacity: 1,
    building: null,
    floor: null,
    amenities: ['Televisor Inteligente', 'Mesa de Conferencia'],
    availability: STANDARD_AVAILABILITY,
  },
  {
    key: 'salon-conferencias-galo',
    name: 'Salón de Conferencias Galo',
    type: 'CONFERENCE_ROOM',
    capacity: 1,
    building: null,
    floor: null,
    amenities: ['Smart Board'],
    availability: STANDARD_AVAILABILITY,
  },
];

export const CLASSROOMS: readonly ClassroomCatalogEntry[] = [...AULAS, ...SPECIAL_ROOMS];

export const seedClassrooms = async (
  prisma: PrismaClient,
  mode: SeedWriteMode = 'sync',
): Promise<Map<string, string>> => {
  logStep('Sembrando aulas, amenidades y disponibilidad...');
  const classrooms = new Map<string, string>();

  for (const classroom of CLASSROOMS) {
    const id = seedId('classroom', classroom.key);

    const existing = await prisma.classroom.findUnique({
      where: { id },
      select: { id: true },
    });

    if (existing && mode === 'ensure') {
      classrooms.set(classroom.key, existing.id);
      continue;
    }

    const record = await prisma.classroom.upsert({
      where: { id },
      update: {
        name: classroom.name,
        type: classroom.type,
        capacity: classroom.capacity,
        building: classroom.building,
        floor: classroom.floor,
        isActive: true,
      },
      create: {
        id,
        name: classroom.name,
        type: classroom.type,
        capacity: classroom.capacity,
        building: classroom.building,
        floor: classroom.floor,
        isActive: true,
      },
      select: { id: true },
    });

    await prisma.classroomAmenity.deleteMany({ where: { classroomId: record.id } });
    await prisma.classroomAmenity.createMany({
      data: classroom.amenities.map((amenity) => ({
        classroomId: record.id,
        amenity,
      })),
      skipDuplicates: true,
    });

    for (const slot of classroom.availability) {
      await prisma.classroomAvailability.upsert({
        where: {
          classroomId_dayOfWeek_startTime_endTime: {
            classroomId: record.id,
            dayOfWeek: slot.dayOfWeek,
            startTime: timeOfDay(slot.startHour),
            endTime: timeOfDay(slot.endHour),
          },
        },
        update: { period: slot.period },
        create: {
          classroomId: record.id,
          dayOfWeek: slot.dayOfWeek,
          startTime: timeOfDay(slot.startHour),
          endTime: timeOfDay(slot.endHour),
          period: slot.period,
        },
      });
    }

    classrooms.set(classroom.key, record.id);
  }

  return classrooms;
};
