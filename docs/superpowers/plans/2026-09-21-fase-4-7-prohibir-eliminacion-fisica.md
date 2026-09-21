# Fase 4.7 - Prohibir eliminacion fisica de programas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que `DELETE /api/v1/event-programs` y `DELETE /api/v1/event-programs/:id` respondan `405 Method Not Allowed` con header `Allow`, sin evaluar autenticacion, y dejar la prohibicion documentada en OpenAPI, Bruno, README y CONTEXT, con prueba del trigger de PostgreSQL.

**Architecture:** Middleware generico `methodNotAllowed(allowedMethods)` en `src/middlewares/` enganchado con `.delete()` al final del router de `event-programs` (no `.all`, para no cambiar el 404 actual de PUT/POST sobre el item). Las operaciones `DELETE` se declaran en OpenAPI con respuesta `405`; Bruno las verifica. Sin migraciones, permisos ni variables de entorno nuevas.

**Tech Stack:** TypeScript 6, Express 5, Prisma 7 (SQL/Postgres), Zod 4, Vitest, Supertest, OpenAPI 3.1 (zod-openapi), Bruno.

**Estado de partida (2026-09-21):**

- No existe ninguna ruta `DELETE` ni llamada `eventProgram.delete*` en `src/` (verificado por grep).
- `DELETE` sobre esos paths cae hoy en `notFoundHandler` -> `404 Route ... not found.`
- Triggers ya existentes: `event_programs_prevent_delete` y `event_programs_prevent_truncate` (`prisma/migrations/20260919053739_initialize_event_program_schema/migration.sql:618-629`).
- Seq maximo actual de Bruno en `Event_Programs` es 32; no hay uso de `res.getHeaders()` en la coleccion.
- 4.6 (`GET /event-programs/:id/activities`) sigue pendiente y no se toca; los cambios de este plan no colisionan con esa futura ruta.

**Decisiones confirmadas con el usuario (2026-09-21):**

1. **405 solo para DELETE** (no `.all`): `PUT`/`POST` en el item conservan el `404` actual.
2. **OpenAPI + Bruno + README/CONTEXT** incluidos.
3. Sin autenticacion en la guarda: el 405 es semantica de metodo, no de identidad (un token invalido o un admin reciben lo mismo).
4. Mensaje estandar `Method not allowed.` con `Allow: GET, POST` (coleccion) y `Allow: GET, PATCH` (item).

**Reglas de negocio:**

- `DELETE /api/v1/event-programs` -> `405` + `Allow: GET, POST`, siempre.
- `DELETE /api/v1/event-programs/:id` -> `405` + `Allow: GET, PATCH`, siempre (id exista o no: sin oraculo de existencia).
- `DELETE` de subrutas legitimas (`/collaborators/:userId`, `/permissions/:permission`) no se ve afectado.
- A nivel BD, `DELETE FROM event_programs` (incluido en cascada) y `TRUNCATE` abortan con la excepcion del trigger.

---

### Task 1: Middleware `methodNotAllowed` (TDD)

**Files:**

- Create: `src/middlewares/methodNotAllowed.middleware.ts`
- Test: `src/middlewares/methodNotAllowed.middleware.test.ts`

- [ ] **Step 1: Escribir la prueba que falla**

```ts
import type { Request, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

import { ApiError } from '../utils/ApiError.js';
import { methodNotAllowed } from './methodNotAllowed.middleware.js';

describe('methodNotAllowed middleware', () => {
  it('sets the Allow header and forwards a 405 error', () => {
    const set = vi.fn();
    const next = vi.fn();

    methodNotAllowed(['GET', 'POST'])({} as Request, { set } as unknown as Response, next);

    expect(set).toHaveBeenCalledWith('Allow', 'GET, POST');
    const error = next.mock.calls[0]?.[0] as ApiError | undefined;
    expect(error).toBeInstanceOf(ApiError);
    expect(error?.statusCode).toBe(405);
    expect(error?.message).toBe('Method not allowed.');
  });
});
```

