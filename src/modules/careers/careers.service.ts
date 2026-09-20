import { getPrismaClient } from '../../config/prisma.js';
import { ApiError } from '../../utils/ApiError.js';
import type { ListCareersQuery } from './careers.schemas.js';
import type {
  CareerSummary,
  CreateCareerInput,
  PaginatedCareers,
  UpdateCareerInput,
} from './careers.types.js';

const OTROS_CAREER_CODE = 'OTROS';
const GLOBAL_UNIT_FILTER = 'global';

const careerSelect = {
  id: true,
  name: true,
  code: true,
  description: true,
  unit: { select: { id: true, name: true, code: true } },
} as const;

const isUniqueConstraintViolation = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: unknown }).code === 'P2002';

const assertUnitAvailable = async (unitId: string): Promise<void> => {
  const unit = await getPrismaClient().organizationalUnit.findUnique({
    where: { id: unitId },
    select: { id: true, type: true, isActive: true },
  });

  if (!unit) {
    throw new ApiError(404, 'Organizational unit not found.');
  }
  if (unit.type !== 'FACULTY') {
    throw new ApiError(400, 'Careers can only belong to a faculty.');
  }
  if (!unit.isActive) {
    throw new ApiError(400, 'Organizational unit is inactive.');
  }
};

export const listCareers = async (query: ListCareersQuery): Promise<PaginatedCareers> => {
  const prisma = getPrismaClient();

  const unitFilter =
    query.unitId === GLOBAL_UNIT_FILTER
      ? { unitId: null }
      : query.unitId
        ? { OR: [{ unitId: query.unitId }, { unitId: null }] }
        : undefined;

  const searchFilter = query.q
    ? {
        OR: [
          { name: { contains: query.q, mode: 'insensitive' as const } },
          { code: { contains: query.q, mode: 'insensitive' as const } },
        ],
      }
    : undefined;

  const filters = [unitFilter, searchFilter].filter((filter) => filter !== undefined);
  const where = filters.length > 0 ? { AND: filters } : {};
  const skip = (query.page - 1) * query.limit;

  const [items, total] = await Promise.all([
    prisma.career.findMany({
      where,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      skip,
      take: query.limit,
      select: careerSelect,
    }),
    prisma.career.count({ where }),
  ]);

  return {
    items,
    page: query.page,
    limit: query.limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / query.limit),
  };
};

export const createCareer = async (input: CreateCareerInput): Promise<CareerSummary> => {
  const prisma = getPrismaClient();

  if (input.unitId) {
    await assertUnitAvailable(input.unitId);
  }

  const existing = await prisma.career.findUnique({
    where: { code: input.code },
    select: { id: true },
  });

  if (existing) {
    throw new ApiError(409, 'Career code already exists.');
  }

  try {
    return await prisma.career.create({
      data: {
        name: input.name,
        code: input.code,
        description: input.description ?? null,
        unitId: input.unitId ?? null,
      },
      select: careerSelect,
    });
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      throw new ApiError(409, 'Career code already exists.');
    }
    throw error;
  }
};

export const updateCareer = async (
  id: string,
  input: UpdateCareerInput,
): Promise<CareerSummary> => {
  const prisma = getPrismaClient();
  const career = await prisma.career.findUnique({
    where: { id },
    select: { id: true, code: true, unitId: true },
  });

  if (!career) {
    throw new ApiError(404, 'Career not found.');
  }

  if (career.code === OTROS_CAREER_CODE) {
    if (input.code !== undefined && input.code !== OTROS_CAREER_CODE) {
      throw new ApiError(409, 'The Otros career code cannot be changed.');
    }
    if (input.unitId !== undefined && input.unitId !== null) {
      throw new ApiError(409, 'The Otros career must remain global.');
    }
  }

  if (input.unitId !== undefined && input.unitId !== null) {
    await assertUnitAvailable(input.unitId);
  }

  if (input.unitId !== undefined && input.unitId !== career.unitId) {
    const associatedUsers = await prisma.user.count({ where: { careerId: id } });

    if (associatedUsers > 0) {
      throw new ApiError(409, 'Cannot change the unit of a career with associated users.');
    }
  }

  try {
    return await prisma.career.update({
      where: { id: career.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.code !== undefined ? { code: input.code } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.unitId !== undefined ? { unitId: input.unitId } : {}),
      },
      select: careerSelect,
    });
  } catch (error) {
    if (isUniqueConstraintViolation(error)) {
      throw new ApiError(409, 'Career code already exists.');
    }
    throw error;
  }
};

export const deleteCareer = async (id: string): Promise<void> => {
  const prisma = getPrismaClient();
  const career = await prisma.career.findUnique({
    where: { id },
    select: { id: true, code: true },
  });

  if (!career) {
    throw new ApiError(404, 'Career not found.');
  }
  if (career.code === OTROS_CAREER_CODE) {
    throw new ApiError(409, 'The global Otros career cannot be deleted.');
  }

  await prisma.$transaction(async (tx) => {
    const associatedUsers = await tx.user.count({ where: { careerId: id } });

    if (associatedUsers > 0) {
      throw new ApiError(409, 'Career has associated users.');
    }

    await tx.career.delete({ where: { id } });
  });
};
