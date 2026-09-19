# Informe de análisis de requisitos y diagrama ER - SIPEG UTP

**Fecha de corte:** 18 de septiembre de 2026  
**Diagrama evaluado:** [`er-diagram.drawio`](./er-diagram.drawio)  
**Justificación evaluada:** [`ER-design-justification.md`](./ER-design-justification.md)  
**Requisitos de referencia:** [`AGENTS.md`](../../AGENTS.md) y [`CONTEXT.md`](../../CONTEXT.md)

## 1. Resumen ejecutivo

El modelo entidad-relación propuesto representa una plataforma académica organizada alrededor de **programas de eventos** y **actividades**. La distinción es apropiada: el programa funciona como unidad administrativa, de permisos y clasificación; la actividad representa el evento concreto al que se asignan fecha, horario, ponente, aula, asistencia y certificados.

La revisión concluye que el ER cubre adecuadamente la estructura central del producto y corrige varias ambigüedades del lenguaje anterior:

- Toda actividad tiene obligatoriamente un programa.
- Cada facultad y subdirección dispone de un programa predeterminado permanente.
- Los programas adicionales solo pueden ser creados por administradores.
- Los programas pertenecen exactamente a una facultad o subdirección.
- Los programas se archivan y no se eliminan físicamente.
- Los permisos del programa pueden heredarse en sus actividades.
- La asistencia, los certificados y las propuestas quedan vinculados a entidades concretas y normalizadas.

El diseño contiene **19 entidades** y **9 enums**. Su cobertura funcional es alta, pero todavía requiere decisiones o controles adicionales en inscripción, auditoría, seguridad de códigos, archivos, certificados, temporalidad y concurrencia.

Los riesgos más importantes antes de implementar son:

1. `attendance` combina inscripción y presencia, pero aún no modela cancelación, ausencia ni lista de espera.
2. La existencia de un programa predeterminado por unidad no puede garantizarse únicamente con un índice.
3. Los cupos requieren control transaccional para evitar sobreventa concurrente.
4. Los códigos QR y manuales no tienen caducidad, rotación ni protección contra reutilización.
5. No existe auditoría administrativa general.
6. La retención de CV, certificados, alertas y datos personales no está definida.
7. Faltan reglas completas para estados, zona horaria, archivos y revocación de certificados.

## 2. Alcance y metodología

### 2.1 Incluido

- Requisitos funcionales y reglas de negocio documentadas.
- Entidades, atributos, claves y nulabilidad del ER.
- Relaciones, cardinalidades y dependencias.
- Reglas de integridad propuestas.
- Funcionamiento futuro deducible del modelo.
- Seguridad, privacidad, concurrencia y temporalidad.
- Consideraciones de despliegue de la base de datos.

### 2.2 Excluido

- Código de aplicación.
- Esquemas ORM o modelos provisionales.
- Endpoints actualmente disponibles.
- Estado de implementación de módulos.
- Infraestructura concreta de despliegue.

### 2.3 Criterios de clasificación

- **Cubierto:** el ER contiene datos, relaciones y restricciones suficientes.
- **Parcial:** existe soporte estructural, pero falta una regla o estado importante.
- **No cubierto:** no existe representación suficiente.
- **Fuera del ER:** corresponde principalmente a autorización, servicio, API o infraestructura.

## 3. Visión general del dominio

### 3.1 Unidades organizativas

El modelo distingue dos propietarios posibles de un programa:

- `faculties`: unidades académicas relacionadas con carreras y usuarios.
- `subdirectorates`: unidades administrativas independientes.

`event_programs` contiene dos FKs opcionales, protegidas por un CHECK XOR. De esta manera, un programa tiene exactamente una unidad propietaria sin introducir una referencia polimórfica carente de integridad.

### 3.2 Programas de eventos

Un programa organiza actividades, permisos y propuestas. Existen dos variantes:

- **Predeterminado:** permanente, sin fechas y creado automáticamente para cada unidad; debe permanecer `ACTIVE` mientras la unidad esté activa.
- **Adicional:** creado por un administrador, con fecha inicial y final.

La combinación `status` y `archived_at` permite conservar el histórico. `created_by_id` ofrece trazabilidad básica del administrador responsable de programas adicionales y puede ser nulo para altas automáticas o reconciliaciones del sistema.

### 3.3 Actividades