- [ ] **Step 2: Verificar el rojo**

```bash
pnpm exec vitest run src/middlewares/methodNotAllowed.middleware.test.ts
```

Esperado: falla al importar (`Failed to resolve import ... methodNotAllowed.middleware.js`).

- [ ] **Step 3: Implementar**

`src/middlewares/methodNotAllowed.middleware.ts`:

```ts
import type { RequestHandler } from 'express';

import { ApiError } from '../utils/ApiError.js';

export const methodNotAllowed = (allowedMethods: string[]): RequestHandler => {
  return (_req, res, next) => {
    res.set('Allow', allowedMethods.join(', '));
    next(new ApiError(405, 'Method not allowed.'));
  };
};
```

- [ ] **Step 4: Verificar el verde**

```bash
pnpm exec vitest run src/middlewares/methodNotAllowed.middleware.test.ts
```

Esperado: 1/1 en verde.

---

### Task 2: Guardas DELETE en las rutas (TDD)

**Files:**

- Modify: `src/modules/event-programs/event-programs.routes.ts`
- Test: `src/modules/event-programs/event-programs.routes.test.ts`

- [ ] **Step 1: Escribir las pruebas que fallan**

Agregar dentro de `describe('event program routes', ...)` (antes del cierre), reutilizando `buildServiceMock` y `loadApp`:

```ts
it('rejects deleting an event program with 405 and an Allow header', async () => {
  const service = buildServiceMock();
  const app = await loadApp(service);

  const response = await request(app).delete('/api/v1/event-programs/program-001').expect(405);

  expect(response.headers['allow']).toBe('GET, PATCH');
  expect(response.body).toEqual({ success: false, message: 'Method not allowed.', errors: [] });
  expect(service.updateEventProgram).not.toHaveBeenCalled();
  expect(service.archiveEventProgram).not.toHaveBeenCalled();
  expect(service.reactivateEventProgram).not.toHaveBeenCalled();
});

it('rejects deleting the event program collection with 405 and an Allow header', async () => {
  const service = buildServiceMock();
  const app = await loadApp(service);

  const response = await request(app).delete('/api/v1/event-programs').expect(405);

  expect(response.headers['allow']).toBe('GET, POST');
  expect(response.body).toEqual({ success: false, message: 'Method not allowed.', errors: [] });
  expect(service.createEventProgram).not.toHaveBeenCalled();
  expect(service.listEventPrograms).not.toHaveBeenCalled();
});

it('keeps rejecting deletion for an admin token and for an unknown program', async () => {
  const service = buildServiceMock();
  const prisma = createPrismaMock();
  prisma.user.findUnique.mockResolvedValue(adminRecord);
  const app = await loadApp(service, prisma);

  await request(app)
    .delete('/api/v1/event-programs/program-001')
    .set('Authorization', 'Bearer admin-001')
    .expect(405);
  await request(app).delete('/api/v1/event-programs/does-not-exist').expect(405);

  expect(prisma.user.findUnique).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Verificar el rojo**

```bash
pnpm exec vitest run src/modules/event-programs/event-programs.routes.test.ts
```

Esperado: los 3 fallan con `404` en lugar de `405`.

- [ ] **Step 3: Enganchar las guardas al final de `event-programs.routes.ts`**

Agregar el import:

```ts
import { methodNotAllowed } from '../../middlewares/methodNotAllowed.middleware.js';
```

Y despues de la ultima ruta (`reactivate`):

```ts
eventProgramsRoutes.delete('/event-programs', methodNotAllowed(['GET', 'POST']));

