# Contexto Del Proyecto

## Producto

SIPEG UTP es una plataforma de gestion de eventos academicos. Este repositorio contiene solo el backend REST API; el frontend React vivira en un repositorio o carpeta separada y consumira este backend mediante HTTP.

El backend debe soportar usuarios, autenticacion, permisos, programas de eventos, actividades, asistencia, certificados, aulas, registro de ponentes, reportes y estadisticas.

## Alcance Del Backend

- Exponer endpoints REST versionados, preferiblemente bajo `/api/v1`.
- Reimplementar autenticacion y autorizacion desde 0 (estado actual: sin auth).
- Persistir datos con Prisma.
- Validar entradas del cliente antes de llegar a reglas de negocio.
- Centralizar errores y respuestas JSON.
- Mantener reglas de negocio en servicios, no en controladores ni rutas.
- Proteger rutas privadas y flujos sensibles con permisos.
- Preparar contratos estables para que el frontend separado los consuma.
- No incluir paginas, componentes, estado global, rutas de navegador, Vite, React, Chakra UI ni codigo browser-only.

## Estado Actual Del Repositorio

- El repositorio puede estar en estado inicial de scaffold.
- Si faltan `src/`, `prisma/`, `tsconfig.json`, scripts de pnpm o `.env.example`, deben crearse solo cuando la tarea lo requiera.
- Las convenciones en `AGENTS.md` describen la arquitectura objetivo y deben aplicarse incrementalmente.
- No se deben agregar dependencias, modulos vacios o placeholders solo para aparentar estructura.

## Stack Objetivo

- Node.js 24.x LTS o la ultima version LTS activa disponible.
- TypeScript.
- Express.
- Prisma ORM.
- Autenticacion y autorizacion: pendiente de reimplementar desde 0 (sin modulo `auth` ni middlewares de auth/authorize en el estado actual).
- pnpm como package manager.

## Lenguaje De Dominio

### Usuario

Persona que usa la plataforma. Puede ser asistente, colaborador, organizador, administrador o ponente segun sus permisos en cada programa de eventos o actividad.

### Unidad Organizativa

Catalogo unico de unidades de la universidad (`organizational_units`). Se distingue por `type` (`UnitType`): `FACULTY` (unidad academica usada para clasificar usuarios, carreras y programas de eventos) o `SUBDIRECTORATE` (unidad administrativa como las subdirecciones). Cada unidad tiene un programa de eventos predeterminado permanente, que debe estar activo mientras la unidad lo este, y puede registrar opcionalmente un encargado (`head_id`) que apunta a un usuario. Los codigos siguen prefijos por tipo (`FIC`, `FIE`, ..., `SUB-ACAD`, `SUB-ADMIN`) para permitir filtros por prefijo. La convencion queda documentada en `docs/adr/adr-0003-unified-organizational-units.md`.

### Carrera

Programa academico asociado a un usuario y a una unidad organizativa de tipo facultad. Se usa para segmentacion, reportes y comunicaciones.

### Permiso De Colaboracion

Capacidad asignada a un usuario para colaborar en un programa de eventos o en una actividad. Los permisos del programa se heredan por defecto en todas sus actividades y pueden complementarse con permisos locales.

### Programa De Eventos

Unidad organizadora que agrupa actividades. Pertenece exactamente a una unidad organizativa. Cada unidad tiene un programa predeterminado permanente creado automaticamente; su condicion predeterminada y unidad propietaria son inmutables. Un administrador del sitio puede crear programas adicionales con fechas, etiqueta y banner. Los programas se archivan y no se eliminan fisicamente, aunque esten vacios.

### Actividad

Evento individual que pertenece obligatoriamente a un programa de eventos. Tiene nombre, tipo, ponente, aula, fecha, hora, equipamiento requerido, banner, colaboradores y permisos.

El termino "evento" puede usarse de forma coloquial, pero el nombre oficial del recurso, del modelo y del endpoint es **actividad** (`activities`). No existe un recurso `/events`.

### Asistente Registrado

Usuario inscrito o esperado en una actividad. Puede recibir notificaciones cuando la actividad se modifica, cancela o elimina.

### Registro De Asistencia

Evidencia de presencia en una actividad. Cada inscripcion (`activity` × `user`) tiene un `code` unico de validacion; el `method` (`QR`/`MANUAL`) registra como se valido. Ver `docs/adr/adr-0004-attendance-checkin-codes.md`.

### Certificado

Documento generado a partir de la asistencia. Puede generarse automaticamente o desde la lista de asistencia.

### Aula

Espacio disponible para actividades. Tiene tipo, horarios disponibles, dias disponibles, capacidad maxima y amenidades.

### Amenidad De Aula

Recurso disponible en un aula, como proyector, escritorios, mesas, smart board o pizarra.

### Ponente

Persona que propone o imparte una actividad. El registro de ponentes captura nombre, email, CV, duracion aproximada, tipo de charla, titulo, contenido, fecha de envio y programa de eventos al que aplica.

### Reporte

Vista o exportacion con metricas de programas, actividades, asistencia y certificados. Puede exportarse a Excel o PDF si el backend implementa exportacion.

