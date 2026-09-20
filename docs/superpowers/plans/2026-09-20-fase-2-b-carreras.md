# Fase 2.B - Carreras Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar los checklist 2.B.1 a 2.B.3 del plan maestro implementando el modulo `careers`: listado publico paginado con filtro por unidad y busqueda, creacion/actualizacion solo ADMIN con validacion de facultad activa, y eliminacion fisica condicionada a la ausencia de usuarios, todo sin `isActive` (ADR-0006).

**Architecture:** Modulo autocontenido `src/modules/careers/` con el patron de `organizational-units`/`users`: `authenticate -> requireAdmin -> validate -> controlador -> servicio -> Prisma`. Las lecturas son publicas. `unitId` nulo representa una carrera global (`OTROS`); el filtro `unitId=<id>` devuelve las carreras propias de la facultad mas las globales, y `unitId=global` devuelve solo las globales. La carrera `OTROS` es una invariante del sistema de usuarios: no se elimina, no cambia de codigo y debe permanecer global. Cambiar la unidad de una carrera con usuarios asociados responde 409 para no romper la coherencia usuario-unidad-carrera.

**Tech Stack:** TypeScript 6, Express 5, Prisma 7 (SQL/Postgres), Zod 4, Vitest, Supertest, OpenAPI 3.1 (zod-openapi), Bruno.

**Hallazgos de partida (2026-09-20):**

- Fase 2.A cerrada: `src/modules/organizational-units/` es el patron de referencia (tipos, schemas, servicio, controlador, rutas, OpenAPI con tag propio y 58 pruebas).
- `Career` no tiene `isActive`; `unitId String?` con `onDelete: Restrict`; `users.career_id` usa `ON DELETE SET NULL` (migracion `20260920014035_remove_career_active_and_optional_unit`).
- El seed (base y demo) ya crea 25 carreras, incluida `OTROS` global (`code: 'OTROS'`, `unitId: null`).
- `src/modules/users/users.service.ts` depende de `code: 'OTROS'` para forzar la carrera cuando `unitId === null`; renombrarlo, volverlo no-global o eliminarlo rompe el registro y `PATCH /users/me` con 409.
- `bruno/environments/local.bru` ya tiene `unitId`, `unitHeadId` y `adminUserId`; se agregaran solo variables de carreras.
- No hay convencion previa de `DELETE` en el repo; se adopta `204 No Content`.

**Decisiones confirmadas (2026-09-20):**

1. `GET /api/v1/careers` es publico (selector del frontend y registro); `POST`/`PATCH`/`DELETE` exigen `authenticate -> requireAdmin`.
2. Filtro `unitId`: `unitId=<id>` devuelve carreras de esa facultad mas globales (`unitId: null`); `unitId=global` devuelve solo globales; sin filtro, todo el catalogo.
3. `OTROS` protegida: `DELETE` responde 409; su `code` es inmutable y debe permanecer global (`unitId: null`); `name`/`description` si son editables.
4. Cambio de `unitId` en una carrera con usuarios asociados responde 409; si la unidad enviada es la misma, no se revalida ni se bloquea.
5. `DELETE` exitoso responde `204 No Content` sin cuerpo.

**Sin cambios de esquema, migraciones, variables de entorno ni catalogo de permisos** (decision 7 del maestro: catalogos solo ADMIN).

---

## Contrato HTTP

| Metodo | Ruta                   | Acceso  | Exito | Errores esperados       |
| ------ | ---------------------- | ------- | ----- | ----------------------- |
| GET    | `/api/v1/careers`      | Publico | 200   | 400                     |
| POST   | `/api/v1/careers`      | ADMIN   | 201   | 400, 401, 403, 404, 409 |
| PATCH  | `/api/v1/careers/{id}` | ADMIN   | 200   | 400, 401, 403, 404, 409 |
| DELETE | `/api/v1/careers/{id}` | ADMIN   | 204   | 401, 403, 404, 409      |

**Query del listado:** `page` (default 1), `limit` (default 20, max 50), `q` (1-200, busca en nombre y codigo), `unitId` (id o `global`). Esquema `.strict()`.

