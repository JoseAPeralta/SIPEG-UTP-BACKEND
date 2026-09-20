# Fase 2.A - Unidades organizativas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar los checklist 2.A.1 a 2.A.7 del plan maestro implementando el modulo `organizational-units`: listado publico paginado, detalle con carreras y programa predeterminado, creacion transaccional unidad+programa default, actualizacion con `code`/`type` inmutables, desactivacion/reactivacion atomica con tratamiento del programa default y la invariante del programa predeterminado.

**Architecture:** Modulo autocontenido `src/modules/organizational-units/` con el patron de `users`/`event-programs`: `authenticate -> requireAdmin -> validate -> controlador -> servicio -> Prisma`. Las lecturas son publicas y muestran solo unidades activas por defecto. La desactivacion actualiza primero `organizational_units.is_active=false` y despues archiva el programa predeterminado en la misma transaccion, porque el trigger `validate_event_program_transition` exige la unidad inactiva para archivar el default. La reactivacion solo cambia `is_active`; el trigger `reactivate_default_event_program` restaura el programa existente dentro de la misma transaccion.

**Tech Stack:** TypeScript 6, Express 5, Prisma 7 (SQL/Postgres), Zod 4, Vitest, Supertest, OpenAPI 3.1 (zod-openapi), Bruno.

**Hallazgos de partida (2026-09-20):**

- No existe `src/modules/organizational-units/`; el modelo `OrganizationalUnit` ya tiene `head_id`, `isActive`, `type` y relaciones `careers`/`eventPrograms`.
- Triggers vigentes de `prisma/migrations/20260919093000_unify_organizational_units/migration.sql`:
  - `event_programs_protect_identity`: `is_default` y unidad propietaria del default son inmutables.
  - `event_programs_validate_transition`: un programa default no se archiva con la unidad activa; uno adicional no se archiva con actividades `SCHEDULED`/`ONGOING`; los adicionales exigen `created_by_id` ADMIN.
  - `organizational_units_reactivate_default_program`: al pasar `is_active` de false a true restaura en la misma transaccion el unico programa default (`status=ACTIVE`, `archived_at=NULL`) y falla si no hay exactamente uno.
  - `event_programs_prevent_delete`: prohibe el borrado fisico de programas.
- `adminUserSelect`/`adminUserSchema` no se reutilizan: el head se expone solo como `{ id, firstName, lastName }`.
- `prisma/seed/base.seed.test.ts` y `pnpm prisma:seed` ya garantizan 10 unidades con sus 10 programas predeterminados.
- Patron de pruebas: `users.routes.test.ts` (JWT con `jose`, `vi.doMock` de Prisma y del verificador) y `users.service.test.ts` (`vi.doMock('../../config/prisma.js')`).

**Decisiones confirmadas (2026-09-20):**

1. `GET /organizational-units` y `GET /organizational-units/:id` son publicos; el listado devuelve solo activas salvo `isActive=false`.
2. Desactivar archiva el programa predeterminado en la misma transaccion (unidad primero, programa despues). Reactivar delega la restauracion al trigger de BD.
3. `headId` acepta cualquier usuario activo; `null` quita el encargado.

**Sin cambios de esquema, migraciones, variables de entorno ni catalogo de permisos** (decision 7 del maestro: catalogos solo ADMIN).

---

### Task 1: Tipos y esquemas Zod (TDD)

**Files:**

- Create: `src/modules/organizational-units/organizational-units.types.ts`
- Create: `src/modules/organizational-units/organizational-units.schemas.ts`
- Test: `src/modules/organizational-units/organizational-units.schemas.test.ts`

- [x] **Step 1: Escribir los tipos**

`src/modules/organizational-units/organizational-units.types.ts`:

```ts
import type { ProgramStatus, UnitType } from '../../generated/prisma/enums.js';

export interface OrganizationalUnitHead {
  id: string;
  firstName: string;
  lastName: string;
}

export interface OrganizationalUnitCareer {
  id: string;
  name: string;
  code: string;
}

export interface DefaultEventProgram {
  id: string;
  name: string;
  status: ProgramStatus;
}

export interface OrganizationalUnitSummary {
  id: string;
  name: string;
  code: string;
  description: string | null;
  type: UnitType;
  isActive: boolean;
  head: OrganizationalUnitHead | null;
}

export interface OrganizationalUnitDetail extends OrganizationalUnitSummary {
  careers: OrganizationalUnitCareer[];
  defaultProgram: DefaultEventProgram | null;
}

export interface PaginatedOrganizationalUnits {
  items: OrganizationalUnitSummary[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface CreateOrganizationalUnitInput {
  name: string;
  code: string;
  description?: string | null | undefined;
  type: UnitType;
  headId?: string | null | undefined;
}

export interface UpdateOrganizationalUnitInput {
  name?: string | undefined;
  description?: string | null | undefined;
  headId?: string | null | undefined;
}
```

- [x] **Step 2: Escribir las pruebas rojas del esquema**

`src/modules/organizational-units/organizational-units.schemas.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  createOrganizationalUnitSchema,
  listOrganizationalUnitsQuerySchema,
  organizationalUnitParamsSchema,
  updateOrganizationalUnitSchema,
} from './organizational-units.schemas.js';

describe('listOrganizationalUnitsQuerySchema', () => {
  it('applies pagination defaults without forcing isActive', () => {
    expect(listOrganizationalUnitsQuerySchema.parse({ query: {} })).toEqual({
      query: { page: 1, limit: 20 },
    });
  });

  it('coerces and validates pagination bounds', () => {
    expect(listOrganizationalUnitsQuerySchema.parse({ query: { page: '2', limit: '50' } })).toEqual(
      { query: { page: 2, limit: 50 } },
    );
    expect(() => listOrganizationalUnitsQuerySchema.parse({ query: { limit: '51' } })).toThrow();
    expect(() => listOrganizationalUnitsQuerySchema.parse({ query: { page: '0' } })).toThrow();
  });

  it('parses type, status and search filters', () => {
    expect(
      listOrganizationalUnitsQuerySchema.parse({
        query: { type: 'FACULTY', isActive: 'false', q: '  fic  ' },
      }),
    ).toEqual({ query: { page: 1, limit: 20, type: 'FACULTY', isActive: false, q: 'fic' } });
  });

  it('rejects invalid filters and unknown keys', () => {
    expect(() => listOrganizationalUnitsQuerySchema.parse({ query: { type: 'CENTER' } })).toThrow();
    expect(() =>
      listOrganizationalUnitsQuerySchema.parse({ query: { isActive: 'yes' } }),
    ).toThrow();
    expect(() => listOrganizationalUnitsQuerySchema.parse({ query: { unknown: 'x' } })).toThrow();
  });

  it('rejects an empty search term', () => {
    expect(() => listOrganizationalUnitsQuerySchema.parse({ query: { q: '   ' } })).toThrow();
  });
});

describe('organizationalUnitParamsSchema', () => {
  it('accepts and trims a unit id', () => {
    expect(organizationalUnitParamsSchema.parse({ params: { id: ' unit-001 ' } })).toEqual({
      params: { id: 'unit-001' },
    });
  });

  it('rejects an empty or whitespace unit id', () => {
    expect(() => organizationalUnitParamsSchema.parse({ params: { id: '' } })).toThrow();
    expect(() => organizationalUnitParamsSchema.parse({ params: { id: '   ' } })).toThrow();
  });

  it('rejects an oversized unit id', () => {
    expect(() =>
      organizationalUnitParamsSchema.parse({ params: { id: 'a'.repeat(101) } }),
    ).toThrow();
  });
});

describe('createOrganizationalUnitSchema', () => {
  it('normalizes the code to uppercase and trims values', () => {
    expect(
      createOrganizationalUnitSchema.parse({
        body: { name: '  Facultad de Pruebas  ', code: ' tmp-2a ', type: 'FACULTY' },
      }),
    ).toEqual({
      body: { name: 'Facultad de Pruebas', code: 'TMP-2A', type: 'FACULTY' },
    });
  });

  it('accepts null description and headId', () => {
    expect(
      createOrganizationalUnitSchema.parse({
        body: {
          name: 'Subdireccion',
          code: 'SUB-TEST',
          description: null,
          type: 'SUBDIRECTORATE',
          headId: null,
        },
      }),
    ).toEqual({
      body: {
        name: 'Subdireccion',
        code: 'SUB-TEST',
        description: null,
        type: 'SUBDIRECTORATE',
        headId: null,
      },
    });
  });

  it('rejects invalid codes', () => {
    expect(() =>
      createOrganizationalUnitSchema.parse({
        body: { name: 'Unidad', code: 'A', type: 'FACULTY' },
      }),
    ).toThrow();
    expect(() =>
      createOrganizationalUnitSchema.parse({
        body: { name: 'Unidad', code: 'A B', type: 'FACULTY' },
      }),
    ).toThrow();
    expect(() =>
      createOrganizationalUnitSchema.parse({
        body: { name: 'Unidad', code: 'A'.repeat(21), type: 'FACULTY' },
      }),
    ).toThrow();
  });

  it('rejects an unknown type, a missing name and unknown keys', () => {
    expect(() =>
      createOrganizationalUnitSchema.parse({
        body: { name: 'Unidad', code: 'ABC', type: 'CENTER' },
      }),
    ).toThrow();
    expect(() =>
      createOrganizationalUnitSchema.parse({ body: { code: 'ABC', type: 'FACULTY' } }),
    ).toThrow();
    expect(() =>
      createOrganizationalUnitSchema.parse({
        body: { name: 'Unidad', code: 'ABC', type: 'FACULTY', isActive: false },
      }),
    ).toThrow();
  });
});

describe('updateOrganizationalUnitSchema', () => {
  it('accepts a partial update with a nullable headId', () => {
    expect(
      updateOrganizationalUnitSchema.parse({
        params: { id: ' unit-001 ' },
        body: { name: 'Nueva', headId: null },
      }),
    ).toEqual({ params: { id: 'unit-001' }, body: { name: 'Nueva', headId: null } });
  });

  it('rejects an empty body and immutable or unknown fields', () => {
    expect(() =>
      updateOrganizationalUnitSchema.parse({ params: { id: 'unit-001' }, body: {} }),
    ).toThrow();
    expect(() =>
      updateOrganizationalUnitSchema.parse({
        params: { id: 'unit-001' },
        body: { code: 'ABC' },
      }),
    ).toThrow();
    expect(() =>
      updateOrganizationalUnitSchema.parse({
        params: { id: 'unit-001' },
        body: { type: 'FACULTY' },
      }),
    ).toThrow();
    expect(() =>
      updateOrganizationalUnitSchema.parse({
        params: { id: 'unit-001' },
        body: { isActive: false },
      }),
    ).toThrow();
  });
});
```

