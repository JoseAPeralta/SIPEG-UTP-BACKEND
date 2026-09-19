---
title: "ADR-0002: Zona horaria institucional America/Panama"
status: "Accepted"
date: "2026-09-19"
authors: "Equipo backend SIPEG UTP"
tags: ["architecture", "datetime", "institutional"]
supersedes: ""
superseded_by: ""
---

# ADR-0002: Zona horaria institucional America/Panama

## Status

**Accepted**

## Context

El diseno ER de SIPEG UTP dejo pendiente la definicion de la zona horaria institucional (D15 y supuesto 7.6): los programas adicionales usan fechas de calendario, las actividades usan fecha y horas locales, y la auditoria usa instantes con zona horaria. Las reglas de negocio del producto (rango de fechas de programas, filtro de actividades proximas, disponibilidad de aulas y reportes) necesitan una referencia unica de calendario.

La institucion opera en Panama, cuya zona horaria es `America/Panama` (UTC-5) y no aplica horario de verano. El servidor y PostgreSQL almacenan instantes en UTC (`Timestamptz`), mientras que `activities.date` es `@db.Date` (fecha de calendario sin hora).

## Decision

`America/Panama` (UTC-5, sin DST) es la zona horaria institucional de SIPEG UTP para toda logica de calendario de negocio.

- La fecha de calendario se calcula con `Intl.DateTimeFormat` usando `timeZone: 'America/Panama'` en `src/utils/date.ts`, sin hardcodear el offset numerico.
- Para comparar contra columnas `@db.Date` se construye un instante a medianoche UTC de la fecha institucional (`startOfInstitutionalDay`), de modo que el valor de fecha enviado a Prisma sea inequivoco.
- Los instantes de auditoria (`createdAt`, `updatedAt`, `issuedAt`, `grantedAt`, etc.) permanecen en UTC con `Timestamptz`, como ya define el ER.
- La aplicacion de la zona institucional a otras reglas de calendario (rango de programas, disponibilidad de aulas, reportes) es obligatoria a medida que esos modulos se implementen.

## Consequences

### Positive

- **POS-001**: Una unica referencia de calendario elimina discrepancias entre filtros, reportes y validaciones de fechas.
- **POS-002**: Panama no tiene DST, por lo que el offset es estable y no requiere tablas de transiciones ni recalculo estacional.
- **POS-003**: Usar `Intl` mantiene la decision testeable y reversible sin dependencias nuevas.
- **POS-004**: Los instantes de auditoria siguen en UTC, preservando comparaciones globales y orden correcto.

### Negative

- **NEG-001**: La logica de fecha de negocio y los timestamps de auditoria operan en zonas distintas; el codigo debe ser explicito sobre cual aplica.
- **NEG-002**: Si la institucion operara en varias zonas, habria que introducir una variable de configuracion; hoy el valor es fijo.
- **NEG-003**: `activity.startTime`/`endTime` son horas locales de la institucion sin zona embebida; una futura actividad en otra zona requeriria modelado adicional.

## Alternatives Considered

### UTC puro

- **ALT-001**: **Description**: Interpretar todas las fechas y horas de negocio en UTC.
- **ALT-002**: **Rejection Reason**: Los eventos de la institucion se planifican en hora local; un evento de las 20:00 en Panama se mostraria como del dia siguiente en UTC.

### Offset configurable por variable de entorno

- **ALT-003**: **Description**: Definir `INSTITUTIONAL_TIMEZONE` en `.env` con default `America/Panama`.
- **ALT-004**: **Rejection Reason**: No hay escenario multi-region hoy; se puede agregar despues sin cambiar la logica, usando el valor fijo como default.

### Libreria dedicada de zonas horarias

- **ALT-005**: **Description**: Agregar `date-fns-tz` o similar para conversion y aritmetica de fechas.
- **ALT-006**: **Rejection Reason**: `Intl.DateTimeFormat` nativo cubre la necesidad sin sumar dependencias.

## Implementation Notes

- **IMP-001**: `src/utils/date.ts` expone `INSTITUTIONAL_TIME_ZONE`, `getInstitutionalDateKey` y `startOfInstitutionalDay`.
- **IMP-002**: `listUpcomingActivities` en `src/modules/activities/activities.service.ts` usa `startOfInstitutionalDay(now)` para el filtro `date >= hoy`. (La ruta y el modulo se renombraron de `events` a `activities`; el nombre oficial del recurso es actividad.)
- **IMP-003**: Tests de borde en `src/utils/date.test.ts` cubren el cambio de dia a las 05:00 UTC (medianoche en Panama).
- **IMP-004**: Criterio de exito: un instante `2026-09-20T03:00:00Z` (19 sep 22:00 en Panama) filtra desde `2026-09-19`.

## References

- **REF-001**: `docs/er-diagram/ER-design-justification.md` (D15, supuesto 7.6).
- **REF-002**: `docs/superpowers/plans/2026-09-19-authorization-strategy.md`.
- **REF-003**: IANA Time Zone Database, zona `America/Panama`.
