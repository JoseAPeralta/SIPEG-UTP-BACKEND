# Decisiones y controles de seguridad de SIPEG UTP

**Fecha de revisión:** 21 de octubre de 2026.

**Alcance:** backend REST, PostgreSQL, contenedores, arquitectura de producción,
administración del VPS, observabilidad y recuperación de datos.

## Propósito y criterio de evidencia

Este documento resume las decisiones implementadas o configuradas que contribuyen
a la **confidencialidad, integridad, disponibilidad y trazabilidad** del sistema.
Cada decisión incluye su justificación, evidencia del proyecto y fuentes externas
que respaldan el mecanismo o principio utilizado.

La revisión parte del código, las migraciones, los archivos de despliegue y los
ADRs. Una configuración versionada demuestra qué se ha preparado para desplegar;
su estado efectivo en el VPS o en el panel de Cloudflare depende de su aplicación
operativa. Cuando se cita una verificación de producción, se atribuye al ADR que
la registra. Los controles que existen únicamente en el esquema de BD se indican
como tales.

Las fuentes justifican mecanismos concretos, no certifican el cumplimiento integral
del sistema. Los tiempos, umbrales y periodos de retención son decisiones del
proyecto, salvo que se indique expresamente que una fuente recomienda ese valor.

## Índice

