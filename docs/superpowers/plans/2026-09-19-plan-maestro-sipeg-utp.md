# Plan Maestro de Implementacion - SIPEG UTP Backend

> **Para agentes:** este es el roadmap global. Antes de ejecutar cada fase, generar su plan detallado con `writing-plans` (TDD, pasos de 2-5 min) y ejecutarlo con `executing-plans`. Cada item es un checklist autodocumentado con su prueba inline.
>
> **Orden logico:** Fases 0-1 (identidad) -> 2 (catalogos, prerrequisito de todo) -> 3-5 (autorizacion, programas, actividades) -> 6-8 (infraestructura transversal, alertas, propuestas) -> 9-11 (asistencia, certificados, reportes) -> 12 (endurecimiento y E2E).

**Objetivo:** Completar el backend REST de SIPEG UTP mediante fases incrementales, verificables y ordenadas por dependencia funcional.

**Arquitectura:** API REST modular con Express y TypeScript, reglas de negocio en servicios, persistencia PostgreSQL mediante Prisma y contratos definidos con Zod/OpenAPI. Las funcionalidades se implementan con TDD y cada fase debe dejar un producto integrado, documentado y comprobable antes de comenzar la siguiente.

**Stack:** Node.js 24, TypeScript, Express 5, Prisma 7, PostgreSQL, Better Auth, JWT EdDSA, Argon2id, Zod, OpenAPI 3.1, Vitest, Supertest y Bruno.

---

## 0. Estado actual

| Area | Estado |
|---|---|
| Infraestructura: Express, errores, health, entorno, Prisma, Docker, rate limit, Helmet, OpenAPI/Scalar, Bruno y seed | Implementado |
| Autenticacion: login, registro, refresh, logout, verificacion de email y recuperacion de contrasena | Implementado; requiere revision final |
| Usuarios: `GET/PATCH /users/me` | Implementado; falta administracion |
| Autorizacion: catalogo, resolucion y delegacion | Servicios implementados; faltan endpoints |
| Programas: listado, creacion y actualizacion | Parcial |
| Actividades: listado de proximas y creacion | Parcial |
| Unidades, carreras, aulas, archivos, email, alertas, propuestas, asistencia, certificados, reportes y auditoria | Pendiente |

Endpoints existentes: `/health`, `/auth/*`, `/users/me`, `/event-programs` y `/activities`.

## Definicion de terminado global

Aplicar esta lista al finalizar cada modulo o fase:

- [ ] Crear un plan detallado en `docs/superpowers/plans/YYYY-MM-DD-<modulo>.md` antes de implementar.
- [ ] Aplicar TDD: prueba que falla por la razon esperada, implementacion minima y pruebas en verde.
- [ ] Mantener el modulo en `src/modules/<modulo>/` con schemas Zod, servicio, controlador, rutas y documentacion OpenAPI.
- [ ] Mantener Prisma fuera de controladores y rutas.
- [ ] Agregar permisos nuevos al catalogo canonico y al seed cuando corresponda.
- [ ] Ejecutar `pnpm test`.
- [ ] Ejecutar `pnpm run typecheck`.
- [ ] Ejecutar `pnpm run lint`.
- [ ] Ejecutar `pnpm run build`.
- [ ] Ejecutar `pnpm run docs:generate` y `pnpm run docs:check` cuando cambie el contrato HTTP.
- [ ] Actualizar la coleccion Bruno y restaurar el script de captura de tokens del login.
- [ ] Actualizar seed, `.env.example`, README, CONTEXT, AGENTS y ADRs cuando corresponda.
- [ ] Confirmar que respuestas y logs no contienen hashes, tokens, secretos, CVs ni detalles internos.
- [ ] Validar params, query, body y archivos antes de ejecutar reglas de negocio.

---

## Fase 0 - Revision de cimientos

**Objetivo:** confirmar que la base tecnica es estable antes de ampliar el dominio.