### Estadistica

Indicador resumido para seguimiento operativo: asistencia total, ocupacion de aulas, certificados generados, programas activos y actividades disponibles o pasadas.

## Modulos Esperados Del Backend

### Autenticacion Y Usuarios

- Proveedor de auth modular con env vars **library-agnostic** (`AUTH_*`). Internamente usa Better Auth 1.7.x + plugin JWT.
- Password hashing: **Argon2id** con parametros OWASP (`t=2, m=19 MiB, p=1`).
- API privada 100% stateless: access tokens JWT EdDSA Ed25519 validados contra JWKS cacheado (vida 15 min).
- Refresh tokens = sesiones nativas del proveedor (vida 7 dias, revocacion server-side inmediata).
- Flujos en `/api/v1/auth/*`: login, register, refresh, logout, verify-email, forgot-password, reset-password.
- Handler del proveedor montado en `/api/auth/*splat` para flujos raw si el frontend los necesita.
- Middlewares: `authenticate` (carga `req.user`) y `authorize` (`requireRole`, `requireAdmin`, `requireOwnership`, `requirePermission`).
- Rate limit por endpoint sensible (login 5/min, register 3/min, password reset 3/min).
- Email verification habilitada; SMTP opcional (en dev, Better Auth loguea el email).
- Variables sensibles: `AUTH_SECRET` (requerido), `AUTH_URL`, opcionales `AUTH_ISSUER`, `AUTH_AUDIENCE`, `AUTH_TOKEN_TTL`, `AUTH_REFRESH_TTL`.
- Documentacion detallada: `AGENTS.md` y `docs/adr/adr-0001-time-aware-collaboration-authorization.md`.

### Autorizacion Por Colaboracion

- Catalogo de permisos `recurso:accion` y defaults por rol en `src/modules/authorization/permissions.ts`.
- Colaboraciones por programa o actividad; herencia aditiva programa a actividad; `ADMIN` con bypass total.
- Resolutor de permisos efectivos y envelopes temporales en `authorization.service.ts`.
- Vigencia por permiso (`validFrom`/`validUntil`); grants vencidos se ignoran sin borrarse.
- `permission:grant` habilita delegar; invariante de subconjunto simetrico y atenuacion temporal en `delegation.service.ts`.
- Sin `DENY` local: un permiso heredado del programa no se revoca en la actividad.
- El catalogo se siembra con `pnpm prisma:seed`.

### Programas De Eventos Y Actividades

- `GET /api/v1/activities` es publico y devuelve proximas actividades: actividades `SCHEDULED`/`ONGOING` de programas `ACTIVE`, con `date >= hoy` en la zona institucional.
- Paginacion offset: `?page` (default 1) y `?limit` (default 20, maximo 50). Respuesta `data = { items, page, limit, total, totalPages }`; la lista no expone codigos de check-in.
- `POST /api/v1/activities` (privado) crea actividades en estado `DRAFT` dentro de un programa `ACTIVE`, con permiso `activity:create` o rol `ADMIN`.
- Los codigos de check-in (`code`) viven en `attendance` (uno por inscripcion, unico global), no en la actividad. Ver `docs/adr/adr-0004-attendance-checkin-codes.md`.
- Crear automaticamente un programa predeterminado permanente al crear una unidad organizativa.
- Permitir que solo el administrador del sitio cree programas adicionales.
- Asociar cada programa exactamente a una unidad organizativa (`organizationalUnitId`).
- Crear actividades unicamente dentro de un programa activo.
- Asociar colaboradores y permisos a programas y actividades.
- Exponer permisos heredados del programa junto con los permisos locales de la actividad.
- Archivar programas en lugar de eliminarlos fisicamente.
- Bloquear el archivado de programas adicionales con actividades programadas o en curso.
- Mantener activo el programa predeterminado mientras su unidad organizativa siga activa.
- Reactivar una unidad y su programa predeterminado existente dentro de la misma transaccion.
- Filtrar actividades por disponibilidad, historial, unidad organizativa y programa.
- Soportar notificaciones antes de modificar, cancelar o eliminar actividades cuando exista servicio de email.

### Asistencia

- Permitir que un mismo registro represente la inscripcion antes del check-in y la presencia despues del check-in.
- Registrar asistencia por actividad.
- Soportar QR y codigos manuales.
- Prevenir duplicados cuando la regla de negocio exija una asistencia unica por usuario y actividad.
- Validar disponibilidad de la actividad antes de aceptar asistencia.
- Mantener auditoria cuando sea necesario.

### Certificados

- Generar certificados a partir de registros de asistencia.
- Evitar duplicados salvo solicitud explicita.
- Guardar metadata del certificado.
- Proteger generacion y descarga con permisos.

### Inventario De Aulas

- Administrar aulas, tipos, horarios, dias disponibles, capacidad y amenidades.
- Validar disponibilidad antes de asignar aula a una actividad.
- Exponer filtros para disponibilidad y capacidad.

### Registro De Ponentes

