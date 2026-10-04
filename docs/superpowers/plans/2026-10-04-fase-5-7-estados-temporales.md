# Fase 5.7 - Resolver estados temporales Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolver `ONGOING`/`COMPLETED` de actividades en tiempo de lectura a partir de la fecha y horas institucionales (`America/Panama`), sin scheduler, y aplicar el estado efectivo en DTOs, filtros, contadores y guardas de negocio.

**Architecture:** El status almacenado queda como ciclo de vida base (`DRAFT`/`SCHEDULED`/`CANCELLED`; los valores legacy `ONGOING`/`COMPLETED` se toleran). Un resolutor puro en `src/modules/activities/activities.status.ts` calcula el estado efectivo y dos constructores de `where` de Prisma (`buildEffectiveStatusWhere`, `buildReservingActivityWhere`) permiten filtrar y bloquear en BD con la misma semantica. `src/utils/date.ts` gana dos helpers para combinar fecha + hora en el instante institucional. Una migracion reemplaza el trigger `validate_event_program_transition` para que una actividad ya terminada no bloquee archivar su programa.

**Tech Stack:** TypeScript 6, Express 5, Prisma 7 (SQL/Postgres), Zod 4, Vitest, Supertest, OpenAPI 3.1 (zod-openapi), Bruno.

**Estado de partida (2026-10-04):**

- El arbol contiene el trabajo completo de 5.6 sin commitear (`GET /activities` con `when`, `status`, filtros y `ActivityListItem.status`; suite 1504 en 70 archivos). No se toca ni se revierte.
- `Activity.status` es una columna almacenada: la API solo escribe `DRAFT` (crear), `SCHEDULED`/`DRAFT` (publicar/despublicar) y `CANCELLED` (cancelar). `ONGOING`/`COMPLETED` solo existen por seed o SQL manual; nada los deriva.
- Consumidores del status almacenado: `listActivities`, `listEventProgramActivities`, `getActivityById`, `countEventProgramActivities` (programa), guarda de `archiveEventProgram`, guarda de desactivacion de unidades y aulas, `findAvailableClassrooms`, `updateActivity`, `cancelActivity`, `deleteActivity` y la exclusion GiST `activities_classroom_no_overlap`.
- El trigger `validate_event_program_transition` (ultima version en `prisma/migrations/20260919093000_unify_organizational_units/migration.sql:161-230`) bloquea archivar programas adicionales con actividades `status IN ('SCHEDULED','ONGOING')` sin mirar la fecha.
- `src/utils/date.ts` resuelve el dia institucional y su rango (`getInstitutionalDayRange`), pero no combina fecha + hora. `activities.schedule.ts` ya valida `endTime > startTime` (`assertActivityTimeRange`), asi que las actividades nocturnas no existen por validacion.
- No hay scheduler, cron ni dependencias de colas. ADR-0008 ya rechazo `pg_cron`; la decision pendiente #6 del plan maestro recomienda derivar al leer.

**Decisiones de diseno (2026-10-04, confirmadas con el usuario):**

1. **Derivar al leer.** Sin scheduler. ADR-0010 documenta la decision, rechaza el job programado y cierra la politica de medianoche (D15/M3): actividades de un solo dia, `endTime > startTime` obligatorio.
2. **`when=upcoming|past` se mantiene por fecha** (5.6): `upcoming` = `date >= hoy`, `past` = `date <= ayer`. Solo se deriva el campo `status`; una actividad de hoy ya terminada puede seguir en `upcoming` con `status: COMPLETED`.
3. **Coherencia completa:** DTOs, filtro `status` (admin), `byStatus` del programa, guardas de `PATCH`/cancel, guardas de archivar programa y desactivar unidad/aula, `findAvailableClassrooms` y trigger SQL de archivado.
4. **Tolerar datos legacy** `ONGOING`/`COMPLETED` almacenados: se tratan como publicados y se resuelven con la misma regla temporal. Sin migracion de datos ni cambios de seed.
5. **Continuar encima** del arbol actual sin tocar el trabajo de 5.6.

**Reglas de negocio:**

- Estado efectivo:
  - `DRAFT` almacenado -> `DRAFT` (no tiene estado temporal).
  - `CANCELLED` almacenado -> `CANCELLED`.
  - `SCHEDULED`/`ONGOING`/`COMPLETED` almacenados (set publicado) -> se resuelve con el instante institucional `date + startTime/endTime`:
    - `now < inicio` -> `SCHEDULED`
    - `inicio <= now < fin` -> `ONGOING`
    - `now >= fin` -> `COMPLETED`
  - Limites: `inicio` inclusivo, `fin` exclusivo. Panama no tiene DST (ADR-0002), por lo que un dia institucional dura exactamente 24 h.
- Filtro `status` solo para `ADMIN` (con `200` silencioso para el resto) y por estado efectivo. El listado publico sin `status` sigue restringido al set publicado almacenado, que es equivalente al set efectivo publico (`SCHEDULED`+`ONGOING`+`COMPLETED`).
- `updateActivity`: rechaza `COMPLETED`/`CANCELLED` efectivos con `409 Completed or cancelled activities cannot be modified.` y `ONGOING` efectivo con `409 Ongoing activities cannot be modified.` La transicion `DRAFT <-> SCHEDULED` se evalua contra el estado efectivo.
- `cancelActivity`: rechaza `COMPLETED` efectivo con `409 Completed activities cannot be cancelled.`; `CANCELLED` efectivo es idempotente `200`; `DRAFT`/`SCHEDULED`/`ONGOING` efectivos se cancelan.
- `deleteActivity`: sin cambios (solo `DRAFT` almacenado).
- Guardas de reserva (archivar programa adicional, desactivar unidad, desactivar aula, disponibilidad): el bloqueo lo producen las actividades publicadas que aun no terminan (`date > hoy` o `date = hoy` con `endTime > hora actual`).
- La reserva/GiST de `activities.schedule.ts` no se modifica: sigue usando el set almacenado para mantener paridad con la constraint de BD.

---

### Task 1: Helpers de instante institucional (`src/utils/date.ts`)

**Files:**

- Modify: `src/utils/date.ts`
- Test: `src/utils/date.test.ts`

- [ ] **Step 1: Escribir las pruebas que fallan**

Agregar imports y describes al final de `src/utils/date.test.ts`:

```ts
import {
  getInstitutionalDateKey,
  getInstitutionalDayOfWeek,
  getInstitutionalDayRange,
  getInstitutionalTimeOfDay,
  INSTITUTIONAL_TIME_ZONE,
  startOfInstitutionalDay,
  toInstitutionalInstant,
} from './date.js';
```