`activities` representa el evento ejecutable. Contiene fecha, horas, tipo, capacidad, códigos de asistencia, aula, ponente y programa obligatorio.

La FK obligatoria elimina actividades huérfanas y permite obtener facultad o subdirección siempre a través del programa.

### 3.4 Colaboración y permisos

`collaborations` puede apuntar a un programa o a una actividad mediante un arco exclusivo. `collaboration_permissions` relaciona esa colaboración con permisos granulares.

El diseño no copia permisos del programa a cada actividad. Los permisos efectivos se calculan combinando:

- Rol global.
- Rol y permisos del programa.
- Rol y permisos locales de la actividad.

Como el modelo solo expresa concesiones, la interpretación coherente actual es una unión aditiva. Para soportar denegaciones se necesitaría una semántica `ALLOW`/`DENY` explícita.

### 3.5 Asistencia y certificados

`attendance` garantiza un registro por usuario y actividad. La fila nace con `registered_at`; `method`, `used_code` y `checked_in_at` se completan durante el check-in. `certificates` depende uno a uno de una asistencia y evita duplicar usuario o actividad.

La normalización es correcta y permite distinguir registro de presencia. La entidad todavía no representa cancelación, ausencia ni lista de espera.

### 3.6 Aulas

Las aulas contienen tipo, capacidad, ubicación, amenidades y disponibilidad recurrente. La restricción de exclusión temporal propuesta evita reservas solapadas incluso bajo concurrencia.

### 3.7 Propuestas y alertas

Las propuestas pertenecen a un programa y a un ponente. Las versiones preservan el historial y el feedback permite texto o imagen.

Las alertas pueden referenciar exactamente una propuesta, programa, actividad o certificado. Los programas archivados y actividades canceladas deben conservarse para evitar referencias históricas rotas.

## 4. Matriz de requisitos frente al ER

### 4.1 Usuarios y afiliación

| Requisito                   | Soporte                                 | Estado      | Observación                                     |
| --------------------------- | --------------------------------------- | ----------- | ----------------------------------------------- |
| Crear y modificar usuarios  | `users`                                 | Cubierto    | Contiene identidad y timestamps                 |
| Autenticación               | Email, identificación y `password_hash` | Parcial     | Tokens y sesiones están fuera del ER            |
| Rol global                  | `GlobalRole`                            | Cubierto    | `ADMIN` y `USER`                                |
| Seleccionar facultad        | `users.faculty_id`                      | Cubierto    | Referencia opcional                             |
| Seleccionar carrera         | `users.career_id`                       | Cubierto    | Referencia opcional                             |
| Coherencia carrera-facultad | Ambas relaciones                        | Parcial     | Requiere validación entre tablas                |
| Desactivar usuario          | `is_active`                             | Cubierto    | Conserva referencias históricas                 |
| Sesiones revocables         | Sin entidad de sesión                   | No cubierto | Solo necesaria si se implementan refresh tokens |

### 4.2 Programas de eventos

| Requisito                                          | Soporte                                     | Estado   | Observación                                                  |
| -------------------------------------------------- | ------------------------------------------- | -------- | ------------------------------------------------------------ |
| Programa predeterminado por facultad               | Índice parcial + creación/reconciliación    | Parcial  | La BD garantiza máximo uno; la operación garantiza el mínimo |
| Programa predeterminado por subdirección           | Índice parcial + creación/reconciliación    | Parcial  | La BD garantiza máximo uno; la operación garantiza el mínimo |
| Programa permanente                                | Fechas nulas y estados restringidos         | Parcial  | Unidad activa y programa `ACTIVE` se coordinan atómicamente  |
| Reactivar unidad y predeterminado                  | Cambio atómico de ambos estados             | Parcial  | Regla transaccional entre dos entidades                      |
| Programas adicionales                              | `is_default = false` + CHECK                | Cubierto | Requieren fechas, etiqueta y banner                          |
| Solo administrador puede crear                     | `created_by_id`, `GlobalRole`               | Parcial  | La autorización no puede imponerse solo con FKs              |
| Una unidad propietaria                             | CHECK XOR                                   | Cubierto | Facultad o subdirección, nunca ambas                         |
| Nombre, fechas, etiqueta y banner                  | Campos y CHECK condicional                  | Cubierto | Metadata obligatoria en programas adicionales                |
| Archivar, no eliminar                              | Estado, timestamp y prohibición de `DELETE` | Parcial  | Requiere privilegios o guarda fuera de una FK                |
| Bloquear archivo de adicional con actividad activa | Estados relacionados                        | Parcial  | Requiere transacción de negocio                              |
| Creador auditable                                  | `created_by_id?`                            | Parcial  | Puede ser nulo para creación automática o backfill           |

