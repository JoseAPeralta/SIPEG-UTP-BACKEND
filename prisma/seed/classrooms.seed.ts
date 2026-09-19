import type { PrismaClient } from '../../src/generated/prisma/client.js';
import type { ClassroomType } from '../../src/generated/prisma/enums.js';
import { logStep, seedId, timeOfDay } from './helpers.js';

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
  building: string;
  floor: number;
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

export const CLASSROOMS: readonly ClassroomCatalogEntry[] = [
  {
    key: 'aula-101',
    name: 'Aula 101',
    type: 'CLASSROOM',
    capacity: 40,
    building: 'Edificio 1',
    floor: 1,
    amenities: ['Proyector', 'Pizarra', 'Aire Acondicionado'],
    availability: STANDARD_AVAILABILITY,
  },
  {
    key: 'aula-102',
    name: 'Aula 102',
    type: 'CLASSROOM',
    capacity: 40,
    building: 'Edificio 1',
    floor: 1,
    amenities: ['Proyector', 'Pizarra'],
    availability: STANDARD_AVAILABILITY,
  },
  {
    key: 'aula-201',
    name: 'Aula 201',
    type: 'CLASSROOM',
    capacity: 35,
    building: 'Edificio 1',
    floor: 2,
    amenities: ['Pizarra', 'Aire Acondicionado'],
    availability: STANDARD_AVAILABILITY,
  },
  {
    key: 'lab-computo-1',
    name: 'Laboratorio de Cómputo 1',
    type: 'LABORATORY',
    capacity: 30,
    building: 'Edificio 3',
    floor: 1,
    amenities: ['Computadoras', 'Proyector', 'Aire Acondicionado'],
    availability: LAB_AVAILABILITY,
  },
  {
    key: 'lab-redes',
    name: 'Laboratorio de Redes',
    type: 'LABORATORY',
    capacity: 25,
    building: 'Edificio 3',
    floor: 2,
    amenities: ['Computadoras', 'Proyector'],
    availability: LAB_AVAILABILITY,
  },
  {
    key: 'lab-electronica',
    name: 'Laboratorio de Electrónica',
    type: 'LABORATORY',
    capacity: 24,
    building: 'Edificio 2',
    floor: 1,
    amenities: ['Mesas', 'Proyector'],
    availability: LAB_AVAILABILITY,
  },
  {
    key: 'lab-mecanica',
    name: 'Laboratorio de Mecánica',
    type: 'LABORATORY',
    capacity: 20,
    building: 'Edificio 4',
    floor: 1,
    amenities: ['Mesas', 'Escritorios'],
    availability: LAB_AVAILABILITY,
  },
  {
    key: 'lab-quimica',
    name: 'Laboratorio de Química',
    type: 'LABORATORY',
    capacity: 24,
    building: 'Edificio 5',
    floor: 1,
    amenities: ['Mesas', 'Pizarra'],
    availability: LAB_AVAILABILITY,
  },
  {
    key: 'auditorio',
    name: 'Auditorio Principal',
    type: 'CLASSROOM',
    capacity: 120,
    building: 'Edificio 1',
    floor: 1,
    amenities: ['Proyector', 'Smart Board', 'Aire Acondicionado'],
    availability: STANDARD_AVAILABILITY,
  },
  {
    key: 'sala-conferencias',
    name: 'Sala de Conferencias',
    type: 'CLASSROOM',
    capacity: 60,
    building: 'Edificio VIPE',
    floor: 1,
    amenities: ['Proyector', 'Smart Board', 'Aire Acondicionado'],
    availability: STANDARD_AVAILABILITY,
  },
];

export const seedClassrooms = async (prisma: PrismaClient): Promise<Map<string, string>> => {
  logStep('Sembrando aulas, amenidades y disponibilidad...');
  const classrooms = new Map<string, string>();

  for (const classroom of CLASSROOMS) {
    const id = seedId('classroom', classroom.key);
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
