# Fase 10.4 - Listar certificados propios Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar `GET /api/v1/users/me/certificates` con paginacion offset y filtros `eventProgramId`, `activityId`, `issuedFrom` y `issuedTo`, aislado al usuario autenticado.

**Architecture:** Se crea el modulo autocontenido `src/modules/certificates/` (types, schemas, servicio, controlador, rutas, OpenAPI y pruebas) con el router montado en `src/routes.ts`. El listado es de lectura propia: no exige permiso de colaboracion, no se audita y no lleva rate limit. La unica pieza de infraestructura que se agrega es `getInstitutionalDayRange` en `src/utils/date.ts`, porque `certificates.issued_at` es `Timestamptz` en UTC y los limites del dia de negocio deben caer en la medianoche de `America/Panama` (ADR-0002).

**Tech Stack:** TypeScript, Express 5, Prisma 7 (PostgreSQL), Zod 4, Vitest, Supertest, OpenAPI 3.1 (zod-openapi), Bruno.

**Decisiones confirmadas con el usuario (2026-09-29):**

1. **Ubicacion:** modulo nuevo `src/modules/certificates/`, no dentro de `users`. Precedente: `authorization.routes.ts:142` ya es dueno de `/users/me/permissions` aunque la ruta sea de users. Asi 10.1 (generar), 10.3 (descargar) y 10.6 (notificar) tienen donde crecer.
2. **Filtros:** `eventProgramId`, `activityId` e `issuedFrom`/`issuedTo` (`YYYY-MM-DD`), ademas de la paginacion offset `page`/`limit` con maximo 50. Sin busqueda `q`.
3. **Archivo:** el listado NO expone `pdfUrl` ni un booleano de disponibilidad. El seed escribe rutas placeholder (`/certificates/<code>.pdf`) sin archivo detras, el almacenamiento es Fase 6 y la descarga es 10.3; un boton de descarga que promete un archivo inexistente es peor que un campo ausente.

**Reglas de negocio:**

1. Aislamiento: `where.attendance.userId` proviene siempre de `requireAuthenticatedUser`, nunca de la query. No existe forma de leer certificados ajenos.
2. `issuedFrom` es inclusivo desde la medianoche institucional del dia; `issuedTo` es exclusivo hasta la medianoche del dia siguiente (asi cubre el dia completo).
3. `issuedFrom > issuedTo` responde `400` con el error en `issuedTo`.
4. Orden estable `issuedAt desc, id asc` para que la paginacion offset no repita ni omita items entre paginas.
5. Un filtro que no coincide con nada devuelve `200` con `items: []` y `total: 0`; el listado propio nunca responde `404`.

**Hallazgos de partida (2026-09-29):**

- `Certificate` ya existe en `prisma/schema.prisma:346` con `code` unico, `pdfUrl` nullable e `issuedAt`. No hay modulo, rutas, OpenAPI ni Bruno de certificados.
- `PERMISSIONS.CERTIFICATE_READ` existe (`src/modules/authorization/permissions.ts:17`) pero no aplica: es lectura propia, igual que `/users/me`.
- El seed demo crea certificados y alertas `CERTIFICATE_ISSUED` (`prisma/seed/attendance.seed.ts:189`). `estudiante01@utp.ac.pa` tiene 3 certificados en 3 programas distintos: `seed_program_fisc_default`, `seed_program_fic_default` y `seed_program_semana-ic`.
- Indice: `attendance` tiene `@@index([userId, checkedInAt])` y `certificates.attendance_id` es unico. La consulta arranca por `attendance` filtrando `userId` y entra a `certificates` por el unico, asi que no hace falta migracion. Se confirma con `EXPLAIN` en la Task 7.
- No hay `isValidCalendarDate` exportable: vive duplicado dentro de `activities.schemas.ts`. Se usa `z.iso.date()` de Zod 4, que valida calendario real (`2026-02-30` falla) y permite mensaje propio.
- Baseline verificado antes de empezar: `pnpm test` 1311 pruebas / 7 skip en 59 archivos en verde. Stack Docker dev arriba (`sipeg-utp-dev-api-1`, `sipeg-utp-dev-db-1` healthy).
- El arbol tiene trabajo concurrente sin commitear en `feat/logging-observability` (logging, observabilidad, auth). No se toca ninguno de esos archivos.

---

### Task 1: `getInstitutionalDayRange` en `src/utils/date.ts`

**Files:**

- Modify: `src/utils/date.ts`
- Modify: `src/utils/date.test.ts`

- [ ] **Step 1: Escribir la prueba que falla**

En `src/utils/date.test.ts`, agregar el import de `getInstitutionalDayRange` y el bloque:

```ts
describe('getInstitutionalDayRange', () => {
  it('resolves the institutional midnight of the requested day', () => {
    const { start, endExclusive } = getInstitutionalDayRange('2026-08-26');

    expect(start.toISOString()).toBe('2026-08-26T05:00:00.000Z');
    expect(endExclusive.toISOString()).toBe('2026-08-27T05:00:00.000Z');
  });

  it('keeps consecutive days contiguous', () => {
    const first = getInstitutionalDayRange('2026-08-26');
    const second = getInstitutionalDayRange('2026-08-27');

    expect(first.endExclusive.getTime()).toBe(second.start.getTime());
  });

  it('returns exactly 24 hours because Panama has no daylight saving time', () => {
    const { start, endExclusive } = getInstitutionalDayRange('2026-12-31');

    expect(endExclusive.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
    expect(start.toISOString()).toBe('2026-12-31T05:00:00.000Z');
  });

  it('does not depend on the process time zone', () => {
    expect(getInstitutionalDayRange('2026-01-01').start.toISOString()).toBe(
      '2026-01-01T05:00:00.000Z',
    );
  });
});
```

- [ ] **Step 2: Verificar el rojo**

Run: `pnpm exec vitest run src/utils/date.test.ts`

Expected: falla porque `getInstitutionalDayRange` no existe en el import.

- [ ] **Step 3: Implementar el helper**

En `src/utils/date.ts`, agregar al final del archivo:

```ts
const zoneOffsetFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: INSTITUTIONAL_TIME_ZONE,
  timeZoneName: 'longOffset',
});

const getZoneOffsetMilliseconds = (instant: Date): number => {
  const offset = zoneOffsetFormatter
    .formatToParts(instant)
    .find((part) => part.type === 'timeZoneName')?.value;

  if (!offset) {
    throw new Error('Unable to resolve the institutional time zone offset.');
  }

  const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(offset);

  if (!match) {
    throw new Error('Unexpected institutional time zone offset format.');
  }

  const [, sign, hours, minutes] = match;
  const totalMinutes = Number(hours) * 60 + Number(minutes);

  return (sign === '-' ? -totalMinutes : totalMinutes) * 60_000;
};

export const getInstitutionalDayRange = (
  dateKey: string,
): {
  start: Date;
  endExclusive: Date;
} => {
  const [year, month, day] = dateKey.split('-').map(Number);
  const calendarStartUtc = Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1);
  const start = new Date(calendarStartUtc - getZoneOffsetMilliseconds(new Date(calendarStartUtc)));

  return {
    start,
    endExclusive: new Date(start.getTime() + 24 * 60 * 60 * 1000),
  };
};
```

El offset se resuelve con `Intl` y se parsea de `GMT-05:00`, sin hardcodear `-05:00` (ADR-0002). `endExclusive` suma 24 horas exactas al inicio del dia porque Panama no aplica horario de verano (ADR-0002, `POS-002`), de modo que el dia institucional siempre dura 86400000 ms; la invariante la verifica la prueba de 24 horas del Step 1.

- [ ] **Step 4: Verde**

Run: `pnpm exec vitest run src/utils/date.test.ts`

Expected: todas en verde, incluidas las 4 pruebas nuevas.

- [ ] **Step 5: Typecheck y lint del archivo**

Run: `pnpm run typecheck && pnpm exec eslint src/utils/date.ts src/utils/date.test.ts`

Expected: sin errores.

---

### Task 2: Tipos y schemas del modulo de certificados

**Files:**

- Create: `src/modules/certificates/certificates.types.ts`
- Create: `src/modules/certificates/certificates.schemas.ts`
- Create: `src/modules/certificates/certificates.schemas.test.ts`

- [ ] **Step 1: Escribir la prueba que falla**

Crear `src/modules/certificates/certificates.schemas.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  certificateSummarySchema,
  listMyCertificatesQuerySchema,
  paginatedMyCertificatesSchema,
} from './certificates.schemas.js';

describe('listMyCertificatesQuerySchema', () => {
  it('applies pagination defaults', () => {
    expect(listMyCertificatesQuerySchema.parse({ query: {} })).toEqual({
      query: { page: 1, limit: 20 },
    });
  });

  it('coerces and validates pagination bounds', () => {
    expect(listMyCertificatesQuerySchema.parse({ query: { page: '2', limit: '50' } })).toEqual({
      query: { page: 2, limit: 50 },
    });
    expect(() => listMyCertificatesQuerySchema.parse({ query: { limit: '51' } })).toThrow();
    expect(() => listMyCertificatesQuerySchema.parse({ query: { page: '0' } })).toThrow();
    expect(() => listMyCertificatesQuerySchema.parse({ query: { page: 'x' } })).toThrow();
  });

  it('trims the scope filters', () => {
    expect(
      listMyCertificatesQuerySchema.parse({
        query: { eventProgramId: '  program-001  ', activityId: '  activity-001  ' },
      }),
    ).toEqual({
      query: {
        page: 1,
        limit: 20,
        eventProgramId: 'program-001',
        activityId: 'activity-001',
      },
    });
  });

  it('rejects empty and oversized scope filters', () => {
    expect(() => listMyCertificatesQuerySchema.parse({ query: { activityId: '   ' } })).toThrow();
    expect(() =>
      listMyCertificatesQuerySchema.parse({ query: { eventProgramId: 'p'.repeat(101) } }),
    ).toThrow();
  });

  it('accepts well formed issued bounds and rejects impossible calendar dates', () => {
    expect(
      listMyCertificatesQuerySchema.parse({
        query: { issuedFrom: '2026-08-26', issuedTo: '2026-09-07' },
      }),
    ).toEqual({ query: { page: 1, limit: 20, issuedFrom: '2026-08-26', issuedTo: '2026-09-07' } });

    expect(() =>
      listMyCertificatesQuerySchema.parse({ query: { issuedFrom: '2026-02-30' } }),
    ).toThrow();
    expect(() =>
      listMyCertificatesQuerySchema.parse({ query: { issuedTo: '26-08-2026' } }),
    ).toThrow();
    expect(() =>
      listMyCertificatesQuerySchema.parse({ query: { issuedFrom: ' 2026-08-26 ' } }),
    ).toThrow();
  });

  it('rejects an inverted issued range pointing at issuedTo', () => {
    const result = listMyCertificatesQuerySchema.safeParse({
      query: { issuedFrom: '2026-09-07', issuedTo: '2026-08-26' },
    });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['query', 'issuedTo']);
    expect(result.error?.issues[0]?.message).toBe('issuedFrom cannot be after issuedTo.');
  });

  it('accepts an inverted-looking pair when only one bound is present', () => {
    expect(listMyCertificatesQuerySchema.parse({ query: { issuedFrom: '2026-09-07' } })).toEqual({
      query: { page: 1, limit: 20, issuedFrom: '2026-09-07' },
    });
  });

  it('rejects unknown query keys', () => {
    expect(() => listMyCertificatesQuerySchema.parse({ query: { userId: 'other' } })).toThrow();
    expect(() => listMyCertificatesQuerySchema.parse({ query: { status: 'ISSUED' } })).toThrow();
  });
});

describe('certificateSummarySchema', () => {
  it('describes a certificate with its activity and event program', () => {
    const certificate = {
      id: 'cert-001',
      code: 'CERT-8F3A2B',
      issuedAt: '2026-09-07T14:05:00.000Z',
      activity: {
        id: 'activity-001',
        name: 'Workshop de Ciberseguridad Defensiva',
        date: '2026-09-07',
        type: 'WORKSHOP',
      },
      eventProgram: { id: 'program-001', name: 'Programa de Eventos - FISC' },
    };

    expect(certificateSummarySchema.parse(certificate)).toEqual(certificate);
  });

  it('strips storage and attendance internals from a certificate', () => {
    const parsed = certificateSummarySchema.parse({
      id: 'cert-001',
      code: 'CERT-8F3A2B',
      issuedAt: '2026-09-07T14:05:00.000Z',
      activity: {
        id: 'activity-001',
        name: 'Workshop',
        date: '2026-09-07',
        type: 'WORKSHOP',
      },
      eventProgram: { id: 'program-001', name: 'Programa' },
      pdfUrl: '/certificates/CERT-8F3A2B.pdf',
      attendanceId: 'attendance-001',
    });

    expect(parsed).toEqual({
      id: 'cert-001',
      code: 'CERT-8F3A2B',
      issuedAt: '2026-09-07T14:05:00.000Z',
      activity: {
        id: 'activity-001',
        name: 'Workshop',
        date: '2026-09-07',
        type: 'WORKSHOP',
      },
      eventProgram: { id: 'program-001', name: 'Programa' },
    });
  });
});

describe('paginatedMyCertificatesSchema', () => {
  it('describes the page envelope', () => {
    expect(
      paginatedMyCertificatesSchema.parse({
        items: [],
        page: 1,
        limit: 20,
        total: 0,
        totalPages: 0,
      }),
    ).toEqual({ items: [], page: 1, limit: 20, total: 0, totalPages: 0 });
  });
});
```