### 4.3 Actividades

| Requisito                           | Soporte                    | Estado   | Observación                                  |
| ----------------------------------- | -------------------------- | -------- | -------------------------------------------- |
| Toda actividad pertenece a programa | FK `NOT NULL`              | Cubierto | No existen actividades independientes        |
| Crear solo en programa activo       | `ProgramStatus.ACTIVE`     | Parcial  | Regla transaccional entre entidades          |
| Nombre y descripción                | Campos explícitos          | Cubierto | Descripción opcional                         |
| Tipo                                | `ActivityType`             | Cubierto | Incluye `OTHER`                              |
| Ponente                             | `speaker_id?`              | Parcial  | Debe definirse cuándo pasa a ser obligatorio |
| Aula                                | `classroom_id?`            | Parcial  | Admite actividades sin aula; falta modalidad |
| Fecha y hora                        | Campos explícitos          | Cubierto | Falta política de zona horaria y medianoche  |
| Capacidad                           | `max_capacity?`            | Parcial  | Falta obligatoriedad por estado/tipo         |
| Equipamiento                        | `activity_equipment`       | Cubierto | Dominio abierto de nombres                   |
| Banner                              | `banner_url?`              | Cubierto | Falta metadata del archivo                   |
| Estados                             | `ActivityStatus`           | Cubierto | Faltan transiciones permitidas               |
| Código QR                           | `qr_code UQ`               | Parcial  | Falta expiración y rotación                  |
| Código manual                       | Unique dentro del programa | Parcial  | Falta seguridad y ventana de uso             |

### 4.4 Colaboradores y permisos

| Requisito                   | Soporte                  | Estado                   | Observación                                       |
| --------------------------- | ------------------------ | ------------------------ | ------------------------------------------------- |
| Colaboradores de programa   | Scope `event_program_id` | Cubierto                 | Unicidad parcial por usuario                      |
| Colaboradores de actividad  | Scope `activity_id`      | Cubierto                 | Unicidad parcial por usuario                      |
| Roles                       | `CollaborationRole`      | Cubierto                 | Organizador, editor y visor                       |
| Permisos granulares         | Catálogo y tabla puente  | Cubierto                 | Evita asignaciones duplicadas                     |
| Herencia programa-actividad | Cálculo no materializado | Cubierto conceptualmente | Unión aditiva documentada                         |
| Denegación local            | Sin tipo de efecto       | No cubierto              | Requiere `ALLOW`/`DENY` si el negocio lo necesita |
| Propietario obligatorio     | Creador y colaboradores  | Parcial                  | No se obliga a mantener un `ORGANIZER`            |

### 4.5 Asistencia

| Requisito                          | Soporte                  | Estado      | Observación                                  |
| ---------------------------------- | ------------------------ | ----------- | -------------------------------------------- |
| Registrar asistencia por actividad | `attendance.activity_id` | Cubierto    | FK obligatoria                               |
| Asociar usuario                    | `user_id`                | Cubierto    | FK obligatoria                               |
| Registro previo                    | `registered_at`          | Cubierto    | Existe antes del check-in                    |
| QR/manual                          | `method?` y `used_code?` | Cubierto    | Ambos son obligatorios al completar check-in |
| Evitar duplicados                  | UQ actividad-usuario     | Cubierto    | Protección declarativa                       |
| Auditar instante                   | `checked_in_at?`         | Cubierto    | Falta actor, dispositivo u origen            |
| Validar capacidad                  | Conteo y `max_capacity`  | Parcial     | Requiere bloqueo o actualización atómica     |
| Distinguir registro y presencia    | Timestamps diferenciados | Cubierto    | Mantiene una sola fila                       |
| Cancelación/lista de espera        | Sin estado específico    | No cubierto | Requiere entidad o estados adicionales       |

### 4.6 Certificados