```ts
describe('getInstitutionalTimeOfDay', () => {
  it('resolves the last millisecond of the Panama day before local midnight', () => {
    const time = getInstitutionalTimeOfDay(new Date('2026-09-20T04:59:59.999Z'));

    expect(time.toISOString()).toBe('1970-01-01T23:59:59.999Z');
  });

  it('resolves midnight exactly at the institutional day start', () => {
    const time = getInstitutionalTimeOfDay(new Date('2026-09-20T05:00:00.000Z'));

    expect(time.toISOString()).toBe('1970-01-01T00:00:00.000Z');
  });

  it('resolves the Panama wall clock during the day', () => {
    const time = getInstitutionalTimeOfDay(new Date('2026-09-20T14:30:15.250Z'));

    expect(time.toISOString()).toBe('1970-01-01T09:30:15.250Z');
  });
});

describe('toInstitutionalInstant', () => {
  it('combines a calendar date and a time into the Panama instant', () => {
    const instant = toInstitutionalInstant(
      new Date('2026-09-20T00:00:00.000Z'),
      new Date('1970-01-01T09:00:00.000Z'),
    );

    expect(instant.toISOString()).toBe('2026-09-20T14:00:00.000Z');
  });

  it('maps the time zero to the institutional midnight', () => {
    const instant = toInstitutionalInstant(
      new Date('2026-09-20T00:00:00.000Z'),
      new Date('1970-01-01T00:00:00.000Z'),
    );

    expect(instant.toISOString()).toBe('2026-09-20T05:00:00.000Z');
  });

  it('stays independent from the process time zone', () => {
    const instant = toInstitutionalInstant(
      new Date('2026-01-01T00:00:00.000Z'),
      new Date('1970-01-01T23:59:00.000Z'),
    );

    expect(instant.toISOString()).toBe('2026-01-02T04:59:00.000Z');
  });
});
```

- [ ] **Step 2: Correr las pruebas y verificar que fallan**

Run: `pnpm exec vitest run src/utils/date.test.ts`
Expected: FAIL con `getInstitutionalTimeOfDay is not a function` / `toInstitutionalInstant is not a function`.

- [ ] **Step 3: Implementar los helpers**

Agregar al final de `src/utils/date.ts`:

```ts
const EPOCH_UTC = Date.UTC(1970, 0, 1);

export const getInstitutionalTimeOfDay = (instant: Date): Date => {
  const dateKey = getInstitutionalDateKey(instant);
  const { start } = getInstitutionalDayRange(dateKey);

  return new Date(EPOCH_UTC + (instant.getTime() - start.getTime()));
};

export const toInstitutionalInstant = (date: Date, time: Date): Date => {
  const dateKey = date.toISOString().slice(0, 10);
  const { start } = getInstitutionalDayRange(dateKey);

  return new Date(start.getTime() + (time.getTime() - EPOCH_UTC));
};
```

- [ ] **Step 4: Correr las pruebas y verificar que pasan**

Run: `pnpm exec vitest run src/utils/date.test.ts`
Expected: PASS.

---

### Task 2: Resolutor y predicados de estado (`activities.status.ts`)

**Files:**

- Create: `src/modules/activities/activities.status.ts`
- Test: `src/modules/activities/activities.status.test.ts`

- [ ] **Step 1: Escribir las pruebas que fallan**

Crear `src/modules/activities/activities.status.test.ts`:

```ts
import { describe, expect, it } from 'vitest';

import {
  buildEffectiveStatusWhere,
  buildReservingActivityWhere,
  PUBLISHED_ACTIVITY_STATUSES,
  resolveActivityStatus,
} from './activities.status.js';

const NOW = new Date('2026-09-20T14:30:00.000Z');

const buildActivity = (overrides: Partial<Parameters<typeof resolveActivityStatus>[0]> = {}) => ({
  status: 'SCHEDULED' as const,
  date: new Date('2026-09-20T00:00:00.000Z'),
  startTime: new Date('1970-01-01T14:00:00.000Z'),
  endTime: new Date('1970-01-01T17:00:00.000Z'),
  ...overrides,
});

describe('resolveActivityStatus', () => {
  it('exposes the published status as scheduled before the start', () => {
    const activity = buildActivity({ startTime: new Date('1970-01-01T15:00:00.000Z') });

    expect(resolveActivityStatus(activity, NOW)).toBe('SCHEDULED');
  });

  it('resolves ongoing at the exact start instant', () => {
    const activity = buildActivity({ startTime: new Date('1970-01-01T09:30:00.000Z') });

    expect(resolveActivityStatus(activity, NOW)).toBe('ONGOING');
  });

  it('resolves ongoing inside the window', () => {
    expect(resolveActivityStatus(buildActivity(), NOW)).toBe('ONGOING');
  });

  it('resolves completed at the exact end instant', () => {
    const activity = buildActivity({ endTime: new Date('1970-01-01T09:30:00.000Z') });

    expect(resolveActivityStatus(activity, NOW)).toBe('COMPLETED');
  });

  it('resolves completed after the end', () => {
    const activity = buildActivity({
      date: new Date('2026-09-01T00:00:00.000Z'),
      startTime: new Date('1970-01-01T09:00:00.000Z'),
      endTime: new Date('1970-01-01T11:00:00.000Z'),
    });

    expect(resolveActivityStatus(activity, NOW)).toBe('COMPLETED');
  });

  it('keeps DRAFT and CANCELLED untouched', () => {
    expect(resolveActivityStatus(buildActivity({ status: 'DRAFT' }), NOW)).toBe('DRAFT');
    expect(resolveActivityStatus(buildActivity({ status: 'CANCELLED' }), NOW)).toBe('CANCELLED');
  });

  it('tolerates legacy ONGOING and COMPLETED stored values', () => {
    const past = {
      date: new Date('2026-09-01T00:00:00.000Z'),
      startTime: new Date('1970-01-01T09:00:00.000Z'),
      endTime: new Date('1970-01-01T11:00:00.000Z'),
    };

    expect(resolveActivityStatus(buildActivity({ status: 'ONGOING', ...past }), NOW)).toBe(
      'COMPLETED',
    );
    expect(resolveActivityStatus(buildActivity({ status: 'COMPLETED', ...past }), NOW)).toBe(
      'COMPLETED',
    );
  });

  it('uses the Panama day boundary', () => {
    const activity = buildActivity({
      date: new Date('2026-09-20T00:00:00.000Z'),
      startTime: new Date('1970-01-01T00:00:00.000Z'),
      endTime: new Date('1970-01-01T01:00:00.000Z'),
    });

    expect(resolveActivityStatus(activity, new Date('2026-09-20T04:59:00.000Z'))).toBe('SCHEDULED');
    expect(resolveActivityStatus(activity, new Date('2026-09-20T05:00:00.000Z'))).toBe('ONGOING');
    expect(resolveActivityStatus(activity, new Date('2026-09-20T06:00:00.000Z'))).toBe('COMPLETED');
  });
});

describe('buildEffectiveStatusWhere', () => {
  it('maps DRAFT and CANCELLED to the stored value', () => {
    expect(buildEffectiveStatusWhere('DRAFT', NOW)).toEqual({ status: 'DRAFT' });
    expect(buildEffectiveStatusWhere('CANCELLED', NOW)).toEqual({ status: 'CANCELLED' });
  });

  it('builds the scheduled predicate around the institutional day', () => {
    expect(buildEffectiveStatusWhere('SCHEDULED', NOW)).toEqual({
      status: { in: PUBLISHED_ACTIVITY_STATUSES },
      OR: [
        { date: { gt: new Date('2026-09-20T00:00:00.000Z') } },
        {
          date: new Date('2026-09-20T00:00:00.000Z'),
          startTime: { gt: new Date('1970-01-01T09:30:00.000Z') },
        },
      ],
    });
  });

  it('builds the ongoing predicate with a half-open window', () => {
    expect(buildEffectiveStatusWhere('ONGOING', NOW)).toEqual({
      status: { in: PUBLISHED_ACTIVITY_STATUSES },
      date: new Date('2026-09-20T00:00:00.000Z'),
      startTime: { lte: new Date('1970-01-01T09:30:00.000Z') },
      endTime: { gt: new Date('1970-01-01T09:30:00.000Z') },
    });
  });

  it('builds the completed predicate around the end instant', () => {
    expect(buildEffectiveStatusWhere('COMPLETED', NOW)).toEqual({
      status: { in: PUBLISHED_ACTIVITY_STATUSES },
      OR: [
        { date: { lt: new Date('2026-09-20T00:00:00.000Z') } },
        {
          date: new Date('2026-09-20T00:00:00.000Z'),
          endTime: { lte: new Date('1970-01-01T09:30:00.000Z') },
        },
      ],
    });
  });
});

describe('buildReservingActivityWhere', () => {
  it('keeps only published activities that have not ended', () => {
    expect(buildReservingActivityWhere(NOW)).toEqual({
      status: { in: PUBLISHED_ACTIVITY_STATUSES },
      OR: [
        { date: { gt: new Date('2026-09-20T00:00:00.000Z') } },
        {
          date: new Date('2026-09-20T00:00:00.000Z'),
          endTime: { gt: new Date('1970-01-01T09:30:00.000Z') },
        },
      ],
    });
  });
});
```