- [ ] **Step 2: Verificar el rojo**

Run: `pnpm exec vitest run src/modules/certificates/certificates.schemas.test.ts`

Expected: falla porque `./certificates.schemas.js` no existe.

- [ ] **Step 3: Crear los tipos**

Crear `src/modules/certificates/certificates.types.ts`:

```ts
import type { ActivityType } from '../../generated/prisma/enums.js';

export interface MyCertificateActivity {
  id: string;
  name: string;
  date: string;
  type: ActivityType;
}

export interface MyCertificateEventProgram {
  id: string;
  name: string;
}

export interface MyCertificateSummary {
  id: string;
  code: string;
  issuedAt: string;
  activity: MyCertificateActivity;
  eventProgram: MyCertificateEventProgram;
}

export interface PaginatedMyCertificates {
  items: MyCertificateSummary[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
```

- [ ] **Step 4: Crear los schemas**

Crear `src/modules/certificates/certificates.schemas.ts`:

```ts
import { z } from 'zod';

import type { MyCertificateSummary, PaginatedMyCertificates } from './certificates.types.js';

const MAX_PAGE_SIZE = 50;
const DEFAULT_PAGE_SIZE = 20;
const MAX_ID_FILTER_LENGTH = 100;

const idFilterSchema = (label: string) =>
  z
    .string()
    .trim()
    .min(1, `${label} is required.`)
    .max(MAX_ID_FILTER_LENGTH, `${label} cannot exceed ${MAX_ID_FILTER_LENGTH} characters.`);

const dateFilterSchema = (label: string) => z.iso.date(`${label} must be in YYYY-MM-DD format.`);

export const listMyCertificatesQuerySchema = z.object({
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
        .max(MAX_PAGE_SIZE, `Limit cannot exceed ${MAX_PAGE_SIZE}.`)
        .default(DEFAULT_PAGE_SIZE),
      eventProgramId: idFilterSchema('Event program id').optional(),
      activityId: idFilterSchema('Activity id').optional(),
      issuedFrom: dateFilterSchema('issuedFrom').optional(),
      issuedTo: dateFilterSchema('issuedTo').optional(),
    })
    .strict()
    .refine((query) => !query.issuedFrom || !query.issuedTo || query.issuedFrom <= query.issuedTo, {
      message: 'issuedFrom cannot be after issuedTo.',
      path: ['issuedTo'],
    }),
});

export type ListMyCertificatesQuery = z.infer<typeof listMyCertificatesQuerySchema>['query'];

export const certificateActivitySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    date: z.string().meta({ description: 'Institutional date in YYYY-MM-DD format.' }),
    type: z.enum([
      'WORKSHOP',
      'SEMINAR',
      'TALK',
      'CONFERENCE',
      'PANEL',
      'COURSE',
      'COMPETITION',
      'OTHER',
    ]),
  })
  .meta({
    id: 'CertificateActivity',
    description: 'Activity the certificate attests.',
  });

export const certificateEventProgramSchema = z
  .object({
    id: z.string(),
    name: z.string(),
  })
  .meta({
    id: 'CertificateEventProgram',
    description: 'Event program that owns the activity the certificate attests.',
  });

export const certificateSummarySchema = z
  .object({
    id: z.string().meta({ description: 'Certificate identifier.' }),
    code: z.string().meta({ description: 'Unique certificate code shown on the document.' }),
    issuedAt: z.iso
      .datetime({ offset: true })
      .meta({ description: 'Instant of issuance, in UTC.' }),
    activity: certificateActivitySchema,
    eventProgram: certificateEventProgramSchema,
  })
  .meta({
    id: 'CertificateSummary',
    description:
      'Certificate owned by the authenticated user. Storage and attendance internals are not exposed.',
  }) satisfies z.ZodType<MyCertificateSummary>;

export const paginatedMyCertificatesSchema = z
  .object({
    items: z.array(certificateSummarySchema).meta({
      description: 'Certificates, most recently issued first.',
    }),
    page: z.number().int(),
    limit: z.number().int(),
    total: z.number().int(),
    totalPages: z.number().int(),
  })
  .meta({
    id: 'PaginatedMyCertificates',
    description:
      'Paginated list of the authenticated user certificates, ordered by issuedAt descending.',
  }) satisfies z.ZodType<PaginatedMyCertificates>;
```

- [ ] **Step 5: Verde**

Run: `pnpm exec vitest run src/modules/certificates/certificates.schemas.test.ts`

Expected: todas en verde. La prueba de `issuedFrom cannot be after issuedTo.` exige que el `path` del refine sea `['query', 'issuedTo']`, es decir, el `.refine()` va dentro del objeto `query`, no sobre el objeto raiz.

- [ ] **Step 6: Typecheck y lint**

Run: `pnpm run typecheck && pnpm exec eslint src/modules/certificates`

Expected: sin errores.

---

### Task 3: Servicio de listado

**Files:**

- Create: `src/modules/certificates/certificates.service.ts`
- Create: `src/modules/certificates/certificates.service.test.ts`

- [ ] **Step 1: Escribir la prueba que falla**