- [x] **Step 3: Verificar el rojo**

Run: `pnpm exec vitest run src/modules/organizational-units/organizational-units.schemas.test.ts`

Expected: FAIL porque los modulos `organizational-units.schemas.js` y `.types.js` no existen.

- [x] **Step 4: Implementar los esquemas**

`src/modules/organizational-units/organizational-units.schemas.ts`:

```ts
import { z } from 'zod';

import type {
  OrganizationalUnitDetail,
  OrganizationalUnitSummary,
  PaginatedOrganizationalUnits,
} from './organizational-units.types.js';

const unitTypeSchema = z.enum(['FACULTY', 'SUBDIRECTORATE'], 'Unit type is invalid.');

const unitCodeSchema = z
  .string()
  .trim()
  .min(2, 'Code must be at least 2 characters.')
  .max(20, 'Code cannot exceed 20 characters.')
  .regex(/^[A-Za-z0-9-]+$/, 'Code may only contain letters, numbers and hyphens.')
  .transform((value) => value.toUpperCase());

const unitIdSchema = z
  .string()
  .trim()
  .min(1, 'Organizational unit id is required.')
  .max(100, 'Organizational unit id cannot exceed 100 characters.');

const headIdSchema = z
  .string()
  .trim()
  .min(1, 'Head user id is required.')
  .max(100, 'Head user id cannot exceed 100 characters.');

export const listOrganizationalUnitsQuerySchema = z.object({
  query: z
    .object({
      page: z.coerce
        .number('Page must be a number.')
        .int('Page must be an integer.')
        .min(1, 'Page must be at least 1.')
        .default(1),
      limit: z.coerce
        .number('Limit must be a number.')
        .int('Limit must be an integer.')
        .min(1, 'Limit must be at least 1.')
        .max(50, 'Limit cannot exceed 50.')
        .default(20),
      type: unitTypeSchema.optional(),
      isActive: z
        .enum(['true', 'false'], 'Status must be true or false.')
        .transform((value) => value === 'true')
        .optional(),
      q: z
        .string()
        .trim()
        .min(1, 'Search term cannot be empty.')
        .max(200, 'Search term cannot exceed 200 characters.')
        .optional(),
    })
    .strict(),
});

export type ListOrganizationalUnitsQuery = z.infer<
  typeof listOrganizationalUnitsQuerySchema
>['query'];

export const organizationalUnitParamsSchema = z.object({
  params: z.object({ id: unitIdSchema }),
});

export type OrganizationalUnitParams = z.infer<typeof organizationalUnitParamsSchema>['params'];

export const createOrganizationalUnitSchema = z.object({
  body: z
    .object({
      name: z
        .string()
        .trim()
        .min(1, 'Name is required.')
        .max(150, 'Name cannot exceed 150 characters.'),
      code: unitCodeSchema,
      description: z
        .string()
        .trim()
        .max(2000, 'Description cannot exceed 2000 characters.')
        .nullish(),
      type: unitTypeSchema,
      headId: headIdSchema.nullish(),
    })
    .strict(),
});

export type CreateOrganizationalUnitBody = z.infer<typeof createOrganizationalUnitSchema>['body'];

export const updateOrganizationalUnitSchema = z.object({
  params: z.object({ id: unitIdSchema }),
  body: z
    .object({
      name: z
        .string()
        .trim()
        .min(1, 'Name is required.')
        .max(150, 'Name cannot exceed 150 characters.')
        .optional(),
      description: z
        .string()
        .trim()
        .max(2000, 'Description cannot exceed 2000 characters.')
        .nullish(),
      headId: headIdSchema.nullish(),
    })
    .strict()
    .refine((body) => Object.keys(body).length > 0, {
      message: 'At least one field must be provided.',
    }),
});

export type UpdateOrganizationalUnitBody = z.infer<typeof updateOrganizationalUnitSchema>['body'];

export const organizationalUnitHeadSchema = z
  .object({
    id: z.string(),
    firstName: z.string(),
    lastName: z.string(),
  })
  .meta({
    id: 'OrganizationalUnitHead',
    description: 'Minimal reference to the user in charge of an organizational unit.',
  });

export const organizationalUnitCareerSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    code: z.string(),
  })
  .meta({
    id: 'OrganizationalUnitCareer',
    description: 'Career offered by an organizational unit.',
  });

export const defaultEventProgramSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    status: z.enum(['DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'ARCHIVED']),
  })
  .meta({
    id: 'DefaultEventProgram',
    description: 'Permanent default event program owned by an organizational unit.',
  });

export const organizationalUnitSummarySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    code: z.string(),
    description: z.string().nullable(),
    type: z.enum(['FACULTY', 'SUBDIRECTORATE']),
    isActive: z.boolean(),
    head: organizationalUnitHeadSchema.nullable(),
  })
  .meta({
    id: 'OrganizationalUnitSummary',
    description: 'Organizational unit catalog entry.',
  }) satisfies z.ZodType<OrganizationalUnitSummary>;

export const organizationalUnitDetailSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    code: z.string(),
    description: z.string().nullable(),
    type: z.enum(['FACULTY', 'SUBDIRECTORATE']),
    isActive: z.boolean(),
    head: organizationalUnitHeadSchema.nullable(),
    careers: z.array(organizationalUnitCareerSchema),
    defaultProgram: defaultEventProgramSchema.nullable(),
  })
  .meta({
    id: 'OrganizationalUnitDetail',
    description: 'Organizational unit detail with its careers and default event program.',
  }) satisfies z.ZodType<OrganizationalUnitDetail>;

export const paginatedOrganizationalUnitsSchema = z
  .object({
    items: z.array(organizationalUnitSummarySchema),
    page: z.number().int(),
    limit: z.number().int(),
    total: z.number().int(),
    totalPages: z.number().int(),
  })
  .meta({
    id: 'PaginatedOrganizationalUnits',
    description: 'Paginated list of organizational units.',
  }) satisfies z.ZodType<PaginatedOrganizationalUnits>;
```

- [x] **Step 5: Verificar el verde**

Run: `pnpm exec vitest run src/modules/organizational-units/organizational-units.schemas.test.ts`

Expected: PASS.

---

### Task 2: Servicio (TDD)

**Files:**

- Create: `src/modules/organizational-units/organizational-units.service.ts`
- Test: `src/modules/organizational-units/organizational-units.service.test.ts`

- [x] **Step 1: Escribir las pruebas rojas del servicio**