| Requisito                    | Soporte                | Estado      | Observación                              |
| ---------------------------- | ---------------------- | ----------- | ---------------------------------------- |
| Certificado desde asistencia | FK a `attendance`      | Cubierto    | Relación directa                         |
| Evitar duplicados            | `attendance_id UQ`     | Cubierto    | Uno por asistencia                       |
| Código verificable           | `code UQ`              | Cubierto    | Debe ser no enumerable                   |
| Guardar PDF y fecha          | `pdf_url`, `issued_at` | Cubierto    | URL opcional                             |
| Reglas de elegibilidad       | No representadas       | Parcial     | Deben definirse por actividad            |
| Revocación                   | Sin estado ni fecha    | No cubierto | Riesgo para certificados inválidos       |
| Regeneración versionada      | Sin versiones          | No cubierto | El reemplazo perdería historial          |
| Plantilla, firma y hash      | Sin metadata           | No cubierto | Recomendado para verificación documental |

### 4.7 Aulas

| Requisito                          | Soporte                  | Estado      | Observación                           |
| ---------------------------------- | ------------------------ | ----------- | ------------------------------------- |
| Tipo y capacidad                   | `classrooms`             | Cubierto    | Capacidad debe ser positiva           |
| Horas y días disponibles           | `classroom_availability` | Cubierto    | Recurrencia semanal                   |
| Amenidades                         | Tabla puente             | Cubierto    | Nombres libres                        |
| Evitar reservas solapadas          | Exclusión temporal       | Cubierto    | Solo `SCHEDULED` y `ONGOING`          |
| Actividad dentro de disponibilidad | Relaciones existentes    | Parcial     | Regla entre tablas                    |
| Capacidad actividad-aula           | Capacidades existentes   | Parcial     | Regla entre tablas                    |
| Festivos y mantenimiento           | Sin excepciones          | No cubierto | La recurrencia no es suficiente       |
| Vigencia de horarios               | Sin fechas de vigencia   | No cubierto | Riesgo al cambiar períodos académicos |

### 4.8 Propuestas de ponentes

| Requisito                | Soporte               | Estado       | Observación                                         |
| ------------------------ | --------------------- | ------------ | --------------------------------------------------- |
| Ponente como usuario     | `speaker_id`          | Cubierto     | Reutiliza identidad                                 |
| Programa al que aplica   | `event_program_id`    | Cubierto     | Obligatorio                                         |
| Título, contenido y tipo | Campos explícitos     | Cubierto     | Tipo compartido con actividad                       |
| Duración aproximada      | `estimated_duration?` | Parcial      | Falta unidad y obligatoriedad                       |
| CV                       | `cv_url?`             | Parcial      | Falta metadata y política de retención              |
| Fecha de envío           | `submitted_at`        | Cubierto     | Instante auditable                                  |
| Estado                   | `ProposalStatus`      | Cubierto     | Faltan `WITHDRAWN` y `CHANGES_REQUESTED` si aplican |
| Historial                | `proposal_versions`   | Cubierto     | Una o más versiones; alta inicial atómica           |
| Feedback texto/imagen    | CHECK de contenido    | Cubierto     | Autor se autoriza mediante colaboración             |
| Envío por email          | Sin estado de entrega | Fuera del ER | Puede requerir outbox si se implementa              |

### 4.9 Alertas, reportes y auditoría

| Requisito                        | Soporte                | Estado       | Observación                                      |
| -------------------------------- | ---------------------- | ------------ | ------------------------------------------------ |
| Alertas internas                 | `alerts`               | Cubierto     | Destinatario y referencia real                   |
| Marcar como leída                | `is_read`              | Cubierto     | Falta `read_at`                                  |
| Alerta de certificado            | `certificate_id`       | Cubierto     | Referencia explícita                             |
| Cambios de programas/actividades | Tipos diferenciados    | Cubierto     | Los objetos deben conservarse                    |
| Métricas de asistencia           | Datos agregables       | Cubierto     | Semántica limitada por inscripción/presencia     |
| Filtros por unidad               | Propiedad del programa | Cubierto     | Actividades heredan clasificación                |
| Exportar Excel/PDF               | Sin entidad especial   | Fuera del ER | Responsabilidad de servicio                      |
| Auditoría administrativa         | Sin `audit_logs`       | No cubierto  | Acciones sensibles quedan sin historial completo |
| Privacidad de reportes           | Datos separables       | Parcial      | Falta política de columnas y autorización        |