Crear `src/modules/certificates/certificates.service.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ListMyCertificatesQuery } from './certificates.schemas.js';
import { listMyCertificates } from './certificates.service.js';

interface PrismaMock {
  certificate: {
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
}

const createPrismaMock = (): PrismaMock => ({
  certificate: {
    findMany: vi.fn(),
    count: vi.fn(),
  },
});

const prismaMock = createPrismaMock();

vi.mock('../../config/prisma.js', () => ({
  getPrismaClient: () => prismaMock,
}));

const record = {
  id: 'cert-001',
  code: 'CERT-8F3A2B',
  issuedAt: new Date('2026-09-07T14:05:00.000Z'),
  attendance: {
    activity: {
      id: 'activity-001',
      name: 'Workshop de Ciberseguridad Defensiva',
      date: new Date('2026-09-07T00:00:00.000Z'),
      type: 'WORKSHOP',
      eventProgram: { id: 'program-001', name: 'Programa de Eventos - FISC' },
    },
  },
};

const baseQuery: ListMyCertificatesQuery = { page: 1, limit: 20 };

describe('listMyCertificates', () => {
  beforeEach(() => {
    prismaMock.certificate.findMany.mockReset().mockResolvedValue([record]);
    prismaMock.certificate.count.mockReset().mockResolvedValue(1);
  });

  it('always scopes the query to the authenticated user', async () => {
    await listMyCertificates('user-001', baseQuery);

    expect(prismaMock.certificate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { attendance: { userId: 'user-001' } } }),
    );
  });

  it('never selects storage or attendance internals', async () => {
    await listMyCertificates('user-001', baseQuery);

    const args = prisma.certificate.findMany.mock.calls[0]?.[0] as {
      select: Record<string, unknown>;
    };
    const serializedSelect = JSON.stringify(args.select);

    expect(serializedSelect).toContain('code');
    expect(serializedSelect).toContain('issuedAt');
    expect(serializedSelect).not.toContain('pdfUrl');
    expect(serializedSelect).not.toContain('attendanceId');
  });

  it('orders by issuedAt descending with a stable id tiebreaker', async () => {
    await listMyCertificates('user-001', baseQuery);

    expect(prismaMock.certificate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ issuedAt: 'desc' }, { id: 'asc' }] }),
    );
  });

  it('maps the nested record into the public summary', async () => {
    const result = await listMyCertificates('user-001', baseQuery);

    expect(result.items).toEqual([
      {
        id: 'cert-001',
        code: 'CERT-8F3A2B',
        issuedAt: '2026-09-07T14:05:00.000Z',
        activity: {
          id: 'activity-001',
          name: 'Workshop de Ciberseguridad Defensiva',
          date: '2026-09-07',
          type: 'WORKSHOP',
        },
        eventProgram: { id: 'program-001', name: 'Programa de Eventos - FISC' },
      },
    ]);
    expect(result).toMatchObject({ page: 1, limit: 20, total: 1, totalPages: 1 });
  });

  it('applies the offset pagination window', async () => {
    await listMyCertificates('user-001', { page: 3, limit: 5 });

    expect(prismaMock.certificate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 10, take: 5 }),
    );
  });

  it('filters by activity', async () => {
    await listMyCertificates('user-001', { ...baseQuery, activityId: 'activity-001' });

    expect(prismaMock.certificate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { attendance: { userId: 'user-001', activityId: 'activity-001' } },
      }),
    );
  });

  it('filters by event program through the attendance activity', async () => {
    await listMyCertificates('user-001', { ...baseQuery, eventProgramId: 'program-001' });

    expect(prismaMock.certificate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          attendance: { userId: 'user-001', activity: { eventProgramId: 'program-001' } },
        },
      }),
    );
  });

  it('translates the issued range into institutional day bounds', async () => {
    await listMyCertificates('user-001', {
      ...baseQuery,
      issuedFrom: '2026-08-26',
      issuedTo: '2026-09-07',
    });

    expect(prismaMock.certificate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          attendance: { userId: 'user-001' },
          issuedAt: {
            gte: new Date('2026-08-26T05:00:00.000Z'),
            lt: new Date('2026-09-08T05:00:00.000Z'),
          },
        },
      }),
    );
  });

  it('applies a single sided issued range', async () => {
    await listMyCertificates('user-001', { ...baseQuery, issuedFrom: '2026-08-26' });

    expect(prismaMock.certificate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          attendance: { userId: 'user-001' },
          issuedAt: { gte: new Date('2026-08-26T05:00:00.000Z') },
        },
      }),
    );
  });

  it('reports zero total pages for an empty result', async () => {
    prismaMock.certificate.findMany.mockResolvedValue([]);
    prismaMock.certificate.count.mockResolvedValue(0);

    const result = await listMyCertificates('user-001', baseQuery);

    expect(result).toEqual({ items: [], page: 1, limit: 20, total: 0, totalPages: 0 });
  });

  it('rounds the total pages up', async () => {
    prismaMock.certificate.findMany.mockResolvedValue([]);
    prismaMock.certificate.count.mockResolvedValue(21);

    const result = await listMyCertificates('user-001', { page: 1, limit: 10 });

    expect(result.totalPages).toBe(3);
  });

  it('counts with the same filter as the listing', async () => {
    await listMyCertificates('user-001', { ...baseQuery, activityId: 'activity-001' });

    expect(prismaMock.certificate.count).toHaveBeenCalledWith({
      where: { attendance: { userId: 'user-001', activityId: 'activity-001' } },
    });
  });
});
```

- [ ] **Step 2: Verificar el rojo**

Run: `pnpm exec vitest run src/modules/certificates/certificates.service.test.ts`

Expected: falla porque `./certificates.service.js` no existe.

- [ ] **Step 3: Implementar el servicio**

Crear `src/modules/certificates/certificates.service.ts`:

```ts
import { getPrismaClient } from '../../config/prisma.js';
import { getInstitutionalDayRange } from '../../utils/date.js';
import type { ListMyCertificatesQuery } from './certificates.schemas.js';
import type { MyCertificateSummary, PaginatedMyCertificates } from './certificates.types.js';

const certificateSelect = {
  id: true,
  code: true,
  issuedAt: true,
  attendance: {
    select: {
      activity: {
        select: {
          id: true,
          name: true,
          date: true,
          type: true,
          eventProgram: { select: { id: true, name: true } },
        },
      },
    },
  },
} as const;

interface CertificateRecord {
  id: string;
  code: string;
  issuedAt: Date;
  attendance: {
    activity: {
      id: string;
      name: string;
      date: Date;
      type: MyCertificateSummary['activity']['type'];
      eventProgram: { id: string; name: string };
    };
  };
}

const formatDate = (value: Date): string => value.toISOString().slice(0, 10);

const toCertificateSummary = (record: CertificateRecord): MyCertificateSummary => {
  const { activity } = record.attendance;

  return {
    id: record.id,
    code: record.code,
    issuedAt: record.issuedAt.toISOString(),
    activity: {
      id: activity.id,
      name: activity.name,
      date: formatDate(activity.date),
      type: activity.type,
    },
    eventProgram: activity.eventProgram,
  };
};

const buildIssuedAtFilter = (
  query: ListMyCertificatesQuery,
): { gte?: Date; lt?: Date } | undefined => {
  if (!query.issuedFrom && !query.issuedTo) {
    return undefined;
  }

  return {
    ...(query.issuedFrom ? { gte: getInstitutionalDayRange(query.issuedFrom).start } : {}),
    ...(query.issuedTo ? { lt: getInstitutionalDayRange(query.issuedTo).endExclusive } : {}),
  };
};

export const listMyCertificates = async (
  userId: string,
  query: ListMyCertificatesQuery,
): Promise<PaginatedMyCertificates> => {
  const prisma = getPrismaClient();
  const issuedAt = buildIssuedAtFilter(query);

  const where = {
    attendance: {
      userId,
      ...(query.activityId ? { activityId: query.activityId } : {}),
      ...(query.eventProgramId ? { activity: { eventProgramId: query.eventProgramId } } : {}),
    },
    ...(issuedAt ? { issuedAt } : {}),
  };

  const skip = (query.page - 1) * query.limit;

  const [records, total] = await Promise.all([
    prisma.certificate.findMany({
      where,
      orderBy: [{ issuedAt: 'desc' }, { id: 'asc' }],
      skip,
      take: query.limit,
      select: certificateSelect,
    }),
    prisma.certificate.count({ where }),
  ]);

  return {
    items: records.map((record) => toCertificateSummary(record as CertificateRecord)),
    page: query.page,
    limit: query.limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / query.limit),
  };
};
```