`src/modules/organizational-units/organizational-units.service.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { OrganizationalUnitDetail } from './organizational-units.types.js';

interface PrismaMock {
  user: { findUnique: ReturnType<typeof vi.fn> };
  organizationalUnit: {
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  eventProgram: { create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  activity: { count: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
}

const createPrismaMock = (): PrismaMock => {
  const prisma: PrismaMock = {
    user: { findUnique: vi.fn() },
    organizationalUnit: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    eventProgram: { create: vi.fn(), update: vi.fn() },
    activity: { count: vi.fn() },
    $transaction: vi.fn(),
  };

  prisma.$transaction.mockImplementation(
    async (callback: (client: PrismaMock) => Promise<unknown>) => callback(prisma),
  );

  return prisma;
};

const loadService = async (prisma: PrismaMock) => {
  vi.resetModules();
  vi.doMock('../../config/prisma.js', () => ({ getPrismaClient: () => prisma }));

  return import('./organizational-units.service.js');
};

const headRecord = { id: 'user-head', firstName: 'Ana', lastName: 'Gomez' };

const summaryRecord = {
  id: 'unit-001',
  name: 'Facultad de Ingenieria Civil',
  code: 'FIC',
  description: 'Facultad',
  type: 'FACULTY',
  isActive: true,
  head: headRecord,
};

const detailRecord = {
  ...summaryRecord,
  careers: [{ id: 'car-001', name: 'Ingenieria Civil', code: 'FIC-CIV' }],
  eventPrograms: [
    {
      id: 'program-001',
      name: 'Programa de Eventos - Facultad de Ingenieria Civil',
      status: 'ACTIVE',
    },
  ],
};

const expectedDetail: OrganizationalUnitDetail = {
  id: 'unit-001',
  name: 'Facultad de Ingenieria Civil',
  code: 'FIC',
  description: 'Facultad',
  type: 'FACULTY',
  isActive: true,
  head: headRecord,
  careers: [{ id: 'car-001', name: 'Ingenieria Civil', code: 'FIC-CIV' }],
  defaultProgram: {
    id: 'program-001',
    name: 'Programa de Eventos - Facultad de Ingenieria Civil',
    status: 'ACTIVE',
  },
};

const createInput = {
  name: 'Facultad de Ingenieria Civil',
  code: 'FIC',
  type: 'FACULTY' as const,
};

describe('organizational units service', () => {
  afterEach(() => {
    vi.doUnmock('../../config/prisma.js');
  });

  it('lists only active units by default', async () => {
    const prisma = createPrismaMock();
    prisma.organizationalUnit.findMany.mockResolvedValue([summaryRecord]);
    prisma.organizationalUnit.count.mockResolvedValue(11);
    const { listOrganizationalUnits } = await loadService(prisma);

    const result = await listOrganizationalUnits({ page: 2, limit: 10 });

    expect(result).toEqual({
      items: [summaryRecord],
      page: 2,
      limit: 10,
      total: 11,
      totalPages: 2,
    });
    expect(prisma.organizationalUnit.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { isActive: true },
        skip: 10,
        take: 10,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      }),
    );
  });

  it('applies type, status and search filters', async () => {
    const prisma = createPrismaMock();
    prisma.organizationalUnit.findMany.mockResolvedValue([]);
    prisma.organizationalUnit.count.mockResolvedValue(0);
    const { listOrganizationalUnits } = await loadService(prisma);

    await listOrganizationalUnits({
      page: 1,
      limit: 20,
      type: 'SUBDIRECTORATE',
      isActive: false,
      q: 'sub',
    });

    expect(prisma.organizationalUnit.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          isActive: false,
          type: 'SUBDIRECTORATE',
          OR: [
            { name: { contains: 'sub', mode: 'insensitive' } },
            { code: { contains: 'sub', mode: 'insensitive' } },
          ],
        },
      }),
    );
  });

  it('returns an empty page when no unit matches', async () => {
    const prisma = createPrismaMock();
    prisma.organizationalUnit.findMany.mockResolvedValue([]);
    prisma.organizationalUnit.count.mockResolvedValue(0);
    const { listOrganizationalUnits } = await loadService(prisma);

    await expect(listOrganizationalUnits({ page: 1, limit: 20 })).resolves.toEqual({
      items: [],
      page: 1,
      limit: 20,
      total: 0,
      totalPages: 0,
    });
  });

  it('returns the detail with careers and the default program', async () => {
    const prisma = createPrismaMock();
    prisma.organizationalUnit.findUnique.mockResolvedValue(detailRecord);
    const { getOrganizationalUnitById } = await loadService(prisma);

    await expect(getOrganizationalUnitById('unit-001')).resolves.toEqual(expectedDetail);
  });

  it('fails when the requested unit does not exist', async () => {
    const prisma = createPrismaMock();
    prisma.organizationalUnit.findUnique.mockResolvedValue(null);
    const { getOrganizationalUnitById } = await loadService(prisma);

    await expect(getOrganizationalUnitById('missing')).rejects.toMatchObject({
      statusCode: 404,
      message: 'Organizational unit not found.',
    });
  });

  it('does not select sensitive head fields', async () => {
    const prisma = createPrismaMock();
    let capturedArgs: { select: Record<string, unknown> } | undefined;
    prisma.organizationalUnit.findUnique.mockImplementation(
      (args: { select: Record<string, unknown> }) => {
        capturedArgs = args;
        return Promise.resolve(detailRecord);
      },
    );
    const { getOrganizationalUnitById } = await loadService(prisma);

    await getOrganizationalUnitById('unit-001');

    const headSelect = (capturedArgs?.select.head as { select: Record<string, unknown> }).select;

    expect(headSelect).toEqual({ id: true, firstName: true, lastName: true });
    expect(headSelect).not.toHaveProperty('email');
    expect(headSelect).not.toHaveProperty('identificationNumber');
  });

  it('rejects creating a unit with an unknown head', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(null);
    const { createOrganizationalUnit } = await loadService(prisma);

    await expect(
      createOrganizationalUnit({ ...createInput, headId: 'user-missing' }),
    ).rejects.toMatchObject({ statusCode: 404, message: 'User not found.' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects creating a unit with an inactive head', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue({ id: 'user-head', isActive: false });
    const { createOrganizationalUnit } = await loadService(prisma);

    await expect(
      createOrganizationalUnit({ ...createInput, headId: 'user-head' }),
    ).rejects.toMatchObject({ statusCode: 400, message: 'Head user is inactive.' });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a duplicated unit code before writing', async () => {
    const prisma = createPrismaMock();
    prisma.organizationalUnit.findUnique.mockResolvedValue({ id: 'unit-existing' });
    const { createOrganizationalUnit } = await loadService(prisma);

    await expect(createOrganizationalUnit(createInput)).rejects.toMatchObject({
      statusCode: 409,
      message: 'Organizational unit code already exists.',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('creates the unit and its default program in one transaction', async () => {
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue({ id: 'user-head', isActive: true });
    prisma.organizationalUnit.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(detailRecord);
    prisma.organizationalUnit.create.mockResolvedValue({ id: 'unit-001' });
    prisma.eventProgram.create.mockResolvedValue({ id: 'program-001' });
    const { createOrganizationalUnit } = await loadService(prisma);

    const detail = await createOrganizationalUnit({ ...createInput, headId: 'user-head' });

    expect(detail).toEqual(expectedDetail);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.organizationalUnit.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          name: 'Facultad de Ingenieria Civil',
          code: 'FIC',
          description: null,
          type: 'FACULTY',
          headId: 'user-head',
          isActive: true,
        },
      }),
    );
    expect(prisma.eventProgram.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          name: 'Programa de Eventos - Facultad de Ingenieria Civil',
          description: 'Programa predeterminado de Facultad de Ingenieria Civil.',
          organizationalUnitId: 'unit-001',
          isDefault: true,
          status: 'ACTIVE',
        },
      }),
    );
  });

  it('translates a unique constraint race into a conflict', async () => {
    const prisma = createPrismaMock();
    prisma.organizationalUnit.findUnique.mockResolvedValue(null);
    prisma.$transaction.mockRejectedValue({ code: 'P2002' });
    const { createOrganizationalUnit } = await loadService(prisma);

    await expect(createOrganizationalUnit(createInput)).rejects.toMatchObject({
      statusCode: 409,
      message: 'Organizational unit code already exists.',
    });
  });

  it('propagates transaction failures keeping both writes in one transaction', async () => {
    const prisma = createPrismaMock();
    prisma.organizationalUnit.findUnique.mockResolvedValue(null);
    prisma.organizationalUnit.create.mockResolvedValue({ id: 'unit-001' });
    prisma.eventProgram.create.mockRejectedValue(new Error('default program failed'));
    const { createOrganizationalUnit } = await loadService(prisma);

    await expect(createOrganizationalUnit(createInput)).rejects.toThrow('default program failed');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.organizationalUnit.create).toHaveBeenCalledTimes(1);
    expect(prisma.eventProgram.create).toHaveBeenCalledTimes(1);
  });

  it('updates only the provided fields', async () => {
    const prisma = createPrismaMock();
    prisma.organizationalUnit.findUnique.mockResolvedValue({ id: 'unit-001' });
    prisma.organizationalUnit.update.mockResolvedValue(detailRecord);
    const { updateOrganizationalUnit } = await loadService(prisma);

    await updateOrganizationalUnit('unit-001', { description: 'Nueva descripcion' });

    expect(prisma.organizationalUnit.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'unit-001' },
        data: { description: 'Nueva descripcion' },
      }),
    );
  });

  it('clears the head when headId is null', async () => {
    const prisma = createPrismaMock();
    prisma.organizationalUnit.findUnique.mockResolvedValue({ id: 'unit-001' });
    prisma.organizationalUnit.update.mockResolvedValue(detailRecord);
    const { updateOrganizationalUnit } = await loadService(prisma);

    await updateOrganizationalUnit('unit-001', { headId: null });

    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.organizationalUnit.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { headId: null } }),
    );
  });

  it('fails updating a missing unit', async () => {
    const prisma = createPrismaMock();
    prisma.organizationalUnit.findUnique.mockResolvedValue(null);
    const { updateOrganizationalUnit } = await loadService(prisma);

    await expect(updateOrganizationalUnit('missing', { name: 'Nueva' })).rejects.toMatchObject({
      statusCode: 404,
      message: 'Organizational unit not found.',
    });
    expect(prisma.organizationalUnit.update).not.toHaveBeenCalled();
  });

  it('rejects an unknown head on update', async () => {
    const prisma = createPrismaMock();
    prisma.organizationalUnit.findUnique.mockResolvedValue({ id: 'unit-001' });
    prisma.user.findUnique.mockResolvedValue(null);
    const { updateOrganizationalUnit } = await loadService(prisma);

    await expect(
      updateOrganizationalUnit('unit-001', { headId: 'user-missing' }),
    ).rejects.toMatchObject({ statusCode: 404, message: 'User not found.' });
    expect(prisma.organizationalUnit.update).not.toHaveBeenCalled();
  });

  it('deactivates the unit and archives its default program in order', async () => {
    const prisma = createPrismaMock();
    prisma.organizationalUnit.findUnique
      .mockResolvedValueOnce({
        id: 'unit-001',
        isActive: true,
        eventPrograms: [{ id: 'program-001' }],
      })
      .mockResolvedValueOnce({
        ...detailRecord,
        isActive: false,
        eventPrograms: [{ ...detailRecord.eventPrograms[0], status: 'ARCHIVED' }],
      });
    prisma.activity.count.mockResolvedValue(0);
    const { deactivateOrganizationalUnit } = await loadService(prisma);

    const detail = await deactivateOrganizationalUnit('unit-001');

    expect(detail.isActive).toBe(false);
    expect(detail.defaultProgram).toEqual({
      id: 'program-001',
      name: 'Programa de Eventos - Facultad de Ingenieria Civil',
      status: 'ARCHIVED',
    });
    expect(prisma.organizationalUnit.update.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.eventProgram.update.mock.invocationCallOrder[0] as number,
    );
    expect(prisma.eventProgram.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'program-001' },
        data: expect.objectContaining({ status: 'ARCHIVED' }),
      }),
    );
  });

  it('fails deactivating a missing unit', async () => {
    const prisma = createPrismaMock();
    prisma.organizationalUnit.findUnique.mockResolvedValue(null);
    const { deactivateOrganizationalUnit } = await loadService(prisma);

    await expect(deactivateOrganizationalUnit('missing')).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('rejects deactivating an inactive unit', async () => {
    const prisma = createPrismaMock();
    prisma.organizationalUnit.findUnique.mockResolvedValue({
      id: 'unit-001',
      isActive: false,
      eventPrograms: [{ id: 'program-001' }],
    });
    const { deactivateOrganizationalUnit } = await loadService(prisma);

    await expect(deactivateOrganizationalUnit('unit-001')).rejects.toMatchObject({
      statusCode: 409,
      message: 'Organizational unit is already inactive.',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects a unit without a default program', async () => {
    const prisma = createPrismaMock();
    prisma.organizationalUnit.findUnique.mockResolvedValue({
      id: 'unit-001',
      isActive: true,
      eventPrograms: [],
    });
    const { deactivateOrganizationalUnit } = await loadService(prisma);

    await expect(deactivateOrganizationalUnit('unit-001')).rejects.toMatchObject({
      statusCode: 409,
      message: 'Organizational unit does not have a default event program.',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects deactivation with scheduled or ongoing activities', async () => {
    const prisma = createPrismaMock();
    prisma.organizationalUnit.findUnique.mockResolvedValue({
      id: 'unit-001',
      isActive: true,
      eventPrograms: [{ id: 'program-001' }],
    });
    prisma.activity.count.mockResolvedValue(2);
    const { deactivateOrganizationalUnit } = await loadService(prisma);

    await expect(deactivateOrganizationalUnit('unit-001')).rejects.toMatchObject({
      statusCode: 409,
      message:
        'Cannot deactivate an organizational unit whose default event program has scheduled or ongoing activities.',
    });
    expect(prisma.activity.count).toHaveBeenCalledWith({
      where: { eventProgramId: 'program-001', status: { in: ['SCHEDULED', 'ONGOING'] } },
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('reactivates the unit and lets the database trigger restore the program', async () => {
    const prisma = createPrismaMock();
    prisma.organizationalUnit.findUnique
      .mockResolvedValueOnce({
        id: 'unit-001',
        isActive: false,
        eventPrograms: [{ id: 'program-001' }],
      })
      .mockResolvedValueOnce(detailRecord);
    const { reactivateOrganizationalUnit } = await loadService(prisma);

    const detail = await reactivateOrganizationalUnit('unit-001');

    expect(detail.isActive).toBe(true);
    expect(detail.defaultProgram?.status).toBe('ACTIVE');
    expect(prisma.organizationalUnit.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'unit-001' }, data: { isActive: true } }),
    );
    expect(prisma.eventProgram.update).not.toHaveBeenCalled();
  });

  it('fails reactivating a missing unit', async () => {
    const prisma = createPrismaMock();
    prisma.organizationalUnit.findUnique.mockResolvedValue(null);
    const { reactivateOrganizationalUnit } = await loadService(prisma);

    await expect(reactivateOrganizationalUnit('missing')).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('rejects reactivating an active unit', async () => {
    const prisma = createPrismaMock();
    prisma.organizationalUnit.findUnique.mockResolvedValue({
      id: 'unit-001',
      isActive: true,
      eventPrograms: [{ id: 'program-001' }],
    });
    const { reactivateOrganizationalUnit } = await loadService(prisma);

    await expect(reactivateOrganizationalUnit('unit-001')).rejects.toMatchObject({
      statusCode: 409,
      message: 'Organizational unit is already active.',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects reactivating a unit without a default program', async () => {
    const prisma = createPrismaMock();
    prisma.organizationalUnit.findUnique.mockResolvedValue({
      id: 'unit-001',
      isActive: false,
      eventPrograms: [],
    });
    const { reactivateOrganizationalUnit } = await loadService(prisma);

    await expect(reactivateOrganizationalUnit('unit-001')).rejects.toMatchObject({
      statusCode: 409,
      message: 'Organizational unit does not have a default event program.',
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
```