- [ ] **Step 2: Correr las pruebas y verificar que fallan**

Run: `pnpm exec vitest run src/modules/activities/activities.status.test.ts`
Expected: FAIL porque el modulo no existe.

- [ ] **Step 3: Implementar el modulo**

Crear `src/modules/activities/activities.status.ts`:

```ts
import type { ActivityStatus } from '../../generated/prisma/enums.js';
import {
  getInstitutionalTimeOfDay,
  startOfInstitutionalDay,
  toInstitutionalInstant,
} from '../../utils/date.js';

export const PUBLISHED_ACTIVITY_STATUSES: ActivityStatus[] = ['SCHEDULED', 'ONGOING', 'COMPLETED'];

export interface ActivityTemporalState {
  status: ActivityStatus;
  date: Date;
  startTime: Date;
  endTime: Date;
}

export const resolveActivityStatus = (
  activity: ActivityTemporalState,
  now: Date,
): ActivityStatus => {
  if (activity.status === 'DRAFT') {
    return 'DRAFT';
  }
  if (activity.status === 'CANCELLED') {
    return 'CANCELLED';
  }

  const start = toInstitutionalInstant(activity.date, activity.startTime);
  const end = toInstitutionalInstant(activity.date, activity.endTime);

  if (now < start) {
    return 'SCHEDULED';
  }
  if (now < end) {
    return 'ONGOING';
  }

  return 'COMPLETED';
};

export const buildEffectiveStatusWhere = (
  status: ActivityStatus,
  now: Date,
): Record<string, unknown> => {
  const today = startOfInstitutionalDay(now);
  const nowTime = getInstitutionalTimeOfDay(now);
  const published = { in: [...PUBLISHED_ACTIVITY_STATUSES] };

  switch (status) {
    case 'DRAFT':
      return { status: 'DRAFT' };
    case 'CANCELLED':
      return { status: 'CANCELLED' };
    case 'SCHEDULED':
      return {
        status: published,
        OR: [{ date: { gt: today } }, { date: today, startTime: { gt: nowTime } }],
      };
    case 'ONGOING':
      return {
        status: published,
        date: today,
        startTime: { lte: nowTime },
        endTime: { gt: nowTime },
      };
    case 'COMPLETED':
      return {
        status: published,
        OR: [{ date: { lt: today } }, { date: today, endTime: { lte: nowTime } }],
      };
  }
};

export const buildReservingActivityWhere = (now: Date): Record<string, unknown> => {
  const today = startOfInstitutionalDay(now);
  const nowTime = getInstitutionalTimeOfDay(now);

  return {
    status: { in: [...PUBLISHED_ACTIVITY_STATUSES] },
    OR: [{ date: { gt: today } }, { date: today, endTime: { gt: nowTime } }],
  };
};
```

- [ ] **Step 4: Correr las pruebas y verificar que pasan**

Run: `pnpm exec vitest run src/modules/activities/activities.status.test.ts`
Expected: PASS.

---

### Task 3: Derivar `status` en los DTOs de actividades

**Files:**

- Modify: `src/modules/activities/activities.service.ts:31-160,189-372`
- Test: `src/modules/activities/activities.service.test.ts`

- [ ] **Step 1: Escribir las pruebas que fallan**

En `src/modules/activities/activities.service.test.ts`, dentro de `describe('activities service')`, agregar:

```ts
it('derives the status of each listed activity at read time', async () => {
  const prisma = createPrismaMock();
  prisma.activity.findMany.mockResolvedValue([
    buildRecord({ id: 'future', status: 'SCHEDULED' }),
    buildRecord({
      id: 'ongoing',
      status: 'SCHEDULED',
      startTime: new Date('1970-01-01T14:00:00.000Z'),
      endTime: new Date('1970-01-01T17:00:00.000Z'),
    }),
    buildRecord({
      id: 'past',
      status: 'SCHEDULED',
      date: new Date('2026-09-01T00:00:00.000Z'),
    }),
    buildRecord({ id: 'draft', status: 'DRAFT' }),
    buildRecord({ id: 'cancelled', status: 'CANCELLED' }),
  ]);
  prisma.activity.count.mockResolvedValue(5);
  const { listActivities } = await loadService(prisma);

  const result = await listActivities(
    { page: 1, limit: 20, when: 'all' },
    null,
    new Date('2026-09-20T16:00:00.000Z'),
  );

  expect(result.items.map((item) => [item.id, item.status])).toEqual([
    ['future', 'SCHEDULED'],
    ['ongoing', 'ONGOING'],
    ['past', 'COMPLETED'],
    ['draft', 'DRAFT'],
    ['cancelled', 'CANCELLED'],
  ]);
});
```

