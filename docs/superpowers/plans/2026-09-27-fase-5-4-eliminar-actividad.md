# Fase 5.4 - Eliminar actividad Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar `DELETE /api/v1/activities/:id` con permiso `activity:delete` en el scope, borrado fisico limitado a actividades `DRAFT` de programas `ACTIVE` sin registros retenidos, y auditoria durable de la eliminacion.

**Architecture:** Se extiende el modulo autocontenido `src/modules/activities/` (schemas, servicio, controlador, rutas, OpenAPI y pruebas) y el catalogo canonico `src/modules/authorization/permissions.ts`. Una migracion agrega el permiso `activity:delete`, materializa el default de `ORGANIZER` en colaboraciones existentes y agrega un trigger `BEFORE DELETE` sobre `activities` que exige `DRAFT` y programa `ACTIVE` (defensa en profundidad de la regla de retencion). El servicio usa un `deleteMany` condicional dentro de la misma transaccion que escribe el evento de auditoria, de modo que una carrera entre lectura y escritura no pueda borrar una actividad que dejo de ser elegible.

**Tech Stack:** TypeScript, Express 5, Prisma 7 (PostgreSQL), Zod 4, Vitest, Supertest, OpenAPI 3.1 (zod-openapi), Bruno.

**Decisiones confirmadas con el usuario (2026-09-27):**

1. **Autorizacion:** permiso dedicado `activity:delete` (no reutilizar `activity:cancel`, no limitar a `ADMIN`).
2. **Default de rol:** `ORGANIZER` solamente. `EDITOR` y `VIEWER` no lo incluyen (un borrado fisico es mas destructivo que una actualizacion).
3. **Programa archivado:** un `DRAFT` sin registros de un programa `ARCHIVED` (o `DRAFT`) responde `409`, conservando la regla acordada en 5.2/5.3 de que archivar congela sus actividades.
4. **Retencion:** cualquier referencia retenida bloquea. Asistencia y alertas se validan explicitamente con mensajes propios; la FK `ON DELETE RESTRICT` de PostgreSQL es la red de seguridad final.
5. **Respuesta exitosa:** `204 No Content` sin cuerpo.
6. **Auditoria:** accion `activity.deleted` registrada en la misma transaccion que el borrado.

**Reglas de negocio (orden de guardas del servicio):**

1. Actividad inexistente -> `404 Activity not found.`
2. `status !== DRAFT` -> `409 Only DRAFT activities can be deleted.`
3. Programa no `ACTIVE` -> `409 Event programs must be active to delete their activities.`
4. Con asistencia -> `409 Activities with attendance records cannot be deleted.`
5. Con alertas -> `409 Activities with alert records cannot be deleted.`
6. Transaccion: `deleteMany` condicional + `writeAuditEvent`.

**Defensa en profundidad de retencion:**

- `attendance.activity_id` y `alerts.activity_id` usan `ON DELETE RESTRICT`: la base de datos bloquea el borrado aunque la API no lo detecte.
- `activity_equipment`, `activity_speakers` y `collaborations` usan `ON DELETE CASCADE`: se limpian solas.
- El catalogo `speakers` NO se borra (vive fuera de la actividad).
- Trigger `activities_prevent_delete`: rechaza estados distintos de `DRAFT` y programas no `ACTIVE`, cerrando el `DELETE` directo por SQL.

**Hallazgos de partida (2026-09-27):**

- `PERMISSIONS.ACTIVITY_DELETE` no existe. `ROLE_DEFAULTS.ORGANIZER` ya incluye `activity:cancel`; el nuevo permiso se agrega al final de la lista para no alterar defaults de otros roles.
- `attendance.certificates` usa `ON DELETE RESTRICT` sobre `attendance`, pero como toda asistencia bloquea el borrado, esa ruta es inalcanzable via API.
- El arbol tiene trabajo concurrente sin commitear (`src/modules/audit/`, migraciones de audit, docs). Baseline verificado antes de empezar: `pnpm test` 1198 pruebas / 7 skip en 55 archivos, `typecheck`, `lint`, `build` y `docs:check` en verde.
- La carpeta Bruno `Activities` tiene `seq` duplicados (dos juegos 17-23) por la importacion destructiva de 5.1. 5.4 agrega sus requests con `seq` 24+ sin renumerar los existentes.

---

### Task 1: Permiso `activity:delete` y trigger de retencion

**Files:**

- Modify: `src/modules/authorization/permissions.ts`
- Modify: `src/modules/authorization/permissions.test.ts`
- Create: `prisma/migrations/20260927184500_add_activity_delete_permission_and_retention_guard/migration.sql`

- [ ] **Step 1: Escribir la prueba que falla**

En `src/modules/authorization/permissions.test.ts`, agregar al final de `describe('permission catalog')`:

```ts
it('grants activity:delete only to organizers', () => {
  expect(PERMISSIONS.ACTIVITY_DELETE).toBe('activity:delete');
  expect(PERMISSION_DESCRIPTIONS[PERMISSIONS.ACTIVITY_DELETE]).toBeTruthy();
  expect(ROLE_DEFAULTS.ORGANIZER).toContain(PERMISSIONS.ACTIVITY_DELETE);
  expect(ROLE_DEFAULTS.EDITOR).not.toContain(PERMISSIONS.ACTIVITY_DELETE);
  expect(ROLE_DEFAULTS.VIEWER).not.toContain(PERMISSIONS.ACTIVITY_DELETE);
});
```