eventProgramsRoutes.delete('/event-programs/:id', methodNotAllowed(['GET', 'PATCH']));
```

- [ ] **Step 4: Verificar el verde del modulo y de los DELETE existentes**

```bash
pnpm exec vitest run src/modules/event-programs
pnpm exec vitest run src/modules/authorization/authorization.routes.test.ts
```

Esperado: todo en verde; en particular siguen pasando los `DELETE /event-programs/:id/collaborators/:userId` y `/permissions/:permission`.

---

### Task 3: Contrato OpenAPI (TDD)

**Files:**

- Modify: `src/modules/event-programs/event-programs.openapi.ts`
- Modify: `src/docs/openapi.test.ts`
- Modify: `openapi.json` (generado)

- [ ] **Step 1: Escribir la prueba de contrato que falla**

En `src/docs/openapi.test.ts`, agregar a `expectedOperations` (el arreglo se ordena con `.sort()`, la posicion no importa):

```ts
  'DELETE /api/v1/event-programs',
  'DELETE /api/v1/event-programs/{id}',
```

Y despues del test de reactivacion (`documents event program reactivation...`):

```ts
it('documents that physical deletion of event programs is not allowed', () => {
  const collectionDelete = openApiDocument.paths?.['/api/v1/event-programs']?.delete;
  const itemDelete = openApiDocument.paths?.['/api/v1/event-programs/{id}']?.delete;

  expect(collectionDelete?.responses?.['405']).toBeDefined();
  expect(collectionDelete?.security).toBeUndefined();
  expect(itemDelete?.responses?.['405']).toBeDefined();
  expect(itemDelete?.security).toBeUndefined();
  const parameters = itemDelete?.parameters ?? [];
  expect(parameters.some((parameter) => 'name' in parameter && parameter.name === 'id')).toBe(true);
});
```

- [ ] **Step 2: Verificar el rojo**

```bash
pnpm exec vitest run src/docs/openapi.test.ts
```

Esperado: fallan el test de operaciones (faltan las dos DELETE) y el nuevo (no existen las operaciones).

- [ ] **Step 3: Declarar las operaciones prohibidas**

En `src/modules/event-programs/event-programs.openapi.ts`, dentro de `'/api/v1/event-programs'` despues de `post`:

```ts
    delete: {
      tags: ['Event Programs'],
      summary: 'Deleting event programs is not allowed',
      description:
        'Event programs are archived, never physically deleted. This operation always responds 405 with an Allow header listing GET and POST; use POST /api/v1/event-programs/{id}/archive to archive a program.',
      responses: {
        405: errorResponse,
      },
    },
```

Y dentro de `'/api/v1/event-programs/{id}'` despues de `patch`:

```ts
    delete: {
      tags: ['Event Programs'],
      summary: 'Deleting an event program is not allowed',
      description:
        'Event programs are archived, never physically deleted. This operation always responds 405 with an Allow header listing GET and PATCH; use POST /api/v1/event-programs/{id}/archive to archive the program.',
      requestParams: { path: eventProgramParamsSchema.shape.params },
      responses: {
        405: errorResponse,
      },
    },
```

- [ ] **Step 4: Regenerar y verificar**

```bash
pnpm run docs:generate
pnpm run docs:check
pnpm exec vitest run src/docs/openapi.test.ts
```

Esperado: `openapi.json` con las dos operaciones `delete` (respuesta 405, sin `security`), `docs:check` sin drift y contrato en verde.

---

### Task 4: Coleccion Bruno

**Files:**

- Create: `bruno/Event_Programs/Deleting an event program returns 405.bru`
- Create: `bruno/Event_Programs/Deleting the event program collection returns 405.bru`

- [ ] **Step 1: `Deleting an event program returns 405.bru` (seq 33)**

```bru
meta {
  name: Deleting an event program returns 405
  type: http
  seq: 33
  tags: [
    Event_Programs
  ]
}

delete {
  url: {{baseUrl}}/api/v1/event-programs/seed_program_foro-ipe
  body: none
  auth: bearer
}

auth:bearer {
  token: {{token}}
}