Nota: `NOW` (linea 83) es `2026-09-19T15:00:00.000Z`; `buildRecord()` sigue derivando `SCHEDULED` con `NOW` porque su inicio es el 20 de septiembre a las 14:00 UTC.

- [ ] **Step 2: Correr la prueba y verificar que falla**

Run: `pnpm exec vitest run src/modules/activities/activities.service.test.ts -t "derives the status"`
Expected: FAIL; los items devuelven el estado almacenado (`SCHEDULED` para `past`, `ONGOING` etc.).

- [ ] **Step 3: Implementar la derivacion**

En `src/modules/activities/activities.service.ts`:

1. Importar el resolutor y el set publicado, y retirar la constante local:

```ts
import {
  buildEffectiveStatusWhere,
  PUBLISHED_ACTIVITY_STATUSES,
  resolveActivityStatus,
} from './activities.status.js';
```

2. Eliminar `const PROGRAM_PUBLIC_ACTIVITY_STATUSES: ActivityStatus[] = ['SCHEDULED', 'ONGOING', 'COMPLETED'];` (linea 31) y usar `PUBLISHED_ACTIVITY_STATUSES` en los tres usos (listados y publico). `ALL_ACTIVITY_STATUSES` se conserva.

3. Cambiar los mappers para recibir `now`:

```ts
const toActivityListItem = (record: ActivityRecord, now: Date): ActivityListItem => {
  const { organizationalUnit } = record.eventProgram;

  return {
    // ...resto igual...
    status: resolveActivityStatus(record, now),
    // ...resto igual...
  };
};

const toActivityDetail = (
  record: ActivityDetailRecord,
  enrolledCount: number,
  checkedInCount: number,
  now: Date,
): ActivityDetail => ({
  ...toActivityListItem(record, now),
  cancelReason: record.cancelReason,
  equipment: record.equipment.map((item) => item.name),
  enrolledCount,
  checkedInCount,
});
```

4. Propagar `now` en los llamadores:
   - `listActivities`: `records.map((record) => toActivityListItem(record, now))`.
   - `listEventProgramActivities`: agregar `now: Date = new Date()` como cuarto parametro y usarlo en el map.
   - `getActivityById`: agregar `now: Date = new Date()` como tercer parametro y llamar `toActivityDetail(record, record._count.attendance, checkedInCount, now)`.
   - `createActivity`, `updateActivity` y `cancelActivity`: capturar `const now = new Date();` al inicio y pasarlo al `toActivityDetail` final.

- [ ] **Step 4: Ajustar las pruebas existentes y correr la suite del modulo**

Actualizar las llamadas que assertan estado derivado para pasar `NOW` (o fake timers) y correr:

Run: `pnpm exec vitest run src/modules/activities/activities.service.test.ts src/modules/activities/activities.schemas.test.ts`
Expected: PASS.

---

### Task 4: Filtro `status` por estado efectivo en los listados

**Files:**

- Modify: `src/modules/activities/activities.service.ts:189-340`
- Test: `src/modules/activities/activities.service.test.ts`

- [ ] **Step 1: Escribir las pruebas que fallan**

En `src/modules/activities/activities.service.test.ts`, reemplazar la prueba `lets an admin filter a non public status and ALL` (lineas 223-236) por:

```ts
it('lets an admin filter a non public status and ALL', async () => {
  const prisma = createPrismaMock();
  prisma.activity.findMany.mockResolvedValue([]);
  prisma.activity.count.mockResolvedValue(0);
  const { listActivities } = await loadService(prisma);

  await listActivities({ page: 1, limit: 20, when: 'all', status: 'DRAFT' }, adminViewer, NOW);
  expect(prisma.activity.findMany.mock.calls[0]?.[0]?.where?.status).toEqual('DRAFT');

  await listActivities({ page: 1, limit: 20, when: 'all', status: 'ALL' }, adminViewer, NOW);
  expect(prisma.activity.findMany.mock.calls[1]?.[0]?.where).not.toHaveProperty('status');
});

it('resolves the admin status filter with the effective temporal predicate', async () => {
  const prisma = createPrismaMock();
  prisma.activity.findMany.mockResolvedValue([]);
  prisma.activity.count.mockResolvedValue(0);
  const { listActivities } = await loadService(prisma);

  await listActivities({ page: 1, limit: 20, when: 'all', status: 'ONGOING' }, adminViewer, NOW);

  expect(prisma.activity.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        status: { in: ['SCHEDULED', 'ONGOING', 'COMPLETED'] },
        date: new Date('2026-09-19T00:00:00.000Z'),
        startTime: { lte: new Date('1970-01-01T10:00:00.000Z') },
        endTime: { gt: new Date('1970-01-01T10:00:00.000Z') },
      }),
    }),
  );
});
```

En el `describe('listEventProgramActivities')`, agregar:

```ts
it('resolves the collaborator status filter with the effective temporal predicate', async () => {
  const prisma = createPrismaMock();
  prisma.eventProgram.findUnique.mockResolvedValue({ id: 'program-001', status: 'ACTIVE' });
  prisma.activity.findMany.mockResolvedValue([]);
  prisma.activity.count.mockResolvedValue(0);
  const { listEventProgramActivities } = await loadService(prisma);

  await listEventProgramActivities(
    'program-001',
    { page: 1, limit: 20, status: 'COMPLETED' },
    { ...adminViewer, globalRole: 'USER' },
    NOW,
  );

  expect(prisma.activity.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({
        AND: [
          {
            status: { in: ['SCHEDULED', 'ONGOING', 'COMPLETED'] },
            OR: [
              { date: { lt: new Date('2026-09-19T00:00:00.000Z') } },
              {
                date: new Date('2026-09-19T00:00:00.000Z'),
                endTime: { lte: new Date('1970-01-01T10:00:00.000Z') },
              },
            ],
          },
        ],
      }),
    }),
  );
});
```

- [ ] **Step 2: Correr y verificar rojo**

Run: `pnpm exec vitest run src/modules/activities/activities.service.test.ts -t "effective temporal predicate"`
Expected: FAIL; hoy solo se usa `{ status: { in: [...] } }`.

- [ ] **Step 3: Implementar el filtro derivado**

En `listActivities`:

```ts
const requestedStatus = viewer?.globalRole === 'ADMIN' ? query.status : undefined;
const statusWhere =
  requestedStatus && requestedStatus !== 'ALL'
    ? buildEffectiveStatusWhere(requestedStatus, now)
    : requestedStatus === 'ALL'
      ? {}
      : { status: { in: [...PUBLISHED_ACTIVITY_STATUSES] } };
```