- [ ] **0.1 Verificar calidad base.** Ejecutar tests, typecheck, lint y build; registrar el baseline de cobertura.
- [ ] **0.2 Revisar health y apagado ordenado.** Confirmar que `/api/v1/health` responde correctamente y que `server.ts` cierra HTTP y Prisma sin perder solicitudes.
- [ ] **0.3 Revisar seguridad global.** Confirmar CORS explicito, Helmet, rate limit global y `DOCS_ENABLED=false` en produccion.
- [ ] **0.4 Revisar migraciones y seed.** Ejecutar `pnpm prisma:migrate:status` y correr `pnpm prisma:seed` dos veces; el segundo pase no debe duplicar datos.
- [ ] **0.5 Revisar OpenAPI.** Confirmar Scalar, `/api/openapi.json` y `pnpm run docs:check` sin drift.
- [ ] **0.6 Definir estructura modular.** Decidir si se migran controllers y routes de actividades/programas al patron autocontenido de auth/users o si se documenta la coexistencia.

**Criterio de salida:** todos los comandos de calidad estan en verde, el seed es idempotente y el contrato OpenAPI no tiene drift.

---

## Fase 1 - Identidad, sesiones y gestion de usuarios

**Depende de:** Fase 0.

**Entregable:** ciclo completo de cuenta y administracion segura de usuarios.

### Revision de funcionalidades existentes

- [ ] **1.1 Registrar usuario - `POST /api/v1/auth/register`.** Probar que se insertan filas en `users` y `accounts`; `accounts.password` comienza con `$argon2id$` y `argon2.verify` devuelve `true`; nunca se almacena texto plano ni se devuelve el hash; email o identificacion duplicados producen 409; el rol inicial es `USER`; el cuarto registro dentro de la ventana limitada produce 429.
- [ ] **1.2 Iniciar sesion - `POST /api/v1/auth/login`.** Probar que credenciales validas devuelven access token EdDSA y refresh token, y crean una sesion; credenciales invalidas producen 401 sin revelar si existe el email; el limite de cinco intentos por minuto produce 429.
- [ ] **1.3 Renovar sesion - `POST /api/v1/auth/refresh`.** Probar que se entrega un nuevo par de tokens, el refresh anterior deja de funcionar y tokens vencidos o revocados producen 401.
- [ ] **1.4 Cerrar sesion - `POST /api/v1/auth/logout`.** Probar que se elimina la sesion correspondiente y que un usuario desactivado no puede usar su access token.
- [ ] **1.5 Verificar email y recuperar contrasena.** Probar expiracion de tokens, respuestas que no revelan si un email existe, rate limit y revocacion de sesiones despues de restablecer la contrasena.
- [ ] **1.6 Consultar y actualizar perfil - `GET/PATCH /api/v1/users/me`.** Probar aislamiento por usuario, validacion de unidad/carrera y ausencia de `password`, `accounts` y `name` interno.

### Funcionalidades nuevas

- [ ] **1.7 Cambiar contrasena - `POST /api/v1/auth/change-password`.** Exigir autenticacion, contrasena actual y nueva contrasena de 12-128 caracteres; revocar las demas sesiones. Probar contrasena actual incorrecta y uso posterior de sesiones revocadas.
- [ ] **1.8 Listar usuarios - `GET /api/v1/admin/users`.** Solo ADMIN; agregar paginacion, busqueda y filtros por rol, estado, unidad y carrera. Probar USER -> 403 y ausencia de campos sensibles.
- [ ] **1.9 Consultar usuario - `GET /api/v1/admin/users/:id`.** Solo ADMIN; devolver DTO seguro y 404 para identificador inexistente.
- [ ] **1.10 Crear usuario administrativo - `POST /api/v1/admin/users`.** Crear `users` y `accounts` con Argon2id; validar conflictos de email e identificacion.
- [ ] **1.11 Actualizar usuario - `PATCH /api/v1/admin/users/:id`.** Permitir rol, estado, unidad y carrera; al desactivar, eliminar sesiones; impedir que el ultimo ADMIN sea degradado o desactivado e impedir autodesactivacion.