tests {
  test("physical deletion of an event program is not allowed", function () {
    expect(res.getStatus()).to.equal(405);
    expect(res.getBody().success).to.equal(false);
    expect(res.getBody().message).to.equal("Method not allowed.");
  });
}
```

- [ ] **Step 2: `Deleting the event program collection returns 405.bru` (seq 34)**

```bru
meta {
  name: Deleting the event program collection returns 405
  type: http
  seq: 34
  tags: [
    Event_Programs
  ]
}

delete {
  url: {{baseUrl}}/api/v1/event-programs
  body: none
  auth: none
}

tests {
  test("physical deletion of the program collection is not allowed", function () {
    expect(res.getStatus()).to.equal(405);
    expect(res.getBody().success).to.equal(false);
  });
}
```

- [ ] **Step 3: Correr la carpeta**

```bash
pnpm --dir bruno exec bru run Event_Programs --env local
```

Esperado: 34/34 requests y 31/31 tests en verde (32/29 de 4.5 + 2 requests + 2 tests). Nota: los logins usan buckets de 5/min; si una corrida previa agoto el limite, esperar 60 s.

---

### Task 5: Documentacion

**Files:**

- Modify: `CONTEXT.md` (despues de la linea 159, bullet de reactivate)
- Modify: `README.md` (despues de la linea 276, bullet de reactivate)

- [ ] **Step 1: `CONTEXT.md`**

```md
- La eliminacion fisica de programas no existe en la API: `DELETE /api/v1/event-programs` y `DELETE /api/v1/event-programs/:id` responden `405` con `Allow` (`GET, POST` y `GET, PATCH` respectivamente) sin evaluar autenticacion; los programas se archivan. A nivel de PostgreSQL, los triggers `event_programs_prevent_delete` y `event_programs_prevent_truncate` bloquean cualquier `DELETE` o `TRUNCATE` directo sobre `event_programs`.
```

- [ ] **Step 2: `README.md`**

```md
- La eliminacion fisica de programas de eventos no esta expuesta: `DELETE /api/v1/event-programs` y `DELETE /api/v1/event-programs/:id` responden `405 Method Not Allowed` con el header `Allow` (`GET, POST` y `GET, PATCH` respectivamente) sin evaluar autenticacion; usa `POST /api/v1/event-programs/:id/archive`. Los triggers `event_programs_prevent_delete` y `event_programs_prevent_truncate` rechazan cualquier borrado directo en la base de datos.
```

- [ ] **Step 3: Verificar formato**

```bash
pnpm exec prettier --check CONTEXT.md README.md
```

---

### Task 6: Verificacion E2E real con Docker + psql

**Files:**

- Create temporal: `/tmp/opencode/f47-e2e.mjs` (se elimina al final)

Solo lectura sobre datos: los DELETE de API son rechazados y la prueba del trigger ocurre en una subtransaccion con manejo de excepcion.

- [ ] **Step 1: Confirmar stack y baseline**

```bash
docker ps --format '{{.Names}}'
docker exec sipeg-utp-dev-db-1 psql -U sipeg -d sipeg_utp -t -A -c "SELECT COUNT(*) FROM event_programs;"
grep -rn "eventProgram.delete" src/ || true
```

Esperado: API arriba, conteo de programas (baseline actual) y grep sin resultados.

- [ ] **Step 2: Escribir y correr `/tmp/opencode/f47-e2e.mjs`**

```js
import { execFileSync } from 'node:child_process';

const BASE = 'http://localhost:3000/api/v1';
const DB = 'sipeg-utp-dev-db-1';
const results = [];

const psql = (sql) =>
  execFileSync(
    'docker',
    ['exec', DB, 'psql', '-U', 'sipeg', '-d', 'sipeg_utp', '-t', '-A', '-c', sql],
    { encoding: 'utf8' },
  ).trim();

const check = (name, condition, detail = '') => {
  results.push({ name, pass: Boolean(condition), detail });
  console.log(`${condition ? 'PASS' : 'FAIL'} - ${name}${detail ? ` :: ${detail}` : ''}`);
};