**DTO:** `CareerSummary = { id, name, code, description, unit }`, `unit = { id, name, code } | null`. Componentes OpenAPI: `CareerUnit`, `CareerSummary`, `PaginatedCareers`.

**Mensajes de error:**

- `Career not found.` (404)
- `Career code already exists.` (409)
- `Organizational unit not found.` (404)
- `Careers can only belong to a faculty.` (400)
- `Organizational unit is inactive.` (400)
- `The Otros career code cannot be changed.` (409)
- `The Otros career must remain global.` (409)
- `Cannot change the unit of a career with associated users.` (409)
- `The global Otros career cannot be deleted.` (409)
- `Career has associated users.` (409)

---

### Task 1: Tipos y esquemas Zod (TDD)

**Files:**

- Create: `src/modules/careers/careers.types.ts`
- Create: `src/modules/careers/careers.schemas.ts`
- Test: `src/modules/careers/careers.schemas.test.ts`

- [ ] **Step 1: Escribir las pruebas rojas del esquema**

Casos en `careers.schemas.test.ts` (patron de `organizational-units.schemas.test.ts`):

`listCareersQuerySchema`:

1. Aplica defaults sin forzar `unitId`: `parse({ query: {} })` -> `{ query: { page: 1, limit: 20 } }`.
2. Coerciona y valida paginacion: `page: '2', limit: '50'` -> numeros; `limit: '51'` y `page: '0'` lanzan.
3. Acepta `unitId` y `q` con trim: `{ unitId: ' unit-001 ', q: '  civil  ' }` -> `{ unitId: 'unit-001', q: 'civil' }`.
4. Acepta el sentinel `unitId: 'global'` sin transformarlo.
5. Rechaza `q: '   '`, `unitId: ''` y claves desconocidas.

`careerParamsSchema`:

6. Acepta y recorta un id; rechaza vacio/espacios y mas de 100 caracteres.

`createCareerSchema`:

7. Normaliza codigo a mayusculas y hace trim: `{ name: '  Ingenieria Civil  ', code: ' fic-civ ' }` -> `{ name: 'Ingenieria Civil', code: 'FIC-CIV' }`.
8. Acepta `description: null` y `unitId: null` (carrera global).
9. Rechaza codigos invalidos (`'A'`, `'A B'`, 21 caracteres), tipo desconocido y claves desconocidas (`isActive`).
10. Rechaza `name` faltante.

`updateCareerSchema`:

11. Acepta actualizacion parcial con `unitId: null`; recorta el id.
12. Rechaza body vacio, claves desconocidas (`createdAt`, `isActive`) y `unitId` vacio.

- [ ] **Step 2: Verificar el rojo**

Run: `pnpm exec vitest run src/modules/careers/careers.schemas.test.ts`
Expected: FAIL porque `careers.schemas.js` y `careers.types.js` no existen.

- [ ] **Step 3: Implementar tipos y esquemas**

`careers.types.ts`:

```ts
export interface CareerUnit {
  id: string;
  name: string;
  code: string;
}

export interface CareerSummary {
  id: string;
  name: string;
  code: string;
  description: string | null;
  unit: CareerUnit | null;
}

export interface PaginatedCareers {
  items: CareerSummary[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface CreateCareerInput {
  name: string;
  code: string;
  description?: string | null | undefined;
  unitId?: string | null | undefined;
}

export interface UpdateCareerInput {
  name?: string | undefined;
  code?: string | undefined;
  description?: string | null | undefined;
  unitId?: string | null | undefined;
}
```

`careers.schemas.ts`:

