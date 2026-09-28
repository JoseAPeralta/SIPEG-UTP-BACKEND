import { getPrismaClient } from '../../config/prisma.js';
import type { ProgramStatus, UnitType } from '../../generated/prisma/enums.js';
import { ApiError } from '../../utils/ApiError.js';
import { writeAuditEvent } from '../audit/audit.service.js';
import type { AuditContext, AuditEventInput } from '../audit/audit.types.js';
import type { ListOrganizationalUnitsQuery } from './organizational-units.schemas.js';
import type {
  CreateOrganizationalUnitInput,
  OrganizationalUnitDetail,
  PaginatedOrganizationalUnits,
  UpdateOrganizationalUnitInput,
} from './organizational-units.types.js';

const unitSummarySelect = {
  id: true,
  name: true,
  code: true,
  description: true,
  type: true,
  isActive: true,
  head: { select: { id: true, firstName: true, lastName: true } },
} as const;

const unitDetailSelect = {
  ...unitSummarySelect,
  careers: {
    select: { id: true, name: true, code: true },
    orderBy: { name: 'asc' as const },
  },
  eventPrograms: {
    where: { isDefault: true },
    take: 1,
    select: { id: true, name: true, status: true },
  },
} as const;

interface OrganizationalUnitDetailRecord {
  id: string;
  name: string;
  code: string;
  description: string | null;
  type: UnitType;
  isActive: boolean;
  head: { id: string; firstName: string; lastName: string } | null;
  careers: { id: string; name: string; code: string }[];
  eventPrograms: { id: string; name: string; status: ProgramStatus }[];
}

const toOrganizationalUnitDetail = (
  record: OrganizationalUnitDetailRecord,
): OrganizationalUnitDetail => ({
  id: record.id,
  name: record.name,
  code: record.code,
  description: record.description,
  type: record.type,
  isActive: record.isActive,
  head: record.head,
  careers: record.careers,
  defaultProgram: record.eventPrograms[0] ?? null,
});

const assertHeadUserAvailable = async (headId: string | null | undefined): Promise<void> => {
  if (!headId) {
    return;
  }

  const user = await getPrismaClient().user.findUnique({
    where: { id: headId },
    select: { id: true, isActive: true },
  });

  if (!user) {
    throw new ApiError(404, 'User not found.');
  }
  if (!user.isActive) {
    throw new ApiError(400, 'Head user is inactive.');
  }
};

const isUniqueConstraintViolation = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: unknown }).code === 'P2002';

const buildUnitUpdateAuditEvent = (
  current: { id: string; name: string; description: string | null; headId: string | null },
  input: UpdateOrganizationalUnitInput,
  auditContext: AuditContext,
): AuditEventInput | null => {
  const changedFields: string[] = [];
  let headChanged = false;

  if (input.name !== undefined && input.name !== current.name) {
    changedFields.push('name');
  }

  if (input.description !== undefined && input.description !== current.description) {
    changedFields.push('description');
  }

  if (input.headId !== undefined && input.headId !== current.headId) {
    headChanged = true;
  }

  if (!headChanged && changedFields.length === 0) {
    return null;
  }

  return {
    ...auditContext,
    action: 'organizational_unit.updated',
    resourceType: 'organizational_unit',
    resourceId: current.id,
    ...(headChanged
      ? { changes: { before: { headId: current.headId }, after: { headId: input.headId ?? null } } }
      : {}),
    ...(changedFields.length > 0 ? { metadata: { changedFields } } : {}),
  };
};

export const listOrganizationalUnits = async (
  query: ListOrganizationalUnitsQuery,
): Promise<PaginatedOrganizationalUnits> => {
  const prisma = getPrismaClient();
  const where = {
    isActive: query.isActive ?? true,
    ...(query.type ? { type: query.type } : {}),
    ...(query.q
      ? {
          OR: [
            { name: { contains: query.q, mode: 'insensitive' as const } },
            { code: { contains: query.q, mode: 'insensitive' as const } },
          ],
        }
      : {}),
  };
  const skip = (query.page - 1) * query.limit;

  const [items, total] = await Promise.all([
    prisma.organizationalUnit.findMany({
      where,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      skip,
      take: query.limit,
      select: unitSummarySelect,
    }),
    prisma.organizationalUnit.count({ where }),
  ]);

  return {
    items,
    page: query.page,
    limit: query.limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / query.limit),
  };
};

export const getOrganizationalUnitById = async (id: string): Promise<OrganizationalUnitDetail> => {
  const prisma = getPrismaClient();
  const record = await prisma.organizationalUnit.findUnique({
    where: { id },
    select: unitDetailSelect,
  });

  if (!record) {
    throw new ApiError(404, 'Organizational unit not found.');
  }

  return toOrganizationalUnitDetail(record);
};