- [ ] **Step 2: Verificar el rojo**

Run: `pnpm exec vitest run src/modules/authorization/permissions.test.ts`

Expected: falla porque `PERMISSIONS.ACTIVITY_DELETE` no existe (TypeError / undefined).

- [ ] **Step 3: Implementar el permiso**

En `src/modules/authorization/permissions.ts`, despues de `ACTIVITY_CANCEL: 'activity:cancel',`:

```ts
  ACTIVITY_DELETE: 'activity:delete',
```

En `PERMISSION_DESCRIPTIONS`, despues de la linea de `ACTIVITY_CANCEL`:

```ts
  [PERMISSIONS.ACTIVITY_DELETE]: 'Eliminar actividades en borrador sin registros.',
```

En `ROLE_DEFAULTS.ORGANIZER`, despues de `PERMISSIONS.ACTIVITY_CANCEL,`:

```ts
    PERMISSIONS.ACTIVITY_DELETE,
```

- [ ] **Step 4: Verde**

Run: `pnpm exec vitest run src/modules/authorization/permissions.test.ts`

Expected: todas en verde. El test `escalates role defaults monotonically` sigue pasando porque `EDITOR` no recibe el permiso nuevo.

- [ ] **Step 5: Escribir la migracion**

Crear `prisma/migrations/20260927184500_add_activity_delete_permission_and_retention_guard/migration.sql`:

```sql
-- 5.4 Destructive activity deletion: dedicated permission plus a database
-- retention guard. The API already refuses non DRAFT activities and archived
-- programs; the trigger closes the direct SQL path.

INSERT INTO "permissions" ("name", "description")
VALUES ('activity:delete', 'Eliminar actividades en borrador sin registros.')
ON CONFLICT ("name") DO UPDATE SET "description" = EXCLUDED."description";

-- Materialize the new ORGANIZER default for existing collaborations. The grant
-- has no author because it is a system backfill, not a delegation by a user.
INSERT INTO "collaboration_permissions" (
    "collaboration_id", "permission_id", "granted_at", "granted_by_id",
    "source", "valid_from", "valid_until"
)
SELECT
    c."id",
    p."id",
    CURRENT_TIMESTAMP,
    NULL,
    'ROLE_DEFAULT',
    NULL,
    NULL
FROM "collaborations" c
CROSS JOIN "permissions" p
WHERE p."name" = 'activity:delete'
  AND c."role" = 'ORGANIZER'
ON CONFLICT ("collaboration_id", "permission_id") DO NOTHING;

CREATE FUNCTION "prevent_activity_delete"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    program_status "ProgramStatus";
BEGIN
    IF OLD."status" <> 'DRAFT' THEN
        RAISE EXCEPTION 'only DRAFT activities can be deleted'
            USING ERRCODE = '23514';
    END IF;

    -- Lock the parent program so a concurrent archival cannot slip through
    -- between the check and the delete.
    SELECT "status"
    INTO STRICT program_status
    FROM "event_programs"
    WHERE "id" = OLD."event_program_id"
    FOR UPDATE;

    IF program_status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'activities can only be deleted in an active event program'
            USING ERRCODE = '23514';
    END IF;

    RETURN OLD;
END;
$$;

CREATE TRIGGER "activities_prevent_delete"
BEFORE DELETE ON "activities"
FOR EACH ROW
EXECUTE FUNCTION "prevent_activity_delete"();
```

- [ ] **Step 6: Validar y aplicar la migracion**

Run:

```bash
pnpm prisma:validate
pnpm prisma:migrate:dev
pnpm prisma:migrate:status
```

Expected: `Database schema is up to date!`.

Nota: `prisma migrate dev` puede pedir nombre de migracion si el directorio ya existe con un `migration.sql` vacio. Si eso ocurre, usar el nombre `add_activity_delete_permission_and_retention_guard`; el directorio y el SQL ya estan escritos por el paso 5, asi que Prisma solo debe aplicar y registrar.

- [ ] **Step 7: Verificacion SQL del backfill y del trigger**

Run:

```bash
docker compose -f compose.dev.yaml exec -T db psql -U sipeg -d sipeg_utp -c "SELECT c.role, count(*) FROM collaborations c JOIN collaboration_permissions cp ON cp.collaboration_id = c.id JOIN permissions p ON p.id = cp.permission_id WHERE p.name = 'activity:delete' GROUP BY c.role;"
docker compose -f compose.dev.yaml exec -T db psql -U sipeg -d sipeg_utp -c "SELECT p.name, p.description FROM permissions p WHERE p.name = 'activity:delete';"
```

Expected primera consulta: solo filas `ORGANIZER`. Segunda: una fila con la descripcion en espanol.

- [ ] **Step 8: Verificacion SQL del trigger (rojo y verde)**

Run:

```bash
docker compose -f compose.dev.yaml exec -T db psql -U sipeg -d sipeg_utp -c "DELETE FROM activities WHERE id = 'seed_activity_fic-charla-puentes';"
```

Expected: `ERROR: only DRAFT activities can be deleted` (la actividad del seed es `COMPLETED`).

Run (DRAFT de programa activo, con rollback):

```bash
docker compose -f compose.dev.yaml exec -T db psql -U sipeg -d sipeg_utp -c "BEGIN; DELETE FROM activities WHERE id = 'seed_activity_fic-taller-acuatica-draft'; ROLLBACK;"
```