```ts
import { z } from 'zod';

import type { CareerSummary, PaginatedCareers } from './careers.types.js';

const careerCodeSchema = z
  .string()
  .trim()
  .min(2, 'Code must be at least 2 characters.')
  .max(20, 'Code cannot exceed 20 characters.')
  .regex(/^[A-Za-z0-9-]+$/, 'Code may only contain letters, numbers and hyphens.')
  .transform((value) => value.toUpperCase());

const careerIdSchema = z
  .string()
  .trim()
  .min(1, 'Career id is required.')
  .max(100, 'Career id cannot exceed 100 characters.');

const unitIdSchema = z
  .string()
  .trim()
  .min(1, 'Organizational unit id is required.')
  .max(100, 'Organizational unit id cannot exceed 100 characters.');

export const listCareersQuerySchema = z.object({
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
      unitId: z
        .string()
        .trim()
        .min(1, 'Organizational unit filter cannot be empty.')
        .max(100, 'Organizational unit filter cannot exceed 100 characters.')
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

export type ListCareersQuery = z.infer<typeof listCareersQuerySchema>['query'];

export const careerParamsSchema = z.object({
  params: z.object({ id: careerIdSchema }),
});

export type CareerParams = z.infer<typeof careerParamsSchema>['params'];

export const createCareerSchema = z.object({
  body: z
    .object({
      name: z
        .string()
        .trim()
        .min(1, 'Name is required.')
        .max(150, 'Name cannot exceed 150 characters.'),
      code: careerCodeSchema,
      description: z
        .string()
        .trim()
        .max(2000, 'Description cannot exceed 2000 characters.')
        .nullish(),
      unitId: unitIdSchema.nullish(),
    })
    .strict(),
});

export type CreateCareerBody = z.infer<typeof createCareerSchema>['body'];

export const updateCareerSchema = z.object({
  params: z.object({ id: careerIdSchema }),
  body: z
    .object({
      name: z
        .string()
        .trim()
        .min(1, 'Name is required.')
        .max(150, 'Name cannot exceed 150 characters.')
        .optional(),
      code: careerCodeSchema.optional(),
      description: z
        .string()
        .trim()
        .max(2000, 'Description cannot exceed 2000 characters.')
        .nullish(),
      unitId: unitIdSchema.nullish(),
    })
    .strict()
    .refine((body) => Object.keys(body).length > 0, {
      message: 'At least one field must be provided.',
    }),
});

export type UpdateCareerBody = z.infer<typeof updateCareerSchema>['body'];

export const careerUnitSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    code: z.string(),
  })
  .meta({
    id: 'CareerUnit',
    description: 'Minimal reference to the organizational unit that owns a career.',
  });

export const careerSummarySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    code: z.string(),
    description: z.string().nullable(),
    unit: careerUnitSchema.nullable(),
  })
  .meta({
    id: 'CareerSummary',
    description: 'Career catalog entry.',
  }) satisfies z.ZodType<CareerSummary>;

export const paginatedCareersSchema = z
  .object({
    items: z.array(careerSummarySchema),
    page: z.number().int(),
    limit: z.number().int(),
    total: z.number().int(),
    totalPages: z.number().int(),
  })
  .meta({
    id: 'PaginatedCareers',
    description: 'Paginated list of careers.',
  }) satisfies z.ZodType<PaginatedCareers>;
```

- [ ] **Step 4: Verificar el verde**

Run: `pnpm exec vitest run src/modules/careers/careers.schemas.test.ts`
Expected: PASS.

---

### Task 2: Servicio (TDD)

**Files:**

- Create: `src/modules/careers/careers.service.ts`
- Test: `src/modules/careers/careers.service.test.ts`

- [ ] **Step 1: Escribir las pruebas rojas del servicio**

Harness (patron de `organizational-units.service.test.ts`): `vi.doMock('../../config/prisma.js', () => ({ getPrismaClient: () => prisma }))` y `$transaction` con callback al mismo mock. Modelos mockeados: `career` (`findUnique`, `findMany`, `count`, `create`, `update`, `delete`), `organizationalUnit.findUnique`, `user.count`.

Casos:

`listCareers`:

1. Sin filtros: `where: {}`, `skip/take` correctos, `orderBy: [{ name: 'asc' }, { id: 'asc' }]`, envelope paginado.
2. `unitId: 'unit-001'` -> `where: { AND: [{ OR: [{ unitId: 'unit-001' }, { unitId: null }] }] }`.
3. `unitId: 'global'` -> `where: { AND: [{ unitId: null }] }`.
4. `q: 'civil'` -> `AND` con `OR` de `name`/`code` `contains` + `mode: 'insensitive'`.
5. `unitId` + `q` combinados -> un solo `where.AND` con ambos filtros (sin colision de claves).
6. Sin resultados -> `total: 0`, `totalPages: 0`.
7. El `select` no expone `createdAt`/`updatedAt` (incluye `unit: { select: { id, name, code } }`).