- [x] **Step 2: Verificar el rojo**

Run: `pnpm exec vitest run src/modules/organizational-units/organizational-units.service.test.ts`

Expected: FAIL porque el servicio no existe.

- [x] **Step 3: Implementar el servicio**

`src/modules/organizational-units/organizational-units.service.ts`:

```ts
import { getPrismaClient } from '../../config/prisma.js';
import type { ProgramStatus, UnitType } from '../../generated/prisma/enums.js';
import { ApiError } from '../../utils/ApiError.js';
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
): Promise<OrganizationalUnitDetail> => {
  const prisma = getPrismaClient();
  const unit = await prisma.organizationalUnit.findUnique({
    where: { id },
    select: { id: true },
  });

  if (!unit) {
    throw new ApiError(404, 'Organizational unit not found.');
  }

  await assertHeadUserAvailable(input.headId);

  const record = await prisma.organizationalUnit.update({
    where: { id: unit.id },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.headId !== undefined ? { headId: input.headId } : {}),
    },
    select: unitDetailSelect,
  });

  return toOrganizationalUnitDetail(record);
};

export const deactivateOrganizationalUnit = async (
  id: string,
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

    return toOrganizationalUnitDetail(record);
  });
};

export const reactivateOrganizationalUnit = async (
  id: string,
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

    return toOrganizationalUnitDetail(record);
  });
};
```

- [x] **Step 4: Verificar el verde**

Run: `pnpm exec vitest run src/modules/organizational-units/organizational-units.service.test.ts`

Expected: PASS.

---

### Task 3: Controlador, rutas y pruebas de ruta (TDD)

**Files:**

- Create: `src/modules/organizational-units/organizational-units.controller.ts`
- Create: `src/modules/organizational-units/organizational-units.routes.ts`
- Test: `src/modules/organizational-units/organizational-units.routes.test.ts`
- Modify: `src/routes.ts`

- [x] **Step 1: Implementar el controlador**

`src/modules/organizational-units/organizational-units.controller.ts`:

