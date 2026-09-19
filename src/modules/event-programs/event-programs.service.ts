import { getPrismaClient } from '../../config/prisma.js';
import type { ProgramStatus, UnitType } from '../../generated/prisma/enums.js';
import { ApiError } from '../../utils/ApiError.js';
import type {
  CreateEventProgramBody,
  ListEventProgramsQuery,
  UpdateEventProgramBody,
} from './event-programs.schemas.js';
import type { EventProgramDetail, PaginatedEventPrograms } from './event-programs.types.js';

const eventProgramDetailSelect = {
  id: true,
  name: true,
  description: true,
  label: true,
  bannerUrl: true,
  isDefault: true,
  status: true,
  startDate: true,
  endDate: true,
  organizationalUnit: { select: { id: true, name: true, type: true } },
} as const;

interface EventProgramDetailRecord {
  id: string;
  name: string;
  description: string | null;
  label: string | null;
  bannerUrl: string | null;
  isDefault: boolean;
  status: ProgramStatus;
  startDate: Date | null;
  endDate: Date | null;
  organizationalUnit: { id: string; name: string; type: UnitType };
}

const formatDate = (value: Date | null): string | null =>
  value ? value.toISOString().slice(0, 10) : null;

const toEventProgramDetail = (record: EventProgramDetailRecord): EventProgramDetail => ({
  id: record.id,
  name: record.name,
  description: record.description,
  label: record.label,
  bannerUrl: record.bannerUrl,
  isDefault: record.isDefault,
  status: record.status,
  startDate: formatDate(record.startDate),
  endDate: formatDate(record.endDate),
  organizationalUnit: record.organizationalUnit,
});

export const listEventPrograms = async (
  query: ListEventProgramsQuery,
): Promise<PaginatedEventPrograms> => {
  const prisma = getPrismaClient();
  const where = {
    status: 'ACTIVE' as const,
    ...(query.organizationalUnitId ? { organizationalUnitId: query.organizationalUnitId } : {}),
    ...(query.unitType ? { organizationalUnit: { type: query.unitType } } : {}),
    ...(query.q
      ? {
          OR: [
            { name: { contains: query.q, mode: 'insensitive' as const } },
            { label: { contains: query.q, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };
  const skip = (query.page - 1) * query.limit;

  const [records, total] = await Promise.all([
    prisma.eventProgram.findMany({
      where,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      skip,
      take: query.limit,
      select: eventProgramDetailSelect,
    }),
    prisma.eventProgram.count({ where }),
  ]);

  return {
    items: records.map(toEventProgramDetail),
    page: query.page,
    limit: query.limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / query.limit),
  };
};

export const createEventProgram = async (
  input: CreateEventProgramBody,
  createdById: string,
): Promise<EventProgramDetail> => {
  const prisma = getPrismaClient();
  const organizationalUnit = await prisma.organizationalUnit.findUnique({
    where: { id: input.organizationalUnitId },
    select: { id: true, isActive: true },
  });

  if (!organizationalUnit) {
    throw new ApiError(404, 'Organizational unit not found.');
  }
  if (!organizationalUnit.isActive) {
    throw new ApiError(
      400,
      'Event programs can only be created for an active organizational unit.',
    );
  }

  const record = await prisma.eventProgram.create({
    data: {
      name: input.name,
      description: input.description ?? null,
      label: input.label ?? null,
      bannerUrl: input.bannerUrl ?? null,
      isDefault: false,
      status: 'DRAFT',
      startDate: new Date(`${input.startDate}T00:00:00.000Z`),
      endDate: new Date(`${input.endDate}T00:00:00.000Z`),
      organizationalUnitId: organizationalUnit.id,
      createdById,
    },
    select: eventProgramDetailSelect,
  });

  return toEventProgramDetail(record);
};

export const updateEventProgram = async (
  id: string,
  input: UpdateEventProgramBody,
): Promise<EventProgramDetail> => {
  const prisma = getPrismaClient();

  const program = await prisma.eventProgram.findUnique({
    where: { id },
    select: { id: true, status: true, startDate: true, endDate: true },
  });

  if (!program) {
    throw new ApiError(404, 'Event program not found.');
  }
  if (program.status === 'ARCHIVED') {
    throw new ApiError(409, 'Archived event programs cannot be modified.');
  }

  const startDate =
    input.startDate !== undefined
      ? new Date(`${input.startDate}T00:00:00.000Z`)
      : program.startDate;
  const endDate =
    input.endDate !== undefined ? new Date(`${input.endDate}T00:00:00.000Z`) : program.endDate;

  if (startDate && endDate && endDate < startDate) {
    throw new ApiError(400, 'End date must be on or after start date.');
  }

  const data = {
    ...(input.name !== undefined ? { name: input.name } : {}),
    ...(input.description !== undefined ? { description: input.description } : {}),
    ...(input.label !== undefined ? { label: input.label } : {}),
    ...(input.bannerUrl !== undefined ? { bannerUrl: input.bannerUrl } : {}),
    ...(input.startDate !== undefined ? { startDate } : {}),
    ...(input.endDate !== undefined ? { endDate } : {}),
  };

  const record = await prisma.eventProgram.update({
    where: { id: program.id },
    data,
    select: eventProgramDetailSelect,
  });

  return toEventProgramDetail(record);
};