**Criterio de salida:** flujo register -> login -> refresh -> logout -> reset completo, administracion de usuarios probada, OpenAPI y Bruno actualizados.

---

## Fase 2 - Catalogos institucionales

**Depende de:** Fase 1.

**Entregable:** unidades, carreras y aulas administrables como base de programas y actividades.

### 2.A Unidades organizativas

- [ ] **2.A.1 Listar unidades - `GET /api/v1/organizational-units`.** Mostrar activas por defecto con filtro por `type`, busqueda y paginacion.
- [ ] **2.A.2 Consultar unidad - `GET /api/v1/organizational-units/:id`.** Incluir carreras y programa predeterminado.
- [ ] **2.A.3 Crear unidad - `POST /api/v1/organizational-units`.** Solo ADMIN; crear unidad y programa default ACTIVE dentro de una transaccion. Probar que un fallo no deja una unidad sin programa y que un codigo duplicado produce 409.
- [ ] **2.A.4 Actualizar unidad - `PATCH /api/v1/organizational-units/:id`.** Solo ADMIN; editar nombre, descripcion y encargado activo; mantener `code` y `type` inmutables.
- [ ] **2.A.5 Desactivar unidad - `POST /api/v1/organizational-units/:id/deactivate`.** Rechazar si el programa default tiene actividades programadas o en curso; documentar y ejecutar atomicamente el tratamiento del programa default.
- [ ] **2.A.6 Reactivar unidad - `POST /api/v1/organizational-units/:id/reactivate`.** Reactivar unidad y programa default existente en una sola transaccion; probar rollback completo ante fallos.
- [ ] **2.A.7 Mantener la invariante del programa default.** No permitir archivarlo mientras la unidad permanezca activa.

### 2.B Carreras

- [ ] **2.B.1 Listar carreras - `GET /api/v1/careers`.** Filtro por unidad/estado, busqueda y paginacion.
- [ ] **2.B.2 Crear y actualizar carreras.** Solo ADMIN; validar que la unidad sea FACULTY y este activa; codigo duplicado produce 409.
- [ ] **2.B.3 Desactivar carreras.** No borrar fisicamente una carrera con usuarios asociados; devolver 409 o desactivarla segun la regla documentada.

### 2.C Aulas

- [ ] **2.C.1 Listar aulas - `GET /api/v1/classrooms`.** Filtros por tipo, capacidad minima, amenidades y estado; paginacion.
- [ ] **2.C.2 Crear y actualizar aulas.** Solo ADMIN; validar tipo, capacidad mayor que cero, edificio y piso.
- [ ] **2.C.3 Gestionar amenidades.** Agregar y quitar amenidades sin duplicados; validar formato y longitud.
- [ ] **2.C.4 Gestionar ventanas de disponibilidad.** Validar `dayOfWeek` 1-7, `startTime < endTime` y ausencia de solapes; un solape produce 409.
- [ ] **2.C.5 Consultar aulas disponibles - `GET /api/v1/classrooms/available`.** Filtrar por fecha, hora y capacidad; considerar ventanas y actividades SCHEDULED/ONGOING en `America/Panama`; actividades CANCELLED no bloquean.

**Criterio de salida:** creacion transaccional unidad+programa demostrada en BD y disponibilidad de aulas cubierta con pruebas de fronteras y solapes.

---

## Fase 3 - API de autorizacion por colaboracion

**Depende de:** Fases 1 y 2.

**Entregable:** exponer los servicios existentes de delegacion y permisos mediante API segura.