```ts
import type { RequestHandler } from 'express';

import { asyncHandler } from '../../utils/asyncHandler.js';
import { successResponse } from '../../utils/response.js';
import type {
  CreateOrganizationalUnitBody,
  ListOrganizationalUnitsQuery,
  UpdateOrganizationalUnitBody,
} from './organizational-units.schemas.js';
import {
  createOrganizationalUnit as createOrganizationalUnitService,
  deactivateOrganizationalUnit as deactivateOrganizationalUnitService,
  getOrganizationalUnitById,
  listOrganizationalUnits as listOrganizationalUnitsService,
  reactivateOrganizationalUnit as reactivateOrganizationalUnitService,
  updateOrganizationalUnit as updateOrganizationalUnitService,
} from './organizational-units.service.js';

export const getOrganizationalUnits: RequestHandler = asyncHandler(async (req, res) => {
  const query = req.query as unknown as ListOrganizationalUnitsQuery;
  const result = await listOrganizationalUnitsService(query);

  res.status(200).json(successResponse('Organizational units retrieved successfully.', result));
});

export const getOrganizationalUnit: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params as { id: string };
  const result = await getOrganizationalUnitById(id);

  res.status(200).json(successResponse('Organizational unit retrieved successfully.', result));
});

export const createOrganizationalUnit: RequestHandler = asyncHandler(async (req, res) => {
  const body = req.body as CreateOrganizationalUnitBody;
  const result = await createOrganizationalUnitService(body);

  res.status(201).json(successResponse('Organizational unit created successfully.', result));
});

export const updateOrganizationalUnit: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params as { id: string };
  const body = req.body as UpdateOrganizationalUnitBody;
  const result = await updateOrganizationalUnitService(id, body);

  res.status(200).json(successResponse('Organizational unit updated successfully.', result));
});

export const deactivateOrganizationalUnit: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params as { id: string };
  const result = await deactivateOrganizationalUnitService(id);

  res.status(200).json(successResponse('Organizational unit deactivated successfully.', result));
});

export const reactivateOrganizationalUnit: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params as { id: string };
  const result = await reactivateOrganizationalUnitService(id);

  res.status(200).json(successResponse('Organizational unit reactivated successfully.', result));
});
```

- [x] **Step 2: Implementar las rutas**

`src/modules/organizational-units/organizational-units.routes.ts`:

```ts
import { Router } from 'express';

import { authenticate } from '../../middlewares/authenticate.middleware.js';
import { requireAdmin } from '../../middlewares/authorize.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import {
  createOrganizationalUnit,
  deactivateOrganizationalUnit,
  getOrganizationalUnit,
  getOrganizationalUnits,
  reactivateOrganizationalUnit,
  updateOrganizationalUnit,
} from './organizational-units.controller.js';
import {
  createOrganizationalUnitSchema,
  listOrganizationalUnitsQuerySchema,
  organizationalUnitParamsSchema,
  updateOrganizationalUnitSchema,
} from './organizational-units.schemas.js';

export const organizationalUnitsRoutes = Router();

organizationalUnitsRoutes.get(
  '/organizational-units',
  validate(listOrganizationalUnitsQuerySchema),
  getOrganizationalUnits,
);

organizationalUnitsRoutes.get(
  '/organizational-units/:id',
  validate(organizationalUnitParamsSchema),
  getOrganizationalUnit,
);

organizationalUnitsRoutes.post(
  '/organizational-units',
  authenticate,
  requireAdmin,
  validate(createOrganizationalUnitSchema),
  createOrganizationalUnit,
);

organizationalUnitsRoutes.patch(
  '/organizational-units/:id',
  authenticate,
  requireAdmin,
  validate(updateOrganizationalUnitSchema),
  updateOrganizationalUnit,
);

organizationalUnitsRoutes.post(
  '/organizational-units/:id/deactivate',
  authenticate,
  requireAdmin,
  validate(organizationalUnitParamsSchema),
  deactivateOrganizationalUnit,
);

organizationalUnitsRoutes.post(
  '/organizational-units/:id/reactivate',
  authenticate,
  requireAdmin,
  validate(organizationalUnitParamsSchema),
  reactivateOrganizationalUnit,
);
```

Modify `src/routes.ts`:

```ts
import { organizationalUnitsRoutes } from './modules/organizational-units/organizational-units.routes.js';

apiRoutes.use(organizationalUnitsRoutes);
```

- [x] **Step 3: Escribir las pruebas de ruta**

`src/modules/organizational-units/organizational-units.routes.test.ts` (patron de `users.routes.test.ts`: JWKS local, mock de Prisma y `$transaction` con callback, tokens USER y ADMIN):