1. [Identidad, contraseñas y sesiones](#1-identidad-contraseñas-y-sesiones)
2. [Autorización y protección de recursos](#2-autorización-y-protección-de-recursos)
3. [API, validación y protección de información](#3-api-validación-y-protección-de-información)
4. [Base de datos e integridad bajo concurrencia](#4-base-de-datos-e-integridad-bajo-concurrencia)
5. [Arquitectura y comunicaciones](#5-arquitectura-y-comunicaciones)
6. [Contenedores y construcción de imágenes](#6-contenedores-y-construcción-de-imágenes)
7. [Endurecimiento y administración del VPS](#7-endurecimiento-y-administración-del-vps)
8. [Auditoría, registros y monitorización](#8-auditoría-registros-y-monitorización)
9. [Backups y recuperación](#9-backups-y-recuperación)
10. [Desarrollo y mantenimiento verificable](#10-desarrollo-y-mantenimiento-verificable)
11. [Precisiones sobre el alcance de las protecciones](#11-precisiones-sobre-el-alcance-de-las-protecciones)
12. [Fuentes verificables](#12-fuentes-verificables)

## 1. Identidad, contraseñas y sesiones

### SEG-01. Contraseñas protegidas con Argon2id

- **Decisión y justificación:** el hashing se centraliza en Argon2id, con valores
  predeterminados `m=12288 KiB`, `t=3`, `p=1`, también usados por Compose. El coste
  de memoria y procesamiento encarece el ataque offline sobre hashes filtrados.
  OWASP incluye expresamente este perfil de 12 MiB y 3 iteraciones entre sus
  configuraciones mínimas alternativas; los parámetros son configurables.
- **Evidencia:** [password.ts](../src/lib/password.ts), [auth.ts](../src/lib/auth.ts)
  y [compose.prod.yaml](../compose.prod.yaml).
- **Fuente:** [OWASP Password Storage, sección «Argon2id»][f01].

### SEG-02. Verificación de correo antes del acceso por contraseña

- **Decisión y justificación:** el proveedor exige verificar el correo y no inicia
  sesión automáticamente tras registrarse ni tras verificarlo. Esto comprueba el
  control del canal de correo antes del login y mantiene explícito el paso de
  autenticación. No equivale a verificar la identidad civil del usuario.
- **Evidencia:** `requireEmailVerification`, `autoSignIn` y
  `autoSignInAfterVerification` en [auth.ts](../src/lib/auth.ts).
- **Fuente:** [OWASP Email Validation and Verification][f02].

### SEG-03. Access tokens firmados asimétricamente

- **Decisión y justificación:** los JWT se firman con EdDSA/Ed25519 y se verifican
  mediante claves públicas JWKS. La firma detecta alteraciones y permite verificar
  sin distribuir la clave privada de firma a los consumidores del JWKS.
- **Evidencia:** [auth.ts](../src/lib/auth.ts), `signAccessJwt` en
  [auth.service.ts](../src/modules/auth/auth.service.ts) y
  [jwt-verifier.ts](../src/utils/jwt-verifier.ts).
- **Fuentes:** [OWASP REST Security, «JWT»][f03] y
  [RFC 8725, §3.1–3.3][f04].

### SEG-04. Verificación restrictiva de JWT y claves de origen configurado

- **Decisión y justificación:** el verificador permite solo `EdDSA`, comprueba
  emisor y audiencia y valida temporalmente el token mediante `jwtVerify`. Exige
  `sub` y `email` de tipo string. El JWKS procede de una URL de configuración,
  no de una URL elegida por una cabecera del token. Se reducen la confusión de
  algoritmos, la sustitución de tokens y las consultas a claves arbitrarias.
- **Evidencia:** `createJwtVerifier` y `assertPayload` en
  [jwt-verifier.ts](../src/utils/jwt-verifier.ts).
- **Fuente:** [RFC 8725, §3.1, §3.8–3.10][f04].

### SEG-05. Separación entre acceso breve y sesión de refresco

- **Decisión y justificación:** el acceso dura 15 minutos por defecto y la sesión
  de refresco 7 días. Esto limita la ventana de uso de un access token robado sin
  exigir contraseña en cada operación. El refresh depende de una sesión vigente
  en BD, mientras el JWT ya emitido no depende de que esa sesión siga existiendo.
- **Evidencia:** [env.ts](../src/config/env.ts), [auth.ts](../src/lib/auth.ts) y
  [auth.service.ts](../src/modules/auth/auth.service.ts).
- **Fuente:** [OWASP Session Management, «Session Expiration»][f05].

### SEG-06. Rotación de refresh tokens con actualización condicional

- **Decisión y justificación:** cada refresco genera 32 bytes aleatorios con
  `randomBytes` y sustituye el token anterior mediante `updateMany` condicionado
  al token vigente y su expiración. Solo se acepta una fila actualizada. Así, un
  token ya consumido no permite seguir refrescando y una carrera sobre el mismo
  valor no produce dos rotaciones exitosas.
- **Evidencia:** `refreshAccessToken` en
  [auth.service.ts](../src/modules/auth/auth.service.ts).
- **Fuente:** [OWASP Session Management, entropía y renovación de identificadores][f05].

### SEG-07. Expiración absoluta de la sesión

- **Decisión y justificación:** `disableSessionRefresh: true` evita prolongar
  automáticamente la sesión del proveedor; la rotación propia conserva
  `expiresAt`. Una sesión comprometida no puede mantenerse indefinidamente solo
  por continuar utilizándola.
- **Evidencia:** [auth.ts](../src/lib/auth.ts) y `refreshAccessToken` en
  [auth.service.ts](../src/modules/auth/auth.service.ts).
- **Fuente:** [OWASP Session Management, «Absolute Timeout»][f05].

### SEG-08. Refresh token en cookie con alcance restringido

- **Decisión y justificación:** la credencial de larga duración viaja en una
  cookie `HttpOnly`, `Secure` en producción, sin `Domain`, con
  `Path=/api/v1/auth` y `SameSite` explícito. No se devuelve en el JSON de login o
  refresh. Se reduce su exposición a JavaScript, al transporte HTTP del navegador
  y a peticiones que no necesitan esa credencial.
- **Evidencia:** [auth.cookie.ts](../src/modules/auth/auth.cookie.ts),
  `formatAuthSuccess` en [auth.controller.ts](../src/modules/auth/auth.controller.ts)
  y [ADR-0009](adr/adr-0009-refresh-token-cookie-httponly.md).
- **Fuente:** [OWASP Session Management, «Cookies» y «Domain and Path Attributes»][f05].

### SEG-09. Logout con revocación del refresco en el servidor

- **Decisión y justificación:** el logout elimina la sesión por su token y después
  limpia la cookie; si falla la revocación, conserva la cookie para permitir
  reintentar. Esto termina la capacidad de refrescar en el servidor, en vez de
  limitarse a borrar una credencial del navegador. No revoca anticipadamente los
  access JWT ya emitidos.
- **Evidencia:** `logoutUser` en [auth.service.ts](../src/modules/auth/auth.service.ts)
  y `logout` en [auth.controller.ts](../src/modules/auth/auth.controller.ts).
- **Fuente:** [OWASP Session Management, «Manual Session Expiration»][f05].

### SEG-10. Recuperación de contraseña con token y revocación de sesiones

- **Decisión y justificación:** la recuperación usa el canal de correo, un token
  de un solo uso gestionado por el proveedor y una caducidad configurable de una
  hora por defecto. `revokeSessionsOnPasswordReset` revoca las sesiones tras el
  reset. La respuesta de solicitud no confirma si existe la cuenta. Se limita la
  reutilización del enlace y se evita revelar esa existencia en el mensaje normal.
- **Evidencia:** [auth.ts](../src/lib/auth.ts),
  [auth.service.ts](../src/modules/auth/auth.service.ts),
  [auth.controller.ts](../src/modules/auth/auth.controller.ts) y
  [pruebas de configuración del proveedor](../src/lib/auth.test.ts).
- **Fuente:** [OWASP Forgot Password][f06].

### SEG-11. Cambio de contraseña con prueba adicional de control

- **Decisión y justificación:** requiere usuario autenticado, contraseña actual
  correcta y refresh token de una sesión de ese usuario. El cambio del hash, la
  revocación de las demás sesiones y su auditoría se realizan en una transacción.
  Esto dificulta cambiar la contraseña con solo un access token robado y evita
  estados parciales entre el cambio y la revocación.
- **Evidencia:** `changePassword` en
  [auth.service.ts](../src/modules/auth/auth.service.ts) y
  [auth.routes.ts](../src/modules/auth/auth.routes.ts).
- **Fuentes:** [OWASP Session Management, reautenticación tras eventos de riesgo][f05]
  y [PostgreSQL, transacciones][f07].

### SEG-12. Enlaces de identidad construidos con URLs de configuración

- **Decisión y justificación:** los correos de verificación y reset se construyen
  con URLs configuradas; el origen de reset debe estar en los orígenes confiables.
  El destino no se toma libremente del `Host` o del cuerpo de la petición. Se
  reduce el riesgo de enviar credenciales de recuperación a un destino manipulado.
- **Evidencia:** [auth.email.ts](../src/modules/auth/auth.email.ts),
  [env.ts](../src/config/env.ts) y `requestPasswordReset` en
  [auth.service.ts](../src/modules/auth/auth.service.ts).
- **Fuente:** [OWASP Forgot Password, «URL Tokens»][f06].

### SEG-13. Estado y privilegios del usuario recargados desde BD

- **Decisión y justificación:** después de verificar el JWT, la API utiliza su
  `sub` para cargar el usuario, rol y estado actuales. Rechaza cuentas inexistentes
  o desactivadas; login y refresh también rechazan cuentas inactivas y eliminan
  la sesión involucrada. Así, un rol o estado antiguo dentro del JWT no decide
  los privilegios actuales.
- **Evidencia:** `loadActiveUser` en
  [authenticate.middleware.ts](../src/middlewares/authenticate.middleware.ts) y
  [auth.service.ts](../src/modules/auth/auth.service.ts).
- **Fuentes:** [RFC 8725, §3.8 y §3.10][f04] y
  [OWASP Authorization, comprobar permisos en cada petición][f08].

## 2. Autorización y protección de recursos

### SEG-14. Controles de acceso ejecutados en el backend

- **Decisión y justificación:** los middlewares de autenticación y autorización
  protegen operaciones privadas; los servicios realizan además comprobaciones
  sensibles al recurso. La identidad autenticada no concede automáticamente
  permiso para cualquier acción, y la interfaz del frontend no es la barrera de
  autorización.
- **Evidencia:** [authorize.middleware.ts](../src/middlewares/authorize.middleware.ts),
  [users.routes.ts](../src/modules/users/users.routes.ts) y
  [activities.service.ts](../src/modules/activities/activities.service.ts).
- **Fuente:** [OWASP Authorization, comprobación por petición y ubicación de controles][f08].

### SEG-15. Permisos por recurso, relación y tiempo

- **Decisión y justificación:** además de `USER`/`ADMIN`, se utilizan colaboraciones
  de programa o actividad y un catálogo cerrado de permisos. Solo los grants
  vigentes se consideran efectivos: los futuros y vencidos no autorizan. Se
  permite acceso acotado al trabajo concreto sin convertir a cada colaborador en
  administrador global.
- **Evidencia:** [permissions.ts](../src/modules/authorization/permissions.ts),
  [authorization.service.ts](../src/modules/authorization/authorization.service.ts)
  y [ADR-0001](adr/adr-0001-time-aware-collaboration-authorization.md).
- **Fuente:** [OWASP Authorization, mínimo privilegio y modelos ABAC/ReBAC][f08].

### SEG-16. Herencia de permisos en una dirección definida

- **Decisión y justificación:** en una actividad se unen los permisos locales y
  los de su programa padre. Una colaboración en la actividad no autoriza gestionar
  el programa padre ni otras actividades. La dirección explícita limita la
  ampliación accidental del alcance. La unión es aditiva: quitar un grant local
  no elimina un permiso que siga heredándose.
- **Evidencia:** `resolveScope` y `getPermissionEnvelopes` en
  [authorization.service.ts](../src/modules/authorization/authorization.service.ts).
- **Fuente:** [OWASP Authorization, límites de confianza y autorización por objeto][f08].

### SEG-17. Delegación que no supera los permisos del actor

- **Decisión y justificación:** gestionar colaboradores y permisos exige
  `permission:grant`; asignar roles, otorgar y revocar permisos se limita al
  conjunto que posee el actor en el mismo scope. Un colaborador no puede elevar
  a otro por encima de su propia autoridad usando la delegación.
- **Evidencia:** `assertActorCanDelegate`, `assertRoleWithinEnvelopes` y las
  operaciones de [delegation.service.ts](../src/modules/authorization/delegation.service.ts).
- **Fuente:** [OWASP Authorization, «Enforce Least Privileges»][f08].

### SEG-18. Delegación con atenuación temporal

- **Decisión y justificación:** la ventana otorgada debe quedar contenida en el
  envelope del actor; un permiso acotado no permite concederlo sin límite.
  También se exige que el final sea posterior al inicio. Esto evita convertir
  una autorización temporal en un privilegio permanente mediante delegación.
- **Evidencia:** `assertWindowWithinEnvelope` y `assertWindowValid` en
  [delegation.service.ts](../src/modules/authorization/delegation.service.ts),
  más el [CHECK de vigencia][mig-permisos].
- **Fuentes:** [OWASP Authorization, mínimo privilegio y atributos temporales][f08]
  y [PostgreSQL, restricciones CHECK][f09].

### SEG-19. Delegación privilegiada fuera de los roles predeterminados

- **Decisión y justificación:** `permission:grant` no pertenece a los defaults de
  ningún rol colaborador. Cambiar un rol reemplaza los grants `ROLE_DEFAULT` y
  conserva los `OVERRIDE` explícitos. Se evita conceder capacidad de delegación
  como efecto secundario de un rol ordinario y se distingue el ajuste fino.
- **Evidencia:** `ROLE_DEFAULTS` en
  [permissions.ts](../src/modules/authorization/permissions.ts) y
  `updateCollaboratorRole` en
  [delegation.service.ts](../src/modules/authorization/delegation.service.ts).
- **Fuente:** [OWASP Authorization, mínimo privilegio y revisión del crecimiento de permisos][f08].

### SEG-20. Identidad del propietario derivada de la autenticación

- **Decisión y justificación:** las consultas y actualizaciones de alertas se
  filtran por `recipientId`; los certificados propios, por `attendance.userId`.
  Esos valores proceden del usuario autenticado. Conocer un ID ajeno no basta
  para leer o modificar la información del propietario.
- **Evidencia:** [alerts.service.ts](../src/modules/alerts/alerts.service.ts),
  [alerts.controller.ts](../src/modules/alerts/alerts.controller.ts),
  [certificates.service.ts](../src/modules/certificates/certificates.service.ts) y
  [certificates.controller.ts](../src/modules/certificates/certificates.controller.ts).
- **Fuente:** [OWASP Authorization, controles por objeto aunque se adivine el identificador][f08].

### SEG-21. Visibilidad pública diferenciada de la gestión privada

- **Decisión y justificación:** los listados públicos aplican filtros de publicación
  y del programa; los servicios distinguen el acceso a estados no públicos según
  los privilegios. La autenticación opcional no ignora un Bearer inválido si se
  presenta. Esto reduce la exposición de borradores y evita interpretar una
  credencial inválida como una autenticación válida o silenciosamente anónima.
- **Evidencia:** [activities.service.ts](../src/modules/activities/activities.service.ts),
  [event-programs.service.ts](../src/modules/event-programs/event-programs.service.ts)
  y [optionalAuthenticate.middleware.ts](../src/middlewares/optionalAuthenticate.middleware.ts).
- **Fuente:** [OWASP Authorization, denegación por defecto y control por recurso][f08].

### SEG-22. Campos privilegiados fuera de los formularios de autoservicio

- **Decisión y justificación:** el perfil propio permite modificar solo campos
  definidos; el registro no acepta un rol global elegido por el usuario y la
  creación administrativa produce un `USER`. Cambiar `globalRole` o `isActive`
  corresponde a rutas administrativas. Se evita la escalada mediante asignación
  masiva de propiedades del modelo.
- **Evidencia:** [users.schemas.ts](../src/modules/users/users.schemas.ts),
  [users.routes.ts](../src/modules/users/users.routes.ts),
  [auth.schemas.ts](../src/modules/auth/auth.schemas.ts) y
  `additionalFields` en [auth.ts](../src/lib/auth.ts).
- **Fuente:** [OWASP Mass Assignment, allowlists y DTOs][f10].

## 3. API, validación y protección de información

### SEG-23. Validación de body, parámetros y consultas antes del servicio

- **Decisión y justificación:** Zod comprueba tipos, formatos, rangos y campos
  permitidos; el middleware sustituye los datos de la petición por el resultado
  parseado. Los campos desconocidos se rechazan o eliminan según el esquema.
  Se evita que el servicio reciba indiscriminadamente el objeto original enviado
  por el cliente.
- **Evidencia:** [validate.middleware.ts](../src/middlewares/validate.middleware.ts)
  y los esquemas de [usuarios](../src/modules/users/users.schemas.ts) y
  [actividades](../src/modules/activities/activities.schemas.ts).
- **Fuente:** [OWASP REST Security, «Input validation»][f03].

### SEG-24. Cuerpos HTTP y listados de tamaño acotado

- **Decisión y justificación:** los parsers JSON y URL-encoded tienen un límite
  de `1mb`; los listados utilizan paginación con máximos definidos por módulo
  —por ejemplo, 50 usuarios por página—. Se limita el consumo por petición y la
  extracción masiva mediante una sola respuesta.
- **Evidencia:** [app.ts](../src/app.ts),
  [users.schemas.ts](../src/modules/users/users.schemas.ts) y
  [audit.schemas.ts](../src/modules/audit/audit.schemas.ts).
- **Fuentes:** [OWASP REST Security, límites de petición][f03] y
  [OWASP Denial of Service][f11].

### SEG-25. Límites de intentos en operaciones de identidad

- **Decisión y justificación:** login combina 5 intentos/minuto por correo+IP y
  30 por IP; registro, 3 y 30; solicitud de reset, 3 y 10. Reset limita a 3/minuto,
  verificación y cambio de contraseña a 5. El correo de la clave se normaliza y
  acota. Las respuestas `429` frenan automatización y abuso de operaciones costosas
  o de envío de correo; los límites por IP complementan los de identidad.
- **Evidencia:** [rateLimit.middleware.ts](../src/middlewares/rateLimit.middleware.ts)
  y [auth.routes.ts](../src/modules/auth/auth.routes.ts).
- **Fuentes:** [OWASP Forgot Password, protección contra solicitudes excesivas][f06]
  y [OWASP REST Security, respuesta 429][f03].

### SEG-26. Límites diferenciados para refresh y JWKS

- **Decisión y justificación:** refresh limita a 12/minuto por hash del token
  presentado; sin cookie, usa IP. No guarda el token crudo como clave del
  limitador. JWKS tiene un límite Express de 100/minuto por IP. Se contienen
  ráfagas sobre una credencial fija y consultas abusivas de claves, evitando
  compartir toda la cuota de refresh entre usuarios de una misma red.
- **Evidencia:** `keyByRefreshSession`, `refreshRateLimit` y `jwksRateLimit` en
  [rateLimit.middleware.ts](../src/middlewares/rateLimit.middleware.ts).
- **Fuentes:** [OWASP Session Management, protección de identificadores][f05] y
  [OWASP Denial of Service, rate limiting][f11].

### SEG-27. CORS con orígenes explícitos

- **Decisión y justificación:** solo se aceptan los orígenes configurados y se
  habilitan credenciales para esos orígenes. La configuración prohíbe `*` en
  producción. Esto restringe qué páginas pueden leer respuestas mediante el
  navegador. CORS no autentica clientes ni impide por sí mismo el uso de la API
  desde herramientas que no aplican la política del navegador.
- **Evidencia:** [app.ts](../src/app.ts) y [env.ts](../src/config/env.ts).
- **Fuente:** [OWASP REST Security, «CORS»][f03].

### SEG-28. Comprobación de Origin en operaciones con cookie

- **Decisión y justificación:** login, refresh, logout y cambio de contraseña
  comprueban el `Origin` contra una lista exacta, junto con la política `SameSite`
  de la cookie. Se rechazan solicitudes de orígenes no permitidos antes de operar
  sobre la sesión. El middleware permite la ausencia de `Origin`; su protección
  debe describirse con esa excepción, no como una defensa CSRF completa.
- **Evidencia:** [trustedOrigin.middleware.ts](../src/middlewares/trustedOrigin.middleware.ts),
  [auth.routes.ts](../src/modules/auth/auth.routes.ts) y
  [auth.cookie.ts](../src/modules/auth/auth.cookie.ts).
- **Fuente:** [OWASP CSRF Prevention, «Using Standard Headers to Verify Origin» y SameSite][f12].

### SEG-29. Cabeceras de seguridad del navegador

- **Decisión y justificación:** Helmet configura, entre otras, protección contra
  MIME sniffing y framing; se fija `Referrer-Policy: no-referrer`, CORP `same-site`
  y CSP en producción. HSTS se activa en producción por un año con subdominios y
  directiva `preload`. Se reducen interpretaciones peligrosas y filtraciones del
  referente; HSTS refuerza HTTPS en navegadores que conocen la política. Enviar
  `preload` no demuestra inscripción efectiva en la lista de precarga.
- **Evidencia:** configuración de Helmet en [app.ts](../src/app.ts).
- **Fuente:** [OWASP REST Security, «Security Headers»][f03].

### SEG-30. Respuestas de sesión excluidas de caché HTTP

- **Decisión y justificación:** login, refresh y logout aplican `noStore`.
  `Cache-Control: no-store` evita que las cachés HTTP conformes almacenen las
  respuestas con credenciales o estado de sesión. No impide que código de una
  aplicación almacene por su cuenta una respuesta.
- **Evidencia:** [noStore.middleware.ts](../src/middlewares/noStore.middleware.ts)
  y [auth.routes.ts](../src/modules/auth/auth.routes.ts).
- **Fuente:** [OWASP Session Management, «Web Content Caching and Clear-Site-Data»][f05].

### SEG-31. Respuestas y errores construidos con campos seleccionados

- **Decisión y justificación:** los servicios usan `select` y mapeos de respuesta;
  no serializan indiscriminadamente modelos completos. Los errores inesperados
  devuelven `Internal server error.` y los errores de parser usan mensajes
  cerrados. Se reduce la exposición de hashes, sesiones, auditoría interna y
  detalles aprovechables para reconocer la implementación.
- **Evidencia:** [users.service.ts](../src/modules/users/users.service.ts),
  [delegation.service.ts](../src/modules/authorization/delegation.service.ts),
  [auth.controller.ts](../src/modules/auth/auth.controller.ts) y
  [error.middleware.ts](../src/middlewares/error.middleware.ts).
- **Fuentes:** [OWASP REST Security, «Error handling»][f03] y
  [OWASP Mass Assignment, DTOs][f10].

### SEG-32. Superficie HTTP del proveedor y de documentación acotada

- **Decisión y justificación:** del handler HTTP de Better Auth solo se expone
  `GET /api/auth/jwks`; el resto de `/api/auth/*` responde como no encontrado.
  Los flujos propios pasan por sus rutas de validación y límites. OpenAPI y
  Scalar están controlados por `DOCS_ENABLED`, deshabilitado por defecto en
  producción. Esto reduce rutas alternativas y exposición operativa innecesaria.
- **Evidencia:** [app.ts](../src/app.ts) y [compose.prod.yaml](../compose.prod.yaml).
- **Fuente:** [OWASP REST Security, control por endpoint y endpoints de gestión][f03].

## 4. Base de datos e integridad bajo concurrencia

### SEG-33. Consultas mediante operaciones estructuradas y parámetros

- **Decisión y justificación:** los servicios consultan con filtros Prisma y no
  concatenan entradas de la petición para formar sentencias SQL. La separación
  entre datos y estructura de consulta reduce inyección SQL. Los scripts
  administrativos contienen SQL explícito y deben evaluarse por separado; el
  uso de un ORM no vuelve seguro cualquier SQL crudo que se añada.
- **Evidencia:** [users.service.ts](../src/modules/users/users.service.ts),
  [alerts.service.ts](../src/modules/alerts/alerts.service.ts) y
  [config/prisma.ts](../src/config/prisma.ts).
- **Fuente:** [OWASP SQL Injection Prevention, consultas parametrizadas][f13].

### SEG-34. Unicidad y relaciones protegidas en PostgreSQL

- **Decisión y justificación:** las claves únicas impiden duplicar correo,
  identificación, colaboración por usuario/scope, asistencia por usuario/actividad
  y certificado por asistencia. Las claves foráneas impiden referencias
  inexistentes. A diferencia de un prechequeo aislado, la restricción de BD
  también arbitra escrituras concurrentes.
- **Evidencia:** [schema.prisma](../prisma/schema.prisma),
  [migración inicial][mig-inicial] y [migración de unidades][mig-unidades].
- **Fuente:** [PostgreSQL, «Unique Constraints» y «Foreign Keys»][f09].

### SEG-35. Restricciones CHECK como segunda barrera de validación

- **Decisión y justificación:** la BD valida intervalos horarios, capacidades
  positivas, días válidos, scope exclusivo de colaboración, coherencia del
  check-in y vigencia de permisos. También exige un destino de alerta coherente
  con su tipo. Se rechazan estados inválidos aunque una escritura evite la API.
  Las restricciones de propuestas y asistencia son controles del esquema, no
  prueba de que todos sus flujos HTTP estén implementados.
- **Evidencia:** [migración inicial][mig-inicial],
  [migración de códigos de asistencia][mig-asistencia] y
  [migración de permisos temporales][mig-permisos].
- **Fuente:** [PostgreSQL, «Check Constraints»][f09].

### SEG-36. Restricción de exclusión contra reservas simultáneas

- **Decisión y justificación:** `EXCLUDE USING gist` impide solapamientos de aula,
  fecha e intervalo para actividades `SCHEDULED`/`ONGOING`; el intervalo `[)`
  permite reservas contiguas. La BD resuelve el conflicto incluso si dos
  peticiones pasan simultáneamente la validación previa de disponibilidad.
- **Evidencia:** `activities_classroom_no_overlap` en la
  [migración inicial][mig-inicial] y
  [activities.schedule.ts](../src/modules/activities/activities.schedule.ts).
- **Fuente:** [PostgreSQL, «Exclusion Constraints»][f09].

### SEG-37. Validación del ciclo de vida y bloqueo del programa padre

- **Decisión y justificación:** los triggers validan que las actividades se creen
  o programen en programas activos y dentro de sus fechas. La escritura de
  actividad bloquea el programa con `FOR UPDATE`; la transición a archivado
  comprueba sus actividades. Esto protege invariantes entre tablas frente a
  cambios concurrentes y llamadas que omitan los servicios.
- **Evidencia:** `validate_activity_program` en la [migración inicial][mig-inicial],
  [migración de unidades][mig-unidades] y
  [actualización del guard de archivado][mig-archivo].
- **Fuentes:** [PostgreSQL, triggers][f14] y [bloqueos explícitos][f15].

### SEG-38. Programas archivados y actividades con retención explícita

- **Decisión y justificación:** triggers impiden `DELETE` y `TRUNCATE` de
  programas. Las actividades solo pueden borrarse bajo las condiciones del guard
  —borrador y programa activo—; las relaciones históricas utilizan `RESTRICT`
  donde corresponde. Se reduce la pérdida de evidencia por borrados accidentales
  o inconsistentes con el ciclo de vida del negocio.
- **Evidencia:** [migración inicial][mig-inicial],
  [guard de eliminación de actividades][mig-borrado],
  [schema.prisma](../prisma/schema.prisma) y
  `deleteActivity` en [activities.service.ts](../src/modules/activities/activities.service.ts).
- **Fuentes:** [PostgreSQL, claves foráneas y acciones de borrado][f09] y
  [OWASP REST Security, validación del estado del flujo][f03].

### SEG-39. Identidad del programa predeterminado protegida

- **Decisión y justificación:** no puede alterarse `isDefault` ni la unidad
  propietaria de un programa predeterminado; un índice único parcial impide más
  de uno por unidad. La reactivación de la unidad restaura su programa existente
  mediante trigger. Se mantiene estable la pertenencia institucional de las
  actividades y se evitan duplicaciones o reasignaciones indebidas.
- **Evidencia:** [schema.prisma](../prisma/schema.prisma) y
  [migración de unidades organizativas][mig-unidades].
- **Fuentes:** [PostgreSQL, unicidad][f09] y [triggers][f14].

### SEG-40. Auditoría e historial protegidos frente a mutación ordinaria

- **Decisión y justificación:** `audit_events` rechaza `UPDATE`, `DELETE` y
  `TRUNCATE` mediante triggers. `proposal_versions` tiene protección equivalente
  para sus snapshots en BD. Se dificulta reescribir el historial usando operaciones
  ordinarias. No es inmutabilidad criptográfica ni protección frente a un
  administrador que pueda desactivar triggers.
- **Evidencia:** [migración de auditoría][mig-auditoria] y
  `prevent_proposal_version_mutation` en la [migración inicial][mig-inicial].
- **Fuentes:** [OWASP Logging, «Protection»][f16] y [PostgreSQL, triggers][f14].

### SEG-41. Escrituras relacionadas unidas por transacciones

- **Decisión y justificación:** los servicios agrupan cambios de negocio y
  auditoría en transacciones cuando controlan ambas escrituras. Una falla revierte
  el conjunto y evita declarar una operación auditada que no quedó aplicada, o
  aplicar solo parte de un cambio. Los flujos internos del proveedor de identidad
  tienen una frontera transaccional distinta, documentada en ADR-0008.
- **Evidencia:** [delegation.service.ts](../src/modules/authorization/delegation.service.ts),
  [activities.service.ts](../src/modules/activities/activities.service.ts),
  [auth.service.ts](../src/modules/auth/auth.service.ts) y
  [ADR-0008](adr/adr-0008-durable-audit-events.md).
- **Fuente:** [PostgreSQL, transacciones y atomicidad][f07].

### SEG-42. Conexiones de BD acotadas y rol separado de monitorización

- **Decisión y justificación:** la API reutiliza un cliente con pool limitado
  —9 conexiones y 5 segundos de espera de conexión por defecto—. El exporter
  utiliza un rol distinto, sin superusuario, con `pg_monitor` y transacciones de
  solo lectura por defecto. Se reduce el agotamiento de conexiones y la necesidad
  de entregar credenciales administrativas al recolector. Esta separación está
  implementada para monitorización, no para todos los servicios de la aplicación.
- **Evidencia:** [config/prisma.ts](../src/config/prisma.ts),
  [env.ts](../src/config/env.ts) y
  [provision-postgres-monitor.sh](../deploy/observability/provision-postgres-monitor.sh).
- **Fuentes:** [OWASP Denial of Service, recursos limitados][f11],
  [OWASP Database Security, mínimo privilegio][f17] y
  [PostgreSQL, `pg_monitor`][f18].

## 5. Arquitectura y comunicaciones

### SEG-43. Ingreso público mediante conexiones salientes del túnel

- **Decisión y justificación:** `cloudflared` conecta el origen con Cloudflare;
  los clientes públicos acceden por los hostnames publicados. No se necesitan
  puertos HTTP/HTTPS entrantes en el VPS. Se reduce la exposición directa del
  origen y la posibilidad de evitar el punto de entrada previsto.
- **Evidencia:** [compose.cloudflare.yaml](../compose.cloudflare.yaml),
  [ADR-0012](adr/adr-0012-cloudflare-workers-tunnel-deployment.md) y
  [despliegue](despliegue.md).
- **Fuente:** [Cloudflare Tunnel, modelo outbound-only][f19].

### SEG-44. API y Grafana publicados solo en loopback; BD sin puerto publicado

- **Decisión y justificación:** los binds del host para API y Grafana son
  `127.0.0.1`; PostgreSQL no publica puertos. El túnel accede por las redes de
  contenedores. Esto evita exponer servicios internos por todas las interfaces,
  una protección importante porque las reglas de Docker pueden eludir UFW.
- **Evidencia:** [compose.prod.yaml](../compose.prod.yaml),
  [compose.observability.yaml](../compose.observability.yaml) y
  [verificador del host](../deploy/host/verify.sh).
- **Fuentes:** [OWASP Docker Security, regla 5a][f20] y
  [OWASP Database Security, aislamiento de BD][f17].

### SEG-45. Segmentación por función y relaciones necesarias

- **Decisión y justificación:** aplicación, observabilidad, métricas, exporter de
  PostgreSQL y acceso a la API Docker utilizan redes diferenciadas. `metrics`,
  `postgres-metrics` y `docker-api` son `internal: true`. Se reduce el número de
  servicios con conectividad a componentes sensibles. Los miembros de una misma
  red conservan conectividad entre sí: pertenecer a una red no equivale a una
  autorización por endpoint.
- **Evidencia:** redes de [compose.prod.yaml](../compose.prod.yaml),
  [compose.observability.yaml](../compose.observability.yaml) y
  [compose.cloudflare.yaml](../compose.cloudflare.yaml).
- **Fuente:** [OWASP Docker Security, regla 5, redes explícitas][f20].

### SEG-46. Acceso administrativo de Grafana con barreras separadas

- **Decisión y justificación:** el ADR registra Cloudflare Access para Grafana;
  el contenedor deshabilita anónimos y autorregistro y exige contraseña inicial y
  clave secreta configuradas. Su cookie es `Secure` en el overlay público. Esto
  protege registros y paneles sensibles mediante control de entrada y
  autenticación de la herramienta. La política Access vive en Cloudflare y se
  evidencia documentalmente, no en el YAML por sí solo.
- **Evidencia:** [compose.observability.yaml](../compose.observability.yaml),
  [compose.cloudflare.yaml](../compose.cloudflare.yaml) y
  [ADR-0012](adr/adr-0012-cloudflare-workers-tunnel-deployment.md).
- **Fuentes:** [Cloudflare Access para aplicaciones HTTP propias][f21] y
  [OWASP Logging, acceso restringido a registros][f16].

### SEG-47. HTTPS público y SMTP con validación TLS

- **Decisión y justificación:** la topología documentada utiliza HTTPS en el
  borde de Cloudflare. Para el correo, producción exige STARTTLS cuando no se usa
  TLS implícito, acepta como mínimo TLS 1.2 y valida certificados. Se protegen
  contraseñas, tokens y enlaces de identidad durante esos transportes. Los saltos
  HTTP internos entre contenedores siguen siendo una frontera distinta del TLS
  público.
- **Evidencia:** [ADR-0012](adr/adr-0012-cloudflare-workers-tunnel-deployment.md),
  [despliegue](despliegue.md) y [email.ts](../src/lib/email.ts).
- **Fuentes:** [OWASP REST Security, «HTTPS»][f03] y
  [OWASP Transport Layer Security][f22].

### SEG-48. Confianza del proxy y JWKS alineados con la topología

- **Decisión y justificación:** `trust proxy=1` corresponde al ingreso previsto
  por `cloudflared`, de modo que la IP utilizada por los limitadores deriva de
  esa cadena. El verificador y health consultan JWKS por loopback en Compose,
  conservando emisor y audiencia públicos. Se evita depender de challenges del
  borde para verificar identidad. Cambiar o añadir un ingreso exige revisar esta
  confianza; loopback no significa desactivar la validación JWT.
- **Evidencia:** [app.ts](../src/app.ts),
  [auth-jwks.ts](../src/config/auth-jwks.ts),
  [compose.prod.yaml](../compose.prod.yaml) y
  [ADR-0012](adr/adr-0012-cloudflare-workers-tunnel-deployment.md).
- **Fuentes:** [Express, aplicaciones detrás de proxies][f23] y
  [RFC 8725, validación de emisor y audiencia][f04].

## 6. Contenedores y construcción de imágenes

### SEG-49. API ejecutada como usuario no root

- **Decisión y justificación:** las etapas de ejecución y migración usan
  `USER node`; Alloy y Telegraf también fijan usuarios no privilegiados. Una
  ejecución de código dentro de esos procesos no obtiene automáticamente los
  privilegios de root del contenedor. Esto reduce impacto, sin convertir el
  aislamiento de contenedores en una barrera infalible frente al host.
- **Evidencia:** [Dockerfile](../Dockerfile) y
  [compose.observability.yaml](../compose.observability.yaml).
- **Fuente:** [OWASP Docker Security, regla 2][f20].

### SEG-50. Capacidades Linux mínimas y sin nuevos privilegios

- **Decisión y justificación:** Compose aplica `no-new-privileges:true` y
  `cap_drop: ALL`; PostgreSQL recupera solo las capacidades explícitas de su
  inicialización. El daemon también fija `no-new-privileges`. Se reducen las
  operaciones privilegiadas disponibles y la escalada mediante ejecutables
  setuid/setgid.
- **Evidencia:** [compose.prod.yaml](../compose.prod.yaml),
  [compose.observability.yaml](../compose.observability.yaml),
  [compose.cloudflare.yaml](../compose.cloudflare.yaml) y
  [daemon.json](../deploy/host/docker/daemon.json).
- **Fuente:** [OWASP Docker Security, reglas 3 y 4][f20].

### SEG-51. Filesystem de ejecución y configuraciones de solo lectura

- **Decisión y justificación:** la API usa `read_only: true` y `/tmp` en tmpfs;
  el proxy y varios exporters siguen ese patrón. Las configuraciones de
  observabilidad se montan con `:ro`. Se limita la modificación persistente de
  ejecutables y configuraciones desde un proceso comprometido, manteniendo las
  escrituras temporales explícitas.
- **Evidencia:** [compose.prod.yaml](../compose.prod.yaml) y
  [compose.observability.yaml](../compose.observability.yaml).
- **Fuente:** [OWASP Docker Security, regla 8][f20].

### SEG-52. Límites de memoria, CPU y procesos

- **Decisión y justificación:** los servicios tienen techos de memoria y PIDs;
  varios incluyen CPU. La API tiene por defecto 768 MiB, 2 CPU y 256 PIDs. Estos
  límites acotan el impacto de fugas, sobrecarga o creación masiva de procesos
  sobre un VPS compartido por todos los componentes. Son techos, no reservas ni
  una garantía de que el sistema mantenga capacidad bajo cualquier ataque.
- **Evidencia:** [compose.prod.yaml](../compose.prod.yaml),
  [compose.observability.yaml](../compose.observability.yaml) y
  [compose.cloudflare.yaml](../compose.cloudflare.yaml).
- **Fuente:** [OWASP Docker Security, regla 7][f20].

### SEG-53. Socket Docker mediado por un proxy con operaciones permitidas

- **Decisión y justificación:** Alloy y Telegraf acceden por un proxy con
  `POST=0`, ejecución y mutaciones deshabilitadas y familias de lectura
  seleccionadas. Solo el proxy monta el socket. Se reduce la autoridad de los
  recolectores sobre el host. La barrera es el filtrado de la API: montar un
  socket con `:ro` por sí solo no vuelve de solo lectura sus operaciones.
- **Evidencia:** servicio `docker-socket-proxy` en
  [compose.observability.yaml](../compose.observability.yaml).
- **Fuente:** [OWASP Docker Security, regla 1][f20].

### SEG-54. Imágenes y dependencias con versiones reproducibles

- **Decisión y justificación:** las imágenes externas de Compose fijan tag y
  digest; la API local exige `IMAGE_TAG`. El Dockerfile fija versiones de Node y
  pnpm e instala con `--frozen-lockfile`. Se reducen cambios inesperados entre
  construcciones y se facilita identificar qué se desplegó. La base Node está
  fijada por versión, no por digest; el tag de API requiere no reutilizarse.
- **Evidencia:** [Dockerfile](../Dockerfile), [pnpm-lock.yaml](../pnpm-lock.yaml),
  archivos Compose y [ADR-0007](adr/adr-0007-structured-logging-and-observability.md).
- **Fuentes:** [Docker Build, «Pin base image versions»][f24] y
  [OWASP Docker Security, regla 9][f20].

### SEG-55. Imagen de runtime mínima y secretos fuera del contexto de build

- **Decisión y justificación:** la construcción multietapa separa compilación,
  migración y runtime; este último recibe dependencias productivas y `dist`.
  `.dockerignore` excluye `.env*`, Git y artefactos de desarrollo. Esto reduce
  herramientas disponibles tras una intrusión y evita incorporar secretos
  locales al contexto y a las capas de construcción.
- **Evidencia:** [Dockerfile](../Dockerfile) y [.dockerignore](../.dockerignore).
- **Fuentes:** [Docker Build, multietapa y exclusión del contexto][f24] y
  [OWASP Secrets Management][f25].

## 7. Endurecimiento y administración del VPS

Estos controles corresponden a artefactos versionados en `deploy/` y a su
aplicación operativa. [ADR-0013](adr/adr-0013-vps-hardening-baseline.md) registra
la verificación de producción del 20 de octubre de 2026.

### SEG-56. SSH con claves, sin root ni contraseña

- **Decisión y justificación:** SSH exige `publickey`, deshabilita root,
  contraseñas e interacción de teclado, restringe a `AllowGroups sudo` y limita
  intentos, sesiones y tiempo de login. Se elimina la adivinación de contraseñas
  como vía normal de acceso remoto y se reduce la superficie de autenticación.
- **Evidencia:** [10-sipeg-hardening.conf](../deploy/host/ssh/10-sipeg-hardening.conf).
- **Fuente:** [OpenSSH `sshd_config`, autenticación y límites de acceso][f26].

### SEG-57. Forwarding y túneles SSH deshabilitados

- **Decisión y justificación:** se deshabilitan X11, agent forwarding, TCP
  forwarding y túneles; las comprobaciones de cliente inactivo ayudan a cerrar
  conexiones que dejaron de responder. Se reduce el uso de SSH como pivote hacia
  otros servicios y la exposición de un agente de claves reenviado.
- **Evidencia:** [10-sipeg-hardening.conf](../deploy/host/ssh/10-sipeg-hardening.conf).
- **Fuente:** [OpenSSH `sshd_config`, opciones de forwarding y ClientAlive][f26].

### SEG-58. Firewall de entrada restrictivo y bloqueo de intentos SSH

- **Decisión y justificación:** UFW niega entradas por defecto y permite SSH
  por CIDR administrativo cuando se configura, o con limitación de tasa. Fail2ban
  añade un jail SSH respaldado por systemd. Se reducen conexiones no necesarias
  e intentos repetidos desde una misma procedencia. El puerto 22 sigue siendo la
  excepción de ingreso público prevista.
- **Evidencia:** [ufw/setup.sh](../deploy/host/ufw/setup.sh),
  [sshd.local](../deploy/host/fail2ban/sshd.local) y
  [install.sh](../deploy/host/install.sh).
- **Fuentes:** [Ubuntu Server, firewall UFW][f27] y
  [Fail2ban, funcionamiento del bloqueo por intentos][f28].

### SEG-59. Actualizaciones de seguridad del host y Docker

- **Decisión y justificación:** `unattended-upgrades` habilita orígenes de
  seguridad de Ubuntu y el origen Docker, con reinicio automático a las 03:00;
  `needrestart` se configura para reinicios de servicios. Se acorta el tiempo
  durante el cual permanecen vulnerabilidades corregidas en paquetes del host.
  Esto no actualiza por sí mismo las dependencias Node ni las imágenes fijadas
  por digest.
- **Evidencia:** [configuración APT](../deploy/host/apt/50unattended-upgrades),
  [20auto-upgrades](../deploy/host/apt/20auto-upgrades),
  [needrestart](../deploy/host/apt/99-sipeg-needrestart.conf) y
  [docker.sources](../deploy/host/apt/docker.sources).
- **Fuentes:** [Ubuntu Server, actualizaciones automáticas y orígenes][f29] y
  [OWASP Docker Security, regla 0][f20].

### SEG-60. Menor exposición de memoria, kernel y enlaces del filesystem

- **Decisión y justificación:** se activa ASLR completo, se restringen mensajes
  y punteros del kernel y se limita `ptrace` con Yama. Se protegen hardlinks y
  symlinks y se fijan límites de core dumps en sesiones PAM junto con
  `fs.suid_dumpable=0`. Se dificultan inspección de memoria, filtración de
  direcciones y ciertos abusos de enlaces. Los límites PAM no prueban la ausencia
  de todos los volcados generados por otros recolectores del sistema.
- **Evidencia:** [sysctl de hardening](../deploy/host/sysctl/99-sipeg-hardening.conf)
  y [límites de core](../deploy/host/limits/99-sipeg-limits.conf).
- **Fuentes:** [Linux, sysctl del kernel][f30], [Yama][f31] y
  [protecciones del filesystem][f32].

### SEG-61. Red del kernel endurecida sin romper el enrutado de Docker

- **Decisión y justificación:** se deshabilitan source routing y redirecciones
  ICMP, se activan SYN cookies y se usa reverse-path filtering en modo loose por
  las rutas asimétricas de Docker. Se reducen ciertas manipulaciones de ruta y
  el efecto de desbordar la cola SYN. Se mantiene `ip_forward` porque los bridges
  lo necesitan; SYN cookies no sustituyen la gestión de capacidad.
- **Evidencia:** [99-sipeg-hardening.conf](../deploy/host/sysctl/99-sipeg-hardening.conf).
- **Fuente:** [Linux, IP sysctl: redirects, source route, rp_filter y tcp_syncookies][f33].

### SEG-62. Elevación sudo con sesión corta y terminal dedicado

- **Decisión y justificación:** sudo fija `timestamp_timeout=5`, `use_pty` y
  `passwd_tries=3`. Se reduce la reutilización prolongada de una autenticación
  privilegiada y se limita la interacción con procesos lanzados fuera de un
  pseudoterminal propio.
- **Evidencia:** [90-sipeg](../deploy/host/sudoers/90-sipeg).
- **Fuente:** [sudoers, timestamp_timeout, use_pty y passwd_tries][f34].

### SEG-63. Auditoría de archivos y superficies administrativas

- **Decisión y justificación:** auditd vigila configuración SSH, sudoers,
  Docker, firewall, timer de backup y accesos al archivo de secretos de producción.
  Permite investigar cambios y accesos a componentes que pueden alterar la
  postura de seguridad. El verificador también comprueba la presencia de AIDE;
  su instalación y ejecución diaria se registran en el ADR, no en un componente
  propio de instalación AIDE dentro del repositorio.
- **Evidencia:** [reglas auditd](../deploy/host/auditd/99-sipeg.rules),
  [verify.sh](../deploy/host/verify.sh) y
  [ADR-0013](adr/adr-0013-vps-hardening-baseline.md).
- **Fuentes:** [auditctl, reglas de vigilancia de archivos][f35] y
  [OWASP Logging, detección de alteraciones][f16].

### SEG-64. Endurecimiento versionado, respaldado y verificable

- **Decisión y justificación:** el instalador copia configuraciones desde Git,
  respalda archivos reemplazados y valida SSH/sudo antes de recargar. El script
  de verificación comprueba controles efectivos con resultados PASS/FAIL.
  Esto hace repetible la configuración y permite detectar desviaciones o
  recuperar una versión anterior tras un cambio fallido.
- **Evidencia:** [install.sh](../deploy/host/install.sh),
  [verify.sh](../deploy/host/verify.sh) y [runbook](../deploy/README.md).
- **Fuentes:** [OpenSSH `sshd`, validación de configuración con `-t`][f42],
  [sudoers, validación con visudo][f34] y
  [OWASP Docker Security, verificación de configuraciones][f20].

## 8. Auditoría, registros y monitorización

### SEG-65. Logs estructurados y correlación de eventos

- **Decisión y justificación:** la aplicación emite JSON con tipo de evento,
  servicio, entorno y versión. Un request ID se acepta solo con formato UUID o
  se genera uno; se propaga mediante contexto y se devuelve al cliente. Los
  accesos registran plantillas de rutas, no la URL completa con consultas.
  Se facilita reconstruir una interacción sin registrar parámetros sensibles.
- **Evidencia:** [logger.ts](../src/config/logger.ts),
  [requestLogger.middleware.ts](../src/middlewares/requestLogger.middleware.ts) y
  [log-context.ts](../src/lib/log-context.ts).
- **Fuente:** [OWASP Logging, atributos e identificador de interacción][f16].

### SEG-66. Redacción de credenciales y seudonimización

- **Decisión y justificación:** el logger redacta rutas de passwords, tokens,
  Authorization y cookies; en producción limita el objeto de error a su tipo.
  Los eventos de identidad utilizan HMAC-SHA256 con una clave requerida en
  producción para seudonimizar sujetos. Se conserva correlación sin escribir
  directamente esas identidades o credenciales. La seudonimización no convierte
  los registros en datos anónimos ni protege campos arbitrarios no cubiertos.
- **Evidencia:** [logger.ts](../src/config/logger.ts),
  [pseudonymize.ts](../src/utils/pseudonymize.ts) y [env.ts](../src/config/env.ts).
- **Fuente:** [OWASP Logging, «Data to exclude»][f16].

### SEG-67. Eventos de seguridad conservados al reducir el nivel de log

- **Decisión y justificación:** accesos y seguridad utilizan un logger que en
  producción conserva nivel `info`, independiente del `LOG_LEVEL` de aplicación.
  Se registran login, token inválido, cuenta desactivada, denegaciones y límites
  excedidos. Se evita perder evidencia necesaria por subir el umbral para reducir
  ruido de aplicación.
- **Evidencia:** `accessLogger` y `securityLogger` en
  [logger.ts](../src/config/logger.ts),
  [authenticate.middleware.ts](../src/middlewares/authenticate.middleware.ts),
  [authorize.middleware.ts](../src/middlewares/authorize.middleware.ts) y
  [rateLimit.middleware.ts](../src/middlewares/rateLimit.middleware.ts).
- **Fuente:** [OWASP Logging, eventos a registrar y niveles configurables][f16].

### SEG-68. Auditoría con payload permitido y lectura administrativa

- **Decisión y justificación:** la escritura de auditoría valida un catálogo de
  claves y rechaza valores que parezcan secretos. Su consulta HTTP requiere
  `ADMIN`, filtros validados y paginación por cursor. Se reduce la captura
  accidental de datos sensibles y el acceso indiscriminado a acciones históricas.
- **Evidencia:** [audit.service.ts](../src/modules/audit/audit.service.ts),
  [audit.types.ts](../src/modules/audit/audit.types.ts) y
  [audit.routes.ts](../src/modules/audit/audit.routes.ts).
- **Fuente:** [OWASP Logging, minimización y protección del acceso a registros][f16].

### SEG-69. Auditoría de identidad posterior a la operación crítica

- **Decisión y justificación:** los hooks del proveedor capturan al sujeto sin
  escribir auditoría. El servicio registra el evento después del éxito del
  proveedor, especialmente tras completar la revocación del reset. Se evita que
  una falla de la bitácora dentro de un hook interrumpa la revocación de sesiones.
  La contrapartida es que esas operaciones y su auditoría no son atómicas.
- **Evidencia:** [auth.audit.ts](../src/modules/auth/auth.audit.ts),
  [auth.ts](../src/lib/auth.ts),
  [auth.service.ts](../src/modules/auth/auth.service.ts) y
  [ADR-0008](adr/adr-0008-durable-audit-events.md).
- **Fuente:** [OWASP Logging, evitar que fallos del logging rompan funciones de la aplicación][f16].

### SEG-70. Retención y almacenamiento de registros acotados

- **Decisión y justificación:** Docker rota el spool local a 5 archivos de 20 MiB;
  journald tiene límites; Loki configura 30 días generales y 90 para seguridad.
  La auditoría tiene una herramienta de purga con retención predeterminada de
  365 días, simulación inicial, respaldo fuera del proyecto, operador y evento de
  purga. Se limita el uso de disco y se hace explícita la intervención sobre el
  historial. Tener la herramienta no demuestra que se ejecute periódicamente.
- **Evidencia:** [compose.prod.yaml](../compose.prod.yaml),
  [límites journald](../deploy/host/journald/limits.conf),
  [configuración Loki](../observability/loki/config.yaml) y
  [purge-audit-events.ts](../prisma/scripts/purge-audit-events.ts).
- **Fuente:** [OWASP Logging, disponibilidad, verificación y eliminación de logs][f16].

### SEG-71. Métricas privadas, etiquetas cerradas y secretos del exporter

- **Decisión y justificación:** `/metrics` utiliza un listener distinto del
  puerto de negocio y no se publica al host o túnel. Las etiquetas usan catálogo
  y plantillas, evitando IDs, emails y consultas; esto reduce filtración y
  cardinalidad descontrolada. La contraseña del exporter se monta desde un
  archivo secreto protegido, no se fija en el YAML. Las redes restringen quién
  alcanza los exporters; el listener de métricas no implementa autenticación propia.
- **Evidencia:** [metrics.server.ts](../src/observability/metrics.server.ts),
  [metrics.ts](../src/observability/metrics.ts),
  [httpMetrics.middleware.ts](../src/middlewares/httpMetrics.middleware.ts),
  [compose.observability.yaml](../compose.observability.yaml) y
  [provision-postgres-monitor.sh](../deploy/observability/provision-postgres-monitor.sh).
- **Fuentes:** [Prometheus, modelo de seguridad][f36],
  [nombres y cardinalidad de etiquetas][f37] y
  [OWASP Secrets Management][f25].

### SEG-72. Alertas y comprobaciones orientadas a incidentes

- **Decisión y justificación:** Grafana provisiona alertas sobre errores, disco
  y otras señales operativas, junto con políticas y un contacto de correo.
  Health y Blackbox permiten diferenciar disponibilidad interna de pública.
  Se facilita detectar indisponibilidad o degradación y notificar al operador;
  los paneles por sí solos no constituyen un sistema de prevención de intrusiones.
- **Evidencia:** [reglas de métricas](../observability/grafana/provisioning/alerting/metrics.yaml),
  [reglas de logs](../observability/grafana/provisioning/alerting/rules.yaml),
  [contactos](../observability/grafana/provisioning/alerting/contact-points.yaml),
  [Blackbox](../observability/blackbox/blackbox.yml) y
  [health.controller.ts](../src/modules/health/health.controller.ts).
- **Fuente:** [OWASP Logging, monitorización y alertas][f16].

## 9. Backups y recuperación

### SEG-73. Backups cifrados con acceso restringido

- **Decisión y justificación:** un timer programa `pg_dump -Fc`; el resultado
  se cifra con AES-256-CBC, salt y PBKDF2 de 600 000 iteraciones. La clave se lee
  de archivo, los backups tienen modo `600` y el directorio `700`. Se protege
  la confidencialidad de las copias y se evita pasar la clave en texto por argv.
  CBC no aporta autenticación criptográfica del backup; no se atribuye esa
  propiedad al cifrado usado.
- **Evidencia:** [pg-backup.sh](../deploy/backup/pg-backup.sh),
  [timer](../deploy/backup/sipeg-pg-backup.timer) y
  [runbook de backups](../deploy/README.md).
- **Fuentes:** [OWASP Database Security, protección de backups][f17],
  [PostgreSQL `pg_dump`][f38] y [OpenSSL `enc`, opciones y limitaciones][f39].

### SEG-74. Restauración verificable en una BD efímera

- **Decisión y justificación:** existe un script que descifra la copia reciente,
  restaura en un contenedor separado y consulta migraciones y usuarios; limpia
  temporales al terminar. Se comprueba la posibilidad básica de recuperar datos
  sin sobrescribir producción. Es una comprobación de restauración técnica, no
  una validación exhaustiva de todos los flujos ni del tiempo de recuperación.
- **Evidencia:** [pg-restore-verify.sh](../deploy/backup/pg-restore-verify.sh) y
  [ADR-0013](adr/adr-0013-vps-hardening-baseline.md).
- **Fuentes:** [CISA, mantener y probar backups][f40] y
  [PostgreSQL `pg_dump`, formatos restaurables][f38].

### SEG-75. Retención de copias y custodia separada de la clave

- **Decisión y justificación:** el backup tiene retención local configurable
  —14 días por defecto— y la operación documenta conservar la clave fuera del
  VPS. Se acota el almacenamiento y se separa la custodia de la clave. Existe un
  hook `OFFSITE_CMD`, pero ADR-0013 registra que está vacío: las copias actuales
  son locales y no cubren la pérdida completa del VPS.
- **Evidencia:** [pg-backup.sh](../deploy/backup/pg-backup.sh),
  [backup.env.example](../deploy/backup/backup.env.example) y
  [ADR-0013, IMP-013](adr/adr-0013-vps-hardening-baseline.md).
- **Fuentes:** [OWASP Secrets Management, custodia y ciclo de vida][f25] y
  [CISA, copias offline y recuperación][f40].

## 10. Desarrollo y mantenimiento verificable

### SEG-76. Secretos externos y configuración validada al arrancar

- **Decisión y justificación:** las credenciales se suministran por entorno o
  archivos del host; Git excluye `.env*` y overrides privados de Bruno. El arranque
  valida secretos mínimos, BD, correo productivo y combinaciones de opciones.
  Se reduce la probabilidad de versionar credenciales o arrancar con una
  configuración incompleta. Las plantillas muestran nombres y valores de ejemplo,
  no demuestran los permisos efectivos de archivos privados en el VPS.
- **Evidencia:** [.gitignore](../.gitignore), [env.ts](../src/config/env.ts),
  [.env.prod.example](../.env.prod.example) y [runbook](../deploy/README.md).
- **Fuentes:** [OWASP Secrets Management][f25] y
  [OWASP Database Security, almacenamiento de credenciales][f17].

### SEG-77. Inicialización y arranque con dependencias explícitas

- **Decisión y justificación:** Compose inicia la API después de migraciones y
  seed base exitosos; este seed conserva ediciones administrativas y el seed demo
  está bloqueado en producción salvo habilitación explícita. Healthchecks y
  reinicio de contenedores ayudan a la recuperación, y Node maneja SIGTERM con
  cierre de servidores y conexiones dentro de un plazo. Se reducen arranques
  inconsistentes y terminaciones con operaciones pendientes.
- **Evidencia:** [compose.prod.yaml](../compose.prod.yaml),
  [seed base](../prisma/seed/base.seed.ts),
  [guard del seed demo](../prisma/seed/helpers.ts),
  [Dockerfile](../Dockerfile), [server.ts](../src/server.ts) y
  [ADR-0005](adr/adr-0005-production-baseline-seed.md).
- **Fuentes:** [PostgreSQL, integridad transaccional][f07] y
  [Express, healthchecks y graceful shutdown][f41].

### SEG-78. Contratos y pruebas que permiten detectar regresiones de seguridad

- **Decisión y justificación:** los esquemas públicos alimentan OpenAPI, existe
  comprobación de deriva del contrato y hay pruebas de autenticación,
  autorización, delegación, cookies, rate limiting, privacidad de logs y triggers.
  Estas comprobaciones permiten detectar que un cambio retire una restricción
  existente. Su presencia no equivale a una prueba de penetración ni demuestra
  que un pipeline automático ejecute todos los controles.
- **Evidencia:** [package.json](../package.json), [generate.ts](../src/docs/generate.ts),
  [pruebas de delegación](../src/modules/authorization/delegation.service.test.ts),
  [pruebas de cookies](../src/modules/auth/auth.cookie.test.ts),
  [pruebas de logs](../src/config/logger.test.ts) y
  [pruebas de integridad de auditoría](../src/modules/audit/audit.integration.test.ts).
- **Fuentes:** [OWASP Authorization, pruebas unitarias y de integración][f08] y
  [OWASP Logging, «Verification»][f16].

### SEG-79. Referencia temporal explícita para reglas e historial

- **Decisión y justificación:** las fechas de negocio se calculan en
  `America/Panama`, y los instantes de auditoría y vigencia se representan como
  timestamps con zona y se exponen en UTC. Se evita que el huso horario del
  servidor cambie qué actividades están en curso o pueden archivarse, y se
  mantiene una referencia comparable para investigar eventos y vencimientos.
  Esta decisión no demuestra por sí misma sincronización NTP del host.
- **Evidencia:** [date.ts](../src/utils/date.ts),
  [activities.status.ts](../src/modules/activities/activities.status.ts),
  [schema.prisma](../prisma/schema.prisma) y
  [ADR-0002](adr/adr-0002-institutional-timezone-panama.md).
- **Fuente:** [OWASP Logging, timestamps y correlación temporal de eventos][f16].

## 11. Precisiones sobre el alcance de las protecciones

Estas precisiones delimitan las decisiones anteriores y evitan atribuirles
garantías que el código no ofrece:

- **Contraseñas:** el código admite 12–20 caracteres. El respaldo de SEG-01
  corresponde al algoritmo y su perfil de coste; no justifica el máximo de 20
  como recomendación universal de seguridad.
- **JWT y logout:** revocar la sesión o resetear la contraseña impide refrescar;
  los JWT ya emitidos siguen válidos hasta expirar. La carga de usuario actual sí
  bloquea cuentas desactivadas y utiliza su rol actual.
- **Contenido y claves JWT:** el payload está firmado, no cifrado, y contiene
  email y otros claims. `disablePrivateKeyEncryption: true` almacena la clave
  privada sin el cifrado adicional del plugin en la tabla JWKS. La protección de
  BD y de sus copias sigue siendo esencial.
- **Almacenamiento de sesiones:** `Session.token` contiene la credencial
  reutilizable. El hash del limitador de refresh no significa que los tokens
  estén hasheados en la tabla de sesiones.
- **CORS y CSRF:** CORS regula acceso del navegador. El middleware de origen
  permite peticiones sin `Origin`; no implementa un token CSRF ni fallback de
  `Referer`. SameSite y la comprobación de origen son capas con ese alcance.
- **Rate limiting:** los limitadores Express no configuran un almacén
  distribuido: sus contadores son locales al proceso. El bucket de refresh cambia
  al rotar el token, por lo que no limita de manera acumulativa una sucesión de
  rotaciones válidas.
- **BD y privilegios:** Compose usa el mismo `POSTGRES_USER` para API, migración
  y seed. El rol separado de mínimo privilegio descrito es el de monitorización;
  no se demuestra una separación DDL/DML del usuario de la API. Los triggers
  pueden ser desactivados por quien tenga autoridad suficiente.
- **Cifrado interno y en reposo:** el túnel y SMTP protegen sus transportes. Las
  conexiones internas usan HTTP y el exporter de PostgreSQL declara
  `sslmode=disable`; no se demuestra TLS de todos los saltos ni cifrado del volumen
  principal de PostgreSQL.
- **Recuperación:** los backups cifrados y la restauración de prueba son controles
  existentes. La copia externa está pendiente según el ADR, por lo que perder el
  VPS también puede perder los backups locales.
- **Cloudflare y controles operativos:** Access, Always Use HTTPS y bypass de
  caché se sustentan en el ADR/runbook. Las listas de futuras medidas del runbook
  no prueban que WAF, reglas de rate limiting del borde, MFA administrativa o
  Turnstile estén efectivamente activados.
- **Funciones futuras:** la existencia de tablas de propuestas, CV, asistencia o
  historial no demuestra endpoints de upload, análisis de archivos, check-in o
  generación automática de certificados. Aquí se documentan sus restricciones de
  BD cuando existen.
- **Parches y reproducibilidad:** los parches del host no actualizan
  automáticamente imágenes fijadas ni paquetes del lockfile. Fijar versiones hace
  reproducible el despliegue, pero no certifica ausencia de vulnerabilidades.

## 12. Fuentes verificables

**Consulta:** 21 de octubre de 2026. Se priorizan OWASP, IETF, documentación de
los fabricantes, manuales de los proyectos y CISA. Los enlaces de cada decisión
remiten a estas fuentes; la evidencia local identifica la implementación concreta.

- **F01.** [OWASP — Password Storage][f01]: Argon2id, coste y perfiles alternativos.
- **F02.** [OWASP — Email Validation and Verification][f02]: control del correo.
- **F03.** [OWASP — REST Security][f03]: HTTPS, JWT, validación, errores,
  cabeceras, CORS y estado de flujos.
- **F04.** [IETF — RFC 8725][f04]: buenas prácticas de verificación de JWT.
- **F05.** [OWASP — Session Management][f05]: cookies, identificadores,
  renovación, expiración y revocación.
- **F06.** [OWASP — Forgot Password][f06]: recuperación, tokens, destinos
  confiables y no enumeración.
- **F07.** [PostgreSQL 18 — Transactions][f07]: atomicidad de cambios relacionados.
- **F08.** [OWASP — Authorization][f08]: mínimo privilegio, autorización por
  objeto y pruebas.
- **F09.** [PostgreSQL 18 — Constraints][f09]: CHECK, UNIQUE, claves foráneas y exclusión.
- **F10.** [OWASP — Mass Assignment][f10]: allowlists y objetos de transferencia limitados.
- **F11.** [OWASP — Denial of Service][f11]: límites de recursos y solicitudes.
- **F12.** [OWASP — CSRF Prevention][f12]: Origin/Referer, SameSite y sus limitaciones.
- **F13.** [OWASP — SQL Injection Prevention][f13]: separación de consultas y parámetros.
- **F14.** [PostgreSQL 18 — Triggers][f14]: reglas ejecutadas ante modificaciones.
- **F15.** [PostgreSQL 18 — Explicit Locking][f15]: sincronización de operaciones concurrentes.
- **F16.** [OWASP — Logging][f16]: eventos, minimización, protección, retención y alertas.
- **F17.** [OWASP — Database Security][f17]: aislamiento, credenciales, permisos y backups.
- **F18.** [PostgreSQL 18 — Predefined Roles][f18]: capacidades y alcance de `pg_monitor`.
- **F19.** [Cloudflare — Tunnel][f19]: conexiones iniciadas desde el origen.
- **F20.** [OWASP — Docker Security][f20]: usuarios, capacidades, socket, redes,
  filesystem y recursos.
- **F21.** [Cloudflare — Self-hosted public applications][f21]: control de acceso
  a aplicaciones HTTP propias.
- **F22.** [OWASP — Transport Layer Security][f22]: versiones TLS y validación de certificados.
- **F23.** [Express — Behind proxies][f23]: confianza en cabeceras según la cadena de proxies.
- **F24.** [Docker — Building best practices][f24]: multietapa, contexto mínimo y
  fijación de imágenes.
- **F25.** [OWASP — Secrets Management][f25]: custodia, acceso y ciclo de vida de secretos.
- **F26.** [OpenSSH — sshd_config][f26]: autenticación, forwarding y límites de acceso SSH.
- **F27.** [Ubuntu Server — Firewalls][f27]: políticas y funcionamiento de UFW.
- **F28.** [Fail2ban — README oficial][f28]: bloqueo de direcciones tras fallos detectados.
- **F29.** [Ubuntu Server — Automatic updates][f29]: actualizaciones, orígenes y reinicios.
- **F30.** [Linux — Kernel sysctl][f30]: ASLR, dmesg y exposición de punteros.
- **F31.** [Linux — Yama][f31]: limitación de inspección de procesos mediante ptrace.
- **F32.** [Linux — Filesystem sysctl][f32]: enlaces protegidos y comportamiento de dumps.
- **F33.** [Linux — IP sysctl][f33]: SYN cookies, filtros de ruta y redirecciones.
- **F34.** [Sudo — sudoers][f34]: caducidad de autenticación, PTY y validación.
- **F35.** [Linux man-pages — auditctl][f35]: reglas de auditoría de archivos.
- **F36.** [Prometheus — Security model][f36]: acceso a métricas y superficie HTTP.
- **F37.** [Prometheus — Metric and label naming][f37]: prevención de cardinalidad no acotada.
- **F38.** [PostgreSQL 18 — pg_dump][f38]: exportación lógica consistente y
  formatos de restauración.
- **F39.** [OpenSSL 3.5 — enc][f39]: AES, salt, PBKDF2 y ausencia de cifrado
  autenticado en `enc`.
- **F40.** [CISA — #StopRansomware Guide][f40]: copias protegidas, separadas y probadas.
- **F41.** [Express — Health checks and graceful shutdown][f41]: cierre de conexiones y recursos.
- **F42.** [OpenSSH — sshd][f42]: comprobación de configuración y claves con `-t`.

[f01]: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#argon2id
[f02]: https://cheatsheetseries.owasp.org/cheatsheets/Email_Validation_and_Verification_Cheat_Sheet.html
[f03]: https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html
[f04]: https://www.rfc-editor.org/rfc/rfc8725.html
[f05]: https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html
[f06]: https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html
[f07]: https://www.postgresql.org/docs/18/tutorial-transactions.html
[f08]: https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html
[f09]: https://www.postgresql.org/docs/18/ddl-constraints.html
[f10]: https://cheatsheetseries.owasp.org/cheatsheets/Mass_Assignment_Cheat_Sheet.html
[f11]: https://cheatsheetseries.owasp.org/cheatsheets/Denial_of_Service_Cheat_Sheet.html
[f12]: https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html
[f13]: https://cheatsheetseries.owasp.org/cheatsheets/SQL_Injection_Prevention_Cheat_Sheet.html
[f14]: https://www.postgresql.org/docs/18/triggers.html
[f15]: https://www.postgresql.org/docs/18/explicit-locking.html
[f16]: https://cheatsheetseries.owasp.org/cheatsheets/Logging_Cheat_Sheet.html
[f17]: https://cheatsheetseries.owasp.org/cheatsheets/Database_Security_Cheat_Sheet.html
[f18]: https://www.postgresql.org/docs/18/predefined-roles.html
[f19]: https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/
[f20]: https://cheatsheetseries.owasp.org/cheatsheets/Docker_Security_Cheat_Sheet.html
[f21]: https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/self-hosted-public-app/
[f22]: https://cheatsheetseries.owasp.org/cheatsheets/Transport_Layer_Security_Cheat_Sheet.html
[f23]: https://expressjs.com/en/guide/behind-proxies.html
[f24]: https://docs.docker.com/build/building/best-practices/
[f25]: https://cheatsheetseries.owasp.org/cheatsheets/Secrets_Management_Cheat_Sheet.html
[f26]: https://man.openbsd.org/sshd_config
[f27]: https://documentation.ubuntu.com/server/how-to/security/firewalls/
[f28]: https://github.com/fail2ban/fail2ban#readme
[f29]: https://documentation.ubuntu.com/server/how-to/software/automatic-updates/
[f30]: https://docs.kernel.org/admin-guide/sysctl/kernel.html
[f31]: https://docs.kernel.org/admin-guide/LSM/Yama.html
[f32]: https://docs.kernel.org/admin-guide/sysctl/fs.html
[f33]: https://docs.kernel.org/networking/ip-sysctl.html
[f34]: https://www.sudo.ws/docs/man/sudoers.man/
[f35]: https://man7.org/linux/man-pages/man8/auditctl.8.html
[f36]: https://prometheus.io/docs/operating/security/
[f37]: https://prometheus.io/docs/practices/naming/
[f38]: https://www.postgresql.org/docs/18/app-pgdump.html
[f39]: https://docs.openssl.org/3.5/man1/openssl-enc/
[f40]: https://www.cisa.gov/stopransomware/ransomware-guide
[f41]: https://expressjs.com/en/advanced/healthcheck-graceful-shutdown.html
[f42]: https://man.openbsd.org/sshd
[mig-inicial]: ../prisma/migrations/20260919053739_initialize_event_program_schema/migration.sql
[mig-permisos]: ../prisma/migrations/20260919091405_add_collaboration_permission_temporal_fields/migration.sql
[mig-unidades]: ../prisma/migrations/20260919093000_unify_organizational_units/migration.sql
[mig-asistencia]: ../prisma/migrations/20260919175329_move_checkin_codes_to_attendance/migration.sql
[mig-auditoria]: ../prisma/migrations/20260927171818_add_durable_audit_events/migration.sql
[mig-borrado]: ../prisma/migrations/20260927184500_add_activity_delete_permission_and_retention_guard/migration.sql
[mig-archivo]: ../prisma/migrations/20261004083747_temporal_archive_guard/migration.sql