- [ ] **Step 4: Verde**

Run: `pnpm exec vitest run src/modules/certificates/certificates.service.test.ts`

Expected: todas en verde. Si Prisma tipa `where` con error por la mezcla de relaciones, agregar `as const` al filtro de programa o tipar `where` como `Prisma.CertificateWhereInput`; no usar `any`.

- [ ] **Step 5: Typecheck y lint**

Run: `pnpm run typecheck && pnpm exec eslint src/modules/certificates`

Expected: sin errores.

---

### Task 4: Controlador, rutas y pruebas de HTTP

**Files:**

- Create: `src/modules/certificates/certificates.controller.ts`
- Create: `src/modules/certificates/certificates.routes.ts`
- Create: `src/modules/certificates/certificates.routes.test.ts`

- [ ] **Step 1: Escribir la prueba que falla**

Crear `src/modules/certificates/certificates.routes.test.ts` siguiendo el patron de `src/modules/careers/careers.routes.test.ts`: JWKS Ed25519 local, mock de `../../config/prisma.js`, `../../utils/jwt-verifier.js` y `../../lib/auth.js`, y `supertest` contra `await import('../../app.js')`.

```ts
import request from 'supertest';
import {
  calculateJwkThumbprint,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type CryptoKey,
} from 'jose';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

interface PrismaMock {
  certificate: {
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
  };
  user: { findUnique: ReturnType<typeof vi.fn> };
}

const createPrismaMock = (): PrismaMock => ({
  certificate: {
    findMany: vi.fn(),
    count: vi.fn(),
  },
  user: { findUnique: vi.fn() },
});

const userRecord = {
  id: 'user-001',
  email: 'estudiante01@utp.ac.pa',
  globalRole: 'USER',
  unitId: 'unit-001',
  careerId: 'career-001',
  isActive: true,
};

const otherUserRecord = {
  id: 'user-002',
  email: 'estudiante02@utp.ac.pa',
  globalRole: 'USER',
  unitId: 'unit-001',
  careerId: 'career-001',
  isActive: true,
};

const mockUserLookup = (prisma: PrismaMock): void => {
  const records: Record<string, unknown> = {
    'user-001': userRecord,
    'user-002': otherUserRecord,
  };

  prisma.user.findUnique.mockImplementation((args: { where: { id: string } }) =>
    Promise.resolve(records[args.where.id] ?? null),
  );
};

const certificateRecord = {
  id: 'cert-001',
  code: 'CERT-8F3A2B',
  issuedAt: new Date('2026-09-07T14:05:00.000Z'),
  attendance: {
    activity: {
      id: 'activity-001',
      name: 'Workshop de Ciberseguridad Defensiva',
      date: new Date('2026-09-07T00:00:00.000Z'),
      type: 'WORKSHOP',
      eventProgram: { id: 'program-001', name: 'Programa de Eventos - FISC' },
    },
  },
};

let accessToken: string;
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

const signToken = async (subject: string): Promise<string> => {
  const keyPair = await generateKeyPair('EdDSA', { crv: 'Ed25519' });
  const publicJwk = await exportJWK(keyPair.publicKey);
  const kid = await calculateJwkThumbprint(publicJwk);
  publicJwk.kid = kid;
  publicJwk.alg = 'EdDSA';
  jwks = { keys: [publicJwk] };

  return new SignJWT({ role: 'USER', isActive: true })
    .setProtectedHeader({ alg: 'EdDSA', kid, typ: 'JWT' })
    .setIssuer('http://localhost:3000')
    .setAudience('http://localhost:3000')
    .setSubject(subject)
    .setIssuedAt()
    .setExpirationTime('15m')
    .sign(keyPair.privateKey);
};

describe('my certificates route', () => {
  beforeAll(async () => {
    accessToken = await signToken('user-001');
  });

  afterAll(() => {
    vi.doUnmock('../../config/prisma.js');
    vi.doUnmock('../../utils/jwt-verifier.js');
    vi.doUnmock('../../lib/auth.js');
  });

  it('lists the authenticated user certificates', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    prisma.certificate.findMany.mockResolvedValue([certificateRecord]);
    prisma.certificate.count.mockResolvedValue(1);
    const app = await loadApp(prisma);

    const response = await request(app)
      .get('/api/v1/users/me/certificates')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(response.body.success).toBe(true);
    expect(response.body.data).toEqual({
      items: [
        {
          id: 'cert-001',
          code: 'CERT-8F3A2B',
          issuedAt: '2026-09-07T14:05:00.000Z',
          activity: {
            id: 'activity-001',
            name: 'Workshop de Ciberseguridad Defensiva',
            date: '2026-09-07',
            type: 'WORKSHOP',
          },
          eventProgram: { id: 'program-001', name: 'Programa de Eventos - FISC' },
        },
      ],
      page: 1,
      limit: 20,
      total: 1,
      totalPages: 1,
    });
  });

  it('never exposes storage or attendance internals', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    prisma.certificate.findMany.mockResolvedValue([
      { ...certificateRecord, pdfUrl: '/certificates/CERT-8F3A2B.pdf', attendanceId: 'att-001' },
    ]);
    prisma.certificate.count.mockResolvedValue(1);
    const app = await loadApp(prisma);

    const response = await request(app)
      .get('/api/v1/users/me/certificates')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    const serialized = JSON.stringify(response.body);
    expect(serialized).not.to.include('pdfUrl');
    expect(serialized).not.to.include('attendanceId');
  });

  it('scopes the query to the token subject', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    prisma.certificate.findMany.mockResolvedValue([]);
    prisma.certificate.count.mockResolvedValue(0);
    const app = await loadApp(prisma);

    await request(app)
      .get('/api/v1/users/me/certificates')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(prisma.certificate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { attendance: { userId: 'user-001' } } }),
    );
  });

  it('cannot be redirected to another user through the query', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    prisma.certificate.findMany.mockResolvedValue([]);
    prisma.certificate.count.mockResolvedValue(0);
    const app = await loadApp(prisma);

    const response = await request(app)
      .get('/api/v1/users/me/certificates?userId=user-002')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(400);

    expect(response.body.success).toBe(false);
    expect(JSON.stringify(response.body)).to.include('userId');
  });

  it('requires a token', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    const app = await loadApp(prisma);

    await request(app).get('/api/v1/users/me/certificates').expect(401);
  });

  it('rejects an invalid pagination limit', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    const app = await loadApp(prisma);

    await request(app)
      .get('/api/v1/users/me/certificates?limit=51')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(400);
  });

  it('rejects an impossible issued date', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    const app = await loadApp(prisma);

    await request(app)
      .get('/api/v1/users/me/certificates?issuedFrom=2026-02-30')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(400);
  });

  it('rejects an inverted issued range', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    const app = await loadApp(prisma);

    const response = await request(app)
      .get('/api/v1/users/me/certificates?issuedFrom=2026-09-07&issuedTo=2026-08-26')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(400);

    expect(JSON.stringify(response.body)).to.include('issuedFrom cannot be after issuedTo.');
  });

  it('passes the scope filters to the query', async () => {
    const prisma = createPrismaMock();
    mockUserLookup(prisma);
    prisma.certificate.findMany.mockResolvedValue([]);
    prisma.certificate.count.mockResolvedValue(0);
    const app = await loadApp(prisma);

    await request(app)
      .get(
        '/api/v1/users/me/certificates?eventProgramId=program-001&activityId=activity-001&page=2&limit=5',
      )
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(prisma.certificate.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          attendance: {
            userId: 'user-001',
            activityId: 'activity-001',
            activity: { eventProgramId: 'program-001' },
          },
        },
        skip: 5,
        take: 5,
      }),
    );
  });
});
```

