---
title: 'ADR-0010: Estados temporales de actividades derivados al leer'
status: 'Accepted'
date: '2026-10-04'
authors: 'Equipo backend SIPEG UTP'
tags: ['activities', 'temporal', 'status', 'timezone']
supersedes: ''
superseded_by: ''
---

# ADR-0010: Estados temporales de actividades derivados al leer

## Status

**Accepted**

## Context

`ActivityStatus` tiene cinco valores (`DRAFT`, `SCHEDULED`, `ONGOING`, `COMPLETED`,
`CANCELLED`) y la columna `activities.status` los almacena tal cual. Sin embargo,
la API solo escribe tres de ellos: `DRAFT` al crear, `SCHEDULED`/`DRAFT` al
publicar o despublicar y `CANCELLED` al cancelar. `ONGOING` y `COMPLETED` solo
pueden aparecer por seed, por SQL manual o por magia futura: nada los deriva de
la fecha y la hora de la actividad. Una actividad publicada permanecia
`SCHEDULED` para siempre aunque ya hubiera terminado.

Los consumidores leen el valor almacenado de forma literal:

- Los listados y el detalle exponen `status`.
- El filtro `status` y el `when=upcoming|past` de los listados operan por fecha.
- `countEventProgramActivities` agrupa por `status` para `visible` y `byStatus`.
- Las guardas de archivar programa, desactivar unidad y desactivar aula usan el
  status almacenado, y la de archivar tambien vive en el trigger
  `validate_event_program_transition`.
- `updateActivity` y `cancelActivity` deciden con el status almacenado.
- La exclusion GiST `activities_classroom_no_overlap` considera `SCHEDULED` y
  `ONGOING` como reservantes.

El analisis del diagrama ER dejo abiertas dos brechas relacionadas: D15 "Semantica
temporal" (la politica para actividades que cruzan medianoche) y M3 "Temporalidad
incompleta". Ademas, el repositorio no tiene scheduler ni dependencias de colas,
y el ADR-0008 ya rechazo `pg_cron` para la purga de auditoria. La decision
pendiente #6 del plan maestro recomienda derivar los estados al leer para no
introducir un scheduler inicial.

## Decision

`ONGOING` y `COMPLETED` se resuelven al leer y no se persisten por la API. La
columna `status` queda como ciclo de vida base y el estado efectivo se calcula
con la fecha y la hora institucionales de `America/Panama` (ADR-0002).

### Regla de resolucion

| Status almacenado                             | Estado efectivo                                           |
| --------------------------------------------- | --------------------------------------------------------- |
| `DRAFT`                                       | `DRAFT`                                                   |
| `CANCELLED`                                   | `CANCELLED`                                               |
| `SCHEDULED`, `ONGOING` o `COMPLETED` (legacy) | Temporal: `SCHEDULED`, `ONGOING` o `COMPLETED` segun hora |

El estado temporal de una actividad publicada es:

- `now < inicio` -> `SCHEDULED`
- `inicio <= now < fin` -> `ONGOING`
- `now >= fin` -> `COMPLETED`

`inicio` y `fin` se combinan con `date`, `startTime` y `endTime` sobre el dia
institucional. El inicio es inclusivo y el fin es exclusivo. Las actividades son
de un solo dia: `assertActivityTimeRange` ya exige `endTime > startTime`, asi que
una actividad no puede cruzar medianoche y D15 queda cerrada por validacion.

### Alcance

- Los DTOs `ActivityListItem`, `EventProgramActivityItem` y `ActivityDetail`
  exponen el estado efectivo.
- El filtro `status` de los listados usa el estado efectivo (solo para `ADMIN` o
  quien tenga `activity:read`; para el resto se ignora en silencio).
- `countEventProgramActivities` calcula `visible`, `total` y `byStatus` con el
  estado efectivo.
- Las guardas de mutacion usan el estado efectivo: `PATCH` rechaza `ONGOING` y
  `COMPLETED`; cancelar rechaza `COMPLETED`.
- Las guardas de archivar programa adicional, desactivar unidad, desactivar aula
  y `findAvailableClassrooms` bloquean solo con actividades publicadas que aun
  no terminan.
- El trigger `validate_event_program_transition` usa la misma semantica temporal
  en SQL: una actividad publicada que ya termino no bloquea el archivado.