const api = async (method, path, { token } = {}) => {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });

  return {
    status: response.status,
    allow: response.headers.get('allow'),
    body: await response.json().catch(() => null),
  };
};

const login = async (email, password) => {
  const response = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await response.json();
  if (response.status !== 200) throw new Error(`login ${email} -> ${response.status}`);
  return body.data.accessToken;
};

const health = await api('GET', '/health');
check('API health is reachable', health.status === 200, `status=${health.status}`);

const before = Number(psql('SELECT COUNT(*) FROM event_programs;'));
const admin = await login('admin@utp.ac.pa', 'Sipeg2026*UTP');

const item = await api('DELETE', '/event-programs/seed_program_foro-ipe');
check('DELETE item without token responds 405', item.status === 405, `status=${item.status}`);
check('DELETE item Allow lists GET and PATCH', item.allow === 'GET, PATCH', `allow=${item.allow}`);
check(
  'DELETE item uses the standard error body',
  item.body?.success === false && item.body?.message === 'Method not allowed.',
  JSON.stringify(item.body),
);

const itemAdmin = await api('DELETE', '/event-programs/seed_program_foro-ipe', { token: admin });
check(
  'DELETE item with an admin token still responds 405',
  itemAdmin.status === 405 && itemAdmin.allow === 'GET, PATCH',
  `status=${itemAdmin.status} allow=${itemAdmin.allow}`,
);

const itemInvalid = await api('DELETE', '/event-programs/seed_program_foro-ipe', {
  token: 'not-a-real-token',
});
check(
  'DELETE item with an invalid token responds 405 (no auth on the guard)',
  itemInvalid.status === 405,
  `status=${itemInvalid.status}`,
);

const unknown = await api('DELETE', '/event-programs/does-not-exist');
check(
  'DELETE an unknown item also responds 405 (no existence oracle)',
  unknown.status === 405,
  `status=${unknown.status}`,
);

const collection = await api('DELETE', '/event-programs');
check(
  'DELETE collection without token responds 405',
  collection.status === 405,
  `status=${collection.status}`,
);
check(
  'DELETE collection Allow lists GET and POST',
  collection.allow === 'GET, POST',
  `allow=${collection.allow}`,
);

const collectionAdmin = await api('DELETE', '/event-programs', { token: admin });
check(
  'DELETE collection with an admin token still responds 405',
  collectionAdmin.status === 405 && collectionAdmin.allow === 'GET, POST',
  `status=${collectionAdmin.status} allow=${collectionAdmin.allow}`,
);

const collaborators = await api(
  'DELETE',
  '/event-programs/seed_program_congreso-cit/collaborators/anything',
);
check(
  'DELETE collaborators subpath is not swallowed by the guard (401 without token)',
  collaborators.status === 401,
  `status=${collaborators.status}`,
);

let triggerBlocked = false;
let triggerDetail = '';
try {
  psql(
    "DO $$ BEGIN DELETE FROM event_programs WHERE id = 'seed_program_foro-ipe'; RAISE EXCEPTION 'trigger did not block the delete'; EXCEPTION WHEN OTHERS THEN IF strpos(SQLERRM, 'event programs cannot be deleted') = 0 THEN RAISE; END IF; END $$;",
  );
  triggerBlocked = true;
} catch (error) {
  triggerDetail = String(error.stderr ?? error.message).slice(0, 200);
}
check('PostgreSQL trigger blocks a direct DELETE', triggerBlocked, triggerDetail);

const after = Number(psql('SELECT COUNT(*) FROM event_programs;'));
check('event_programs count is unchanged', before === after, `${before} -> ${after}`);

