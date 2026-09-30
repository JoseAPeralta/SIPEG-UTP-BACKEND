---
title: 'ADR-0008: Bitacora durable de auditoria append-only en PostgreSQL'
status: 'Accepted'
date: '2026-09-26'
authors: 'Equipo backend SIPEG UTP'
tags: ['architecture', 'security', 'audit', 'prisma']
supersedes: ''
superseded_by: ''
---

# ADR-0008: Bitacora durable de auditoria append-only en PostgreSQL

## Status

**Accepted**

## Context

SIPEG UTP necesita trazabilidad atribuible de las acciones sensibles
(privilegios, cuentas y ciclos de vida de recursos), pero hoy no existe una
auditoria durable:

- El unico rastro de actor son `EventProgram.createdById` y
  `CollaborationPermission.grantedById`/`grantedAt`. Este ultimo no es historico:
  cambiar de rol borra y recrea grants, el `upsert` sobrescribe la atribucion,
  revocar elimina la fila y borrar al colaborador la elimina por cascada.
- El diseno ER (`docs/er-diagram/ER-design-justification.md`) y el plan maestro
  dejan la auditoria general como pendiente.
- Varias mutaciones ya usan transacciones Prisma interactivas, lo que da un punto
  natural para insertar el evento en la misma transaccion que la mutacion.
- Better Auth atiende `/api/auth/*` directamente (`src/app.ts`), de modo que
  puede mutar usuarios y sesiones sin pasar por los servicios propios; esas
  operaciones no son atomicas con un insert de auditoria a nivel aplicacion.
- La politica de trabajo exige no exponer ni registrar tokens, contrasenas,
  hashes, numeros de identificacion ni datos personales innecesarios.

Los logs de Loki son diagnostico operativo con retencion acotada; no son
evidencia durable ni permiten reconstruir quien cambio que con garantia de
integridad.

## Decision

Crear una bitacora durable append-only en PostgreSQL, separada de los logs:

- **Modelo `AuditEvent`:** `id` (cuid), `action`, `occurredAt`
  (`Timestamptz(3)` UTC), `actorType` (`USER`/`ANONYMOUS`/`SYSTEM`), `actorId`,
  `resourceType`, `resourceId`, `scopeType`, `scopeId`, `targetUserId`,
  `requestId`, `changes` (JSON) y `metadata` (JSON).
- **Atomicidad:** el writer `writeAuditEvent(tx, input)` recibe obligatoriamente
  un `Prisma.TransactionClient`; no usa el cliente global. La mutacion y el
  evento se confirman o revierten juntos.
- **Immutabilidad:** una trigger PostgreSQL rechaza `UPDATE`, `DELETE` y
  `TRUNCATE` sobre `audit_events`, siguiendo el patron ya usado para
  `event_programs_prevent_delete`/`_truncate`.
- **Catalogo:** `action` es `String` con una union de literales en TypeScript, no
  un enum PostgreSQL, para poder evolucionar el catalogo sin migraciones.
- **Acciones auditadas:** en orden de prioridad, (1) delegacion
  (colaboradores y permisos), (2) cuentas (creacion admin, rol, activacion) y
  credenciales (cambio de contrasena, revocacion de sesiones), (3) ciclos de vida
  (unidades, programas, actividades, aulas, carreras) y (4) catalogos.
- **Payload:** solo cambios expresamente permitidos con formato old/new; nunca
  contrasenas, hashes, tokens, headers `Authorization`, cuerpos completos,
  numeros de identificacion ni emails.
- **Consulta:** `GET /api/v1/audit-events` de solo lectura, protegido con
  `authenticate -> requireAdmin`. No se exponen endpoints de modificacion ni
  eliminacion. Los campos internos de auditoria no aparecen en las respuestas de
  los modulos de dominio.
- **Retencion:** 365 dias propuestos como linea base, sujetos a ratificacion por
  politica institucional/legal. La purga no se automatiza hasta ratificarse y es
  un procedimiento administrativo privilegiado; el runtime no puede borrar.
- **Better Auth:** la cobertura de sus operaciones internas se limita a hooks
  post-exito cuando el sujeto se identifique con certeza; se documenta que no hay
  atomicidad con esas operaciones. Los fallos de login/reset van a Loki, no a
  `audit_events`.

  Decisiones de la instrumentacion de esa frontera (fase 11):

  - **El hook no escribe; identifica.** `emailVerification.afterEmailVerification`
    y `emailAndPassword.onPasswordReset` solo anotan el `userId` en un marcador
    creado por la llamada en curso. La escritura ocurre en el servicio, cuando la
    llamada del proveedor ya termino bien.
  - **La razon del indireccion es `revokeSessionsOnPasswordReset`.**
    `onPasswordReset` corre despues de cambiar la contrasena pero **antes** de
    revocar las sesiones. Escribir auditoria dentro del hook convertiria un fallo
    de la bitacora en sesiones sin revocar: el titular tendria una contrasena
    nueva creyendo que cerro el resto de sus accesos.
  - **El marcador es por llamada, no global.** Viaja en un `AsyncLocalStorage` con
    un objeto propio por invocacion, de modo que dos resets simultaneos no pueden
    intercambiarse el sujeto.
  - **Un fallo de auditoria no revierte la operacion.** La mutacion ya ocurrio y es
    irreversible desde la aplicacion; perderla por un insert caido seria peor que
    la linea que falta. El error se reporta como `audit.write.failed`
    (`logType: application`) y el flujo continua. Consecuencia asumida: puede
    existir una operacion exitosa sin su linea en la bitacora.
  - **Actor = sujeto.** Registro, verificacion y reset son flujos publicos sin
    sesion. El unico identificador con certeza es el del usuario afectado, asi que
    `actorId` es ese mismo id; atribuir la accion a un `SYSTEM` o a un
    administrador sugeriria una intervencion que nadie hizo.
  - **`user.registered` se escribe tras confirmar la persistencia**, no al recibir
    la respuesta del proveedor: auditar un alta que no llego a la base dejaria un
    evento sin sujeto real.