`when=upcoming|past` se mantiene por fecha de calendario (`upcoming` = `date >=
hoy`, `past` = `date <= ayer`), por decision de producto: el consumidor que
quiere el corte temporal exacto usa el filtro `status`.

### Valores legacy

Los valores `ONGOING` y `COMPLETED` almacenados se toleran y se resuelven con la
misma regla temporal, sin migracion de datos ni cambio de seed. La API nunca los
escribe, pero tampoco se normalizan para no chocar con el trigger de actividades
en programas archivados.

## Consequences

### Positive

- **POS-001** No se introduce scheduler, dependencia nueva ni estado en runtime:
  la derivacion es pura y testeable con reloj controlado.
- **POS-002** Una sola fuente de verdad para el corte temporal: el reloj
  institucional, usado por el resolutor y por los predicados de BD.
- **POS-003** Las actividades terminadas dejan de bloquear el archivado de su
  programa y la desactivacion de unidades y aulas.
- **POS-004** El filtro `status` y el `status` de cada item son consistentes
  porque comparten el mismo resolutor.
- **POS-005** Las constraints de BD (exclusion GiST y triggers de actividad)
  siguen operando sobre el status almacenado, que la API mantiene en el
  vocabulario que ya conocen.

### Negative

- **NEG-001** El status almacenado deja de ser la fuente del estado temporal:
  consultas SQL directas, exportaciones crudas o consumidores externos ven el
  ciclo de vida base, no el estado efectivo.
- **NEG-002** Cualquier consumidor nuevo debe reutilizar `activities.status.ts`
  (`resolveActivityStatus`, `buildEffectiveStatusWhere`,
  `buildReservingActivityWhere`) en lugar de filtrar por la columna.
- **NEG-003** La reserva de aulas y la exclusion GiST siguen considerando el
  status almacenado; una actividad pasada con `SCHEDULED` almacenado permanece en
  el indice parcial, aunque su estado efectivo sea `COMPLETED`.

### Neutral

- **NEU-001** Los registros legacy `ONGOING`/`COMPLETED` son validos y se
  resuelven por tiempo; no hay migracion de datos.
- **NEU-002** `when=upcoming` puede incluir una actividad de hoy ya terminada;
  el `status` del item la marca como `COMPLETED`.

## Alternatives Considered

- **ALT-001 Job o scheduler que actualice `status`:** descartado. Exigiria una
  dependencia de runtime, un actor `SYSTEM` para auditoria, manejo de fallos y
  ventanas de drift; el ADR-0008 ya rechazo `pg_cron` por motivos similares y el
  producto no necesita tiempo real.
- **ALT-002 Vista SQL o columna generada:** descartado. Prisma no modela vistas
  con el mismo soporte que tablas y las constraints/triggers vigentes seguirian
  leyendo la columna, creando dos fuentes de verdad.
- **ALT-003 Escritura al leer (lazy materialization):** descartado. Convierte un
  `GET` en una escritura, agrega contencion y rompe la idempotencia esperada de
  las lecturas.
- **ALT-004 Normalizar los estados legacy por migracion:** descartado por ahora.
  El `UPDATE` de `ONGOING`/`COMPLETED` a `SCHEDULED` dispara
  `validate_activity_program` y falla en programas archivados; se prefiere
  tolerarlos.

## Implementation Notes

- **IMP-001** `src/utils/date.ts` agrega `getInstitutionalTimeOfDay` y
  `toInstitutionalInstant`.
- **IMP-002** `src/modules/activities/activities.status.ts` concentra
  `PUBLISHED_ACTIVITY_STATUSES`, `resolveActivityStatus`,
  `buildEffectiveStatusWhere` y `buildReservingActivityWhere`.
- **IMP-003** La migracion `20261004083747_temporal_archive_guard` reemplaza
  `validate_event_program_transition` para comparar
  `("date" + "end_time") > now() AT TIME ZONE 'America/Panama'`.
- **IMP-004** Los servicios de `event-programs`, `classrooms` y
  `organizational-units` aceptan `now` para pruebas deterministas y usan los
  predicados efectivos.

## References

- `docs/superpowers/plans/plan-maestro-sipeg-utp.md` (fase 5.7, decision #6).
- `docs/adr/adr-0002-institutional-timezone-panama.md`.
- `docs/adr/adr-0008-durable-audit-events.md` (rechazo de `pg_cron`).
- `docs/er-diagram/ER-design-justification.md` (D15 y M3).
