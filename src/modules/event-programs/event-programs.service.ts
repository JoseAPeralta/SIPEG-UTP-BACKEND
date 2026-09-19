import { getPrismaClient } from '../../config/prisma.js';
import type { ProgramStatus, UnitType } from '../../generated/prisma/enums.js';
import { ApiError } from '../../utils/ApiError.js';
import type { CreateEventProgramBody } from './event-programs.schemas.js';
import type { EventProgramDetail } from './event-programs.types.js';

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