const failed = results.filter((result) => !result.pass);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length === 0 ? 0 : 1);
```

Ejecutar:

```bash
node /tmp/opencode/f47-e2e.mjs
```

Esperado: todos `PASS` y exit code 0, con el conteo de `event_programs` intacto.

- [ ] **Step 3: Eliminar el script temporal**

```bash
rm /tmp/opencode/f47-e2e.mjs
```

---

### Task 7: Gates finales y actualizacion del plan maestro

**Files:**

- Modify: `docs/superpowers/plans/plan-maestro-sipeg-utp.md`

- [ ] **Step 1: Correr los gates**

```bash
pnpm test
pnpm run typecheck
pnpm run lint
pnpm run build
pnpm run format:check
pnpm run docs:check
```

Esperado: todo en verde. Si `format:check` falla solo por archivos de sesiones concurrentes ajenas (p. ej. 4.6), registrar la excepcion con el archivo exacto.

- [ ] **Step 2: Actualizar el plan maestro**

1. Fila de Programas (linea 23): `Parcial: 4.1-4.5 y 4.7 implementados; falta 4.6`.
2. Marcar `- [x] **4.7 Prohibir eliminacion fisica.**`.
3. Anadir a la linea de "Endpoints existentes" (linea 28): la eliminacion fisica de programas no esta expuesta (`405` con `Allow`).
4. Insertar el registro despues del bloque de 4.5 (linea 502) y antes de `**Criterio de salida:**` (linea 504), completando con la evidencia real:

```md
**Registro de ejecucion (2026-09-21 - 4.7):**

- [x] Plan detallado en `docs/superpowers/plans/2026-09-21-fase-4-7-prohibir-eliminacion-fisica.md` con ciclo TDD rojo/verde en middleware (1 prueba), rutas (3) y contrato OpenAPI (1 prueba nueva + listado de operaciones).
- [x] Decisiones confirmadas con el usuario: `405` explicito solo para `DELETE` (PUT/POST conservan 404), header `Allow` (`GET, POST` en la coleccion y `GET, PATCH` en el item), sin autenticacion en la guarda y documentacion en OpenAPI, Bruno, README y CONTEXT.
- [x] Implementacion: middleware `methodNotAllowed(allowedMethods)` + `.delete()` al final del router; operaciones `DELETE` en OpenAPI con respuesta `405`; sin migraciones, permisos ni variables de entorno nuevas.
- [x] Pruebas: (completar con el total real de `pnpm test`, archivos y gates).
- [x] Verificacion real (stack Docker + psql, script temporal eliminado): (completar con los checks del E2E, incluido el trigger `event_programs_prevent_delete` y el conteo intacto).
- [x] Bruno: (completar con requests/tests y resultado de `bru run Event_Programs --env local`).
- [x] Contrato: `openapi.json` regenerado sin drift con las dos operaciones `DELETE` prohibidas (respuesta 405, sin `security`).
- [x] Documentacion: README y CONTEXT describen el 405, el header `Allow` y los triggers de BD.
- [x] Sin commit: el usuario no lo solicito.
```

---

## Self-review del plan

- **Cobertura de 4.7:** "no exponer DELETE" (Tasks 1-2), "documentar 404/405" (Tasks 3-5), garantia de BD y evidencia (Task 6), cierre (Task 7).
- **Sin placeholders:** todo el codigo de produccion/pruebas/Bruno/E2E esta completo; solo los `(completar)` del registro dependen de la ejecucion.
- **Consistencia:** `methodNotAllowed(['GET','POST'])` / `(['GET','PATCH'])` coincide con los `Allow` que afirman rutas, E2E y OpenAPI; el 405 documentado no declara `security`, consistente con la guarda sin auth.
- **Riesgos/notas:** concurrencia con la sesion 4.6 (mismos archivos `event-programs.routes.ts`, `.openapi.ts`, `openapi.test.ts`, `openapi.json` y carpeta Bruno): re-leer antes de editar, usar anclas unicas, no tocar seq <=32 y re-ejecutar `docs:generate` tras los edits. Un `DELETE` con token invalido responde 405 (no 401) por diseno: el metodo no existe para el recurso; queda documentado y cubierto.