- [ ] **Step 2: Verificar el rojo**

Run: `pnpm exec vitest run src/modules/certificates/certificates.routes.test.ts`

Expected: falla con 404 porque la ruta todavia no esta montada.

- [ ] **Step 3: Crear el controlador**

Crear `src/modules/certificates/certificates.controller.ts`:

```ts
import { requireAuthenticatedUser } from '../../middlewares/authenticate.middleware.js';
import { asyncHandler } from '../../utils/asyncHandler.js';
import { successResponse } from '../../utils/response.js';
import type { ListMyCertificatesQuery } from './certificates.schemas.js';
import { listMyCertificates as listMyCertificatesService } from './certificates.service.js';

export const listMyCertificates = asyncHandler(async (req, res) => {
  const user = requireAuthenticatedUser(req);
  const query = req.query as unknown as ListMyCertificatesQuery;
  const result = await listMyCertificatesService(user.id, query);

  res.status(200).json(successResponse('Certificates retrieved successfully.', result));
});
```

- [ ] **Step 4: Crear las rutas**

Crear `src/modules/certificates/certificates.routes.ts`:

```ts
import { Router } from 'express';

import { authenticate } from '../../middlewares/authenticate.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import { listMyCertificates } from './certificates.controller.js';
import { listMyCertificatesQuerySchema } from './certificates.schemas.js';

export const certificatesRoutes = Router();

certificatesRoutes.get(
  '/users/me/certificates',
  authenticate,
  validate(listMyCertificatesQuerySchema),
  listMyCertificates,
);
```

- [ ] **Step 5: Montar el router**

En `src/routes.ts`, agregar el import en orden alfabetico (despues de `careersRoutes`):

```ts
import { certificatesRoutes } from './modules/certificates/certificates.routes.js';
```

y el montaje despues de `apiRoutes.use(careersRoutes);`:

```ts
apiRoutes.use(certificatesRoutes);
```

- [ ] **Step 6: Verde**

Run: `pnpm exec vitest run src/modules/certificates/certificates.routes.test.ts`

Expected: todas en verde.

- [ ] **Step 7: Typecheck y lint**

Run: `pnpm run typecheck && pnpm exec eslint src/modules/certificates src/routes.ts`

Expected: sin errores.

---

### Task 5: OpenAPI

**Files:**

- Create: `src/modules/certificates/certificates.openapi.ts`
- Modify: `src/docs/openapi.ts`
- Modify: `src/docs/openapi.test.ts`
- Modify: `openapi.json` (generado)

- [ ] **Step 1: Escribir la prueba que falla**

En `src/docs/openapi.test.ts`, agregar `'GET /api/v1/users/me/certificates',` a `expectedOperations` (despues de `'GET /api/v1/users/me/permissions',`) y agregar dentro de `describe('openApiDocument', ...)`:

```ts
it('documents my certificates as a private paginated operation', () => {
  const operation = openApiDocument.paths?.['/api/v1/users/me/certificates']?.get;

  expect(operation?.security).toEqual([{ bearerAuth: [] }]);
  expect(operation?.tags).toEqual(['Certificates']);
  expect(operation?.responses?.['200']).toBeDefined();
  expect(operation?.responses?.['400']).toBeDefined();
  expect(operation?.responses?.['401']).toBeDefined();
  expect(operation?.parameters?.length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Verificar el rojo**

Run: `pnpm exec vitest run src/docs/openapi.test.ts`

Expected: falla `contains exactly the expected operations`.

- [ ] **Step 3: Crear los paths**

Crear `src/modules/certificates/certificates.openapi.ts`:

```ts
import type { ZodOpenApiPathsObject } from 'zod-openapi';

import { errorResponse } from '../../docs/schemas.js';
import {
  listMyCertificatesQuerySchema,
  paginatedMyCertificatesSchema,
} from './certificates.schemas.js';
import { apiSuccessResponse } from '../../docs/schemas.js';