- Exigir que el ponente tenga o cree una cuenta de usuario antes de enviar una propuesta.
- Recibir propuestas de ponentes asociadas a programas de eventos.
- Capturar datos personales necesarios, CV, duracion aproximada, tipo de charla, titulo y contenido.
- Conservar versiones inmutables cuando el ponente actualice su propuesta.
- Permitir feedback en texto o imagen por colaboradores autorizados del programa.
- Alertar al ponente y a los responsables cuando la propuesta se envia, actualiza o responde.
- Validar y restringir archivos CV por tipo, tamano y destino.
- Reenviar propuestas por email solo si existe servicio configurado.

### Reportes Y Estadisticas

- Exponer numeros de asistencia y participacion.
- Exportar Excel o PDF solo si se implementa soporte de exportacion.
- Proteger reportes con autorizacion.
- Evitar exponer datos personales salvo que el usuario solicitante este autorizado.

## Decisiones De Trabajo

- `server.ts` inicia el servidor y gestiona apagado ordenado.
- `app.ts` configura Express, middleware global, rutas, not-found y errores.
- Los modulos de dominio viven bajo `src/modules`.
- Las rutas conectan paths, validacion, middleware y controladores.
- Los controladores manejan HTTP y delegan reglas de negocio.
- Los servicios contienen reglas de negocio y decisiones sensibles.
- Prisma debe usarse desde una instancia centralizada.
- La capa de repositorio se agrega solo cuando la complejidad de datos lo justifique.
- Las respuestas JSON deben ser consistentes.
- Los endpoints que puedan crecer deben tener paginacion y filtros.
- Las reglas ambiguas se resuelven con el comportamiento seguro minimo o con una pregunta corta si bloquean la implementacion.
- La zona horaria institucional es `America/Panama` (UTC-5, sin DST). Los filtros de fecha de negocio se calculan con `src/utils/date.ts`; los instantes de auditoria permanecen en UTC. Detalle en `docs/adr/adr-0002-institutional-timezone-panama.md`.

## Seguridad

- Aplicar practicas alineadas con OWASP API Security Top 10.
- Validar params, query, body y archivos.
- Usar CORS con origenes explicitos.
- No usar `*` en CORS de produccion.
- Agregar rate limiting para login, registro, asistencia QR, codigos manuales, formularios publicos y reportes costosos.
- Usar headers de seguridad cuando corresponda.
- No registrar secretos, contrasenas, tokens, headers `Authorization`, URLs de base de datos ni CVs.
- No exponer stack traces, errores crudos de Prisma, detalles de tokens ni secretos en respuestas.
- Auditar acciones administrativas sensibles cuando el modulo lo requiera.

## Prisma

- Revisar la version real de Prisma antes de copiar patrones de los skills.
- Para Prisma 7 con SQL, considerar `prisma.config.ts`, output explicito del generator y driver adapters.
- Para configuraciones Prisma existentes, seguir el patron actual salvo que el usuario pida migrar.
- Ejecutar `pnpm prisma validate`, `pnpm prisma format` y `pnpm prisma generate` cuando se modifique el schema y Prisma este configurado.
- Crear migraciones con `pnpm prisma migrate dev` cuando haya cambios de schema.
- Usar transacciones para escrituras relacionadas que deban ser atomicas.
- Usar `select` u `omit` para evitar devolver datos sensibles.
- Evitar raw SQL salvo razon concreta y segura.

## TypeScript

- Preferir configuracion estricta al inicializar el proyecto.
- Usar `unknown` para datos externos o no confiables.
- Evitar `any` salvo justificacion clara.
- Preferir interfaces para shapes de objetos y types para uniones o utilidades complejas.
- Mantener tipos cerca del modulo que los usa.
- Usar tipos avanzados solo cuando simplifiquen contratos o eliminen errores reales.

## Testing

- Para features, bugfixes, refactors o cambios de comportamiento, aplicar TDD.
- Escribir primero una prueba que falle por la razon esperada.
- Implementar el cambio minimo para pasar la prueba.
- Probar servicios, middleware y rutas criticas.
- Cubrir autenticacion, autorizacion, validacion y errores esperados.
- Usar base de datos de prueba aislada para pruebas con Prisma.
- Los cambios de documentacion no requieren pruebas automatizadas.

## Skills Instalados Como Referencia

- `writing-plans` y `executing-plans` guian trabajo multi-paso con planes verificables.
- `test-driven-development` define el flujo red-green-refactor.
- `nodejs-backend-patterns` guia estructura Express, middleware, servicios, errores y respuestas.
- `secure-code-guardian` y `api-security-best-practices` guian seguridad, OWASP, auth, validacion, rate limiting y proteccion de datos.
- `prisma-cli`, `prisma-client-api`, `prisma-database-setup` y `prisma-postgres` guian Prisma segun el caso.
- `typescript-expert` y `typescript-advanced-types` guian TypeScript, strictness y contratos tipados.
- `multi-stage-dockerfile` guia Docker si se agrega contenedorizacion.
- `architecture-blueprint-generator` y `create-architectural-decision-record` guian documentacion arquitectonica.
- `git-commit` guia commits convencionales solo cuando el usuario pida commitear.