```ts
import request from 'supertest';
import {
  calculateJwkThumbprint,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
} from 'jose';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

interface PrismaMock {
  user: { findUnique: ReturnType<typeof vi.fn> };
  organizationalUnit: {
    findUnique: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  eventProgram: { create: ReturnType<typeof vi.fn>; update: ReturnType<typeof vi.fn> };
  activity: { count: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
}

const createPrismaMock = (): PrismaMock => {
  const prisma: PrismaMock = {
    user: { findUnique: vi.fn() },
    organizationalUnit: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    eventProgram: { create: vi.fn(), update: vi.fn() },
    activity: { count: vi.fn() },
    $transaction: vi.fn(),
  };

  prisma.$transaction.mockImplementation(
    async (callback: (client: PrismaMock) => Promise<unknown>) => callback(prisma),
  );

  return prisma;
};

const headRecord = { id: 'user-head', firstName: 'Ana', lastName: 'Gomez' };

const unitDetailRecord = {
  id: 'unit-001',
  name: 'Facultad de Ingenieria Civil',
  code: 'FIC',
  description: 'Facultad',
  type: 'FACULTY',
  isActive: true,
  head: headRecord,
  careers: [{ id: 'car-001', name: 'Ingenieria Civil', code: 'FIC-CIV' }],
  eventPrograms: [
    {
      id: 'program-001',
      name: 'Programa de Eventos - Facultad de Ingenieria Civil',
      status: 'ACTIVE',
    },
  ],
};

const adminAuthUserRecord = {
  id: 'user-admin',
  email: 'admin@utp.ac.pa',
  globalRole: 'ADMIN',
  unitId: null,
  careerId: null,
  isActive: true,
};

const regularAuthUserRecord = {
  id: 'user-001',
  email: 'user@utp.ac.pa',
  globalRole: 'USER',
  unitId: null,
  careerId: null,
  isActive: true,
};

const authUserRecords: Record<string, unknown> = {
  'user-admin': adminAuthUserRecord,
  'user-001': regularAuthUserRecord,
};

interface UserLookupArgs {
  where: { id: string };
  select?: Record<string, unknown>;
}

const mockUserLookup = (prisma: PrismaMock): void => {
  prisma.user.findUnique.mockImplementation((args: UserLookupArgs) => {
    const select = args.select ?? {};

    if ('email' in select) {
      return Promise.resolve(authUserRecords[args.where.id] ?? null);
    }
    if (args.where.id === 'user-head') {
      return Promise.resolve({ id: 'user-head', isActive: true });
    }
    if (args.where.id === 'user-inactive') {
      return Promise.resolve({ id: 'user-inactive', isActive: false });
    }

    return Promise.resolve(null);
  });
};

let accessToken: string;
let adminAccessToken: string;
let jwks: { keys: unknown[] };

const loadApp = async (prisma: PrismaMock) => {
  process.env['NODE_ENV'] = 'test';
  process.env['AUTH_SECRET'] = 'a'.repeat(32);
  process.env['DATABASE_URL'] = 'postgresql://test:test@localhost:5432/test';
  process.env['AUTH_URL'] = 'http://localhost:3000';
  vi.resetModules();
  vi.doMock('../../config/prisma.js', () => ({ getPrismaClient: () => prisma }));
  vi.doMock('../../utils/jwt-verifier.js', () => ({
    getJwtVerifier: () => ({
      verify: async (token: string) => {
        const resolver = createLocalJWKSet(jwks as Parameters<typeof createLocalJWKSet>[0]);
        const { payload } = await import('jose').then((j) =>
          j.jwtVerify(token, resolver, {
            issuer: 'http://localhost:3000',
            audience: 'http://localhost:3000',
            algorithms: ['EdDSA'],
          }),
        );
        return payload;
      },
      refresh: async () => {},
    }),
  }));
  vi.doMock('../../lib/auth.js', () => ({
    auth: {
      api: {
        signInEmail: vi.fn(),
        signUpEmail: vi.fn(),
        getToken: vi.fn(),
        getSession: vi.fn(),
        signOut: vi.fn(),
        verifyEmail: vi.fn(),
        requestPasswordReset: vi.fn(),
        resetPassword: vi.fn(),
      },
    },
  }));
  const { app } = await import('../../app.js');
  return app;
};

const signToken = async (sub: string, role: 'USER' | 'ADMIN') => {
  const { privateKey } = await generateKeyPair('EdDSA');
  const jwk = await exportJWK(privateKey);
  const kid = await calculateJwkThumbprint(jwk);
  const { publicKey } = await generateKeyPair('EdDSA');
  const publicJwk = await exportJWK(publicKey);
  jwks = { keys: [{ ...publicJwk, kid, alg: 'EdDSA', use: 'sig' }] };

  return new SignJWT({ sub, role })
    .setProtectedHeader({ alg: 'EdDSA', kid })
    .setIssuer('http://localhost:3000')
    .setAudience('http://localhost:3000')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(privateKey);
};

beforeAll(async () => {
  accessToken = await signToken('user-001', 'USER');
  adminAccessToken = await signToken('user-admin', 'ADMIN');
});

afterAll(() => {
  vi.restoreAllMocks();
});

describe('organizational units routes', () => {
  it('lists active units publicly', async () => {
    const prisma = createPrismaMock();
    prisma.organizationalUnit.findMany.mockResolvedValue([unitDetailRecord]);
    prisma.organizationalUnit.count.mockResolvedValue(1);
    const app = await loadApp(prisma);

    const response = await request(app).get('/api/v1/organizational-units').expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data.items).toHaveLength(1);
    expect(prisma.organizationalUnit.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: true } }),
    );
  });

  it('applies list filters and pagination', async () => {
    const prisma = createPrismaMock();
    prisma.organizationalUnit.findMany.mockResolvedValue([]);
    prisma.organizationalUnit.count.mockResolvedValue(0);
    const app = await loadApp(prisma);

    await request(app)
      .get('/api/v1/organizational-units?type=FACULTY&isActive=false&page=2&limit=5')
      .expect(200);

    expect(prisma.organizationalUnit.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isActive: false, type: 'FACULTY' }, skip: 5, take: 5 }),
    );
  });

  it('rejects invalid list filters before touching Prisma', async () => {
    const prisma = createPrismaMock();
    const app = await loadApp(prisma);

    const response = await request(app).get('/api/v1/organizational-units?type=CENTER').expect(400);

    expect(response.body.message).toBe('Validation error.');
    expect(prisma.organizationalUnit.findMany).not.toHaveBeenCalled();
  });

  it('returns a public detail with careers and default program', async () => {
    const prisma = createPrismaMock();
    prisma.organizationalUnit.findUnique.mockResolvedValue(unitDetailRecord);
    const app = await loadApp(prisma);

    const response = await request(app).get('/api/v1/organizational-units/unit-001').expect(200);

    expect(response.body.data.careers).toEqual([
      { id: 'car-001', name: 'Ingenieria Civil', code: 'FIC-CIV' },
    ]);
    expect(response.body.data.defaultProgram).toEqual({
      id: 'program-001',
      name: 'Programa de Eventos - Facultad de Ingenieria Civil',
      status: 'ACTIVE',
    });
  });

  it('returns 404 for an unknown unit', async () => {
    const prisma = createPrismaMock();
    prisma.organizationalUnit.findUnique.mockResolvedValue(null);
    const app = await loadApp(prisma);

    const response = await request(app)
      .get('/api/v1/organizational-units/unit-missing')
      .expect(404);

    expect(response.body.message).toBe('Organizational unit not found.');
  });

  it('rejects creating a unit without a token', async () => {
    const app = await loadApp(createPrismaMock());

    await request(app)
      .post('/api/v1/organizational-units')
      .send({ name: 'Unidad', code: 'TMP-1', type: 'FACULTY' })
      .expect(401);
  });

  it('rejects creating a unit as USER before touching Prisma', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    const app = await loadApp(prisma);

    const response = await request(app)
      .post('/api/v1/organizational-units')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Unidad', code: 'TMP-1', type: 'FACULTY' })
      .expect(403);

    expect(response.body.message).toBe('Insufficient privileges for this resource.');
    expect(prisma.organizationalUnit.create).not.toHaveBeenCalled();
  });

  it('creates the unit and its default program as ADMIN', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    prisma.organizationalUnit.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(unitDetailRecord);
    prisma.organizationalUnit.create.mockResolvedValue({ id: 'unit-001' });
    prisma.eventProgram.create.mockResolvedValue({ id: 'program-001' });
    const app = await loadApp(prisma);

    const response = await request(app)
      .post('/api/v1/organizational-units')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({
        name: 'Facultad de Ingenieria Civil',
        code: 'fic',
        type: 'FACULTY',
        headId: 'user-head',
      })
      .expect(201);

    expect(response.body.message).toBe('Organizational unit created successfully.');
    expect(prisma.organizationalUnit.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ code: 'FIC', headId: 'user-head', isActive: true }),
      }),
    );
    expect(prisma.eventProgram.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ isDefault: true, status: 'ACTIVE' }),
      }),
    );
  });

  it('rejects a duplicated unit code with 409', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    prisma.organizationalUnit.findUnique.mockResolvedValue({ id: 'unit-001' });
    const app = await loadApp(prisma);

    const response = await request(app)
      .post('/api/v1/organizational-units')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ name: 'Facultad', code: 'FIC', type: 'FACULTY' })
      .expect(409);

    expect(response.body.message).toBe('Organizational unit code already exists.');
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects an unknown or inactive head user', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    const app = await loadApp(prisma);

    await request(app)
      .post('/api/v1/organizational-units')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ name: 'Unidad', code: 'TMP-1', type: 'FACULTY', headId: 'user-missing' })
      .expect(404);

    const response = await request(app)
      .post('/api/v1/organizational-units')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ name: 'Unidad', code: 'TMP-1', type: 'FACULTY', headId: 'user-inactive' })
      .expect(400);

    expect(response.body.message).toBe('Head user is inactive.');
  });

  it('updates the editable fields as ADMIN', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    prisma.organizationalUnit.findUnique.mockResolvedValue({ id: 'unit-001' });
    prisma.organizationalUnit.update.mockResolvedValue(unitDetailRecord);
    const app = await loadApp(prisma);

    await request(app)
      .patch('/api/v1/organizational-units/unit-001')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ name: 'Facultad Renombrada', headId: 'user-head' })
      .expect(200);

    expect(prisma.organizationalUnit.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'unit-001' },
        data: { name: 'Facultad Renombrada', headId: 'user-head' },
      }),
    );
  });

  it('rejects immutable fields on update', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    const app = await loadApp(prisma);

    await request(app)
      .patch('/api/v1/organizational-units/unit-001')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ code: 'NEW' })
      .expect(400);
    await request(app)
      .patch('/api/v1/organizational-units/unit-001')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ type: 'SUBDIRECTORATE' })
      .expect(400);
    await request(app)
      .patch('/api/v1/organizational-units/unit-001')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ isActive: false })
      .expect(400);

    expect(prisma.organizationalUnit.update).not.toHaveBeenCalled();
  });

  it('rejects updating a missing unit', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    prisma.organizationalUnit.findUnique.mockResolvedValue(null);
    const app = await loadApp(prisma);

    await request(app)
      .patch('/api/v1/organizational-units/unit-missing')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .send({ name: 'Nueva' })
      .expect(404);
  });

  it('deactivates a unit and archives its default program in order', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    prisma.organizationalUnit.findUnique
      .mockResolvedValueOnce({
        id: 'unit-001',
        isActive: true,
        eventPrograms: [{ id: 'program-001' }],
      })
      .mockResolvedValueOnce({
        ...unitDetailRecord,
        isActive: false,
        eventPrograms: [{ ...unitDetailRecord.eventPrograms[0], status: 'ARCHIVED' }],
      });
    prisma.activity.count.mockResolvedValue(0);
    const app = await loadApp(prisma);

    const response = await request(app)
      .post('/api/v1/organizational-units/unit-001/deactivate')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .expect(200);

    expect(response.body.message).toBe('Organizational unit deactivated successfully.');
    expect(response.body.data.isActive).toBe(false);
    expect(response.body.data.defaultProgram.status).toBe('ARCHIVED');
    expect(prisma.organizationalUnit.update.mock.invocationCallOrder[0]).toBeLessThan(
      prisma.eventProgram.update.mock.invocationCallOrder[0] as number,
    );
  });

  it('rejects deactivation with scheduled or ongoing activities', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    prisma.organizationalUnit.findUnique.mockResolvedValue({
      id: 'unit-001',
      isActive: true,
      eventPrograms: [{ id: 'program-001' }],
    });
    prisma.activity.count.mockResolvedValue(1);
    const app = await loadApp(prisma);

    await request(app)
      .post('/api/v1/organizational-units/unit-001/deactivate')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .expect(409);

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects deactivating an already inactive unit', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    prisma.organizationalUnit.findUnique.mockResolvedValue({
      id: 'unit-001',
      isActive: false,
      eventPrograms: [{ id: 'program-001' }],
    });
    const app = await loadApp(prisma);

    await request(app)
      .post('/api/v1/organizational-units/unit-001/deactivate')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .expect(409);
  });

  it('reactivates a unit as ADMIN', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    prisma.organizationalUnit.findUnique
      .mockResolvedValueOnce({
        id: 'unit-001',
        isActive: false,
        eventPrograms: [{ id: 'program-001' }],
      })
      .mockResolvedValueOnce(unitDetailRecord);
    const app = await loadApp(prisma);

    const response = await request(app)
      .post('/api/v1/organizational-units/unit-001/reactivate')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .expect(200);

    expect(response.body.message).toBe('Organizational unit reactivated successfully.');
    expect(response.body.data.defaultProgram.status).toBe('ACTIVE');
    expect(prisma.eventProgram.update).not.toHaveBeenCalled();
  });

  it('rejects unit management as USER', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    const app = await loadApp(prisma);

    await request(app)
      .patch('/api/v1/organizational-units/unit-001')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Nueva' })
      .expect(403);
    await request(app)
      .post('/api/v1/organizational-units/unit-001/deactivate')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(403);
    await request(app)
      .post('/api/v1/organizational-units/unit-001/reactivate')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(403);

    expect(prisma.organizationalUnit.update).not.toHaveBeenCalled();
  });

  it('returns 404 for deactivate and reactivate on unknown units', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    prisma.organizationalUnit.findUnique.mockResolvedValue(null);
    const app = await loadApp(prisma);

    await request(app)
      .post('/api/v1/organizational-units/unit-missing/deactivate')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .expect(404);
    await request(app)
      .post('/api/v1/organizational-units/unit-missing/reactivate')
      .set('Authorization', `Bearer ${adminAccessToken}`)
      .expect(404);
  });
});
```