y en el `where` reemplazar `status: { in: statuses },` por `...statusWhere,`.

En `listEventProgramActivities`:

```ts
const statusWhere = canRead
  ? query.status && query.status !== 'ALL'
    ? { AND: [buildEffectiveStatusWhere(query.status, now)] }
    : { status: { in: [...ALL_ACTIVITY_STATUSES] } }
  : { status: { in: [...PUBLISHED_ACTIVITY_STATUSES] } };
```

y en el `where` reemplazar `status: { in: statuses },` por `...statusWhere,`. El `AND` evita la colision con el `OR` de la busqueda `q`.

- [ ] **Step 4: Correr la suite y verificar verde**

Run: `pnpm exec vitest run src/modules/activities/activities.service.test.ts`
Expected: PASS.

---

### Task 5: Guardas temporales de `PATCH` y cancelacion

**Files:**

- Modify: `src/modules/activities/activities.service.ts:683-943`
- Test: `src/modules/activities/activities.service.test.ts`

- [ ] **Step 1: Escribir las pruebas que fallan**

En el `describe('updateActivity')`, dentro de un nuevo `describe('temporal guards with a controlled clock')` con:

```ts
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-20T16:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});
```

agregar:

```ts
it('rejects updating an effectively ongoing activity', async () => {
  const prisma = createActivityPrismaMock();
  prisma.activity.findUnique.mockResolvedValue(ongoingActivityRecord);
  const { updateActivity } = await loadService(prisma);

  await expect(updateActivity('activity-001', { name: 'Nuevo' })).rejects.toMatchObject({
    statusCode: 409,
    message: 'Ongoing activities cannot be modified.',
  });
  expect(prisma.activity.update).not.toHaveBeenCalled();
});

it('rejects updating an effectively completed activity', async () => {
  const prisma = createActivityPrismaMock();
  prisma.activity.findUnique.mockResolvedValue(completedActivityRecord);
  const { updateActivity } = await loadService(prisma);

  await expect(updateActivity('activity-001', { name: 'Nuevo' })).rejects.toMatchObject({
    statusCode: 409,
    message: 'Completed or cancelled activities cannot be modified.',
  });
  expect(prisma.activity.update).not.toHaveBeenCalled();
});

it('still publishes an effectively scheduled draft', async () => {
  const prisma = createActivityPrismaMock();
  prisma.activity.findUnique.mockResolvedValue(draftActivityRecord);
  prisma.activity.update.mockResolvedValue(updatedRecord);
  const { updateActivity } = await loadService(prisma);

  await updateActivity('activity-001', { status: 'SCHEDULED' });

  expect(prisma.activity.update).toHaveBeenCalledWith(
    expect.objectContaining({ data: expect.objectContaining({ status: 'SCHEDULED' }) }),
  );
});
```

Los fixtures `ongoingActivityRecord` (inicio 14:00 UTC del 20, publicado `SCHEDULED`) y `completedActivityRecord` (fecha 2026-09-01, `SCHEDULED`) se construyen a partir del `current` existente del describe. En el `describe('cancelActivity')` agregar el mismo bloque de fake timers y:

```ts
it('rejects cancelling an effectively completed activity', async () => {
  const prisma = createActivityPrismaMock();
  prisma.activity.findUnique.mockResolvedValue(completedActivityRecord);
  const { cancelActivity } = await loadService(prisma);

  await expect(cancelActivity('activity-001')).rejects.toMatchObject({
    statusCode: 409,
    message: 'Completed activities cannot be cancelled.',
  });
});

it('cancels an effectively ongoing activity', async () => {
  const prisma = createActivityPrismaMock();
  prisma.activity.findUnique.mockResolvedValue(ongoingActivityRecord);
  prisma.activity.update.mockResolvedValue({ ...ongoingActivityRecord, status: 'CANCELLED' });
  const { cancelActivity } = await loadService(prisma);

  await cancelActivity('activity-001');

  expect(prisma.activity.update).toHaveBeenCalledWith(
    expect.objectContaining({ data: { status: 'CANCELLED', cancelReason: null } }),
  );
});
```

- [ ] **Step 2: Correr y verificar rojo**

Run: `pnpm exec vitest run src/modules/activities/activities.service.test.ts -t "effectively"`
Expected: FAIL; la guarda actual usa solo el status almacenado y no conoce `ONGOING` efectivo.

- [ ] **Step 3: Implementar las guardas**

En `updateActivity`, reemplazar la guarda de estado (lineas 727-744) por:

```ts
const now = new Date();
const effectiveStatus = resolveActivityStatus(current, now);

if (effectiveStatus === 'COMPLETED' || effectiveStatus === 'CANCELLED') {
  throw new ApiError(409, 'Completed or cancelled activities cannot be modified.');
}
if (effectiveStatus === 'ONGOING') {
  throw new ApiError(409, 'Ongoing activities cannot be modified.');
}
if (current.eventProgram.status !== 'ACTIVE') {
  throw new ApiError(409, 'Event programs must be active to modify their activities.');
}

const status = input.status ?? effectiveStatus;

if (input.status !== undefined && input.status !== effectiveStatus) {
  const allowed =
    (effectiveStatus === 'DRAFT' && input.status === 'SCHEDULED') ||
    (effectiveStatus === 'SCHEDULED' && input.status === 'DRAFT');

  if (!allowed) {
    throw new ApiError(400, 'Activity status transition is not allowed.');
  }
}
```

`effectiveStatus` solo puede ser `DRAFT` o `SCHEDULED` a esta altura. `requiresBooking` pasa a usar `status` (que ya no puede ser `ONGOING`/`COMPLETED`) y por eso `RESERVING_STATUSES` deja de usarse en este servicio; si el import queda sin uso, eliminarlo. El DTO final usa el `now` capturado: `toActivityDetail(record, ..., now)`.

En `cancelActivity`, reemplazar la guarda `if (current.status === 'COMPLETED')` por:

```ts
const now = new Date();
const effectiveStatus = resolveActivityStatus(current, now);

if (effectiveStatus === 'COMPLETED') {
  throw new ApiError(409, 'Completed activities cannot be cancelled.');
}

let record = current;

if (effectiveStatus !== 'CANCELLED') {
  // ...bloque existente...
}
```

- [ ] **Step 4: Correr y verificar verde**

Run: `pnpm exec vitest run src/modules/activities/activities.service.test.ts`
Expected: PASS. Ajustar las pruebas existentes de `updateActivity`/`cancelActivity` que asumian `ONGOING` almacenado no asignable: con reloj controlado siguen cubiertas por la guarda efectiva.

---

### Task 6: `byStatus` derivado y guarda de archivado en programas

**Files:**

- Modify: `src/modules/event-programs/event-programs.service.ts:126-157,402-438`
- Test: `src/modules/event-programs/event-programs.service.test.ts`