Expected: `DELETE 1` seguido de `ROLLBACK`, confirmando que un `DRAFT` de programa `ACTIVE` si se puede borrar.

- [ ] **Step 9: Verificar que el trigger bloquea con programa archivado**

Run:

```bash
docker compose -f compose.dev.yaml exec -T db psql -U sipeg -d sipeg_utp -c "SELECT a.id, a.status, ep.status FROM activities a JOIN event_programs ep ON ep.id = a.event_program_id WHERE a.status = 'DRAFT' AND ep.status <> 'ACTIVE';"
```

Expected: cero filas (el seed no tiene borradores en programas no activos). Si apareciera alguna, el paso 8 de la verificacion real de la fase cubre el `409`.

---

### Task 2: Accion de auditoria y servicio `deleteActivity` (TDD)

**Files:**

- Modify: `src/modules/audit/audit.types.ts`
- Modify: `src/modules/activities/activities.service.ts`
- Test: `src/modules/activities/activities.service.test.ts`

- [ ] **Step 1: Escribir las pruebas que fallan**

En `src/modules/activities/activities.service.test.ts`, al final del archivo:

```ts
interface DeletePrismaMock {
  activity: {
    findUnique: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
  };
  attendance: { count: ReturnType<typeof vi.fn> };
  alert: { count: ReturnType<typeof vi.fn> };
  auditEvent: { create: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
}

const createDeletePrismaMock = (): DeletePrismaMock => {
  const prisma: DeletePrismaMock = {
    activity: { findUnique: vi.fn(), deleteMany: vi.fn() },
    attendance: { count: vi.fn() },
    alert: { count: vi.fn() },
    auditEvent: { create: vi.fn().mockResolvedValue({ id: 'audit-001' }) },
    $transaction: vi.fn(),
  };

  prisma.$transaction.mockImplementation(
    async (callback: (client: DeletePrismaMock) => Promise<unknown>) => callback(prisma),
  );

  return prisma;
};

const loadDeleteService = async (prisma: DeletePrismaMock) => {
  vi.resetModules();
  vi.doMock('../../config/prisma.js', () => ({ getPrismaClient: () => prisma }));

  return import('./activities.service.js');
};

const deletableActivity = () => ({
  id: 'activity-001',
  status: 'DRAFT' as const,
  eventProgram: { id: 'program-001', status: 'ACTIVE' as const },
});

const isForeignKeyViolation = (error: unknown): boolean => {
  const candidate = error as { code?: unknown; message?: unknown };

  return (
    candidate.code === 'P2003' ||
    (typeof candidate.message === 'string' && candidate.message.includes('23503'))
  );
};

describe('deleteActivity', () => {
  afterEach(() => {
    vi.doUnmock('../../config/prisma.js');
  });

  it('throws 404 when the activity does not exist', async () => {
    const prisma = createDeletePrismaMock();
    prisma.activity.findUnique.mockResolvedValue(null);
    const { deleteActivity } = await loadDeleteService(prisma);

    await expect(deleteActivity('missing')).rejects.toMatchObject({
      statusCode: 404,
      message: 'Activity not found.',
    });
    expect(prisma.activity.deleteMany).not.toHaveBeenCalled();
  });

  it.each(['SCHEDULED', 'ONGOING', 'COMPLETED', 'CANCELLED'] as const)(
    'rejects deleting a %s activity with 409',
    async (status) => {
      const prisma = createDeletePrismaMock();
      prisma.activity.findUnique.mockResolvedValue({ ...deletableActivity(), status });
      const { deleteActivity } = await loadDeleteService(prisma);

      await expect(deleteActivity('activity-001')).rejects.toMatchObject({
        statusCode: 409,
        message: 'Only DRAFT activities can be deleted.',
      });
      expect(prisma.activity.deleteMany).not.toHaveBeenCalled();
    },
  );

  it.each(['ARCHIVED', 'DRAFT'] as const)(
    'rejects deleting when the program is %s with 409',
    async (programStatus) => {
      const prisma = createDeletePrismaMock();
      prisma.activity.findUnique.mockResolvedValue({
        ...deletableActivity(),
        eventProgram: { id: 'program-001', status: programStatus },
      });
      const { deleteActivity } = await loadDeleteService(prisma);

      await expect(deleteActivity('activity-001')).rejects.toMatchObject({
        statusCode: 409,
        message: 'Event programs must be active to delete their activities.',
      });
      expect(prisma.activity.deleteMany).not.toHaveBeenCalled();
    },
  );

  it('rejects an activity with attendance records with 409', async () => {
    const prisma = createDeletePrismaMock();
    prisma.activity.findUnique.mockResolvedValue(deletableActivity());
    prisma.attendance.count.mockResolvedValue(3);
    const { deleteActivity } = await loadDeleteService(prisma);

    await expect(deleteActivity('activity-001')).rejects.toMatchObject({
      statusCode: 409,
      message: 'Activities with attendance records cannot be deleted.',
    });
    expect(prisma.attendance.count).toHaveBeenCalledWith({
      where: { activityId: 'activity-001' },
    });
    expect(prisma.alert.count).not.toHaveBeenCalled();
    expect(prisma.activity.deleteMany).not.toHaveBeenCalled();
  });

  it('rejects an activity with alert records with 409', async () => {
    const prisma = createDeletePrismaMock();
    prisma.activity.findUnique.mockResolvedValue(deletableActivity());
    prisma.attendance.count.mockResolvedValue(0);
    prisma.alert.count.mockResolvedValue(1);
    const { deleteActivity } = await loadDeleteService(prisma);

    await expect(deleteActivity('activity-001')).rejects.toMatchObject({
      statusCode: 409,
      message: 'Activities with alert records cannot be deleted.',
    });
    expect(prisma.activity.deleteMany).not.toHaveBeenCalled();
  });

  it('deletes a clean DRAFT activity with a conditional delete and returns nothing', async () => {
    const prisma = createDeletePrismaMock();
    prisma.activity.findUnique.mockResolvedValue(deletableActivity());
    prisma.attendance.count.mockResolvedValue(0);
    prisma.alert.count.mockResolvedValue(0);
    prisma.activity.deleteMany.mockResolvedValue({ count: 1 });
    const { deleteActivity } = await loadDeleteService(prisma);

    await expect(deleteActivity('activity-001')).resolves.toBeUndefined();

    expect(prisma.activity.deleteMany).toHaveBeenCalledWith({
      where: {
        id: 'activity-001',
        status: 'DRAFT',
        eventProgram: { status: 'ACTIVE' },
        attendance: { none: {} },
        alerts: { none: {} },
      },
    });
  });

  it('writes a single activity.deleted event in the same transaction', async () => {
    const prisma = createDeletePrismaMock();
    prisma.activity.findUnique.mockResolvedValue(deletableActivity());
    prisma.attendance.count.mockResolvedValue(0);
    prisma.alert.count.mockResolvedValue(0);
    prisma.activity.deleteMany.mockResolvedValue({ count: 1 });
    const { deleteActivity } = await loadDeleteService(prisma);

    await deleteActivity('activity-001', {
      actorId: 'user-001',
      actorType: 'USER',
      requestId: 'req-300',
    });

    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(prisma.auditEvent.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'activity.deleted',
        actorId: 'user-001',
        resourceType: 'activity',
        resourceId: 'activity-001',
        scopeType: 'event_program',
        scopeId: 'program-001',
        requestId: 'req-300',
        changes: { before: { status: 'DRAFT' } },
      }),
    });
  });

  it('does not audit a deletion rejected by the status guard', async () => {
    const prisma = createDeletePrismaMock();
    prisma.activity.findUnique.mockResolvedValue({
      ...deletableActivity(),
      status: 'SCHEDULED',
    });
    const { deleteActivity } = await loadDeleteService(prisma);

    await expect(deleteActivity('activity-001')).rejects.toMatchObject({ statusCode: 409 });

    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it('surfaces the conflict when the conditional delete matches no row', async () => {
    const prisma = createDeletePrismaMock();
    prisma.activity.findUnique.mockResolvedValue(deletableActivity());
    prisma.attendance.count.mockResolvedValue(0);
    prisma.alert.count.mockResolvedValue(0);
    prisma.activity.deleteMany.mockResolvedValue({ count: 0 });
    const { deleteActivity } = await loadDeleteService(prisma);

    await expect(deleteActivity('activity-001')).rejects.toMatchObject({
      statusCode: 409,
      message: 'The activity changed while it was being deleted. Retry the request.',
    });
    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it('translates a foreign key violation raised by a concurrent insert into a 409', async () => {
    const prisma = createDeletePrismaMock();
    prisma.activity.findUnique.mockResolvedValue(deletableActivity());
    prisma.attendance.count.mockResolvedValue(0);
    prisma.alert.count.mockResolvedValue(0);
    prisma.activity.deleteMany.mockRejectedValue(
      Object.assign(new Error('Foreign key constraint violated'), { code: 'P2003' }),
    );
    const { deleteActivity } = await loadDeleteService(prisma);

    await expect(deleteActivity('activity-001')).rejects.toMatchObject({
      statusCode: 409,
      message: 'The activity changed while it was being deleted. Retry the request.',
    });
    expect(prisma.auditEvent.create).not.toHaveBeenCalled();
  });

  it('reverts the deletion when the audit insert fails', async () => {
    const prisma = createDeletePrismaMock();
    prisma.activity.findUnique.mockResolvedValue(deletableActivity());
    prisma.attendance.count.mockResolvedValue(0);
    prisma.alert.count.mockResolvedValue(0);
    prisma.activity.deleteMany.mockResolvedValue({ count: 1 });
    prisma.auditEvent.create.mockRejectedValue(new Error('audit insert failed'));
    const { deleteActivity } = await loadDeleteService(prisma);

    await expect(deleteActivity('activity-001')).rejects.toThrow('audit insert failed');
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Verificar el rojo**

Run: `pnpm exec vitest run src/modules/activities/activities.service.test.ts`

Expected: falla porque `deleteActivity` no esta exportado (todos los casos nuevos).

- [ ] **Step 3: Implementar la accion de auditoria**

En `src/modules/audit/audit.types.ts`, agregar `'activity.deleted',` despues de `'activity.cancelled',` en `AUDIT_ACTIONS`.

- [ ] **Step 4: Implementar el servicio**

En `src/modules/activities/activities.service.ts`, agregar despues de `isExclusionViolation` (reutilizando el patron de deteccion de errores de BD):

```ts
const isRetentionConflict = (error: unknown): boolean => {
  if (typeof error !== 'object' || error === null) {
    return false;
  }

  const candidate = error as { code?: unknown; message?: unknown; meta?: { code?: unknown } };

  return (
    candidate.code === 'P2003' ||
    candidate.meta?.code === 'P2003' ||
    (typeof candidate.message === 'string' && candidate.message.includes('23503')) ||
    (typeof candidate.message === 'string' &&
      candidate.message.includes('only DRAFT activities can be deleted')) ||
    (typeof candidate.message === 'string' &&
      candidate.message.includes('activities can only be deleted in an active event program'))
  );
};