- [ ] **3.1 Listar colaboradores.** Crear `GET /event-programs/:id/collaborators` y `GET /activities/:id/collaborators`, protegidos por `permission:grant` en el scope.
- [ ] **3.2 Agregar colaborador.** Crear `POST .../collaborators`; materializar permisos `ROLE_DEFAULT`; probar que un actor no puede otorgar permisos que no posee.
- [ ] **3.3 Cambiar rol.** Crear `PATCH .../collaborators/:userId`; reemplazar `ROLE_DEFAULT` y preservar `OVERRIDE`.
- [ ] **3.4 Eliminar colaborador.** Crear `DELETE .../collaborators/:userId`; impedir que el scope quede sin un actor capaz de delegar.
- [ ] **3.5 Otorgar permiso.** Crear `POST .../permissions`; validar subconjunto y atenuacion temporal; un envelope acotado no puede crear grants ilimitados.
- [ ] **3.6 Revocar permiso.** Crear `DELETE .../permissions/:permission`; no revocar herencia del programa desde una actividad; devolver 409 claro.
- [ ] **3.7 Consultar permisos propios.** Crear `GET /api/v1/users/me/permissions?scope=program|activity&id=` con envelopes temporales.
- [ ] **3.8 Exponer procedencia de permisos.** En detalles privados mostrar `inherited`, `local` y `effective`.
- [ ] **3.9 Ignorar permisos vencidos sin borrarlos.** Probar con reloj controlado.
- [ ] **3.10 Minimizar auditoria expuesta.** No devolver `grantedById` ni `grantedAt` salvo a actores autorizados.

**Criterio de salida:** tests de rutas con ADMIN, ORGANIZER, EDITOR y VIEWER cubren subconjunto simetrico, atenuacion, herencia y no ampliacion de scope.

---

## Fase 4 - Programas de eventos

**Depende de:** Fases 2 y 3.

**Entregable:** ciclo completo crear -> actualizar -> archivar -> reactivar.

- [ ] **4.1 Consultar programa - `GET /api/v1/event-programs/:id`.** Para programas ACTIVE, incluir unidad, etiqueta, fechas y conteo de actividades.
- [ ] **4.2 Revisar creacion y actualizacion.** Mantener `isDefault` y `organizationalUnitId` inmutables; validar `startDate <= endDate`; un programa ARCHIVED no es editable.
- [ ] **4.3 Archivar programa - `POST /api/v1/event-programs/:id/archive`.** Rechazar programas adicionales con actividades SCHEDULED/ONGOING y programas default cuya unidad este activa; guardar `archivedAt`; comportamiento idempotente.
- [ ] **4.4 Reactivar programa - `POST /api/v1/event-programs/:id/reactivate`.** Solo adicionales archivados; validar rango de fechas.
- [ ] **4.5 Completar filtros.** Permitir que ADMIN filtre estados no publicos; mantener listado publico limitado a ACTIVE.
- [ ] **4.6 Listar actividades del programa - `GET /api/v1/event-programs/:id/activities`.** Agregar filtros y paginacion.
- [ ] **4.7 Prohibir eliminacion fisica.** No exponer `DELETE` de programas; documentar 404/405.

**Criterio de salida:** transiciones invalidas rechazadas, `archivedAt` correcto y ninguna actividad creable en programas archivados.

---

## Fase 5 - Actividades

**Depende de:** Fase 4 y disponibilidad de aulas de Fase 2.

**Entregable:** ciclo de vida completo con validacion de calendario, aula y permisos.