- [ ] **Step 1: Escribir las pruebas que fallan**

En `src/modules/event-programs/event-programs.service.test.ts`, actualizar `PrismaMock.activity` a `{ count, findMany }` y `createPrismaMock` a `activity: { count: vi.fn(), findMany: vi.fn() }`. Reemplazar las pruebas de `groupBy` por:

```ts
const NOW = new Date('2026-09-20T16:00:00.000Z');

it('derives the per-status breakdown at read time', async () => {
  const prisma = createPrismaMock();
  prisma.eventProgram.findUnique.mockResolvedValue(activeDetailRecord);
  prisma.activity.findMany.mockResolvedValue([
    {
      status: 'DRAFT',
      date: new Date('2026-09-20T00:00:00.000Z'),
      startTime: time(9),
      endTime: time(11),
    },
    {
      status: 'SCHEDULED',
      date: new Date('2026-09-20T00:00:00.000Z'),
      startTime: time(9),
      endTime: time(11),
    },
    {
      status: 'SCHEDULED',
      date: new Date('2026-09-20T00:00:00.000Z'),
      startTime: time(14),
      endTime: time(17),
    },
    {
      status: 'SCHEDULED',
      date: new Date('2026-09-25T00:00:00.000Z'),
      startTime: time(9),
      endTime: time(11),
    },
    {
      status: 'COMPLETED',
      date: new Date('2026-09-01T00:00:00.000Z'),
      startTime: time(9),
      endTime: time(11),
    },
    {
      status: 'CANCELLED',
      date: new Date('2026-09-25T00:00:00.000Z'),
      startTime: time(9),
      endTime: time(11),
    },
  ]);
  const { getEventProgramById } = await loadService(prisma);

  const result = await getEventProgramById('program-001', adminViewer, NOW);

  expect(result.activityCount).toEqual({
    visible: 3,
    total: 6,
    byStatus: { DRAFT: 1, SCHEDULED: 2, ONGOING: 1, COMPLETED: 2, CANCELLED: 0 },
  });
  expect(prisma.activity.findMany).toHaveBeenCalledWith({
    where: { eventProgramId: 'program-001' },
    select: { status: true, date: true, startTime: true, endTime: true },
  });
});
```

Donde `time(hour)` es `(hour: number) => new Date(\`1970-01-01T${String(hour).padStart(2, '0')}:00:00.000Z\`)`. Ajustar la prueba de `visible` sin desglose (`includeBreakdown=false`) para mockear `findMany`. En la guarda de archivado, reemplazar las aserciones de `activity.count`:

```ts
it('rejects archiving while an activity has not ended', async () => {
  const prisma = createPrismaMock();
  prisma.eventProgram.findUnique.mockResolvedValue(additionalProgramRecord);
  prisma.activity.count.mockResolvedValue(1);
  const { archiveEventProgram } = await loadService(prisma);

  await expect(archiveEventProgram('program-001', {}, NOW)).rejects.toMatchObject({
    statusCode: 409,
    message: 'An event program with scheduled or ongoing activities cannot be archived.',
  });
  expect(prisma.activity.count).toHaveBeenCalledWith({
    where: {
      eventProgramId: 'program-001',
      status: { in: ['SCHEDULED', 'ONGOING', 'COMPLETED'] },
      OR: [
        { date: { gt: new Date('2026-09-20T00:00:00.000Z') } },
        {
          date: new Date('2026-09-20T00:00:00.000Z'),
          endTime: { gt: new Date('1970-01-01T09:30:00.000Z') },
        },
      ],
    },
  });
});

it('archives a program whose published activities already ended', async () => {
  const prisma = createPrismaMock();
  prisma.eventProgram.findUnique.mockResolvedValue(additionalProgramRecord);
  prisma.activity.count.mockResolvedValue(0);
  prisma.eventProgram.update.mockResolvedValue({ ...additionalProgramRecord, status: 'ARCHIVED' });
  const { archiveEventProgram } = await loadService(prisma);

  await expect(archiveEventProgram('program-001', {}, NOW)).resolves.toBeDefined();
  expect(prisma.eventProgram.update).toHaveBeenCalled();
});
```

- [ ] **Step 2: Correr y verificar rojo**

Run: `pnpm exec vitest run src/modules/event-programs/event-programs.service.test.ts`
Expected: FAIL; `activity.findMany` no existe y la guarda usa `['SCHEDULED','ONGOING']`.

- [ ] **Step 3: Implementar**

En `event-programs.service.ts`:

1. Importar `buildReservingActivityWhere` y `resolveActivityStatus` desde `../activities/activities.status.js`.
2. `countEventProgramActivities(eventProgramId, includeBreakdown, now = new Date())`:

```ts
const activities = await prisma.activity.findMany({
  where: { eventProgramId },
  select: { status: true, date: true, startTime: true, endTime: true },
});

const byStatus = Object.fromEntries(ACTIVITY_STATUSES.map((status) => [status, 0])) as Record<
  ActivityStatus,
  number
>;

for (const activity of activities) {
  byStatus[resolveActivityStatus(activity, now)] += 1;
}

const visible = PUBLIC_ACTIVITY_STATUSES.reduce((total, status) => total + byStatus[status], 0);
```

3. `getEventProgramById(id, viewer, now = new Date())` propaga `now` a `countEventProgramActivities`.
4. `archiveEventProgram(id, auditContext = {}, now = new Date())` reemplaza la guarda por:

```ts
const blockingActivities = await prisma.activity.count({
  where: { eventProgramId: program.id, ...buildReservingActivityWhere(now) },
});
```

- [ ] **Step 4: Correr y verificar verde**

Run: `pnpm exec vitest run src/modules/event-programs/event-programs.service.test.ts`
Expected: PASS.

---

### Task 7: Guardas temporales en aulas y unidades organizativas

**Files:**

- Modify: `src/modules/classrooms/classrooms.service.ts:17,286-299,507-557`
- Modify: `src/modules/organizational-units/organizational-units.service.ts:318-327`
- Test: `src/modules/classrooms/classrooms.service.test.ts`, `src/modules/organizational-units/organizational-units.service.test.ts`

- [ ] **Step 1: Escribir las pruebas que fallan**

En `classrooms.service.test.ts`, fijar un reloj controlado en las pruebas de desactivacion (`vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-09-20T16:00:00.000Z'));`) y actualizar las aserciones a la guarda temporal. En la prueba de bloqueo, `prisma.activity.findMany` sigue devolviendo una fila y se agrega:

```ts
expect(prisma.activity.findMany).toHaveBeenCalledWith(
  expect.objectContaining({
    where: {
      classroomId: 'classroom-001',
      status: { in: ['SCHEDULED', 'ONGOING', 'COMPLETED'] },
      OR: [
        { date: { gt: new Date('2026-09-20T00:00:00.000Z') } },
        {
          date: new Date('2026-09-20T00:00:00.000Z'),
          endTime: { gt: new Date('1970-01-01T09:30:00.000Z') },
        },
      ],
    },
  }),
);
```

