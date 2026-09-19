---
title: "ADR-0001: Autorizacion por colaboracion con ventanas temporales y delegacion atenuada"
status: "Accepted"
date: "2026-09-19"
authors: "Equipo backend SIPEG UTP"
tags: ["architecture", "security", "authorization"]
supersedes: ""
superseded_by: ""
---

# ADR-0001: Autorizacion por colaboracion con ventanas temporales y delegacion atenuada

## Status

**Accepted**

## Context

SIPEG UTP modela la autorizacion con `GlobalRole` (`USER`, `ADMIN`), colaboraciones por scope (`Collaboration` sobre programa o actividad), `CollaborationRole` (`ORGANIZER`, `EDITOR`, `VIEWER`) y un catalogo granular de `Permission` unido a cada colaboracion. Los permisos del programa se heredan de forma aditiva en sus actividades.

El producto requiere ademas:

- Otorgar permisos especificos a un colaborador para una unica actividad, por ejemplo un estudiante que registra asistencia solo durante un evento.
- Limitar la vigencia del permiso ("valido para siempre o hasta fecha y hora especifica").
- Permitir que un colaborador autorizado delegue permisos en otros sin escalar privilegios.

El repositorio trabaja con Node.js 24, Express 5, Prisma 7.10 sobre PostgreSQL 18, TypeScript estricto y Vitest. La regla de trabajo pide no agregar dependencias sin una razon concreta cuando el stack existente resuelve el problema.

## Decision

Se implementa una capa de autorizacion tipada sobre Prisma, sin motor de politicas externo, con estas reglas:

- La vigencia vive por permiso en `CollaborationPermission` (`valid_from`, `valid_until`); `NULL` significa sin limite de ese lado. Los grants vencidos se ignoran al calcular permisos y nunca se borran (historico).
- `ROLE_DEFAULT` materializa los defaults del rol al crear una colaboracion; `OVERRIDE` registra ajustes finos. Cambiar de rol reemplaza los `ROLE_DEFAULT` y preserva los `OVERRIDE`.
- El permiso efectivo en un scope es la union aditiva de las colaboraciones de la actividad y de su programa padre, filtrada por ventana vigente. `ADMIN` hace bypass total.
- `permission:grant` es el unico permiso de delegacion y no forma parte de ningun default de rol. Habilita agregar/quitar colaboradores, cambiar rol y otorgar/revocar permisos.
- Invariante de subconjunto simetrico: otorgar, revocar y asignar rol exigen que el conjunto actuado este contenido en los permisos efectivos del actor en el mismo scope.
- Atenuacion temporal: la ventana otorgada debe quedar contenida en el envelope de grants del actor para ese permiso. Un envelope acotado prohibe grants sin limite.
- Sin ampliacion de scope: un permiso de actividad no permite gestionar el programa padre.
- Cada grant registra `granted_by_id` y `granted_at` para auditoria de la delegacion.

## Consequences

### Positive

- **POS-001**: El modelo relacional existente es la unica fuente de verdad; no hay politicas duplicadas en un DSL ni sincronizacion adicional.
- **POS-002**: Las ventanas temporales se expresan como columnas y se resuelven con una funcion pura testeable, sin dependencias nuevas.
- **POS-003**: La delegacion atenuada evita escalada de privilegios por nombre, por scope y por tiempo, y deja rastro auditable del delegante.
- **POS-004**: La herencia aditiva mantiene el principio de D16 del diseno ER: no se copian permisos entre programa y actividad.

### Negative

- **NEG-001**: Sin efecto `DENY`, no se puede revocar localmente en una actividad un permiso heredado del programa; solo se puede omitir el grant local.
- **NEG-002**: La materializacion de defaults por rol no es retroactiva: cambiar `ROLE_DEFAULTS` requiere backfill explicito.
- **NEG-003**: La atenuacion temporal usa un envelope conservador (inicio mas temprano, fin mas tardio). Un actor con multiples ventanas disjuntas puede otorgar dentro de la envolvente aunque no cubra un hueco intermedio.
- **NEG-004**: Las verificaciones por recurso agregan consultas a Prisma por request autorizado; no hay cache distribuida.

## Alternatives Considered

### CASL (`@casl/ability`)

- **ALT-001**: **Description**: DSL de reglas con `defineAbility` y `ability.can(action, subject)` construido desde las colaboraciones del usuario.
- **ALT-002**: **Rejection Reason**: Las condiciones comparan campos del subject, no el reloj, por lo que las ventanas temporales exigen inyectar `now()` o pre-filtrar. Ademas no elimina las consultas a la base de datos.

### Casbin / Oso

- **ALT-003**: **Description**: Motores de politicas con RBAC/ABAC, matchers temporales y administracion de politicas.
- **ALT-004**: **Rejection Reason**: Duplican `permissions` y `collaborations` del schema, agregan sincronizacion de politicas y un DSL extra sin aportar sobre consultas relacionales ya modeladas.

### RBAC puro con `CollaborationRole` sin catalogo granular

- **ALT-005**: **Description**: Autorizar unicamente por rol (`VIEWER`, `EDITOR`, `ORGANIZER`) ignorando la tabla `Permission`.
- **ALT-006**: **Rejection Reason**: No permite permisos de una sola actividad ni vigencia temporal por permiso, requisitos explicitos del producto.

## Implementation Notes

- **IMP-001**: Archivos clave: `src/modules/authorization/permissions.ts` (catalogo y defaults), `authorization.service.ts` (permisos efectivos y envelopes), `delegation.service.ts` (invariantes de delegacion), `src/middlewares/authorize.middleware.ts` (`requirePermission`).
- **IMP-002**: La migracion `add_collaboration_permission_temporal_fields` agrega `source`, `valid_from`, `valid_until`, `granted_by_id`, `granted_at`, indices y un CHECK `valid_until > valid_from`. El seed `prisma/seed.ts` puebla el catalogo de forma idempotente.
- **IMP-003**: Orden recomendado en rutas privadas: `authenticate -> requirePermission -> validate -> controller`. Los guardas de negocio (archivado, programa activo) permanecen en servicios.
- **IMP-004**: Criterio de exito: tests de catalogo, resolutor, delegacion y middleware en verde; `pnpm run typecheck`, `pnpm run lint` y `pnpm run build` limpios.

## References

- **REF-001**: `docs/er-diagram/ER-design-justification.md` (D16 herencia de permisos, D22 trazabilidad administrativa).
- **REF-002**: `docs/superpowers/plans/2026-09-19-authorization-strategy.md`.
- **REF-003**: OWASP API Security Top 10 (API1 y API5, broken object/function level authorization).