const DELETION_CONFLICT_MESSAGE =
  'The activity changed while it was being deleted. Retry the request.';
```

Y al final del archivo:

```ts
export const deleteActivity = async (
  id: string,
  auditContext: AuditContext = {},
): Promise<void> => {
  const prisma = getPrismaClient();

  const current = await prisma.activity.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      eventProgram: { select: { id: true, status: true } },
    },
  });

  if (!current) {
    throw new ApiError(404, 'Activity not found.');
  }
  if (current.status !== 'DRAFT') {
    throw new ApiError(409, 'Only DRAFT activities can be deleted.');
  }
  if (current.eventProgram.status !== 'ACTIVE') {
    throw new ApiError(409, 'Event programs must be active to delete their activities.');
  }

  const [enrolledCount, alertCount] = await Promise.all([
    prisma.attendance.count({ where: { activityId: id } }),
    prisma.alert.count({ where: { activityId: id } }),
  ]);

  if (enrolledCount > 0) {
    throw new ApiError(409, 'Activities with attendance records cannot be deleted.');
  }
  if (alertCount > 0) {
    throw new ApiError(409, 'Activities with alert records cannot be deleted.');
  }

  await prisma.$transaction(async (tx) => {
    const deleted = await tx.activity
      .deleteMany({
        where: {
          id,
          status: 'DRAFT',
          eventProgram: { status: 'ACTIVE' },
          attendance: { none: {} },
          alerts: { none: {} },
        },
      })
      .catch((error: unknown) => {
        if (isRetentionConflict(error)) {
          throw new ApiError(409, DELETION_CONFLICT_MESSAGE);
        }
        throw error;
      });

    if (deleted.count !== 1) {
      throw new ApiError(409, DELETION_CONFLICT_MESSAGE);
    }

    await writeAuditEvent(tx, {
      ...auditContext,
      action: 'activity.deleted',
      resourceType: 'activity',
      resourceId: id,
      scopeType: 'event_program',
      scopeId: current.eventProgram.id,
      changes: { before: { status: 'DRAFT' } },
    });
  });
};
```

Nota: `changes.before.status` usa la clave permitida `status` de `AUDIT_ALLOWED_SNAPSHOT_KEYS`, por lo que `assertAuditPayload` acepta el payload.

- [ ] **Step 5: Verde**

Run: `pnpm exec vitest run src/modules/activities/activities.service.test.ts src/modules/audit`

Expected: todas en verde.

---

### Task 3: Controlador y ruta (TDD)

**Files:**

- Modify: `src/modules/activities/activities.controller.ts`
- Modify: `src/modules/activities/activities.routes.ts`
- Test: `src/modules/activities/activities.routes.test.ts`

- [ ] **Step 1: Escribir las pruebas que fallan**

En `activities.routes.test.ts`, agregar `deleteActivity: vi.fn()` a la interfaz `ActivitiesServiceMock` y a `buildServiceMock`. Al final del archivo:

```ts
describe('activity delete route', () => {
  it('rejects delete requests without a token', async () => {
    const service = buildServiceMock();
    const app = await loadApp({ service });

    await request(app).delete('/api/v1/activities/activity-002').expect(401);
    expect(service.deleteActivity).not.toHaveBeenCalled();
  });

  it('rejects delete requests when the user lacks activity:delete', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(userRecord);
    const authorization: AuthorizationMock = {
      getEffectivePermissions: vi.fn().mockResolvedValue(new Set(['activity:update'])),
    };
    const app = await loadApp({ service, prisma, authorization });

    await request(app)
      .delete('/api/v1/activities/activity-002')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(403);

    expect(authorization.getEffectivePermissions).toHaveBeenCalledWith(userRecord, {
      activityId: 'activity-002',
    });
    expect(service.deleteActivity).not.toHaveBeenCalled();
  });

  it('deletes a DRAFT activity for a collaborator with activity:delete', async () => {
    const service = buildServiceMock();
    service.deleteActivity.mockResolvedValue(undefined);
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(userRecord);
    const authorization: AuthorizationMock = {
      getEffectivePermissions: vi.fn().mockResolvedValue(new Set(['activity:delete'])),
    };
    const app = await loadApp({ service, prisma, authorization });

    const response = await request(app)
      .delete('/api/v1/activities/activity-002')
      .set('Authorization', `Bearer ${userToken}`)
      .expect(204);

    expect(service.deleteActivity).toHaveBeenCalledWith('activity-002', auditContext('user-001'));
    expect(response.body).toEqual({});
  });

  it('deletes a DRAFT activity for an admin without a permission lookup', async () => {
    const service = buildServiceMock();
    service.deleteActivity.mockResolvedValue(undefined);
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const authorization: AuthorizationMock = {
      getEffectivePermissions: vi.fn().mockResolvedValue(new Set()),
    };
    const app = await loadApp({ service, prisma, authorization });

    await request(app)
      .delete('/api/v1/activities/activity-002')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(204);

    expect(authorization.getEffectivePermissions).not.toHaveBeenCalled();
    expect(service.deleteActivity).toHaveBeenCalledWith('activity-002', auditContext('admin-001'));
  });

  it('rejects a blank activity id on delete before the service', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const app = await loadApp({ service, prisma });

    await request(app)
      .delete('/api/v1/activities/%20')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(400);

    expect(service.deleteActivity).not.toHaveBeenCalled();
  });

  it('propagates the service 404 and 409 retention errors on delete', async () => {
    const service = buildServiceMock();
    const prisma = createPrismaMock();
    prisma.user.findUnique.mockResolvedValue(adminRecord);
    const app = await loadApp({ service, prisma });
    const { ApiError } = await import('../../utils/ApiError.js');

    service.deleteActivity.mockRejectedValue(new ApiError(404, 'Activity not found.'));
    await request(app)
      .delete('/api/v1/activities/missing')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(404);

    service.deleteActivity.mockRejectedValue(
      new ApiError(409, 'Only DRAFT activities can be deleted.'),
    );
    const conflict = await request(app)
      .delete('/api/v1/activities/activity-002')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(409);

    expect(conflict.body).toMatchObject({
      success: false,
      message: 'Only DRAFT activities can be deleted.',
    });
  });
});
```

- [ ] **Step 2: Verificar el rojo**

Run: `pnpm exec vitest run src/modules/activities/activities.routes.test.ts`

Expected: `404` en las rutas nuevas y `service.deleteActivity` inexistente.

- [ ] **Step 3: Implementar el controlador**

En `activities.controller.ts`, importar `deleteActivity as deleteActivityService` desde el servicio y agregar:

```ts
export const deleteActivity: RequestHandler = asyncHandler(async (req, res) => {
  const { id } = req.params as ActivityParams;

  await deleteActivityService(id, toAuditContext(req));

  res.status(204).send();
});
```

- [ ] **Step 4: Implementar la ruta**

En `activities.routes.ts`, importar `deleteActivity` del controlador y `PERMISSIONS` ya esta importado. Agregar despues del `PATCH`:

```ts
activitiesRoutes.delete(
  '/activities/:id',
  authenticate,
  requirePermission(PERMISSIONS.ACTIVITY_DELETE, activityScope),
  validate(activityParamsSchema),
  deleteActivity,
);
```

El orden importa: la ruta `DELETE /activities/:id` no colisiona con `POST /activities/:id/cancel` porque Express distingue metodo y segmento.

- [ ] **Step 5: Verde**

Run: `pnpm exec vitest run src/modules/activities`

Expected: todas en verde.

---

### Task 4: Contrato OpenAPI (TDD)

**Files:**

- Modify: `src/modules/activities/activities.openapi.ts`
- Test: `src/docs/openapi.test.ts`
- Generated: `openapi.json`

- [ ] **Step 1: Escribir las pruebas que fallan**

En `src/docs/openapi.test.ts`, agregar `'DELETE /api/v1/activities/{id}'` a `expectedOperations` y:

```ts
it('documents the activity deletion with bearer security and its retention conflicts', () => {
  const operation = openApiDocument.paths?.['/api/v1/activities/{id}']?.delete;
  const parameters = operation?.parameters ?? [];
  const names = parameters.map((parameter) => ('name' in parameter ? parameter.name : undefined));

  expect(operation?.security).toEqual([{ bearerAuth: [] }]);
  expect(names).toContain('id');
  expect(operation?.requestBody).toBeUndefined();
  expect(operation?.responses?.['204']).toBeDefined();
  expect(operation?.responses?.['400']).toBeDefined();
  expect(operation?.responses?.['401']).toBeDefined();
  expect(operation?.responses?.['403']).toBeDefined();
  expect(operation?.responses?.['404']).toBeDefined();
  expect(operation?.responses?.['409']).toBeDefined();
});
```

- [ ] **Step 2: Verificar el rojo**

Run: `pnpm exec vitest run src/docs/openapi.test.ts`

Expected: falla porque la operacion no existe.

- [ ] **Step 3: Implementar**

En `activities.openapi.ts`, agregar `delete` dentro de `'/api/v1/activities/{id}'`, despues de `patch`:

```ts
    delete: {
      tags: ['Activities'],
      summary: 'Delete a draft activity',
      description:
        'Physically deletes an activity. Requires the activity:delete permission on the activity scope (or the ADMIN role); it is a default of ORGANIZER only. Retention rule: only DRAFT activities of ACTIVE event programs can be deleted, and the activity must have no attendance records and no alert records, otherwise the endpoint responds 409. Attendance and alerts are retained data protected by ON DELETE RESTRICT, so an activity with history is cancelled instead of deleted. Equipment, speaker links and local collaborations are removed by cascade; the speakers catalog entry is kept. Archived event programs are frozen and their activities respond 409.',
      security: [{ bearerAuth: [] }],
      requestParams: { path: activityParamsSchema.shape.params },
      responses: {
        204: { description: 'Activity deleted successfully.' },
        400: errorResponse,
        401: errorResponse,
        403: errorResponse,
        404: errorResponse,
        409: errorResponse,
      },
    },