En `listAvailableClassrooms`, la prueba de exclusion actualiza su asercion al mismo predicado mas `date`/`startTime`/`endTime` del overlap.

En `organizational-units.service.test.ts`, la prueba `rejects deactivation with scheduled or ongoing activities` espera:

```ts
expect(prisma.activity.count).toHaveBeenCalledWith({
  where: {
    eventProgramId: 'program-001',
    status: { in: ['SCHEDULED', 'ONGOING', 'COMPLETED'] },
    OR: [
      { date: { gt: new Date('2026-09-20T00:00:00.000Z') } },
      {
        date: new Date('2026-09-20T00:00:00.000Z'),
        endTime: { gt: new Date('1970-01-01T09:30:00.000Z') },
      },
    ],
  },
});
```

y la llamada pasa el reloj: `deactivateOrganizationalUnit('unit-001', {}, NOW)`.

- [ ] **Step 2: Correr y verificar rojo**

Run: `pnpm exec vitest run src/modules/classrooms/classrooms.service.test.ts src/modules/organizational-units/organizational-units.service.test.ts`
Expected: FAIL; las guardas siguen filtrando solo por status almacenado.

- [ ] **Step 3: Implementar**

En `classrooms.service.ts`:

1. Importar `buildReservingActivityWhere` desde `../activities/activities.status.js` y eliminar `BLOCKING_ACTIVITY_STATUSES` (linea 17) y su import si queda sin uso.
2. `updateClassroom(id, input, auditContext = {}, now = new Date())`; en la guarda:

```ts
const blocking = await prisma.activity.findMany({
  where: { classroomId: id, ...buildReservingActivityWhere(now) },
  select: { id: true },
  take: 1,
});
```

3. `findAvailableClassrooms(query, now = new Date())`; en el bloqueo:

```ts
const blocking = await prisma.activity.findMany({
  where: {
    date,
    ...buildReservingActivityWhere(now),
    classroomId: { in: candidates.map((candidate) => candidate.id) },
    startTime: { lt: endTime },
    endTime: { gt: startTime },
  },
  select: { classroomId: true },
  distinct: ['classroomId'],
});
```

En `organizational-units.service.ts`, importar `buildReservingActivityWhere` y cambiar:

```ts
const blockingActivities = await prisma.activity.count({
  where: { eventProgramId: defaultProgram.id, ...buildReservingActivityWhere(now) },
});
```

con `deactivateOrganizationalUnit(id, auditContext = {}, now = new Date())`.

- [ ] **Step 4: Correr y verificar verde**

Run: `pnpm exec vitest run src/modules/classrooms/classrooms.service.test.ts src/modules/organizational-units/organizational-units.service.test.ts`
Expected: PASS.

---

### Task 8: Migracion del trigger de archivado temporal

**Files:**

- Create: `prisma/migrations/<timestamp>_temporal_archive_guard/migration.sql`

- [ ] **Step 1: Verificar el rojo actual en la base real**

Con el stack de desarrollo arriba y una actividad publicada con fecha pasada en un programa adicional:

```sql
BEGIN;
UPDATE "event_programs" SET "status" = 'ARCHIVED' WHERE "id" = '<programa-adicional>';
ROLLBACK;
```

Expected: error `an event program with scheduled or ongoing activities cannot be archived`, aunque la actividad ya termino.

- [ ] **Step 2: Crear la migracion**

Crear `prisma/migrations/<timestamp>_temporal_archive_guard/migration.sql` con la funcion completa `validate_event_program_transition` actual (copiada de `prisma/migrations/20260919093000_unify_organizational_units/migration.sql:161-225`) reemplazando solo el `ELSE` del archivado:

```sql
        ELSE
            PERFORM 1
            FROM "activities"
            WHERE "event_program_id" = NEW."id"
              AND "status" IN ('SCHEDULED', 'ONGOING', 'COMPLETED')
              AND ("date" + "end_time") > (now() AT TIME ZONE 'America/Panama')
            LIMIT 1;

            IF FOUND THEN
                RAISE EXCEPTION 'an event program with scheduled or ongoing activities cannot be archived';
            END IF;
        END IF;
```

Encabezado del archivo:

```sql
-- Make the additional-program archive guard temporal: a published activity
-- that already ended must not block archiving its event program.
-- See docs/adr/adr-0010-read-time-activity-status-derivation.md.
```

- [ ] **Step 3: Aplicar y validar**

Run:

```bash
pnpm prisma validate
pnpm prisma migrate dev
pnpm prisma:migrate:status
```

Expected: migracion aplicada, `Database schema is up to date!`.

- [ ] **Step 4: Verificar el verde**

Repetir el SQL del Step 1: ahora el `UPDATE` no lanza excepcion (rollback). Insertar/publicar por SQL una actividad futura en un programa adicional `ACTIVE` y confirmar que el archivado sigue bloqueado.

---

### Task 9: Contrato OpenAPI y documentacion

**Files:**

- Modify: `src/modules/activities/activities.openapi.ts`
- Modify: `src/modules/event-programs/event-programs.openapi.ts`
- Modify: `src/docs/openapi.test.ts` (solo si alguna asercion cambia)
- Modify: `README.md`, `CONTEXT.md`, `AGENTS.md` (si aplica)
- Create: `docs/adr/adr-0010-read-time-activity-status-derivation.md`

- [ ] **Step 1: Actualizar descripciones OpenAPI**

En `activities.openapi.ts`, documentar que `status` es el estado efectivo derivado al leer (`DRAFT`/`CANCELLED` son administrativos; `SCHEDULED`/`ONGOING`/`COMPLETED` se resuelven con fecha y hora institucional), que `when` sigue siendo por fecha y que el filtro `status` de `ADMIN` usa el estado efectivo. En `event-programs.openapi.ts`, documentar que `activityCount.byStatus` y `visible` usan el estado efectivo y que la guarda de archivado ignora actividades ya terminadas.

- [ ] **Step 2: Regenerar y verificar contrato**

Run:

```bash
pnpm run docs:generate
pnpm run docs:check
git diff --stat openapi.json
```

Expected: `openapi.json` refleja las descripciones; `docs:check` en verde.

- [ ] **Step 3: Escribir el ADR-0010**

Crear `docs/adr/adr-0010-read-time-activity-status-derivation.md` con el template del skill (`Status`, `Context`, `Decision`, `Consequences` con `POS/NEG`, `Alternatives Considered` con `ALT`, `Implementation Notes`, `References`). Contenido minimo:

- Contexto: `ONGOING`/`COMPLETED` no se producen por API; D15/M3 pendientes; sin scheduler; ADR-0008 rechaza `pg_cron`.
- Decision: derivacion al leer con reloj institucional; limites `[inicio, fin)`; un solo dia (no hay actividades nocturnas por `endTime > startTime`); valores legacy tolerados; `when` por fecha.
- Alternativas: scheduler/job (rechazado), vista/generated column en BD (rechazado por complejidad con Prisma y triggers), escritura al leer (rechazado).
- Consecuencias: sin drift ni scheduler; la columna almacenada ya no es la fuente del estado temporal; las constraints GiST siguen en terminos almacenados.

- [ ] **Step 4: Actualizar README/CONTEXT**

Documentar en ambos: estado efectivo, `when` por fecha, filtro `status` efectivo, guardas temporales de PATCH/cancel/archivado/desactivaciones, `byStatus` derivado y el trigger.

---

### Task 10: Bruno, gates y verificacion E2E

**Files:**

- Modify: `bruno/Activities/*` y `bruno/Event_Programs/*` solo si alguna asercion depende de la hora
- Modify: `docs/superpowers/plans/plan-maestro-sipeg-utp.md` (marcar 5.7 y agregar registro)

- [ ] **Step 1: Auditar y correr Bruno**

Run:

```bash
pnpm run api:run:smoke
bru run Activities --env local
bru run Event_Programs --env local
bru run Classrooms --env local
bru run Organizational_Units --env local
```

Expected: verde. Las aserciones relevantes ya son de forma (set publico, `visible = SCHEDULED+ONGOING+COMPLETED`); corregir solo lo que dependa de la hora.

- [ ] **Step 2: Verificacion real E2E (Docker + psql)**

Con `pnpm exec tsx` o psql, sobre el stack dev:

1. Crear/publicar una actividad de hoy cuyo inicio sea anterior a `now` y su fin posterior: el `GET` devuelve `status: ONGOING`; con el fin anterior a `now`, `COMPLETED`; con inicio futuro, `SCHEDULED`.
2. `GET /activities?status=ONGOING|COMPLETED|SCHEDULED` como admin devuelve solo coincidencias efectivas; como no-admin el filtro se ignora en silencio.
3. `PATCH` de una actividad efectivamente `ONGOING` -> `409 Ongoing activities cannot be modified.`; `PATCH` de una efectivamente `COMPLETED` -> `409 Completed or cancelled...`; `POST .../cancel` de una `COMPLETED` -> `409`, de una `ONGOING` -> `200`.
4. `GET /event-programs/:id` como admin: `byStatus` coincide con el calculo manual y `visible = suma publica`.
5. Archivar un programa adicional cuyas actividades ya terminaron -> `200`; con una actividad futura -> `409`.
6. Desactivar un aula/unidad con solo actividades terminadas -> permitido; con futuras -> `409`.
7. `findAvailableClassrooms` para una fecha/hora futura no cambia; para una ventana pasada, una actividad terminada ya no bloquea.
8. Limpiar residuos: `pnpm run prisma:cleanup:dev -- --pattern='Actividad temporal%' --apply` y borrar ponentes huerfanos si Bruno los deja.

- [ ] **Step 3: Gates completos**

Run:

```bash
pnpm test
pnpm run typecheck
pnpm run lint
pnpm run build
pnpm run format:check
pnpm run docs:check
pnpm prisma validate
pnpm prisma:migrate:status
```

Expected: todo en verde (salvo fallos ajenos preexistentes ya documentados).

- [ ] **Step 4: Registrar en el plan maestro**

Marcar `5.7` con `[x]` y agregar el bloque `Registro de ejecucion (2026-10-04 - 5.7)` en la Fase 5 con: plan, pruebas, verificacion real, contrato, Bruno, hallazgos y "Sin commit: el usuario no lo solicito."

---

## Registro de ejecucion (2026-10-04)

- [x] Baseline previo: `pnpm test` 1504 en 70 archivos (1 omitido, 7 skip) con el trabajo de 5.6 sin commitear.
- [x] Task 1: rojo verificado (6 fallos por funciones ausentes) y verde en `src/utils/date.test.ts` (19 pruebas).
- [x] Task 2: rojo verificado (modulo ausente) y verde en `activities.status.test.ts` (13 pruebas). El fixture inicial mezclaba horas locales con UTC y se corrigio a horas de pared de Panama.
- [x] Task 3: DTOs derivados; 4 pruebas existentes de `getActivityById`/`listEventProgramActivities` fallaron al usar el reloj real y se ajustaron para pasar `NOW`/fixtures temporales. Suite del servicio 105 en verde.
- [x] Task 4: rojo verificado en los 2 tests nuevos de filtro efectivo; `listActivities` y `listEventProgramActivities` usan `buildEffectiveStatusWhere` (con `AND` para convivir con el `OR` de `q`). Suite del servicio 107 en verde.
- [x] Task 5: rojo verificado en 3 guardas nuevas; reloj controlado con `vi.useFakeTimers({ toFake: ['Date'] })` en los describes de `updateActivity` y `cancelActivity`; fixtures legacy corregidos. Suite del servicio 109 en verde.
- [x] Task 6: rojo verificado (5 fallos); `byStatus` con `findMany` + resolutor y guarda de archivado con `buildReservingActivityWhere`. Suite de event-programs 129 en verde.
- [x] Task 7: rojo verificado en las 3 guardas; aulas y unidades usan el predicado de reserva. Suite 149 en verde.
- [x] Task 8: rojo SQL verificado (`an event program with scheduled or ongoing activities cannot be archived` con una actividad pasada); migracion `20261004083747_temporal_archive_guard` aplicada; verde SQL con `archived_at` y futuro sigue bloqueado. 17 migraciones, `Database schema is up to date!`.
- [x] Task 9: descripciones OpenAPI con estado efectivo, `openapi.json` regenerado sin drift, ADR-0010 creado y README/CONTEXT actualizados.
- [x] Task 10: `pnpm test` 1530 (+26), `typecheck`, `lint`, `build` y `docs:check` en verde; `format:check` solo reporta los 3 archivos ajenos preexistentes. E2E real 26/26. Bruno: `Activities` 48/48, `Event_Programs` 34/34, `Classrooms` 19/19 y `Organizational_Units` 14/14 (todas con sus tests en verde).
- [x] Desviaciones: el request Bruno `Update event program dates that exclude activities returns 409` estaba acoplado al seed y mutaba `start_date` al fallar; se le hizo calcular la fecha desde el detalle del programa y se restauro el dato. El bind mount del contenedor estaba congelado: se sincronizaron 9 archivos con `docker cp` + `restart api`. La primera corrida de `pnpm test` tuvo 9 timeouts bajo carga (52 s); las dos siguientes cerraron 1530/1530 (23-25 s).