`createCareer`:

8. Sin `unitId` crea carrera global (`unitId: null`, `description: null`).
9. Con `unitId` de facultad activa valida y crea.
10. Unidad inexistente -> 404 `Organizational unit not found.` sin crear.
11. Unidad `SUBDIRECTORATE` -> 400 `Careers can only belong to a faculty.`
12. Unidad inactiva -> 400 `Organizational unit is inactive.`
13. Codigo duplicado pre-existente -> 409 `Career code already exists.` sin crear.
14. Carrera `P2002` en create -> 409 (carrera de concurrencia).

`updateCareer`:

15. Carrera inexistente -> 404 `Career not found.`
16. Actualiza nombre/descripcion parcialmente con `where: { id }`.
17. `unitId` igual al actual con usuarios -> actualiza sin contar usuarios.
18. `unitId` distinto con usuarios -> 409 `Cannot change the unit of a career with associated users.`
19. `unitId` distinto sin usuarios -> valida la unidad y actualiza.
20. `unitId: null` sin usuarios -> vuelve global.
21. `PATCH` de `OTROS` con codigo distinto -> 409 `The Otros career code cannot be changed.`
22. `PATCH` de `OTROS` con `unitId` no nulo -> 409 `The Otros career must remain global.`
23. `PATCH` de `OTROS` con `name` -> permitido.
24. Codigo duplicado en update -> 409 (pre-check/P2002).

`deleteCareer`:

25. Carrera inexistente -> 404.
26. `OTROS` -> 409 `The global Otros career cannot be deleted.` sin transaccion.
27. Con usuarios -> 409 `Career has associated users.` dentro de la transaccion, sin `delete`.
28. Sin usuarios -> `delete` dentro de `$transaction` y resuelve `undefined`.

- [ ] **Step 2: Verificar el rojo**

Run: `pnpm exec vitest run src/modules/careers/careers.service.test.ts`
Expected: FAIL porque el servicio no existe.

- [ ] **Step 3: Implementar el servicio**

`careers.service.ts`:

```ts
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
  const filters: Record<string, unknown>[] = [];

  if (query.unitId === GLOBAL_UNIT_FILTER) {
    filters.push({ unitId: null });
  } else if (query.unitId) {
    filters.push({ OR: [{ unitId: query.unitId }, { unitId: null }] });
  }

  if (query.q) {
    filters.push({
      OR: [
        { name: { contains: query.q, mode: 'insensitive' } },
        { code: { contains: query.q, mode: 'insensitive' } },
      ],
    });
  }

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

  const isOtrosCareer = career.code === OTROS_CAREER_CODE;

  if (isOtrosCareer) {
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
```

Nota: `filters` se tipa como `Record<string, unknown>[]`; si `tsc` se queja al pasar `where` a Prisma, sustituir por `Prisma.CareerWhereInput[]` importado de `../../generated/prisma/client.js`.

- [ ] **Step 4: Verificar el verde**

Run: `pnpm exec vitest run src/modules/careers/careers.service.test.ts`
Expected: PASS.

---

### Task 3: Controlador, rutas, pruebas de ruta y montaje (TDD)

**Files:**

- Create: `src/modules/careers/careers.controller.ts`
- Create: `src/modules/careers/careers.routes.ts`
- Test: `src/modules/careers/careers.routes.test.ts`
- Modify: `src/routes.ts`

- [ ] **Step 1: Implementar el controlador**

`careers.controller.ts` con 4 handlers `RequestHandler` envueltos en `asyncHandler` (patron exacto de `organizational-units.controller.ts`):

- `getCareers`: `req.query as unknown as ListCareersQuery` -> `listCareers` -> `200 successResponse('Careers retrieved successfully.', result)`.
- `createCareer`: body -> `201 'Career created successfully.'`.
- `updateCareer`: `{ id }` + body -> `200 'Career updated successfully.'`.
- `deleteCareer`: `{ id }` -> `await deleteCareerService(id)` -> `res.status(204).send()`.

- [ ] **Step 2: Implementar las rutas**

`careers.routes.ts`:

```ts
import { Router } from 'express';

import { authenticate } from '../../middlewares/authenticate.middleware.js';
import { requireAdmin } from '../../middlewares/authorize.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { createCareer, deleteCareer, getCareers, updateCareer } from './careers.controller.js';
import {
  careerParamsSchema,
  createCareerSchema,
  listCareersQuerySchema,
  updateCareerSchema,
} from './careers.schemas.js';

export const careersRoutes = Router();

careersRoutes.get('/careers', validate(listCareersQuerySchema), getCareers);

careersRoutes.post(
  '/careers',
  authenticate,
  requireAdmin,
  validate(createCareerSchema),
  createCareer,
);

careersRoutes.patch(
  '/careers/:id',
  authenticate,
  requireAdmin,
  validate(updateCareerSchema),
  updateCareer,
);

careersRoutes.delete(
  '/careers/:id',
  authenticate,
  requireAdmin,
  validate(careerParamsSchema),
  deleteCareer,
);
```

Modificar `src/routes.ts`: importar `careersRoutes` y `apiRoutes.use(careersRoutes);` (despues de `organizationalUnitsRoutes`, antes de `healthRoutes`).

- [ ] **Step 3: Escribir las pruebas de ruta**

`careers.routes.test.ts` replica el arnes de `organizational-units.routes.test.ts` (JWKS local en `beforeAll`, un unico par Ed25519 para ambos tokens, `vi.doMock` de `../../config/prisma.js`, `../../utils/jwt-verifier.js` y `../../lib/auth.js`, `loadApp` que importa `../../app.js`). El mock de Prisma agrega `career: { findUnique, findMany, count, create, update, delete }` y `user: { findUnique, count }`; `$transaction` ejecuta el callback con el mismo mock.

Casos:

1. `GET /api/v1/careers` publico 200: `success`, `data.items` con `unit`, y `findMany` llamado con `where: {}`.
2. `GET /api/v1/careers?unitId=unit-001&q=civil&page=2&limit=5` 200: `where.AND` con `OR` de unidad mas globales y `OR` de busqueda; `skip: 5`, `take: 5`.
3. `GET /api/v1/careers?unitId=global` 200: `where: { AND: [{ unitId: null }] }`.
4. `GET /api/v1/careers?limit=51` 400 `Validation error.` sin tocar Prisma.
5. `POST /api/v1/careers` sin token 401.
6. `POST /api/v1/careers` como USER 403 `Insufficient privileges for this resource.` sin crear.
7. `POST /api/v1/careers` ADMIN 201 con unidad de facultad; normaliza `code` a mayusculas y `description` nula.
8. `POST /api/v1/careers` ADMIN con unidad `SUBDIRECTORATE` 400 `Careers can only belong to a faculty.`
9. `POST /api/v1/careers` ADMIN con unidad inactiva 400 `Organizational unit is inactive.`
10. `POST /api/v1/careers` ADMIN con codigo duplicado 409 `Career code already exists.` sin crear.
11. `PATCH /api/v1/careers/car-001` ADMIN 200 con `name`; verifica `where`/`data`.
12. `PATCH /api/v1/careers/car-otros` ADMIN con `code: 'OTRO'` 409 `The Otros career code cannot be changed.`
13. `PATCH /api/v1/careers/car-001` ADMIN con `unitId` distinto y usuarios 409 `Cannot change the unit of a career with associated users.`
14. `PATCH /api/v1/careers/car-missing` ADMIN 404 `Career not found.`
15. `PATCH /api/v1/careers/car-001` ADMIN body vacio 400 sin tocar Prisma.
16. `DELETE /api/v1/careers/car-001` sin token 401; como USER 403.
17. `DELETE /api/v1/careers/car-001` ADMIN sin usuarios 204 con cuerpo vacio y `career.delete` llamado dentro de la transaccion.
18. `DELETE /api/v1/careers/car-001` ADMIN con usuarios 409 `Career has associated users.` sin `delete`.
19. `DELETE /api/v1/careers/car-otros` ADMIN 409 `The global Otros career cannot be deleted.`
20. `DELETE /api/v1/careers/car-missing` ADMIN 404.

- [ ] **Step 4: Verificar el rojo y luego el verde**