```

- [ ] **Step 4: Regenerar y verificar**

Run:

```bash
pnpm run docs:generate
pnpm exec vitest run src/docs/openapi.test.ts
pnpm run docs:check
```

Expected: sin drift y pruebas en verde.

---

### Task 5: Coleccion Bruno

**Files:**

- Create: `bruno/Activities/Create a draft activity to delete.bru`
- Create: `bruno/Activities/Delete a draft activity without a token returns 401.bru`
- Create: `bruno/Activities/Delete a draft activity as a user without permission returns 403.bru`
- Create: `bruno/Activities/Delete a published activity returns 409.bru`
- Create: `bruno/Activities/Delete an unknown activity returns 404.bru`
- Create: `bruno/Activities/Delete a draft activity.bru`
- Create: `bruno/Activities/Get a deleted activity returns 404.bru`
- Modify: `bruno/environments/local.bru` (agregar `deletableActivityId`)

- [ ] **Step 1: Crear el borrador eliminable (seq 24)**

`bruno/Activities/Create a draft activity to delete.bru`:

```bru
meta {
  name: Create a draft activity to delete
  type: http
  seq: 24
  tags: [Activities]
}

post {
  url: {{baseUrl}}/api/v1/activities
  body: json
  auth: bearer
}

auth:bearer {
  token: {{token}}
}