- [x] **Step 4: Verificar el rojo de rutas**

Run: `pnpm exec vitest run src/modules/organizational-units/organizational-units.routes.test.ts`

Expected: FAIL con 404 en las rutas nuevas antes de montarlas (o fallo de import).

- [x] **Step 5: Montar el router y verificar el verde**

Modificar `src/routes.ts` y correr:

```bash
pnpm exec vitest run src/modules/organizational-units/organizational-units.routes.test.ts
```

Expected: PASS.

---

### Task 4: Contrato OpenAPI (TDD)

**Files:**

- Create: `src/modules/organizational-units/organizational-units.openapi.ts`
- Modify: `src/docs/openapi.ts`
- Modify: `src/docs/openapi.test.ts`
- Modify: `openapi.json` (generado)

- [x] **Step 1: Crear el archivo OpenAPI del modulo**

`src/modules/organizational-units/organizational-units.openapi.ts`:

```ts
import type { ZodOpenApiPathsObject } from 'zod-openapi';

import { apiErrorResponseSchema, apiSuccessResponse } from '../../docs/schemas.js';
import {
  createOrganizationalUnitSchema,
  listOrganizationalUnitsQuerySchema,
  organizationalUnitDetailSchema,
  organizationalUnitParamsSchema,
  paginatedOrganizationalUnitsSchema,
  updateOrganizationalUnitSchema,
} from './organizational-units.schemas.js';

const errorResponse = {
  description: 'Error response.',
  content: { 'application/json': { schema: apiErrorResponseSchema } },
} as const;

export const organizationalUnitsPaths: ZodOpenApiPathsObject = {
  '/api/v1/organizational-units': {
    get: {
      tags: ['Organizational Units'],
      summary: 'List organizational units',
      description:
        'Public catalog of organizational units. Returns only active units by default; use isActive=false to list inactive ones. Supports pagination, type and case-insensitive search by name or code.',
      requestParams: { query: listOrganizationalUnitsQuerySchema.shape.query },
      responses: {
        200: {
          description: 'Paginated list of organizational units.',
          content: {
            'application/json': { schema: apiSuccessResponse(paginatedOrganizationalUnitsSchema) },
          },
        },
        400: errorResponse,
      },
    },
    post: {
      tags: ['Organizational Units'],
      summary: 'Create an organizational unit',
      description:
        'Creates an organizational unit and its permanent default event program in a single transaction. Requires the ADMIN role. The organizational unit code is unique and case-insensitive.',
      security: [{ bearerAuth: [] }],
      requestBody: {
        required: true,
        content: { 'application/json': { schema: createOrganizationalUnitSchema.shape.body } },
      },
      responses: {
        201: {
          description: 'Organizational unit created with its default event program.',
          content: {
            'application/json': { schema: apiSuccessResponse(organizationalUnitDetailSchema) },
          },
        },
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
        409: errorResponse,
      },
    },
  },
  '/api/v1/organizational-units/{id}': {
    get: {
      tags: ['Organizational Units'],
      summary: 'Get an organizational unit',
      description:
        'Public organizational unit detail including its careers and its default event program.',
      requestParams: { path: organizationalUnitParamsSchema.shape.params },
      responses: {
        200: {
          description: 'Organizational unit detail.',
          content: {
            'application/json': { schema: apiSuccessResponse(organizationalUnitDetailSchema) },
          },
        },
        400: errorResponse,
        404: errorResponse,
      },
    },
    patch: {
      tags: ['Organizational Units'],
      summary: 'Update an organizational unit',
      description:
        'Updates name, description and head user. The code and type are immutable. Requires the ADMIN role.',
      security: [{ bearerAuth: [] }],
      requestParams: { path: organizationalUnitParamsSchema.shape.params },
      requestBody: {
        required: true,
        content: { 'application/json': { schema: updateOrganizationalUnitSchema.shape.body } },
      },
      responses: {
        200: {
          description: 'Updated organizational unit detail.',
          content: {
            'application/json': { schema: apiSuccessResponse(organizationalUnitDetailSchema) },
          },
        },
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  '/api/v1/organizational-units/{id}/deactivate': {
    post: {
      tags: ['Organizational Units'],
      summary: 'Deactivate an organizational unit',
      description:
        'Deactivates the unit and archives its default event program in a single transaction. Requires the ADMIN role. Rejected while the default program has scheduled or ongoing activities.',
      security: [{ bearerAuth: [] }],
      requestParams: { path: organizationalUnitParamsSchema.shape.params },
      responses: {
        200: {
          description: 'Deactivated organizational unit with its archived default program.',
          content: {
            'application/json': { schema: apiSuccessResponse(organizationalUnitDetailSchema) },
          },
        },
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
        409: errorResponse,
      },
    },
  },
  '/api/v1/organizational-units/{id}/reactivate': {
    post: {
      tags: ['Organizational Units'],
      summary: 'Reactivate an organizational unit',
      description:
        'Reactivates the unit and restores its existing default event program in the same transaction. Requires the ADMIN role.',
      security: [{ bearerAuth: [] }],
      requestParams: { path: organizationalUnitParamsSchema.shape.params },
      responses: {
        200: {
          description: 'Reactivated organizational unit with its active default program.',
          content: {
            'application/json': { schema: apiSuccessResponse(organizationalUnitDetailSchema) },
          },
        },
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
        409: errorResponse,
      },
    },
  },
};
```

- [x] **Step 2: Escribir las pruebas rojas del contrato**

En `src/docs/openapi.test.ts` agregar a `expectedOperations`:

```ts
'GET /api/v1/organizational-units',
'POST /api/v1/organizational-units',
'GET /api/v1/organizational-units/{id}',
'PATCH /api/v1/organizational-units/{id}',
'POST /api/v1/organizational-units/{id}/deactivate',
'POST /api/v1/organizational-units/{id}/reactivate',
```

Y agregar los tests:

```ts
it('keeps public organizational unit reads without bearer security', () => {
  expect(openApiDocument.paths?.['/api/v1/organizational-units']?.get?.security).toBeUndefined();
  expect(
    openApiDocument.paths?.['/api/v1/organizational-units/{id}']?.get?.security,
  ).toBeUndefined();
});

it('marks organizational unit management with bearer security', () => {
  const collection = openApiDocument.paths?.['/api/v1/organizational-units'];
  const detail = openApiDocument.paths?.['/api/v1/organizational-units/{id}'];
  const deactivate = openApiDocument.paths?.['/api/v1/organizational-units/{id}/deactivate']?.post;
  const reactivate = openApiDocument.paths?.['/api/v1/organizational-units/{id}/reactivate']?.post;

  expect(collection?.post?.security).toEqual([{ bearerAuth: [] }]);
  expect(detail?.patch?.security).toEqual([{ bearerAuth: [] }]);
  expect(deactivate?.security).toEqual([{ bearerAuth: [] }]);
  expect(reactivate?.security).toEqual([{ bearerAuth: [] }]);
  expect(collection?.post?.responses?.['201']).toBeDefined();
  expect(deactivate?.responses?.['409']).toBeDefined();
});

it('documents the organizational unit components and params', () => {
  expect(openApiDocument.components?.schemas).toHaveProperty('OrganizationalUnitSummary');
  expect(openApiDocument.components?.schemas).toHaveProperty('OrganizationalUnitDetail');
  expect(openApiDocument.components?.schemas).toHaveProperty('PaginatedOrganizationalUnits');

  const listParameters =
    openApiDocument.paths?.['/api/v1/organizational-units']?.get?.parameters ?? [];
  const listNames = listParameters.map((parameter) =>
    'name' in parameter ? parameter.name : undefined,
  );
  expect(listNames).toContain('type');
  expect(listNames).toContain('isActive');

  const detailParameters =
    openApiDocument.paths?.['/api/v1/organizational-units/{id}']?.patch?.parameters ?? [];
  const detailNames = detailParameters.map((parameter) =>
    'name' in parameter ? parameter.name : undefined,
  );
  expect(detailNames).toContain('id');
});
```

- [x] **Step 3: Verificar el rojo y montar el documento**

Run: `pnpm exec vitest run src/docs/openapi.test.ts`

Expected: FAIL porque las operaciones no existen.

Modify `src/docs/openapi.ts`: importar `organizationalUnitsPaths`, agregar el tag `{ name: 'Organizational Units', description: 'Organizational unit catalog and lifecycle.' }` y extender `paths`.

- [x] **Step 4: Regenerar y verificar el contrato**

```bash
pnpm run docs:generate
pnpm exec vitest run src/docs/openapi.test.ts
pnpm run docs:check
```

Expected: `openapi.json` con las 6 operaciones nuevas; tests y check en verde.

---

### Task 5: Coleccion Bruno

**Files:**

