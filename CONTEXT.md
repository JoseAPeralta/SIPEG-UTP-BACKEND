# Contexto Del Proyecto

## Producto

SIPEG UTP es una plataforma de gestion de eventos academicos. Este repositorio contiene solo el backend REST API; el frontend React vivira en un repositorio o carpeta separada y consumira este backend mediante HTTP.

El backend debe soportar usuarios, autenticacion, permisos, programas de eventos, actividades, asistencia, certificados, aulas, registro de ponentes, reportes y estadisticas.

## Alcance Del Backend

- Exponer endpoints REST versionados, preferiblemente bajo `/api/v1`.
- Implementar autenticacion y autorizacion con JWT.
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
- JWT para autenticacion y autorizacion.
- pnpm como package manager.

## Lenguaje De Dominio

### Usuario

Persona que usa la plataforma. Puede ser asistente, colaborador, organizador, administrador o ponente segun sus permisos en cada programa de eventos o actividad.

### Facultad

Unidad academica usada para clasificar usuarios, carreras y programas de eventos. Cada facultad tiene un programa de eventos predeterminado permanente, que debe estar activo mientras la facultad lo este.

### Subdireccion

Unidad administrativa independiente de las facultades. Cada subdireccion tiene un programa de eventos predeterminado permanente, que debe estar activo mientras la subdireccion lo este.

### Carrera

Programa academico asociado a un usuario. Se usa para segmentacion, reportes y comunicaciones.

### Permiso De Colaboracion

Capacidad asignada a un usuario para colaborar en un programa de eventos o en una actividad. Los permisos del programa se heredan por defecto en todas sus actividades y pueden complementarse con permisos locales.

### Programa De Eventos

Unidad organizadora que agrupa actividades. Pertenece exactamente a una facultad o a una subdireccion. Cada unidad tiene un programa predeterminado permanente creado automaticamente; su condicion predeterminada y unidad propietaria son inmutables. Un administrador del sitio puede crear programas adicionales con fechas, etiqueta y banner. Los programas se archivan y no se eliminan fisicamente, aunque esten vacios.

### Actividad

Evento individual que pertenece obligatoriamente a un programa de eventos. Tiene nombre, tipo, ponente, aula, fecha, hora, equipamiento requerido, banner, colaboradores y permisos.

### Asistente Registrado

Usuario inscrito o esperado en una actividad. Puede recibir notificaciones cuando la actividad se modifica, cancela o elimina.

### Registro De Asistencia

Evidencia de presencia en una actividad. Puede capturarse mediante QR o codigo manual.

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

- Registrar y autenticar usuarios.
- Hashear contrasenas con bcrypt o argon2.
- Emitir access tokens de corta duracion.
- Implementar refresh tokens solo si se requiere sesion persistente.
- Administrar facultad, carrera, roles y permisos.
- Nunca devolver hashes de contrasena ni tokens internos.

### Programas De Eventos Y Actividades

- Crear automaticamente un programa predeterminado permanente al crear una facultad o subdireccion.
- Permitir que solo el administrador del sitio cree programas adicionales.
- Asociar cada programa exactamente a una facultad o subdireccion.
- Crear actividades unicamente dentro de un programa activo.
- Asociar colaboradores y permisos a programas y actividades.
- Exponer permisos heredados del programa junto con los permisos locales de la actividad.
- Archivar programas en lugar de eliminarlos fisicamente.
- Bloquear el archivado de programas adicionales con actividades programadas o en curso.
- Mantener activo el programa predeterminado mientras su facultad o subdireccion siga activa.
- Reactivar una unidad y su programa predeterminado existente dentro de la misma transaccion.
- Filtrar actividades por disponibilidad, historial, facultad, subdireccion y programa.
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

## Seguridad

- Aplicar practicas alineadas con OWASP API Security Top 10.
- Validar params, query, body y archivos.
- Usar CORS con origenes explicitos.
- No usar `*` en CORS de produccion.
- Agregar rate limiting para login, registro, asistencia QR, codigos manuales, formularios publicos y reportes costosos.
- Usar headers de seguridad cuando corresponda.
- No registrar secretos, contrasenas, tokens, headers `Authorization`, URLs de base de datos ni CVs.
- No exponer stack traces, errores crudos de Prisma, detalles de JWT ni secretos en respuestas.
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