- [ ] **5.1 Consultar actividad - `GET /api/v1/activities/:id`.** Incluir ponentes, aula, equipamiento, programa y conteo de inscritos.
- [ ] **5.2 Actualizar actividad - `PATCH /api/v1/activities/:id`.** Requerir `activity:update`; validar transiciones y rechazar edicion de COMPLETED/CANCELLED.
- [ ] **5.3 Cancelar actividad - `POST /api/v1/activities/:id/cancel`.** Requerir `activity:cancel`; admitir motivo opcional; no cancelar una actividad completada.
- [ ] **5.4 Definir eliminacion.** Recomendacion: permitir `DELETE` solo para DRAFT sin asistencia; documentar la regla de retencion.
- [ ] **5.5 Validar aula y horario.** Exigir `endTime > startTime`, ventana disponible, ausencia de solape, capacidad del aula suficiente, speakers validos y equipamiento sin duplicados.
- [ ] **5.6 Completar filtros.** Proximas, pasadas, programa, unidad, tipo de unidad, tipo de actividad, aula, rango de fechas y estado; paginacion.
- [ ] **5.7 Resolver estados temporales.** Decidir si ONGOING/COMPLETED se derivan al leer o mediante job; documentar con ADR si se usa scheduler.
- [ ] **5.8 Revisar creacion existente.** Aplicar todas las validaciones anteriores a `POST /activities`.

**Criterio de salida:** solapes de aula producen 409, colaboracion horizontal incorrecta produce 403 y cambios de aula/horario mantienen disponibilidad consistente.

---

## Fase 6 - Infraestructura de archivos y correo

**Depende de:** Fase 1.

**Entregable:** subida segura de CV/imagenes y servicio de email configurable.

- [ ] **6.1 Decidir almacenamiento.** Crear ADR; opcion inicial recomendada: disco local fuera de rutas ejecutables con nombres aleatorios; alternativa S3-compatible.
- [ ] **6.2 Implementar subida segura.** Limite de tamano, allowlist MIME/extension, magic bytes, nombres aleatorios, proteccion path traversal y acceso privado a CV.
- [ ] **6.3 Crear endpoints de archivos.** `POST /api/v1/uploads/cv` y `POST /api/v1/uploads/images` con autenticacion o rate limit estricto segun el flujo.
- [ ] **6.4 Implementar email.** SMTP configurable y modo desarrollo; plantillas de verificacion, reset, propuesta, actividad y certificado.
- [ ] **6.5 Documentar variables.** Agregar `MAIL_*` y `UPLOAD_*`/`STORAGE_*` a `.env.example` y validarlas al arrancar.

**Criterio de salida:** MIME falso, exceso de tamano y traversal son rechazados; CV no accesible por URL publica; logs sin tokens.

---

## Fase 7 - Alertas

**Depende de:** Fase 1.

**Entregable:** bandeja in-app y servicio reutilizable para eventos de dominio.

- [ ] **7.1 Listar alertas - `GET /api/v1/alerts`.** Solo propias, paginacion y filtros `isRead`/`type`.
- [ ] **7.2 Marcar alertas.** Crear `PATCH /alerts/:id/read` y `POST /alerts/read-all`.
- [ ] **7.3 Crear helper interno.** Implementar `createAlert` reutilizable dentro de transacciones.
- [ ] **7.4 Aislar usuarios.** Consultar o modificar alertas ajenas debe producir 404.

**Criterio de salida:** aislamiento por usuario y rollback conjunto entre accion de dominio y alerta comprobados.

---

## Fase 8 - Ponentes y propuestas

**Depende de:** Fases 4, 6 y 7.

**Entregable:** formulario publico con CV, versionado inmutable, revision y feedback.