- Create: `bruno/Organizational_Units/` (folder.bru, Log in as admin.bru, Log in as a regular user.bru, List organizational units.bru, List inactive organizational units.bru, Get an organizational unit.bru, Create an organizational unit.bru, Create a duplicate unit returns 409.bru, Update an organizational unit.bru, Reject immutable unit fields returns 400.bru, Deactivate an organizational unit.bru, Reactivate an organizational unit.bru, Deactivate a unit with scheduled activities returns 409.bru, Manage units as USER returns 403.bru, Get unknown unit returns 404.bru)
- Modify: `bruno/environments/local.bru` (variables `unitId`, `unitHeadId`, `newUnitId`, `newUnitCode`, `unknownUnitId`)

Reglas:

- Login admin (seq 1) captura `adminToken`; login regular (seq 2) captura `regularToken`.
- `Create an organizational unit` (seq 7) usa `newUnitCode` generado con `script:pre-request` (`"TMP-" + Date.now()`) y captura `newUnitId` en `script:post-response`.
- `Deactivate a unit with scheduled activities returns 409` usa `seed_unit_fic` (tiene una actividad `SCHEDULED` en el seed demo).
- No ejecutar `pnpm run api:collection:import` (destructivo).
- Run: `pnpm --dir bruno exec bru run Organizational_Units --env local`
- Expected: 15/15 requests y tests en verde.

---

### Task 6: Verificacion real contra el stack local

**Files:**

- Create temporal: `.tmp-2a-integration.mts` (se elimina al terminar)

- [x] **Step 1: Confirmar el stack**

```bash
docker compose -f compose.dev.yaml ps --format '{{.Name}} {{.Status}}'
docker compose -f compose.dev.yaml exec -T db psql -U sipeg -d sipeg -c "SELECT code, is_active FROM organizational_units ORDER BY code;"
```

- [x] **Step 2: Ejecutar la verificacion E2E**

El script temporal hace login admin y USER, crea una unidad `TMP-<timestamp>` con head, valida:
200/409/400/403/404, detalle con `defaultProgram` y `careers`, desactivacion con `ARCHIVED`, rechazo de desactivacion de `FIC` con 409, reactivacion con `ACTIVE`, inmutabilidad de `code`/`type`, y contraste psql de las filas creadas.

- [x] **Step 3: Verificar 2.A.7 directo en la BD**

```bash
docker compose -f compose.dev.yaml exec -T db psql -U sipeg -d sipeg -c "UPDATE event_programs SET status='ARCHIVED' WHERE is_default AND organizational_unit_id=(SELECT id FROM organizational_units WHERE code='FIC');"
```

Expected: error `a default event program cannot be archived while its owner is active`.

- [x] **Step 4: Limpiar unidades temporales**

```sql
BEGIN;
ALTER TABLE event_programs DISABLE TRIGGER event_programs_prevent_delete;
DELETE FROM event_programs WHERE organizational_unit_id IN (SELECT id FROM organizational_units WHERE code LIKE 'TMP-%');
DELETE FROM organizational_units WHERE code LIKE 'TMP-%';
ALTER TABLE event_programs ENABLE TRIGGER event_programs_prevent_delete;
COMMIT;
```

- [x] **Step 5: Eliminar el script temporal**

`rm .tmp-2a-integration.mts`

---

### Task 7: Documentacion, gates de calidad y cierre

**Files:**

- Modify: `README.md`, `CONTEXT.md`, `docs/superpowers/plans/plan-maestro-sipeg-utp.md`

- [x] **Step 1: Documentar el modulo** en README (seccion `Unidades Organizativas`) y CONTEXT (decisiones/estado).
- [x] **Step 2: Gates**: `pnpm test`, `pnpm run typecheck`, `pnpm run lint`, `pnpm run build`, `pnpm run format:check`, `pnpm run docs:check`.
- [x] **Step 3: Cerrar 2.A.1-2.A.7** en el plan maestro, actualizar la tabla de estado y agregar el registro de ejecucion. Sin commit: el usuario no lo solicito.

---

## Threat model resumido

- **BFLA:** `POST`/`PATCH`/`deactivate`/`reactivate` exigen `authenticate` + `requireAdmin`; un `USER` recibe 403 antes de tocar Prisma.
- **Mass assignment:** create y update usan `.strict()`; `code`, `type` e `isActive` no son editables por PATCH.
- **Fugas:** el head expone solo `{ id, firstName, lastName }`; no se devuelven `createdAt/updatedAt`, emails ni identificaciones.
- **Integridad:** unidad+programa default en una transaccion; orden unidad→programa en la desactivacion; triggers de BD validan la invariante; `event_programs_prevent_delete` impide el borrado fisico.
- **Inyeccion:** Prisma parametriza; parametros y query validados con Zod (trim, rangos, enum, `.strict()`).

## Self-review

- Cobertura 2.A.1 (listado publico con filtros y paginacion), 2.A.2 (detalle con carreras y default), 2.A.3 (transaccion y 409), 2.A.4 (campos editables e inmutabilidad), 2.A.5 (desactivacion atomica y 409 con actividades), 2.A.6 (reactivacion atomica), 2.A.7 (invariante por trigger + prueba de orden + verificacion SQL).
- Sin migraciones, variables de entorno ni permisos nuevos.
- Los tests de ruta montan el contrato real con Prisma mockeado; la verificacion real cubre triggers y transacciones.

---

## Registro de ejecucion (2026-09-20)

- [x] Plan detallado con ciclo TDD rojo/verde en las 4 capas: esquemas (14 pruebas; rojo por modulo inexistente), servicio (25; rojo por servicio inexistente), rutas (19; rojo con 404 en todas las rutas nuevas) y contrato OpenAPI (3; rojo por operaciones ausentes).
- [x] Implementacion: `src/modules/organizational-units/` con tipos, esquemas Zod, servicio, controlador, rutas y OpenAPI; `src/routes.ts` monta el router y `src/docs/openapi.ts` agrega el tag `Organizational Units`.
- [x] 2.A.3: `createOrganizationalUnit` valida head activo, pre-valida el `code` y crea unidad + programa predeterminado `ACTIVE` (`Programa de Eventos - <nombre>`) en un `$transaction`; traduce `P2002` a `409`. La prueba de fallo verifica que ambas escrituras viven en una sola transaccion.
- [x] 2.A.5: `deactivateOrganizationalUnit` rechaza con `409` si el default tiene actividades `SCHEDULED`/`ONGOING`; dentro de la transaccion actualiza la unidad primero y luego archiva el programa (`status=ARCHIVED`, `archivedAt`). El orden se fija con `invocationCallOrder` porque el trigger de BD lo exige.
- [x] 2.A.6: `reactivateOrganizationalUnit` actualiza solo `is_active`; el trigger `organizational_units_reactivate_default_program` restaura el default en la misma transaccion. La prueba comprueba que el servicio no llama a `eventProgram.update`.
- [x] 2.A.7: verificacion SQL directa contra PostgreSQL: `UPDATE event_programs SET status='ARCHIVED' WHERE is_default AND ... FIC` falla con `a default event program cannot be archived while its owner is active`.
- [x] Pruebas: modulo `organizational-units` 58 en 3 archivos (14 esquemas + 25 servicio + 19 rutas); `src/docs` 23 en el archivo OpenAPI (20 previos + 3 nuevos).
- [x] Verificacion real (stack Docker dev, seed demo): 39/39 checks E2E con admin y USER; listado publico con filtros y sin campos internos, detalle con carreras/encargado y sin PII, `201`/`409`/`404`/`400`/`403`, ciclo desactivar/reactivar con `ARCHIVED`/`ACTIVE`, FIC bloqueado con `409`. Contraste psql: 2 unidades `TMP-*` activas con default `ACTIVE` coherentes con las respuestas; limpieza con `event_programs_prevent_delete` deshabilitado en una transaccion (10 unidades y 10 programas predeterminados restaurados).
- [x] Bruno: `bruno/Organizational_Units/` con 14 requests y 15 tests (`bru run Organizational_Units --env local` en verde) y variables `unitId`/`unitHeadId` en `bruno/environments/local.bru`.
- [x] Contrato: `pnpm run docs:generate` y `docs:check` sin drift; 6 operaciones, tag y componentes nuevos.
- [x] Documentacion: README y CONTEXT actualizados; plan maestro con 2.A.1-2.A.7 marcados y registro agregado.
- [x] Desviacion: el arnes de las pruebas de ruta genera un unico par Ed25519 en `beforeAll` y firma ambos tokens con esa clave privada (el boceto del plan generaba un par por token, lo que no valida contra el JWKS local). El comportamiento probado no cambia.
- [x] Calidad: `pnpm test` 492 en 35 archivos, `build`, `lint`, `format` de los archivos tocados y `docs:check` en verde (93 pruebas en `src/modules/organizational-units` + `src/docs`). `typecheck` y `format:check` globales fallan unicamente por el trabajo concurrente de 1.10/1.11: `src/modules/users/users.routes.test.ts:229` (TS4111, archivo ajeno) y `docs/superpowers/plans/2026-09-20-fase-1-11-actualizar-usuario.md` sin formatear. `tsc -p tsconfig.build.json` (sin tests) y `eslint` global pasan.
- [x] Notas: sin migraciones, variables de entorno ni permisos nuevos. Renombrar una unidad no sincroniza el nombre del programa predeterminado. Sin commit: el usuario no lo solicito.