## 5. Funcionamiento futuro esperado

### 5.1 Creación de facultad o subdirección

1. Un administrador valida y crea la unidad.
2. La misma transacción crea el programa predeterminado.
3. El programa queda `ACTIVE`, con fechas nulas y asociado únicamente a esa unidad.
4. Si falla cualquier escritura, se revierte la operación completa.

Esta atomicidad es necesaria porque un índice garantiza como máximo un programa predeterminado, pero no que todas las unidades tengan uno.

Cuando una unidad inactiva se reactiva, la misma transacción bloquea ambos registros, reactiva el programa predeterminado existente y confirma después el estado activo de la unidad.

### 5.2 Creación de programa adicional

1. Se verifica `GlobalRole.ADMIN`.
2. Se selecciona una facultad o subdirección.
3. Se validan fechas, nombre, etiqueta y banner.
4. Se registra al administrador en `created_by_id`.
5. El programa comienza en borrador y se activa cuando cumple sus reglas.

### 5.3 Creación de actividad

1. Se selecciona un programa `ACTIVE`.
2. Se validan fecha, horario, estado, capacidad y tipo.
3. Si el programa es adicional, la fecha debe quedar dentro de su rango.
4. Si existe aula, se valida disponibilidad, capacidad y ausencia de solape.
5. Se asignan ponente, equipamiento y códigos.
6. Se crea la actividad con FK obligatoria al programa.

### 5.4 Autorización efectiva

1. Se obtiene el rol global del usuario.
2. Se consultan colaboración y permisos del programa.
3. Se consultan colaboración y permisos locales de la actividad.
4. Se calcula la unión efectiva de concesiones.
5. Se verifica el permiso requerido antes de ejecutar la acción.

### 5.5 Registro de asistencia

1. Durante la inscripción se identifica la actividad y se comprueba disponibilidad.
2. Se verifica que el usuario no tenga registro previo.
3. Se reserva cupo de forma atómica y se crea la fila con `registered_at`.
4. Durante el check-in se recupera esa misma fila.
5. Se valida método, código, vigencia y correspondencia.
6. Se completan `method`, `used_code` y `checked_in_at` de forma idempotente, exigiendo `checked_in_at >= registered_at`.

La comprobación de cupo y la escritura deben formar una única transacción para evitar que solicitudes simultáneas excedan la capacidad.

### 5.6 Archivado de programa

1. Se bloquean el programa y su unidad propietaria.
2. Si es predeterminado y su unidad está activa, se rechaza.
3. Si es adicional y tiene actividades programadas o en curso, se rechaza.
4. La creación y transición de actividades debe usar el mismo bloqueo del programa.
5. Se determinan destinatarios y se crean notificaciones si corresponde.
6. Se cambia a `ARCHIVED` y se registra `archived_at`.

### 5.7 Propuesta y certificado

- La propuesta se envía a un programa y genera una versión inicial.
- Organizadores o editores emiten feedback y el ponente crea nuevas versiones.
- Una propuesta aprobada puede originar la asignación del ponente a una actividad.
- Una asistencia elegible genera un certificado único y una alerta vinculada a él.

## 6. Hallazgos y riesgos

### 6.1 Severidad alta

#### H1. Ciclo de registro incompleto

`registered_at` y `checked_in_at?` distinguen inscripción y presencia, pero no existe estado para cancelado, ausente o lista de espera.

**Recomendación:** añadir un estado de registro y timestamps de cancelación; separar `activity_registrations` solo si el flujo crece en complejidad.

#### H2. Cupos vulnerables a concurrencia

El unique por usuario evita duplicados, pero dos usuarios pueden tomar simultáneamente el último cupo.

**Recomendación:** control transaccional con bloqueo de actividad, contador atómico o serialización equivalente.

#### H3. Códigos de asistencia sin ciclo de seguridad

No existen expiración, rotación, hash, límite de usos ni prevención de replay.

**Recomendación:** almacenar metadatos de vigencia, rotar QR, comparar secretos de forma segura y hacer el check-in idempotente.

#### H4. Auditoría administrativa insuficiente

`created_at` y `updated_at` no registran quién cambió permisos, canceló una actividad, archivó un programa o exportó un reporte.