Run (antes de montar el router): `pnpm exec vitest run src/modules/careers/careers.routes.test.ts`
Expected: FAIL con 404 en todas las rutas nuevas.

Tras montar el router:
Run: `pnpm exec vitest run src/modules/careers/careers.routes.test.ts`
Expected: PASS.

---

### Task 4: Contrato OpenAPI (TDD)

**Files:**

- Create: `src/modules/careers/careers.openapi.ts`
- Modify: `src/docs/openapi.ts`
- Test: `src/docs/openapi.test.ts`

- [ ] **Step 1: Escribir las pruebas rojas del contrato**

Agregar a `expectedOperations`: `GET/POST /api/v1/careers`, `PATCH/DELETE /api/v1/careers/{id}`.

Nuevas pruebas (patron de las de `organizational-units`):

1. `GET /api/v1/careers` queda publico (`security` `undefined`) y documenta `page`, `limit`, `unitId`, `q`; expone `PaginatedCareers`.
2. `POST /careers` y `PATCH /careers/{id}` llevan `security: [{ bearerAuth: [] }]` y documentan 201/200, 400, 401, 403, 409.
3. `DELETE /careers/{id}` lleva bearer, documenta 204, 401, 403, 404, 409 y el path param `id`.
4. Existen los componentes `CareerUnit`, `CareerSummary` y `PaginatedCareers`, y `CareerSummary` tiene `unit` nullable.

Run: `pnpm exec vitest run src/docs/openapi.test.ts`
Expected: FAIL porque las operaciones y componentes no existen.

- [ ] **Step 2: Implementar `careers.openapi.ts` y montar el documento**

`careers.openapi.ts` con `ZodOpenApiPathsObject` (patron de `organizational-units.openapi.ts`):

- `GET`: tag `Careers`, `summary: 'List careers'`, publico, `requestParams.query = listCareersQuerySchema.shape.query`, 200 `apiSuccessResponse(paginatedCareersSchema)`, 400 error.
- `POST`: tag `Careers`, bearer, body `createCareerSchema.shape.body`, 201 `apiSuccessResponse(careerSummarySchema)`, 400/401/403/404/409.
- `PATCH`: path param `careerParamsSchema.shape.params`, body `updateCareerSchema.shape.body`, 200 `careerSummarySchema`, 400/401/403/404/409.
- `DELETE`: path param, `204: { description: 'Career deleted.' }` sin `content`, 401/403/404/409.

Modificar `src/docs/openapi.ts`:

- `import { careersPaths } from '../modules/careers/careers.openapi.js';`
- Tag `{ name: 'Careers', description: 'Career catalog management.' }`.
- `...careersPaths` en `paths`.

- [ ] **Step 3: Regenerar y verificar**

```bash
pnpm run docs:generate
pnpm exec vitest run src/docs/openapi.test.ts
pnpm run docs:check
```

Expected: `openapi.json` con las 4 operaciones nuevas; tests y check en verde.

---

### Task 5: Coleccion Bruno

**Files:**

- Create: `bruno/Careers/` (folder.bru + 11 requests)
- Modify: `bruno/environments/local.bru`

Secuencia:

1. `Log in as admin.bru` (seq 1): copia de `bruno/Admin/Log in as admin.bru`; captura `adminToken`.
2. `Log in as a regular user.bru` (seq 2): captura `regularToken`.
3. `List careers.bru` (seq 3): `GET /api/v1/careers?page=1&limit=5`; assertions de envelope paginado, `items[].unit` presente y ausencia de `createdAt`/`updatedAt`.
4. `List careers by unit.bru` (seq 4): `GET /api/v1/careers?unitId={{unitId}}`; assertion de que al menos un item es global (`unit === null`), demostrando la semantica unidad+globales.
5. `Create a career.bru` (seq 5): `script:pre-request` genera `newCareerCode` con `TMP-` + timestamp, body `{ name, code: "{{newCareerCode}}", unitId: "{{unitId}}" }`; 201, captura `newCareerId`, no filtra `$argon2`.
6. `Create a duplicate career returns 409.bru` (seq 6): reutiliza `newCareerCode`; 409 `Career code already exists.`
7. `Update a career.bru` (seq 7): `PATCH /careers/{{newCareerId}}` con `name`; 200.
8. `Delete a career.bru` (seq 8): `DELETE /careers/{{newCareerId}}`; 204 y cuerpo vacio.
9. `Delete career with users returns 409.bru` (seq 9): `DELETE /careers/seed_career_fic-civ`; 409 `Career has associated users.`
10. `Delete the Otros career returns 409.bru` (seq 10): `DELETE /careers/seed_career_otros`; 409 `The global Otros career cannot be deleted.`
11. `Manage careers as USER returns 403.bru` (seq 11): `POST /careers` con `regularToken`; 403.
12. `Update unknown career returns 404.bru` (seq 12): `PATCH /careers/career-does-not-exist`; 404.