export const certificatesPaths: ZodOpenApiPathsObject = {
  '/api/v1/users/me/certificates': {
    get: {
      tags: ['Certificates'],
      summary: 'List my certificates',
      description:
        'Paginated list of the certificates issued to the authenticated user, most recent first. Each item carries the certificate code, its issuance instant and the activity and event program it attests. Storage paths and attendance internals are not exposed until certificate download exists. Supports filters by event program, activity and an issuance date range interpreted in the institutional calendar (America/Panama).',
      security: [{ bearerAuth: [] }],
      requestParams: { query: listMyCertificatesQuerySchema.shape.query },
      responses: {
        200: {
          description: 'Paginated list of own certificates.',
          content: {
            'application/json': { schema: apiSuccessResponse(paginatedMyCertificatesSchema) },
          },
        },
        400: errorResponse('Invalid query parameters.'),
        401: errorResponse('Authentication required.'),
      },
    },
  },
};
```

Unificar los dos imports de `../../docs/schemas.js` en una sola linea:

```ts
import { apiSuccessResponse, errorResponse } from '../../docs/schemas.js';
```

- [ ] **Step 4: Registrar el path y el tag**

En `src/docs/openapi.ts`, agregar el import:

```ts
import { certificatesPaths } from '../modules/certificates/certificates.openapi.js';
```

despues de `careersPaths`. En `tags`, agregar despues de `Careers`:

```ts
    { name: 'Certificates', description: 'Certificates issued to the authenticated user.' },
```

En `paths`, agregar despues de `...careersPaths,`:

```ts
    ...certificatesPaths,
```

- [ ] **Step 5: Verde**

Run: `pnpm exec vitest run src/docs/openapi.test.ts`

Expected: todas en verde.

- [ ] **Step 6: Regenerar el contrato**

Run: `pnpm run docs:generate && pnpm run docs:check`

Expected: `openapi.json written to .../openapi.json` y `openapi.json is up to date.`

- [ ] **Step 7: Typecheck y lint**

Run: `pnpm run typecheck && pnpm exec eslint src/modules/certificates src/docs`

Expected: sin errores.

---

### Task 6: Coleccion Bruno

**Files:**

- Create: `bruno/Certificates/folder.bru`
- Create: `bruno/Certificates/Log in as a student with certificates.bru`
- Create: `bruno/Certificates/List my certificates.bru`
- Create: `bruno/Certificates/List my certificates filtered by event program.bru`
- Create: `bruno/Certificates/List my certificates filtered by activity.bru`
- Create: `bruno/Certificates/List my certificates within an issued range.bru`
- Create: `bruno/Certificates/List my certificates with pagination.bru`
- Create: `bruno/Certificates/List my certificates with an unknown filter returns 400.bru`
- Create: `bruno/Certificates/List my certificates without a token returns 401.bru`
- Modify: `bruno/environments/local.bru`

- [ ] **Step 1: Agregar las variables de entorno**

En `bruno/environments/local.bru`, agregar al final del bloque `vars`:

```
  certificateEventProgramId: seed_program_fic_default
  certificateActivityId: seed_activity_fic-charla-puentes
```

- [ ] **Step 2: Crear la carpeta**

`bruno/Certificates/folder.bru`:

```
meta {
  name: Certificates
}

auth {
  mode: inherit
}

docs {
  Certificates issued to the authenticated user.
}
```

- [ ] **Step 3: Crear los requests**

`Log in as a student with certificates.bru` (seq 1) usa `X-Forwarded-For: 203.0.113.241`, `{{userEmail}}` / `{{userPassword}}`, `script:post-response` que capture `token` y `refreshToken`, y un test que afirme 200 y que `accessToken` sea string.

`List my certificates.bru` (seq 2) consulta `{{baseUrl}}/api/v1/users/me/certificates?page=1&limit=20` con `auth: bearer` y tres tests:

```
tests {
  test("the student sees their own certificates", function () {
    expect(res.getStatus()).to.equal(200);
    const body = res.getBody();
    expect(body.success).to.equal(true);
    expect(body.data.page).to.equal(1);
    expect(body.data.limit).to.equal(20);
    expect(body.data.total).to.be.at.least(3);
    expect(body.data.totalPages).to.be.at.least(1);
    expect(body.data.items.length).to.be.at.least(3);
  });

  test("each item carries the certificate, its activity and its program", function () {
    const items = res.getBody().data.items;
    const first = items[0];
    expect(first.id).to.be.a("string");
    expect(first.code).to.be.a("string");
    expect(first.issuedAt).to.be.a("string");
    expect(first.activity.id).to.be.a("string");
    expect(first.activity.name).to.be.a("string");
    expect(first.activity.date).to.match(/^\d{4}-\d{2}-\d{2}$/);
    expect(first.activity.type).to.be.a("string");
    expect(first.eventProgram.id).to.be.a("string");
    expect(first.eventProgram.name).to.be.a("string");
  });

  test("the listing does not expose storage or attendance internals", function () {
    const serialized = JSON.stringify(res.getBody());
    expect(serialized).to.not.include("pdfUrl");
    expect(serialized).to.not.include("attendanceId");
  });
}
```

`List my certificates filtered by event program.bru` (seq 3) consulta `?eventProgramId={{certificateEventProgramId}}` y afirma que todos los items tienen `eventProgram.id` igual a la variable y que hay al menos 1.

`List my certificates filtered by activity.bru` (seq 4) consulta `?activityId={{certificateActivityId}}` y afirma que todos los items tienen `activity.id` igual a la variable y que hay al menos 1.

`List my certificates within an issued range.bru` (seq 5) consulta `?issuedFrom=2026-08-26&issuedTo=2026-09-07` y afirma 200, `total` al menos 1, y que cada `issuedAt` cae dentro de `[2026-08-26T05:00:00Z, 2026-09-08T05:00:00Z)`.

`List my certificates with pagination.bru` (seq 6) consulta `?page=1&limit=1` y afirma que hay exactamente 1 item, `limit` 1 y `totalPages` igual a `Math.ceil(total/1)`.

`List my certificates with an unknown filter returns 400.bru` (seq 7) consulta `?userId=seed_user_admin` y afirma 400 con `success: false` y un error que menciona `userId`.

`List my certificates without a token returns 401.bru` (seq 8) consulta el path con `auth: none` y afirma 401 con `success: false`.

- [ ] **Step 4: Verificar la sintaxis**

Run: `pnpm --dir bruno exec bru run Certificates --env local --reporter-json 2>/dev/null | head -40`

Expected: la ejecucion completa en verde en la Task 7. Antes de eso, al menos `bru run` no debe fallar al parsear.

---

### Task 7: Verificacion real

**Files:** ninguno (solo ejecucion)

- [ ] **Step 1: Reconstruir y levantar la API**

Run: `docker compose -f compose.dev.yaml build api && docker compose -f compose.dev.yaml up -d`

Expected: el contenedor `sipeg-utp-dev-api-1` en estado `Up` y `curl -s localhost:3000/api/v1/health` con 200 y `authJwksReachable: true`.

- [ ] **Step 2: Sembrar datos demo**

Run: `docker compose -f compose.dev.yaml exec -T api pnpm prisma:seed`

Expected: resumen con registros, check-ins y certificados.

- [ ] **Step 3: Contrastar el listado contra la base**

Run: login por curl como `estudiante01@utp.ac.pa`, luego `GET /api/v1/users/me/certificates` y comparar `total` con:

```sql
select count(*) from certificates c
join attendance a on a.id = c.attendance_id
join users u on u.id = a.user_id
where u.email = 'estudiante01@utp.ac.pa';
```

Expected: los mismos 3.

- [ ] **Step 4: Probar los filtros en la API real**

Comprobar: `?eventProgramId=seed_program_fic_default` devuelve 1; `?activityId=seed_activity_fic-charla-puentes` devuelve 1; `?issuedFrom=2026-08-26&issuedTo=2026-09-07` devuelve 3; `?issuedFrom=2026-09-01` devuelve 2; `?limit=51` responde 400; `?issuedFrom=2026-09-07&issuedTo=2026-08-26` responde 400; `?userId=seed_user_admin` responde 400; sin token responde 401.

- [ ] **Step 5: Probar el aislamiento en la API real**

Con el token de `estudiante01`, pedir `?userId=seed_user_admin` (400) y confirmar que ningun certificado de `estudiante02` aparece en el listado.

- [ ] **Step 6: Confirmar el plan de consulta**

Run:

```sql
EXPLAIN (COSTS OFF)
SELECT c.id FROM certificates c
JOIN attendance a ON a.id = c.attendance_id
WHERE a.user_id = (select id from users where email = 'estudiante01@utp.ac.pa')
ORDER BY c.issued_at DESC, c.id ASC
LIMIT 20;
```

Expected: recorrido por indice sobre `attendance` y lookup por `certificates_attendance_id_key`. No se requiere migracion.

- [ ] **Step 7: Correr la carpeta Bruno**

Run: `pnpm --dir bruno exec bru run Certificates --env local`

Expected: 8 requests y sus tests en verde.

---

### Task 8: Documentacion

**Files:**

- Modify: `README.md`
- Modify: `CONTEXT.md`
- Modify: `docs/superpowers/plans/plan-maestro-sipeg-utp.md`

- [ ] **Step 1: README**

En `README.md`, agregar una seccion `### Certificados` despues de `### Aulas` y antes de `## Observabilidad Y Auditoria`:

```markdown
### Certificados

- `GET /api/v1/users/me/certificates` (privado) lista los certificados del usuario autenticado, del mas reciente al mas antiguo. Cada item trae `id`, `code`, `issuedAt` (instante UTC), la actividad (`id`, `name`, `date`, `type`) y el programa de eventos (`id`, `name`).
- Acepta paginacion offset (`page`/`limit`, maximo 50) y filtros `eventProgramId`, `activityId` e `issuedFrom`/`issuedTo` (`YYYY-MM-DD`). El rango de emision se interpreta en la zona institucional `America/Panama`: `issuedFrom` es inclusivo desde la medianoche del dia y `issuedTo` cubre el dia completo. `issuedFrom` posterior a `issuedTo` responde `400`.
- El aislamiento es estructural: la consulta se acota al usuario del token y no hay forma de pedir los certificados de otra persona. Un `userId` en la query responde `400` por clave desconocida. Un filtro sin coincidencias responde `200` con `items: []` y `total: 0`; el listado propio nunca responde `404`.
- La respuesta NO expone `pdfUrl` ni `attendanceId`. El campo de archivo llega con 10.3, cuando exista el endpoint de descarga y el almacenamiento de la Fase 6; hoy el seed escribe rutas placeholder sin archivo detras.
- Sin auditoria ni rate limit propio: es una lectura autenticada de datos propios, no una accion administrativa.
```

- [ ] **Step 2: CONTEXT.md**

En `CONTEXT.md`, reemplazar los bullets de `### Certificados` por:

```markdown
### Certificados

- `GET /api/v1/users/me/certificates` (privado) lista los certificados propios con paginacion offset (`page`/`limit`, maximo 50) y filtros `eventProgramId`, `activityId` e `issuedFrom`/`issuedTo` en calendario institucional. Orden `issuedAt desc, id asc`.
- El aislamiento es estructural: `where.attendance.userId` sale del token. No existe `userId` en la query y un filtro sin coincidencias responde `200` con `total: 0`.
- El listado expone `id`, `code`, `issuedAt`, la actividad y el programa. No expone `pdfUrl` ni `attendanceId`; la descarga llega en 10.3 con el almacenamiento de la Fase 6.
- Generar certificados a partir de registros de asistencia (Fase 9 y 10.1).
- Evitar duplicados salvo solicitud explicita.
- Proteger generacion y descarga con permisos (`certificate:generate` y `certificate:read` ya existen en el catalogo).
```

- [ ] **Step 3: Plan maestro**

En `docs/superpowers/plans/plan-maestro-sipeg-utp.md`, marcar la linea de 10.4 como completada y agregar el registro de ejecucion:

```markdown
- [x] **10.4 Listar certificados propios - `GET /users/me/certificates`.** Paginacion offset (`page`/`limit`, maximo 50) y filtros `eventProgramId`, `activityId`, `issuedFrom`/`issuedTo` en calendario institucional. Aislamiento estructural por `attendance.userId`; sin `pdfUrl` hasta 10.3.
```

Seguido de un bloque `**Registro de ejecucion (2026-09-29 - 10.4):**` con los puntos de verificacion real, pruebas, Bruno, contrato y hallazgos `F10.4-A` y `F10.4-B` descritos arriba.

- [ ] **Step 4: Formato**

Run: `pnpm exec prettier --write README.md CONTEXT.md docs/superpowers/plans/2026-09-29-fase-10-4-listar-certificados.md docs/superpowers/plans/plan-maestro-sipeg-utp.md src/modules/certificates src/utils/date.ts src/utils/date.test.ts src/docs src/routes.ts`

Expected: sin archivos pendientes.

---

### Task 9: Gates finales

- [ ] **Step 1: Suite completa**

Run: `pnpm test`

Expected: 1311 + las pruebas nuevas en verde, 7 skip.

- [ ] **Step 2: Calidad**

Run: `pnpm run typecheck && pnpm run lint && pnpm run build && pnpm run format:check && pnpm run docs:check`

Expected: todo en verde.

- [ ] **Step 3: Prisma**

Run: `pnpm prisma validate && pnpm prisma migrate status`

Expected: schema valido y base al dia (10.4 no genera migraciones).

- [ ] **Step 4: Reporte**

Reportar conteos de pruebas antes/despues, resultado de la verificacion real, resultado de Bruno y los hallazgos. Sin commit: el usuario no lo solicito.