body:json {
  {
    "name": "Actividad temporal fase 5.4",
    "type": "SEMINAR",
    "date": "2026-12-18",
    "startTime": "09:00",
    "endTime": "11:00",
    "eventProgramId": "seed_program_fic_default",
    "equipment": ["Proyector"]
  }
}

script:post-response {
  const body = res.getBody();

  if (body?.success && body.data?.id) {
    bru.setVar("deletableActivityId", body.data.id);
  }
}

tests {
  test("a deletable DRAFT is created", function () {
    expect(res.getStatus()).to.equal(201);
    const body = res.getBody();
    expect(body.data.status).to.equal("DRAFT");
    expect(body.data.enrolledCount).to.equal(0);
    expect(body.data.checkedInCount).to.equal(0);
  })
}
```

- [ ] **Step 2: Crear los requests de rechazo (seq 25-28)**

Siguen el patron existente. Detalles clave:

- `Delete a draft activity without a token returns 401` (seq 25): `auth: none`, url `{{deletableActivityId}}`, assert `401`.
- `Delete a draft activity as a user without permission returns 403` (seq 26): `auth:bearer { token: {{userToken}} }`, assert `403` y `success === false`.
- `Delete a published activity returns 409` (seq 27): url `{{seedActivityId}}` con `token`, assert `409` y mensaje `Only DRAFT activities can be deleted.`.
- `Delete an unknown activity returns 404` (seq 28): url `{{unknownActivityId}}`, assert `404` y mensaje `Activity not found.`.

- [ ] **Step 3: Crear la eliminacion y la verificacion (seq 29-30)**

`bruno/Activities/Delete a draft activity.bru` (seq 29):

```bru
meta {
  name: Delete a draft activity
  type: http
  seq: 29
  tags: [Activities]
}