Variables nuevas en `bruno/environments/local.bru`: `careerId: seed_career_fic-civ`, `otrosCareerId: seed_career_otros`, `newCareerId:`, `newCareerCode:`, `unknownCareerId: career-does-not-exist`. No ejecutar `pnpm run api:collection:import`.

Run: `pnpm --dir bruno exec bru run Careers --env local`
Expected: 12/12 requests y tests en verde (reiniciar el stack si el login agota rate limit).

---

### Task 6: Verificacion real contra el stack local

**Files:**

- Create temporal: `.tmp-2b-integration.mts` (se elimina al terminar)

- [ ] **Step 1: Confirmar el stack y las carreras del seed**

```bash
docker compose -f compose.dev.yaml ps --format '{{.Name}} {{.Status}}'
docker compose -f compose.dev.yaml exec -T db psql -U sipeg -d sipeg -c "SELECT code, unit_id FROM careers ORDER BY code LIMIT 5;"
```

- [ ] **Step 2: Ejecutar la verificacion E2E**

El script temporal hace login admin y USER y valida contra `http://localhost:3000`:

- `GET /api/v1/careers` 200 publico con paginacion.
- `GET /api/v1/careers?unitId=seed_unit_fic` incluye `OTROS` (`unit: null`) y carreras de FIC.
- `GET /api/v1/careers?unitId=global` solo `OTROS`.
- `GET /api/v1/careers?q=civil` filtra por nombre/codigo.
- `POST /careers` con `unitId` `SUB-ACAD` -> 400; con `unitId: null` -> 201 global temporal.
- `POST /careers` duplicado -> 409; `PATCH` del temporal -> 200; `DELETE` -> 204.
- `DELETE /careers/seed_career_fic-civ` -> 409; `DELETE /careers/seed_career_otros` -> 409.
- `PATCH /careers/seed_career_otros` con `code` distinto -> 409; con `name` -> 200 y se restaura el nombre.
- `PATCH /careers/seed_career_fic-civ` con `unitId` distinto -> 409.
- `POST`/`PATCH`/`DELETE` con token USER -> 403.
- `PATCH /careers/career-does-not-exist` -> 404.
- Contraste psql de la carrera global temporal y limpieza.

- [ ] **Step 3: Limpiar y eliminar el script**

```sql
DELETE FROM careers WHERE code LIKE 'TMP-B2%';
```

`rm .tmp-2b-integration.mts`

---

### Task 7: Documentacion, gates de calidad y cierre

**Files:**

- Modify: `README.md`, `CONTEXT.md`, `docs/superpowers/plans/plan-maestro-sipeg-utp.md`

- [ ] **Step 1: README** — agregar `### Carreras` despues de `### Unidades Organizativas` con el contrato completo (publico, filtros, ADMIN, OTROS, cambio de unidad, DELETE 204).
- [ ] **Step 2: CONTEXT** — actualizar el estado del repositorio y la definicion de `Carrera` (catalogo sin `isActive`, global `OTROS`, protecciones).
- [ ] **Step 3: Plan maestro** — marcar `2.B.1`-`2.B.3`, actualizar la tabla de estado y agregar el registro de ejecucion.
- [ ] **Step 4: Gates**

```bash
pnpm test
pnpm run typecheck
pnpm run lint
pnpm run build
pnpm run format:check
pnpm run docs:check
```