- [ ] **8.1 Enviar propuesta - `POST /api/v1/speaker-proposals`.** Publico con rate limit y CV; crear/reutilizar Speaker por email, propuesta PENDING y version 1; programa no ACTIVE produce 409.
- [ ] **8.2 Listar propuestas - `GET /api/v1/speaker-proposals`.** Requerir `proposal:read` en scope; filtros por estado, fecha y programa.
- [ ] **8.3 Consultar propuesta - `GET /api/v1/speaker-proposals/:id`.** Autor mediante mecanismo anonimo seguro o colaborador autorizado.
- [ ] **8.4 Actualizar propuesta - `PATCH /api/v1/speaker-proposals/:id`.** Crear `ProposalVersion` incremental sin modificar versiones anteriores; documentar autenticacion anonima en ADR.
- [ ] **8.5 Agregar feedback - `POST /api/v1/speaker-proposals/:id/feedback`.** Requerir `proposal:feedback`; texto o imagen obligatorios.
- [ ] **8.6 Resolver propuesta - `PATCH /api/v1/speaker-proposals/:id/status`.** Requerir `proposal:review`; permitir transiciones PENDING -> APPROVED/REJECTED.
- [ ] **8.7 Consultar versiones - `GET /api/v1/speaker-proposals/:id/versions`.** Historial inmutable y ordenado.
- [ ] **8.8 Emitir alertas y correos.** Notificar submit, update, feedback y respuesta.
- [ ] **8.9 Administrar catalogo de ponentes.** Listar ponentes y permitir vincular `userId` con autorizacion.

**Criterio de salida:** version 1 permanece intacta tras una actualizacion, CV invalido es rechazado, revision sin permiso produce 403 y programa archivado produce 409.

---

## Fase 9 - Asistencia

**Depende de:** Fase 5.

**Referencia:** `docs/adr/adr-0004-attendance-checkin-codes.md`.

- [ ] **9.1 Inscribirse - `POST /api/v1/activities/:id/attendance`.** Generar codigo unico global criptograficamente aleatorio; validar actividad disponible; duplicado `(activityId,userId)` produce 409.
- [ ] **9.2 Realizar check-in - `POST /api/v1/activities/:id/attendance/check-in`.** Validar codigo, actividad, usuario y metodo QR/MANUAL; segundo check-in produce 409.
- [ ] **9.3 Check-in asistido.** Permitir a quien tenga `attendance:checkin` validar codigos de terceros en su scope.
- [ ] **9.4 Listar asistencia - `GET /api/v1/activities/:id/attendance`.** Requerir `attendance:manage`; paginacion y filtros inscrito/presente.
- [ ] **9.5 Cancelar inscripcion - `DELETE /api/v1/attendance/:id`.** Dueño antes del check-in o staff autorizado; certificado existente produce 409.
- [ ] **9.6 Consultar asistencia propia - `GET /api/v1/users/me/attendance`.** Mostrar inscripciones e historial.
- [ ] **9.7 Resolver asistentes sin cuenta.** Decidir si el registro manual exige User o admite invitados; documentar modelo si cambia.
- [ ] **9.8 Proteger check-in.** Rate limit especifico y prohibicion de loguear codigos.
- [ ] **9.9 Auditar validacion.** Registrar quien valida, metodo y tiempos UTC.

**Criterio de salida:** codigo de otra actividad es rechazado, doble check-in no modifica datos, actividad cancelada/finalizada no acepta asistencia y se prueban permisos horizontales.

---

## Fase 10 - Certificados

**Depende de:** Fases 6, 7 y 9.

**Entregable:** emision individual/masiva, descarga protegida y deduplicacion.

- [ ] **10.1 Generar certificados.** Crear `POST /attendance/:id/certificate` y `POST /activities/:id/certificates`; requerir check-in y `certificate:generate`; evitar duplicados por `attendanceId`.
- [ ] **10.2 Definir generacion automatica.** Decidir job al completar actividad o generacion on-demand; documentar.
- [ ] **10.3 Consultar/descargar certificado - `GET /certificates/:id`.** Solo dueño o actor con `certificate:read`; archivo privado.
- [ ] **10.4 Listar certificados propios - `GET /users/me/certificates`.** Paginacion y filtros.
- [ ] **10.5 Generar codigo seguro.** Unico, no secuencial y no adivinable.
- [ ] **10.6 Notificar emision.** Crear alerta y correo `CERTIFICATE_ISSUED`.