**Recomendación:** añadir `audit_logs` antes de operar acciones administrativas sensibles.

### 6.2 Severidad media

#### M1. Garantía mínima de programa predeterminado

Los índices parciales garantizan como máximo uno por unidad, pero no al menos uno.

**Mitigación:** creación transaccional, inmutabilidad de `is_default`/propietario, job de reconciliación y health check de integridad.

#### M2. Estados sin máquina de transición

Los enums impiden valores desconocidos, pero no transiciones inválidas como `COMPLETED → SCHEDULED`.

**Mitigación:** definir matrices de transición para programas, actividades, propuestas y certificados.

#### M3. Temporalidad incompleta

No se define zona horaria institucional, actividades nocturnas, ventanas de inscripción ni apertura y cierre de check-in.

**Mitigación:** adoptar `America/Panama` si es la única zona y documentar intervalos que cruzan medianoche.

#### M4. Archivos representados solo por URL

CV, banners y certificados carecen de MIME, tamaño, hash, nombre original, estado antivirus y política de retención.

**Mitigación:** entidad común de archivos o metadata equivalente en almacenamiento privado.

#### M5. Certificados sin revocación ni versiones

No se puede invalidar un certificado manteniendo evidencia ni regenerarlo conservando historial.

**Mitigación:** añadir estado, `revoked_at`, motivo, versión, hash y plantilla.

#### M6. Disponibilidad de aulas demasiado recurrente

El día semanal no representa festivos, mantenimiento, semestres o reservas externas.

**Mitigación:** agregar vigencia y excepciones de calendario.

#### M7. Compatibilidad facultad-carrera

Un usuario puede guardar una carrera de una facultad distinta.

**Mitigación:** validación transaccional, FK compuesta o tabla de afiliaciones.

#### M8. Tipo de alerta y referencia mitigado

El CHECK garantiza una referencia y la vincula con el grupo correspondiente: propuestas, programas, actividades o certificados.

**Mitigación aplicada:** CHECK por tipo y referencia, complementado por validación centralizada en los servicios que generen alertas.

### 6.3 Severidad baja o evolutiva

- No existe `read_at` en alertas.
- No se modela modalidad presencial, virtual o híbrida.
- Equipamiento y amenidades usan vocabularios separados y libres.
- No se obliga a conservar al menos un organizador por programa.
- No se representa retirada o solicitud de cambios de propuesta.
- No se define qué datos muestra la verificación pública de certificados.
- No existe política formal para desactivar unidades con actividades activas.

## 7. Seguridad y privacidad

### 7.1 Datos sensibles

El modelo almacena o referencia:

- Identificación personal.
- Email.
- Afiliación académica.
- Historial de asistencia.
- CV y feedback.
- Certificados.
- Alertas y actividad administrativa.

### 7.2 Controles recomendados

1. Cifrado en tránsito y en reposo.
2. Acceso mínimo por rol, programa y actividad.
3. Almacenamiento privado para CV y certificados.
4. URLs firmadas y de corta duración para descargas.
5. Retención diferenciada para CV, alertas, asistencia y certificados.
6. Anonimización cuando deba conservarse estadística sin identidad.
7. Códigos públicos no secuenciales ni predecibles.
8. Registro de accesos a reportes nominativos y archivos sensibles.
9. Evitar incluir PII innecesaria en alertas o exports.

## 8. Consideraciones de despliegue

### 8.1 Dependencias del motor

El diseño utiliza características avanzadas de PostgreSQL:

- Enums.
- CHECKs.
- Índices únicos parciales.
- `EXCLUDE USING gist`.
- Extensión `btree_gist`.
- Tipos de fecha, hora e instantes con zona.

Debe comprobarse que el usuario de despliegue pueda instalar o utilizar la extensión.

### 8.2 Orden recomendado

1. Crear enums.
2. Crear facultades, subdirecciones, carreras y permisos.
3. Crear usuarios y aulas.
4. Crear programas.
5. Crear actividades y colaboraciones.
6. Crear puentes, disponibilidad y equipamiento.
7. Crear asistencia y certificados.
8. Crear propuestas, versiones, feedback y alertas.
9. Aplicar índices parciales y exclusiones.
10. Crear o reconciliar programas predeterminados.

### 8.3 Datos iniciales

Se necesitan cargas idempotentes para:

- Facultades.
- Subdirecciones.
- Carreras.
- Permisos.
- Programas predeterminados de unidades existentes.
- Amenidades estandarizadas, si dejan de ser texto libre.

### 8.4 Validación previa de datos

Antes de activar restricciones deben buscarse:

- Unidades sin programa predeterminado.
- Más de un programa predeterminado por unidad.
- Programas sin propietario o con dos propietarios.
- Actividades sin programa.
- Fechas y horas invertidas.
- Capacidades inválidas.
- Aulas solapadas.
- Colaboraciones con scope inválido.
- Asistencias, versiones o permisos duplicados.
- Feedback vacío.
- Alertas sin referencia o con múltiples referencias.

### 8.5 Operación y rollback

- Realizar backup y prueba de restauración antes de restricciones destructivas.
- Mantener migraciones pequeñas y verificables.
- Separar cambios de enums de despliegues que ya utilicen los nuevos valores.
- Coordinar base de datos y almacenamiento de archivos.
- Evitar borrados en cascada sobre históricos críticos.
- Medir consultas reales antes de agregar vistas materializadas.
- Probar concurrencia de cupos, versiones y asignación de aulas.

## 9. Recomendaciones priorizadas

### P0 - Antes de aprobar el modelo para implementación

1. Definir estados de registro, cancelación, ausencia y lista de espera.
2. Definir transiciones válidas de `ProgramStatus` y `ActivityStatus`.
3. Definir política de zona horaria y actividades nocturnas.
4. Diseñar seguridad y caducidad de códigos QR/manuales.
5. Definir política completa de borrado, archivado, retención y anonimización.
6. Confirmar cuándo ponente, aula, capacidad, CV y duración pasan a ser obligatorios.
7. Especificar elegibilidad, revocación y regeneración de certificados.
8. Formalizar la unión aditiva de permisos o diseñar denegaciones.

### P1 - Integridad y seguridad

9. Implementar control transaccional de cupos.
10. Añadir auditoría administrativa.
11. Añadir metadata y almacenamiento privado de archivos.
12. Añadir vigencia y excepciones de aulas.
13. Garantizar compatibilidad facultad-carrera.
14. Proteger generación de versiones de propuesta contra concurrencia.
15. Añadir idempotencia para check-in, alertas y certificados.

### P2 - Operación y evolución

16. Añadir índices según consultas y planes de ejecución reales.
17. Definir métricas exactas y política de privacidad de reportes.
18. Añadir modalidad de actividad.
19. Estandarizar catálogo de equipamiento y amenidades si se requiere comparación automática.
20. Añadir estados de entrega para email si las alertas alimentan notificaciones externas.

## 10. Decisiones pendientes

1. ¿Habrá cancelación de inscripción, ausencia y lista de espera?
2. ¿Qué transiciones se permiten entre estados?
3. ¿Puede una actividad cruzar medianoche?
4. ¿La zona horaria única será `America/Panama`?
5. ¿Qué tipos de actividad permiten aula o ponente nulos al publicarse?
6. ¿Cómo caducan y rotan QR y códigos manuales?
7. ¿Cómo se calcula exactamente la elegibilidad de certificados?
8. ¿Los certificados pueden revocarse o versionarse?
9. ¿Cuánto tiempo se conservan CV, feedback, alertas y asistencia?
10. ¿Qué ocurre con las actividades activas antes de desactivar su unidad propietaria?
11. ¿Se exige al menos un organizador por programa?
12. ¿Qué acciones requieren auditoría nominativa?
13. ¿Qué datos personales pueden aparecer en reportes y verificaciones públicas?
14. ¿Las actividades se cancelan, archivan o eliminan físicamente según su estado?

## 11. Conclusión

El ER actualizado es una base coherente para SIPEG UTP. La jerarquía **programa de eventos → actividad** elimina la ambigüedad de tamaño, garantiza contexto organizativo y simplifica permisos, filtros y reportes. La incorporación de subdirecciones y programas predeterminados cubre el funcionamiento administrativo esperado.

Antes de convertir el diseño en un esquema ejecutable deben resolverse principalmente el ciclo completo de registro, la seguridad de códigos, el control concurrente de cupos, la política de archivos y certificados, y la auditoría administrativa. Estas decisiones afectan integridad y privacidad, por lo que no deberían aplazarse hasta después del despliegue.