delete {
  url: {{baseUrl}}/api/v1/activities/{{deletableActivityId}}
  body: none
  auth: bearer
}

auth:bearer {
  token: {{token}}
}

tests {
  test("a clean DRAFT is deleted with 204 and no body", function () {
    expect(res.getStatus()).to.equal(204);
    expect(res.getBody()).to.equal(null);
  })
}
```

`bruno/Activities/Get a deleted activity returns 404.bru` (seq 30): `GET` de `{{deletableActivityId}}` con `token`, assert `404`.

- [ ] **Step 4: Agregar la variable de entorno**

En `bruno/environments/local.bru`, despues de `draftActivityId:`:

```
  deletableActivityId:
```

- [ ] **Step 5: Correr la carpeta**

Run: `pnpm --dir bruno exec bru run Activities --env local`

Expected: requests y tests en verde. Si el rate limit de login molesta, aislar con `X-Forwarded-For` como en fases previas. La carpeta deja un borrador nuevo por corrida (`deletableActivityId` se elimina al final, `draftActivityId` queda como en fases anteriores y se limpia con psql).

---

### Task 6: Documentacion y plan maestro

**Files:**

- Modify: `README.md`
- Modify: `CONTEXT.md`
- Modify: `docs/superpowers/plans/plan-maestro-sipeg-utp.md`

- [ ] **Step 1: README**

En la seccion `### Actividades`, agregar despues de la linea de `POST /api/v1/activities/:id/cancel`:

```
- `DELETE /api/v1/activities/:id` (privado) elimina fisicamente una actividad y requiere el permiso `activity:delete` en el scope de la actividad (o rol `ADMIN`); `activity:delete` es un permiso por defecto de `ORGANIZER` y no lo tienen `EDITOR` ni `VIEWER`. Responde `204` sin cuerpo. **Regla de retencion:** solo se eliminan actividades `DRAFT` de programas `ACTIVE` sin asistencia y sin alertas; cualquier otro caso responde `409` (`Only DRAFT activities can be deleted.`, `Event programs must be active to delete their activities.`, `Activities with attendance records cannot be deleted.`, `Activities with alert records cannot be deleted.`), por lo que una actividad con historia se cancela en lugar de borrarse. El equipo, los vinculos de ponentes y las colaboraciones locales se eliminan por cascada, pero la ficha del catalogo de ponentes se conserva. El trigger `activities_prevent_delete` de PostgreSQL rechaza el borrado directo por SQL de estados distintos de `DRAFT` y de programas no `ACTIVE`.
```

En `### Datos Base De Produccion (Seed Base)`, cambiar `19 claves` por `20 claves`.

- [ ] **Step 2: CONTEXT**

En la seccion `### Programas De Eventos Y Actividades`, agregar la misma regla en version resumida despues de la linea de cancelacion, y actualizar la linea del catalogo de permisos si aplica.

- [ ] **Step 3: Plan maestro**