## Consequences

### Positive

- **POS-001**: El historial de privilegios y cuentas sobrevive a
  re-grants, revocaciones y eliminaciones de filas mutables.
- **POS-002**: La atomicidad en la misma transaccion evita evidencia huerfana o
  acciones sin registro.
- **POS-003**: La trigger append-only aporta integridad a nivel de base de datos,
  no solo por convencion de codigo.
- **POS-004**: La separacion de Loki mantiene la retencion operativa corta y la
  auditoria con retencion larga y acceso restringido.
- **POS-005**: El modelo no expone `grantedById`/`grantedAt` en HTTP, preservando
  la minimizacion ya decidida en ADR-0001.

### Negative

- **NEG-001**: Aumenta el volumen de escritura y el tamano de PostgreSQL; la
  retencion debe administrarse.
- **NEG-002**: Cada mutacion instrumentada gana una escritura adicional dentro de
  su transaccion, con leve costo de latencia.
- **NEG-003**: Las operaciones de Better Auth no pueden auditarse atomicamente sin
  una transaccion compartida; la cobertura de esa frontera queda parcial. En
  concreto, `user.registered`, `auth.email_verified` y `auth.password_reset` se
  escriben **despues** de que la mutacion se aplique y con su propia transaccion:
  una caida entre ambos deja la operacion hecha sin su registro. Se eligio esa
  direccion porque la alternativa (escribir dentro del hook) puede impedir la
  revocacion de sesiones.
- **NEG-004**: Los mocks de Prisma y los tests de rutas deben extenderse
  (`auditEvent.create` y `$transaction`), ampliando el mantenimiento.
- **NEG-005**: La purga por retencion queda pendiente de ratificacion; hasta
  entonces no se elimina automaticamente.

## Alternatives Considered

### Usar Loki como fuente de auditoria

- **ALT-001**: **Description**: Considerar los eventos de seguridad en Loki como
  bitacora de cambios.
- **ALT-002**: **Rejection Reason**: Los logs no son transaccionales con la
  mutacion, tienen retencion corta y no garantizan integridad; no sirven como
  evidencia durable.

### Auditar mediante logging de Prisma y middleware

- **ALT-003**: **Description**: Registrar cambios con un middleware que inspecciona
  el body y el resultado de cada request.
- **ALT-004**: **Rejection Reason**: No conoce reglas de negocio, no distingue
  no-ops idempotentes y no comparte la transaccion; produce eventos incompletos o
  duplicados.

### Trigger de base de datos que audite automaticamente todo `UPDATE`/`DELETE`

- **ALT-005**: **Description**: Auditar a nivel de tabla con triggers genericos.
- **ALT-006**: **Rejection Reason**: Capturaria columnas sensibles (password,
  tokens), no entiende contexto de negocio (accion, scope, actor) y complica
  excluir cambios internos y seeds.

### Mantener `grantedById`/`grantedAt` como auditoria suficiente

- **ALT-007**: **Description**: Extender los campos actuales de los grants.
- **ALT-008**: **Rejection Reason**: Son mutables y se eliminan por cascada; no
  conservan historial tras revocar o cambiar de rol.

### Tabla de auditoria mutable con permisos de borrado para la aplicacion

- **ALT-009**: **Description**: Permitir que el runtime limpie registros por
  retencion.
- **ALT-010**: **Rejection Reason**: Un compromiso de la aplicacion permitiria
  borrar evidencia; la purga debe ser un procedimiento privilegiado y separado.

## Implementation Notes

- **IMP-001**: Archivos clave a crear: `src/modules/audit/audit.types.ts`,
  `audit.service.ts`, `src/utils/audit-context.ts` y la migracion
  `add_durable_audit_events` con la trigger append-only.
- **IMP-002**: Los servicios reciben un `AuditContext` construido desde
  `req.user` y `req.id`; no acoplan dominio a Express.
- **IMP-003**: Reutilizar las transacciones existentes en
  `delegation.service.ts`, `users.service.ts`, `auth.service.ts`,
  `organizational-units.service.ts`, `careers.service.ts` y las que se agreguen
  en programas/actividades/aulas.
- **IMP-004**: Afirmar en tests un unico evento por transicion real, ninguno en
  fallos de validacion/autorizacion y ninguno en no-ops idempotentes.
- **IMP-005**: Criterio de exito: rollback conjunto probado con base aislada,
  trigger append-only verificada y `GET /api/v1/audit-events` solo para `ADMIN`.

## References

- **REF-001**: `docs/superpowers/plans/logging-y-auditoria.md`.
- **REF-002**: `docs/adr/adr-0007-structured-logging-and-observability.md`.
- **REF-003**: `docs/adr/adr-0001-time-aware-collaboration-authorization.md`
  (minimizacion de `grantedById`/`grantedAt` en HTTP).
- **REF-004**: `docs/er-diagram/ER-design-justification.md` (auditoria pendiente).
- **REF-005**: `prisma/migrations/20260919053739_initialize_event_program_schema/`
  (patron de trigger de inmutabilidad).
