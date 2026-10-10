---
title: 'ADR-0011: Descubrimiento de scopes propios por colaboracion'
status: 'Accepted'
date: '2026-10-04'
authors: 'Equipo backend SIPEG UTP'
tags: ['authorization', 'collaboration', 'scopes', 'api-contract']
supersedes: ''
superseded_by: ''
---

# ADR-0011: Descubrimiento de scopes propios por colaboracion

## Status

**Accepted** — implementa y confirma el contrato que el frontend propuso como ADR-0014.

## Context

- Las colaboraciones otorgan permisos sobre programas de eventos y actividades. Un
  colaborador autenticado necesita descubrir todos los scopes en los que puede
  trabajar sin conocer identificadores de antemano.
- `GET /api/v1/users/me/permissions?scope=program|activity&id=` (Fase 3.7) responde
  solo para un scope que el llamador ya conoce.
- Con Bearer, `GET /event-programs` devuelve programas `ACTIVE` y
  `GET /activities` el conjunto publico. Una colaboracion sobre un scope `DRAFT`,
  `CANCELLED` o `ARCHIVED` no se puede descubrir por esos listados.
- Consultar los permisos propios por cada item del catalogo publico seria un N+1
  prohibido y seguiria siendo incompleto para scopes no publicos.
- El plan maestro (Fase 3.1-3.10) no planificaba una operacion global de
  descubrimiento.

## Decision

Publicar la operacion dedicada `GET /api/v1/users/me/scopes`.

### Contrato

- **Autenticacion:** `bearerAuth`; cualquier cuenta autenticada. No exige un permiso
  adicional porque cada llamador lee unicamente sus propios scopes, igual que
  `GET /users/me/permissions`. `401` token ausente o invalido; `403` cuenta inactiva.
- **Query estricta:** `type?` (`program | activity`), `page` entero `>= 1`
  (default 1) y `limit` entero `1..50` (default 20). Valores invalidos responden
  `400`.
- **Respuesta:** envoltura estandar con `items`, `page`, `limit`, `total` y
  `totalPages`. Sin scopes se responde una pagina vacia, nunca `404`.
- **Item:** `{ type, id, name, status, eventProgram, organizationalUnit, permissions }`.
  `eventProgram` es `{ id, name, label, status }` para actividades y `null` para
  programas. `organizationalUnit` es `{ id, name, type }`. `permissions` reutiliza
  `OwnPermission` (`{ name, origin, validFrom, validUntil }`), ordenado por nombre.
- **Orden:** `name ASC, id ASC` con comparacion binaria determinista en codigo,
  independiente de la colacion de la base de datos.

### Semantica

- Un item aparece solo si al menos un permiso efectivo esta vigente al momento de la
  peticion; los grants vencidos o futuros se ignoran sin borrarse, consistente con
  `GET /users/me/permissions`.
- Un `USER` recibe unicamente sus colaboraciones directas: un programa aparece
  cuando tiene colaboracion local alli; una actividad aparece solo cuando tiene
  colaboracion local en ella. Los grants del programa padre se siguen uniendo en
  los `permissions` de una actividad como `INHERITED`/`BOTH`; no se expanden todas
  las actividades del programa como scopes.
- Los scopes en estados no publicos (`DRAFT`, `CANCELLED`, `ARCHIVED`) se incluyen:
  es el proposito de la operacion.
- `status` de una actividad es el estado efectivo derivado al leer con la fecha y
  hora institucionales (ADR-0010); el de un programa es el almacenado.
- `ADMIN` recibe el catalogo completo (todos los programas y actividades, cualquier
  estado) con el catalogo completo de permisos como `LOCAL` e ilimitado, paginado,
  consistente con `GET /users/me/permissions`.
- Privacidad: nunca se devuelven `grantedById`, `grantedAt`, emails ni campos de
  auditoria.

### Implementacion

- La operacion vive en `src/modules/authorization/` con tag OpenAPI `Collaborators`.
- Camino `USER`: una consulta de las colaboraciones propias con sus grants y
  relaciones de scope; los scopes sin permisos activos se descartan.
- Camino `ADMIN` (alternativa elegida frente a cargar todo el catalogo completo en
  memoria): descubrimiento ligero `select { id, name }` de programas y actividades,
  merge y paginacion en memoria, e hidratacion de solo los identificadores de la
  pagina. Si el catalogo crece a decenas de miles de filas, el follow-up es un
  `UNION ALL` con `$queryRaw` que pagine en la base de datos.

## Consequences

### Positive

- **POS-001**: Una sola peticion paginada descubre todos los scopes accesibles,
  incluidos los no publicos.
- **POS-002**: La navegacion por capacidades y el contexto de trabajo del frontend
  se pueden implementar sin adivinar ni consultar permisos por item.
- **POS-003**: Los limites publico/administrativo se mantienen intactos y no se
  reintroduce el fan-out del catalogo de actividades.

### Negative

- **NEG-001**: Los contratos de scopes directos y de catalogo completo para `ADMIN`
  fijan semantica adicional que debe mantenerse aunque cambien los listados
  publicos.
- **NEG-002**: El camino `ADMIN` recorre O(N) filas ligeras por peticion; aceptable
  al volumen actual y documentado como follow-up.

## Alternatives Considered

### Permisos propios por item (N+1)

- **ALT-001**: Iterar el listado publico y llamar a `GET /users/me/permissions` por
  item.
- **ALT-002**: Prohibido; ademas es incompleto porque los scopes no publicos nunca
  aparecen en el listado publico.

### Extender los listados publicos

- **ALT-003**: Hacer que `GET /event-programs` y `GET /activities` devuelvan items no
  publicos cuando hay Bearer.
- **ALT-004**: Contamina el contrato publico y la cache, y seguiria obligando a una
  consulta de permisos por item para saber que es accionable.

### Enumerar los listados administrativos

- **ALT-005**: Reutilizar `status=ALL` para inferir scopes.
- **ALT-006**: Esos listados son solo `ADMIN` y globales; no expresan alcance
  horizontal.

### Expandir las actividades heredadas de un programa

- **ALT-007**: Devolver cada actividad de un programa donde el usuario tiene
  permisos, con `origin: INHERITED`.
- **ALT-008**: Multiplica los items y cambia ante cada alta de actividad; el item de
  programa ya cubre la navegacion hacia sus actividades.

## Implementation Notes

- La respuesta es privada y de solo lectura; no se persiste en el cliente.
- Las mutaciones de colaboracion o permisos deben invalidar la cache del cliente
  para este endpoint; el frontend lo gestiona por identidad.
- Ninguna accion debe derivar autorizacion de este listado: un `403` del backend
  sigue siendo la fuente autoritativa.