- Marcar 5.4 `[x]`.
- Actualizar la fila de Actividades del "Estado actual" a `5.1-5.4 implementados; faltan 5.5-5.8`.
- Agregar `DELETE /api/v1/activities/:id` a "Endpoints existentes".
- Agregar `Registro de ejecucion (2026-09-27 - 5.4)` con plan, migracion, pruebas, verificacion real, Bruno, contrato, docs, hallazgos y gates.

---

### Task 7: Verificacion real con Docker + psql

- [ ] **Step 1: Preparar el stack**

Run: `docker compose -f compose.dev.yaml up -d` y esperar salud. Login admin y guardar token.

- [ ] **Step 2: E2E de la API**

Comprobar:

1. `DELETE` de `seed_activity_fic-charla-puentes` (`COMPLETED`) -> `409 Only DRAFT activities can be deleted.`
2. Crear un `DRAFT` limpio -> eliminarlo -> `204`; `GET` posterior -> `404`.
3. Crear un `DRAFT` con un colaborador local y un ponente -> eliminarlo -> `204`; verificar en psql que `activity_equipment`, `activity_speakers` y `collaborations` quedaron en 0 y que el ponente del catalogo sigue existiendo.
4. Sin token -> `401`; `estudiante01` -> `403`.
5. Actividad inexistente -> `404`; id en blanco -> `400`.
6. Organizador con `activity:delete` heredado del programa -> `204`.

- [ ] **Step 3: E2E de retencion con psql**

7. Crear un `DRAFT` e insertar una fila en `attendance` -> `DELETE` -> `409 Activities with attendance records cannot be deleted.` (y la fila sigue).
8. Crear un `DRAFT` e insertar una fila en `alerts` -> `DELETE` -> `409 Activities with alert records cannot be deleted.`
9. Crear un `DRAFT` en un programa archivado temporal -> `DELETE` -> `409 Event programs must be active to delete their activities.`
10. Intento de borrado directo por SQL de una actividad `COMPLETED` -> error del trigger.

- [ ] **Step 4: Auditoria y limpieza**

11. `SELECT action, resource_type, resource_id FROM audit_events WHERE action = 'activity.deleted'` devuelve la fila del borrado, y la actividad ya no existe.
12. Limpiar todas las filas temporales y restaurar los conteos base del seed.

---

### Task 8: Gates finales

- [ ] `pnpm test`
- [ ] `pnpm run typecheck`
- [ ] `pnpm run lint`
- [ ] `pnpm run build`
- [ ] `pnpm run format:check` (los archivos de 5.4 deben pasar; reportar solo archivos ajenos)
- [ ] `pnpm run docs:generate` y `pnpm run docs:check`
- [ ] `pnpm prisma:validate` y `pnpm prisma:migrate:status`

---

## Estado de ejecucion

Ejecutado el 2026-09-27. Los pasos de arriba se dejan sin marcar a proposito: es la convencion de los planes de Fase 5 (5.1 a 5.4 registran 0 pasos marcados) y el registro con la evidencia vive en el plan maestro, en `Registro de ejecucion (2026-09-27 - 5.4)`.

Resultado: los 8 tasks completados, 40/40 comprobaciones reales en verde y los gates finales en verde.

### Desviaciones respecto al plan

1. **Permiso con id determinista.** El paso 5 de Task 1 omitio la columna `id` en el `INSERT` de `permissions`. El SQL aplicado usa `('perm_activity_delete', 'activity:delete', ...)` para que la migracion sea replayable; el seed base hace upsert por nombre, asi que nunca colisiona. El `ON CONFLICT ("name")` del plan se conservo.
2. **El fixture de programa archivado se creo al reves.** Task 7 paso 3 asumia insertar directamente un `DRAFT` en un programa `ARCHIVED`, pero el trigger `validate_activity_program` lo rechaza (`activities can only be created or scheduled in an active event program`). La secuencia correcta es crear el programa y el `DRAFT` con el programa en `ACTIVE`, y archivarlos despues con `UPDATE event_programs SET status = 'ARCHIVED'`. La regla de negocio verificada (409 y trigger) no cambia; cambia como se arma el fixture.
3. **Tipo de alerta para fixtures con `activity_id`.** Una alerta ligada a una actividad debe usar `AlertType.ACTIVITY_CANCELLED`; los tipos `PROPOSAL_*` violan el check `alerts_target_check`, que exige propuesta o actividad y no admite ambas.
4. **Columnas obligatorias de un programa adicional.** `event_programs_metadata_check` exige `created_by_id` y, en programas no default, `start_date`/`end_date`. Los fixtures de las notas de verificacion los omitian y el `INSERT` fallaba en bloque.
5. **Residuos de Bruno.** El paso 5 de Task 5 asumia que `draftActivityId` "queda y se limpia con psql". Tras el trigger de retencion, esa limpieza ya no es un `DELETE` directo: exige deshabilitar `activities_prevent_delete` en una transaccion. Quedo registrado como `P3` (coleccion idempotente) y `P1` (procedimiento de purga) en el plan maestro.

### Problemas abiertos

Los hallazgos `F5.4-A` a `F5.4-D` y los problemas de tooling detectados durante la ejecucion estan consolidados como pendientes accionables `P1` a `P6` en el bloque `Problemas abiertos y cierre de Fase 5` del plan maestro. La fase no puede declararse cerrada hasta que 5.5-5.8 esten implementados y esos pendientes se resuelvan.