export const createOrganizationalUnit = async (
  input: CreateOrganizationalUnitInput,
  auditContext: AuditContext = {},
): Promise<OrganizationalUnitDetail> => {
  const prisma = getPrismaClient();
  await assertHeadUserAvailable(input.headId);

  const existing = await prisma.organizationalUnit.findUnique({
    where: { code: input.code },
    select: { id: true },
  });

  if (existing) {
    throw new ApiError(409, 'Organizational unit code already exists.');
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const unit = await tx.organizationalUnit.create({
        data: {
          name: input.name,
          code: input.code,
          description: input.description ?? null,
          type: input.type,
          headId: input.headId ?? null,
          isActive: true,
        },
        select: { id: true },
      });

      await tx.eventProgram.create({
        data: {
          name: `Programa de Eventos - ${input.name}`,
          description: `Programa predeterminado de ${input.name}.`,
          organizationalUnitId: unit.id,
          isDefault: true,
          status: 'ACTIVE',
        },
        select: { id: true },
      });

      const record = await tx.organizationalUnit.findUnique({
        where: { id: unit.id },
        select: unitDetailSelect,
      });

      if (!record) {
        throw new ApiError(500, 'Organizational unit could not be created.');
      }

      await writeAuditEvent(tx, {
        ...auditContext,
        action: 'organizational_unit.created',
        resourceType: 'organizational_unit',
        resourceId: unit.id,
        changes: {
          after: {
            type: input.type,
            isActive: true,
            headId: input.headId ?? null,
          },
        },
      });

      return toOrganizationalUnitDetail(record);
    });
  } catch (error) {
    if (error instanceof ApiError) {
      throw error;
    }
    if (isUniqueConstraintViolation(error)) {
      throw new ApiError(409, 'Organizational unit code already exists.');
    }
    throw error;
  }
};

export const updateOrganizationalUnit = async (
  id: string,
  input: UpdateOrganizationalUnitInput,
  auditContext: AuditContext = {},
): Promise<OrganizationalUnitDetail> => {
  const prisma = getPrismaClient();
  const unit = await prisma.organizationalUnit.findUnique({
    where: { id },
    select: { id: true, name: true, description: true, headId: true },
  });

  if (!unit) {
    throw new ApiError(404, 'Organizational unit not found.');
  }

  await assertHeadUserAvailable(input.headId);

  const auditEvent = buildUnitUpdateAuditEvent(unit, input, auditContext);

  const record = await prisma.$transaction(async (tx) => {
    const updated = await tx.organizationalUnit.update({
      where: { id: unit.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.headId !== undefined ? { headId: input.headId } : {}),
      },
      select: unitDetailSelect,
    });

    if (auditEvent) {
      await writeAuditEvent(tx, auditEvent);
    }

    return updated;
  });

  return toOrganizationalUnitDetail(record);
};

export const deactivateOrganizationalUnit = async (
  id: string,
  auditContext: AuditContext = {},
): Promise<OrganizationalUnitDetail> => {
  const prisma = getPrismaClient();
  const unit = await prisma.organizationalUnit.findUnique({
    where: { id },
    select: {
      id: true,
      isActive: true,
      eventPrograms: { where: { isDefault: true }, take: 1, select: { id: true } },
    },
  });

  if (!unit) {
    throw new ApiError(404, 'Organizational unit not found.');
  }
  if (!unit.isActive) {
    throw new ApiError(409, 'Organizational unit is already inactive.');
  }

  const defaultProgram = unit.eventPrograms[0];
  if (!defaultProgram) {
    throw new ApiError(409, 'Organizational unit does not have a default event program.');
  }

  const blockingActivities = await prisma.activity.count({
    where: { eventProgramId: defaultProgram.id, status: { in: ['SCHEDULED', 'ONGOING'] } },
  });

  if (blockingActivities > 0) {
    throw new ApiError(
      409,
      'Cannot deactivate an organizational unit whose default event program has scheduled or ongoing activities.',
    );
  }

  return prisma.$transaction(async (tx) => {
    await tx.organizationalUnit.update({
      where: { id: unit.id },
      data: { isActive: false },
      select: { id: true },
    });

    await tx.eventProgram.update({
      where: { id: defaultProgram.id },
      data: { status: 'ARCHIVED', archivedAt: new Date() },
      select: { id: true },
    });

    const record = await tx.organizationalUnit.findUnique({
      where: { id: unit.id },
      select: unitDetailSelect,
    });

    if (!record) {
      throw new ApiError(500, 'Organizational unit could not be deactivated.');
    }

    await writeAuditEvent(tx, {
      ...auditContext,
      action: 'organizational_unit.deactivated',
      resourceType: 'organizational_unit',
      resourceId: unit.id,
      changes: {
        before: { isActive: true },
        after: { isActive: false },
      },
    });

    return toOrganizationalUnitDetail(record);
  });
};

export const reactivateOrganizationalUnit = async (
  id: string,
  auditContext: AuditContext = {},
): Promise<OrganizationalUnitDetail> => {
  const prisma = getPrismaClient();
  const unit = await prisma.organizationalUnit.findUnique({
    where: { id },
    select: {
      id: true,
      isActive: true,
      eventPrograms: { where: { isDefault: true }, take: 1, select: { id: true } },
    },
  });

  if (!unit) {
    throw new ApiError(404, 'Organizational unit not found.');
  }
  if (unit.isActive) {
    throw new ApiError(409, 'Organizational unit is already active.');
  }
  if (unit.eventPrograms.length === 0) {
    throw new ApiError(409, 'Organizational unit does not have a default event program.');
  }

  return prisma.$transaction(async (tx) => {
    await tx.organizationalUnit.update({
      where: { id: unit.id },
      data: { isActive: true },
      select: { id: true },
    });

    const record = await tx.organizationalUnit.findUnique({
      where: { id: unit.id },
      select: unitDetailSelect,
    });

    if (!record) {
      throw new ApiError(500, 'Organizational unit could not be reactivated.');
    }

    await writeAuditEvent(tx, {
      ...auditContext,
      action: 'organizational_unit.reactivated',
      resourceType: 'organizational_unit',
      resourceId: unit.id,
      changes: {
        before: { isActive: false },
        after: { isActive: true },
      },
    });

    return toOrganizationalUnitDetail(record);
  });
};