**Criterio de salida:** sin check-in produce 409, regeneracion no duplica, acceso ajeno produce 403 y codigos no se repiten.

---

## Fase 11 - Reportes y estadisticas

**Depende de:** Fases 9 y 10.

**Entregable:** metricas protegidas y exportacion opcional.

- [ ] **11.1 Reporte de asistencia - `GET /api/v1/reports/attendance`.** Filtros por programa, actividad, unidad y rango; datos agregados.
- [ ] **11.2 Estadisticas por scope.** Crear `/reports/programs/:id/statistics` y `/reports/activities/:id/statistics` con inscritos, presentes, tasa y ocupacion.
- [ ] **11.3 Resumen general - `GET /reports/overview`.** Programas activos, actividades proximas/pasadas y certificados emitidos.
- [ ] **11.4 Decidir exportacion.** Si entra en alcance, implementar XLSX/PDF con `report:export`, limite de filas, rate limit y ADR de librerias.
- [ ] **11.5 Minimizar PII.** Reportes agregados por defecto; nombres y datos identificables solo con permiso en scope.

**Criterio de salida:** cifras coinciden con datos conocidos del seed, scope horizontal probado, exportaciones no filtran PII y consultas cumplen el objetivo de rendimiento.

---

## Fase 12 - Notificaciones, auditoria y endurecimiento final

- [ ] **12.1 Notificar cambios de actividades.** Conectar `notifyAttendees` a modificar, cancelar o eliminar una actividad mediante asistencia, alertas y email.
- [ ] **12.2 Auditar acciones sensibles.** Archivar programa, cancelar/eliminar actividad, modificar permisos, exportar reportes y emitir certificados.
- [ ] **12.3 Revisar OWASP API Top 10.** Cubrir BOLA/BFLA, mass assignment, rate limiting, headers, uploads y errores sin detalles internos.
- [ ] **12.4 Cerrar contrato HTTP.** Regenerar OpenAPI, comprobar drift y ejecutar la coleccion Bruno completa en un entorno local seguro.
- [ ] **12.5 Ejecutar E2E documentado.** Registro -> login -> unidad -> programa -> actividad -> propuesta -> asistencia -> certificado -> reporte.
- [ ] **12.6 Ejecutar cierre tecnico.** Tests, cobertura, typecheck, lint, build, migraciones, seed, documentacion, variables y ADRs.

**Criterio de salida:** recorrido E2E completo, controles de seguridad verificados, documentacion sincronizada y todos los comandos de calidad en verde.

---

## Decisiones pendientes

| # | Decision | Fase | Recomendacion inicial |
|---|---|---|---|
| 1 | Storage de archivos: disco o S3 | 6 | Disco local seguro con ADR |
| 2 | Proveedor SMTP/email | 6 | SMTP configurable; desarrollo en modo log |
| 3 | Identidad anonima del ponente para editar propuesta | 8 | Token secreto y temporal enviado por email |
| 4 | Crear actividad al aprobar propuesta | 8 | No automatico; accion manual posterior |
| 5 | Eliminar o cancelar actividad | 5 | DELETE solo para DRAFT sin asistencia |
| 6 | Estados ONGOING/COMPLETED: derivados o job | 5 | Derivarlos al leer para evitar scheduler inicial |
| 7 | Catalogos solo ADMIN o permisos delegables | 2 | Solo ADMIN inicialmente |
| 8 | Exportacion Excel/PDF dentro del alcance | 11 | Confirmar antes de agregar dependencias |
| 9 | Unificar ubicacion de controllers/routes | 0 | Migrar gradualmente a modulos autocontenidos |

## Orden resumido

`0 cimientos -> 1 identidad/usuarios -> 2 catalogos -> 3 delegacion -> 4 programas -> 5 actividades -> 6 archivos/email -> 7 alertas -> 8 propuestas -> 9 asistencia -> 10 certificados -> 11 reportes -> 12 endurecimiento/E2E`