Expected: verde (si `typecheck`/`format:check` globales fallan solo por archivos de otra fase concurrente, documentarlo como desviacion).

- [ ] **Step 5: Cierre** — actualizar el registro de ejecucion de este plan. Sin commit: el usuario no lo solicito.

---

## Threat model resumido

- **BFLA:** `POST`/`PATCH`/`DELETE` exigen `authenticate` + `requireAdmin`; un `USER` recibe 403 antes de tocar Prisma.
- **Mass assignment:** create/update usan `.strict()`; `isActive`, `createdAt` y `id` no son editables.
- **Fugas:** el DTO expone solo `{ id, name, code, description, unit }`; sin `createdAt`/`updatedAt` ni datos de usuarios.
- **Integridad:** `OTROS` protegida (delete/code/global); cambio de unidad con usuarios bloqueado; delete con conteo de usuarios dentro de transaccion; `users.career_id` usa `ON DELETE SET NULL`, pero el servicio responde 409 antes.
- **Inyeccion:** Prisma parametriza; query/params/body validados con Zod (trim, rangos, `.strict()`).

## Self-review

- Cobertura 2.B.1 (listado publico con filtro por unidad, busqueda y paginacion, sin `isActive`), 2.B.2 (crear/actualizar con `unitId` opcional, validacion FACULTY activa y 409 duplicado) y 2.B.3 (DELETE con 409 por usuarios asociados).
- Sin migraciones, variables de entorno nuevas ni permisos nuevos.
- Los tests de ruta montan el contrato real con Prisma mockeado; la verificacion real cubre las protecciones del catalogo en la BD del seed.

---

## Registro de ejecucion (2026-09-20)

- [x] Plan detallado con ciclo TDD rojo/verde en las 4 capas: esquemas (14 pruebas; rojo por modulo inexistente), servicio (28; rojo por servicio inexistente), rutas (20; rojo con 404 en todas las rutas nuevas) y contrato OpenAPI (3 nuevas; rojo por operaciones ausentes).
- [x] Implementacion: `src/modules/careers/` con tipos, esquemas Zod, servicio, controlador, rutas y OpenAPI; `src/routes.ts` monta el router y `src/docs/openapi.ts` agrega el tag `Careers`.
- [x] 2.B.1: listado publico paginado con `q` y `unitId`; `unitId=<id>` devuelve propias + globales, `unitId=global` solo globales, filtros combinados con `AND`.
- [x] 2.B.2: `unitId` opcional/null, validacion 404/400 de unidad (existencia, `FACULTY`, activa) y `code` unico con pre-check + `P2002` a 409.
- [x] 2.B.3 y protecciones: `DELETE` 204 sin usuarios y 409 con conteo dentro de transaccion; `OTROS` no se elimina, no cambia de codigo y debe permanecer global; cambio de unidad con usuarios 409.
- [x] Pruebas: modulo `careers` 62 en 3 archivos (14 esquemas + 28 servicio + 20 rutas); `pnpm test` 557 en 38 archivos.
- [x] Verificacion real (stack Docker dev, seed demo): 26/26 checks E2E con admin y USER; listado, filtros, 201/409/404/400/403, protecciones y `DELETE` 204; limpieza por psql (25 carreras, `OTROS` global con nombre restaurado).
- [x] Bruno: `bruno/Careers/` con 12 requests y 13 tests (`bru run Careers --env local` en verde) y variables de carreras en `bruno/environments/local.bru`.
- [x] Contrato: `pnpm run docs:generate` y `docs:check` sin drift; 4 operaciones, tag y componentes nuevos.
- [x] Documentacion: README y CONTEXT actualizados; plan maestro con 2.B.1-2.B.3 marcados, tabla de estado, endpoints y registro agregados.
- [x] Desviacion: `bru.getVar` no lee variables de environment dentro de los tests de Bruno; las assertions usan el codigo `FIC` del seed en lugar de `{{unitId}}`. El comportamiento probado no cambia.
- [x] Calidad: `pnpm test` 557 en 38 archivos, `typecheck`, `lint`, `build`, `format:check` y `docs:check` en verde.
- [x] Notas: sin migraciones, variables de entorno ni permisos nuevos. Sin commit: el usuario no lo solicito.
