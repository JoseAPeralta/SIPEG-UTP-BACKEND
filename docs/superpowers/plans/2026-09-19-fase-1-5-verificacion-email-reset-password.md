# Fase 1.5 - Verificacion de email y recuperacion de contrasena Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar el checklist 1.5 del plan maestro: enviar tokens utilizables de verificacion y recuperacion, rechazar tokens vencidos, evitar enumeracion de cuentas, limitar abuso y revocar todas las sesiones despues de restablecer la contrasena.

**Architecture:** Better Auth 1.7.5 sigue siendo responsable de generar, validar y consumir tokens, actualizar `users.emailVerified`/`accounts.password` y eliminar sesiones. Se agrega un transporte SMTP minimo y desacoplado para los correos de identidad, con Mailpit solo en desarrollo; los callbacks no esperan el envio para reducir diferencias temporales y nunca registran destinatarios, URLs ni tokens. Los endpoints REST existentes conservan su forma y normalizan tokens invalidos o vencidos a errores genericos.

**Tech Stack:** TypeScript 6, Express 5, Better Auth 1.7.5, Prisma 7, Nodemailer, Mailpit, Zod 4, Vitest, Supertest, OpenAPI 3.1 y Bruno.

**Documentacion de referencia:** Better Auth 1.7 `Email` (`https://better-auth.com/docs/concepts/email`) y `Email & Password` (`https://better-auth.com/docs/authentication/email-password`); Nodemailer SMTP (`https://github.com/nodemailer/nodemailer/blob/master/_autodocs/api-reference/smtp-transport.md`).

**Hallazgos de partida (2026-09-19):**

- `src/lib/auth.ts` no define `sendVerificationEmail` ni `sendResetPassword`; `forgot-password` responde `RESET_PASSWORD_DISABLED` y el registro no envia correo.
- `sendOnSignUp` esta en `false`, `requireEmailVerification` esta en `false` y `autoSignInAfterVerification` crea una sesion que el wrapper REST no entrega.
- Better Auth usa 24 horas para verificacion por configuracion local y una hora implicita para reset, pero ningun test fija o comprueba esos TTL.
- `revokeSessionsOnPasswordReset` no esta habilitado; los refresh tokens sobreviven al cambio de contrasena.
- `forgot-password` y `reset-password` comparten una instancia de limiter, por lo que solicitar un correo consume la cuota necesaria para usar el token.
- La entrega SMTP general esta prevista para 6.4. Esta fase adelanta solo el transporte minimo y las dos plantillas de identidad necesarias para que 1.5 sea funcional.
- El arbol de trabajo ya contiene cambios de 1.1-1.3, seed y documentacion. No se revierten ni se incluyen cambios ajenos.

---

### Task 1: Transporte SMTP minimo (TDD)

**Files:**

- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `src/config/env.ts`
- Create: `src/lib/email.ts`
- Create: `src/lib/email.test.ts`
- Modify: `.env.example`

- [x] **Step 1: Instalar Nodemailer y sus tipos**

Run:

```bash
pnpm add nodemailer
pnpm add -D @types/nodemailer
```

Expected: `package.json` y `pnpm-lock.yaml` registran las dependencias sin actualizar paquetes no relacionados.

- [x] **Step 2: Escribir las pruebas fallidas del transporte**

Crear `src/lib/email.test.ts` con un mock de `nodemailer.createTransport` y comprobar que `sendEmail`:

```ts
expect(createTransport).toHaveBeenCalledWith(
  expect.objectContaining({
    host: 'smtp.test',
    port: 2525,
    secure: false,
    tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
  }),
);
expect(sendMail).toHaveBeenCalledWith({
  from: 'SIPEG UTP <no-reply@utp.ac.pa>',
  to: 'user@utp.ac.pa',
  subject: 'Subject',
  text: 'Body',
});
```

Agregar un caso con `MAIL_USER`/`MAIL_PASSWORD` que compruebe `auth`, y otro sin credenciales que compruebe que no se envia `auth: undefined` bajo `exactOptionalPropertyTypes`.

- [x] **Step 3: Verificar el rojo**

Run: `pnpm exec vitest run src/lib/email.test.ts`

Expected: FAIL porque `src/lib/email.ts` no existe.

- [x] **Step 4: Implementar configuracion y transporte**

Agregar a `src/config/env.ts`:

```ts
MAIL_HOST: optionalNonEmptyString,
MAIL_PORT: z.coerce.number().int().positive().max(65535).default(1025),
MAIL_SECURE: z.enum(['true', 'false']).transform((value) => value === 'true').default(false),
MAIL_USER: optionalNonEmptyString,
MAIL_PASSWORD: optionalNonEmptyString,
MAIL_FROM: z.string().min(1).default('SIPEG UTP <no-reply@sipeg.local>'),
AUTH_EMAIL_VERIFICATION_URL: z.string().url().default('http://localhost:5173/verify-email'),
AUTH_PASSWORD_RESET_URL: z.string().url().default('http://localhost:5173/reset-password'),
AUTH_EMAIL_VERIFICATION_TTL: ttlSchema.default('24h'),
AUTH_PASSWORD_RESET_TTL: ttlSchema.default('1h'),
```

En `superRefine`, exigir `MAIL_HOST` en produccion y que `MAIL_USER`/`MAIL_PASSWORD` aparezcan juntos. Crear `src/lib/email.ts` con un transporter perezoso:

```ts
export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export const sendEmail = async (message: EmailMessage): Promise<void> => {
  await getTransporter().sendMail({
    from: env.MAIL_FROM,
    to: message.to,
    subject: message.subject,
    text: message.text,
  });
};
```

El SMTP usa `env.MAIL_HOST ?? '127.0.0.1'`, TLS minimo 1.2, certificados validos y `requireTLS` en produccion cuando `MAIL_SECURE=false`. No registrar errores SMTP completos porque pueden contener destinatarios o contenido.

- [x] **Step 5: Documentar las variables y verificar verde**

Agregar las variables anteriores a `.env.example`, sin credenciales reales. Run: `pnpm exec vitest run src/lib/email.test.ts`

Expected: PASS.

### Task 2: Correos de identidad y callbacks no bloqueantes (TDD)

**Files:**

- Create: `src/modules/auth/auth.email.ts`
- Create: `src/modules/auth/auth.email.test.ts`
- Modify: `src/lib/auth.ts`
- Modify: `src/lib/auth.test.ts`

- [x] **Step 1: Escribir pruebas fallidas para las URLs y cuerpos**

Crear `src/modules/auth/auth.email.test.ts`, mockear `sendEmail` y comprobar:

```ts
await sendVerificationEmail('user@utp.ac.pa', 'verify token/+');
expect(sendEmail).toHaveBeenCalledWith(
  expect.objectContaining({
    to: 'user@utp.ac.pa',
    subject: 'Verifica tu correo de SIPEG UTP',
    text: expect.stringContaining('http://localhost:5173/verify-email?token=verify+token%2F%2B'),
  }),
);
```

Repetir para `sendPasswordResetEmail` y `AUTH_PASSWORD_RESET_URL`. La URL se construye con `URL`/`searchParams`, no por concatenacion sin escape.

- [x] **Step 2: Verificar el rojo**

Run: `pnpm exec vitest run src/modules/auth/auth.email.test.ts`

Expected: FAIL porque `auth.email.ts` no existe.

- [x] **Step 3: Implementar las dos plantillas de texto**

Crear `auth.email.ts` con `sendVerificationEmail(email, token)` y `sendPasswordResetEmail(email, token)`. Los mensajes incluyen el enlace, el tiempo de vigencia configurado y una instruccion para ignorar el correo si no se solicito; no incluyen password, hash ni refresh token.

- [x] **Step 4: Escribir pruebas fallidas de configuracion Better Auth**

Extender `src/lib/auth.test.ts` para comprobar:

```ts
expect(auth.options.emailAndPassword).toMatchObject({
  requireEmailVerification: true,
  resetPasswordTokenExpiresIn: 3600,
  revokeSessionsOnPasswordReset: true,
  sendResetPassword: expect.any(Function),
});
expect(auth.options.emailVerification).toMatchObject({
  sendOnSignUp: true,
  autoSignInAfterVerification: false,
  expiresIn: 86400,
  sendVerificationEmail: expect.any(Function),
});
```

Mockear las funciones de `auth.email.ts` con promesas pendientes e invocar ambos callbacks. Comprobar que cada callback resuelve sin esperar esas promesas, como recomienda Better Auth para reducir timing attacks, y que un rechazo se captura sin `unhandledRejection` ni loguear token/URL.

- [x] **Step 5: Verificar el rojo e implementar callbacks**

Run: `pnpm exec vitest run src/lib/auth.test.ts`

Expected: FAIL por opciones ausentes o valores actuales. Luego modificar `src/lib/auth.ts`:

```ts
emailAndPassword: {
  // opciones existentes
  requireEmailVerification: true,
  resetPasswordTokenExpiresIn: parseTtlToSeconds(env.AUTH_PASSWORD_RESET_TTL),
  revokeSessionsOnPasswordReset: true,
  sendResetPassword: ({ user, token }) => {
    void sendPasswordResetEmail(user.email, token).catch(reportEmailDeliveryFailure);
  },
},
emailVerification: {
  sendOnSignUp: true,
  autoSignInAfterVerification: false,
  expiresIn: parseTtlToSeconds(env.AUTH_EMAIL_VERIFICATION_TTL),
  sendVerificationEmail: ({ user, token }) => {
    void sendVerificationEmail(user.email, token).catch(reportEmailDeliveryFailure);
  },
},
```

Cambiar la regla interna obsoleta `'/forget-password'` a `'/request-password-reset'`.

- [x] **Step 6: Verificar verde**

Run: `pnpm exec vitest run src/modules/auth/auth.email.test.ts src/lib/auth.test.ts`

Expected: PASS.

### Task 3: Tokens vencidos, anti-enumeracion y revocacion (TDD)

**Files:**

- Modify: `src/modules/auth/auth.service.ts`
- Modify: `src/modules/auth/auth.service.test.ts`
- Modify: `src/modules/auth/auth.routes.test.ts`

- [x] **Step 1: Escribir pruebas fallidas de errores genericos**

En `auth.service.test.ts`, hacer que `auth.api.verifyEmail` y `auth.api.resetPassword` rechacen `APIError` de token vencido/invalido. Esperar respectivamente:

```ts
{ statusCode: 400, message: 'Email verification token is invalid or expired.' }
{ statusCode: 400, message: 'Password reset token is invalid or expired.' }
```

Comprobar tambien que `requestPasswordReset` normaliza el email antes de delegar y usa `env.AUTH_PASSWORD_RESET_URL` como `redirectTo`.

- [x] **Step 2: Verificar el rojo**

Run: `pnpm exec vitest run src/modules/auth/auth.service.test.ts`

Expected: FAIL porque hoy se exponen mensajes de Better Auth y `redirectTo` apunta a `AUTH_URL`.

- [x] **Step 3: Implementar la normalizacion de servicio**

En `verifyEmail` y `resetPassword`, convertir errores operativos 400/401 del proveedor a los mensajes genericos anteriores. En `requestPasswordReset`, enviar email normalizado y `redirectTo: env.AUTH_PASSWORD_RESET_URL`. Los fallos inesperados siguen llegando al middleware como error generico, sin incluir token ni email.

- [x] **Step 4: Probar el contrato de ruta anti-enumeracion**

En `auth.routes.test.ts`, hacer que el mock de `requestPasswordReset` responda igual para email existente e inexistente. Comparar status y cuerpo completos y exigir el mensaje:

```ts
'If the email is registered, a reset link has been sent.';
```

Agregar casos de token de verificacion/reset vencido que respondan 400 con los mensajes genericos y sin contener el token.

- [x] **Step 5: Verificar verde dirigido**

Run: `pnpm exec vitest run src/modules/auth/auth.service.test.ts src/modules/auth/auth.routes.test.ts`

Expected: PASS.

### Task 4: Limites independientes por flujo (TDD)

**Files:**

- Modify: `src/middlewares/rateLimit.middleware.ts`
- Modify: `src/middlewares/rateLimit.middleware.test.ts`
- Modify: `src/modules/auth/auth.routes.ts`
- Modify: `src/modules/auth/auth.routes.test.ts`

- [x] **Step 1: Escribir pruebas de ruta fallidas**

Agregar pruebas que envien cuatro solicitudes desde una IP aislada a `forgot-password` y esperen 429 en la cuarta. Despues de tres solicitudes de forgot, el primer `reset-password` desde la misma IP debe llegar al controlador, demostrando stores separados. Agregar seis verificaciones y esperar 429 en la sexta.

- [x] **Step 2: Verificar el rojo**

Run: `pnpm exec vitest run src/modules/auth/auth.routes.test.ts src/middlewares/rateLimit.middleware.test.ts`

Expected: FAIL porque forgot/reset comparten limiter y verify-email no tiene limiter.

- [x] **Step 3: Crear y montar limiters separados**

Exportar `forgotPasswordRateLimit`, `resetPasswordRateLimit` y `emailVerificationRateLimit` como instancias independientes. Mantener 3/minuto para forgot/reset y usar 5/minuto para verificacion. Montarlos antes de `validate` en las rutas correspondientes.

- [x] **Step 4: Verificar verde**

Run: `pnpm exec vitest run src/modules/auth/auth.routes.test.ts src/middlewares/rateLimit.middleware.test.ts`

Expected: PASS.

### Task 5: Contrato, entorno local y cliente HTTP

**Files:**

- Modify: `src/modules/auth/auth.openapi.ts`
- Modify: `src/docs/openapi.test.ts`
- Modify: `openapi.json`
- Modify: `compose.dev.yaml`
- Modify: `compose.prod.yaml`
- Modify: `README.md`
- Modify: `CONTEXT.md`
- Modify: `bruno/Auth/Verify an email address.bru`
- Modify: `bruno/Auth/Request a password reset.bru`
- Modify: `bruno/Auth/Reset a password with a token.bru`
- Create: `bruno/Auth/Request password reset for unknown email.bru`
- Create: `bruno/Auth/Password reset rate limit returns 429.bru`

- [x] **Step 1: Actualizar y probar OpenAPI**

Documentar 403 de login por email no verificado, 429 de verificacion y 400 de tokens invalidos/vencidos. Extender `src/docs/openapi.test.ts` para fijar esos status.

Run: `pnpm exec vitest run src/docs/openapi.test.ts`

Expected: PASS despues de ajustar `auth.openapi.ts`.

- [x] **Step 2: Agregar Mailpit y variables de despliegue**

En `compose.dev.yaml`, agregar Mailpit con SMTP interno 1025, UI enlazada solo a `127.0.0.1:8025`, healthcheck y red existente; inyectar `MAIL_HOST=mailpit` y URLs frontend al API. En `compose.prod.yaml`, exigir `MAIL_HOST`, `MAIL_FROM`, las dos URLs frontend y pasar port/secure/credenciales opcionales. No incluir secretos reales.

- [x] **Step 3: Actualizar documentacion operativa**

Documentar en README y CONTEXT el flujo, TTL, revocacion de refresh tokens, vigencia residual de access tokens stateless (maximo `AUTH_TOKEN_TTL`), Mailpit local y requisitos SMTP de produccion. Aclarar que nunca se loguean enlaces ni tokens.

- [x] **Step 4: Actualizar Bruno sin secretos**

Usar variables de entorno privadas/runtime `verificationToken` y `passwordResetToken`; agregar assertions de status/cuerpo y casos anti-enumeracion/rate-limit. No versionar tokens capturados ni credenciales. No ejecutar el import destructivo de OpenAPI.

- [x] **Step 5: Regenerar el contrato**

Run: `pnpm run docs:generate && pnpm run docs:check`

Expected: `openapi.json` actualizado y check sin drift.

### Task 6: Verificacion integrada y cierre

**Files:**

- Modify: `docs/superpowers/plans/plan-maestro-sipeg-utp.md`
- Modify: `docs/superpowers/plans/2026-09-19-fase-1-5-verificacion-email-reset-password.md`

- [x] **Step 1: Ejecutar la suite dirigida**

Run:

```bash
pnpm exec vitest run src/lib/email.test.ts src/modules/auth/auth.email.test.ts src/lib/auth.test.ts src/modules/auth/auth.service.test.ts src/modules/auth/auth.routes.test.ts src/middlewares/rateLimit.middleware.test.ts src/docs/openapi.test.ts
```

Expected: PASS.

- [x] **Step 2: Ejecutar calidad completa**

Run:

```bash
pnpm test
pnpm run typecheck
pnpm run lint
pnpm run build
pnpm run format:check
pnpm run docs:check
```

Expected: todos en verde.

- [x] **Step 3: Verificar flujo real con PostgreSQL y Mailpit**

Levantar el stack local, registrar un usuario unico, extraer el token solamente desde la API local de Mailpit, verificar email, iniciar dos sesiones, solicitar reset, restablecer con el token recibido y comprobar:

```text
emailVerified=false -> true
token de verificacion vencido -> 400 generico
email existente e inexistente -> mismo 200 y mismo cuerpo
cuarta solicitud de recuperacion/minuto -> 429
token de reset vencido -> 400 generico
hash accounts.password sigue siendo $argon2id$ y verifica la nueva password
password anterior -> 401; password nueva -> 200
ambos refresh tokens previos -> 401
sesiones de otro usuario -> intactas
```

Eliminar los usuarios/filas temporales al terminar. No imprimir tokens completos en el registro de ejecucion.

- [x] **Step 4: Ejecutar Bruno local**

Ejecutar solo contra el stack local, esperando la ventana del limiter cuando corresponda:

```bash
pnpm --dir bruno exec bru run Auth --env local
```

Expected: assertions de Auth en verde. Si los tokens de correo se cargan manualmente, usar un override privado ignorado por Git.

- [x] **Step 5: Registrar evidencia y cerrar 1.5**

Marcar este plan, marcar 1.5 en el maestro y agregar un registro con conteos de pruebas, comandos, evidencia real, decisiones de seguridad y cualquier hallazgo diferido. No hacer commit: el usuario no lo solicito.

---

## Threat model resumido

- **Enumeracion:** cuerpo/status identicos para email existente e inexistente; callbacks SMTP no bloqueantes; errores de entrega no llegan a la respuesta.
- **Robo/reuso de token:** TTL explicito, token de reset de un solo uso administrado por Better Auth, errores genericos y tokens nunca registrados.
- **Secuestro de sesion posterior al reset:** Better Auth elimina todas las filas `sessions` del usuario; los access JWT ya emitidos conservan como maximo su TTL corto documentado.
- **Fuerza bruta/abuso:** limiters independientes por IP para solicitar, consumir y verificar tokens; limitador interno de Better Auth corregido.
- **Transporte:** SMTP requiere TLS en produccion y valida certificados; Mailpit solo existe en desarrollo y su UI se enlaza a loopback.

## Self-review

- Cobertura: expiracion de ambos tokens, anti-enumeracion, rate limit y revocacion estan asociados a tareas y pruebas concretas.
- Limite de alcance: no se agregan plantillas de propuestas/actividades/certificados ni una cola de correo; siguen en 6.4.
- Contrato: no cambia la forma de los payloads; solo se documentan status ya necesarios y se corrigen URLs/entrega.
- Seguridad: no se guardan ni registran secretos/tokens; SMTP de produccion es explicito y Mailpit no se expone fuera de localhost.
- Persistencia: el schema actual de Better Auth es suficiente; no se crea migracion Prisma.

---

## Registro de ejecucion (2026-09-19)

- [x] Task 6 Step 1: suite dirigida de 1.5 en verde, 78 pruebas en 7 archivos (`src/lib/email.test.ts`, `src/modules/auth/auth.email.test.ts`, `src/lib/auth.test.ts`, `src/modules/auth/auth.service.test.ts`, `src/modules/auth/auth.routes.test.ts`, `src/middlewares/rateLimit.middleware.test.ts` y `src/docs/openapi.test.ts`).
- [x] Task 6 Step 2: `pnpm test` con 321 pruebas en 32 archivos; `typecheck`, `lint`, `build`, `format:check` y `docs:check` en verde; `prisma:migrate:status` con 11 migraciones y `Database schema is up to date!`.
- [x] Task 6 Step 3: verificacion real con PostgreSQL y Mailpit completada con usuarios temporales ya eliminados: registro 201; login sin verificar 403; verificacion 200 y token vencido 400 generico; email existente e inexistente con identico 200 y cuerpo; cuarta solicitud de recuperacion por minuto 429; reset vencido 400 generico y valido 200; las dos sesiones del usuario revocadas y la sesion de otro usuario intacta; `accounts.password` conserva prefijo `$argon2id$` y verifica la nueva password; password anterior 401 y nueva 200; el access JWT emitido antes del reset sigue valido dentro de `AUTH_TOKEN_TTL`. No se imprimieron tokens en la evidencia.
- [x] Task 6 Step 4: `pnpm --dir bruno exec bru run Auth --env local` con 17/17 requests y 21/21 tests, incluidos anti-enumeracion y los limites de login, registro, forgot/reset y verificacion.
- [x] Task 6 Step 5: plan cerrado, 1.5 marcada en `plan-maestro-sipeg-utp.md` y registro de ejecucion agregado. Sin commit: el usuario no lo solicito.

Desviaciones y hallazgos de cierre:

- `F0-B` se resolvio con la migracion `prisma/migrations/20260920041816_add_jwks_metadata` (`expires_at`, `alg`, `crv`), contra el supuesto inicial de no migrar. `createJwk` persiste `null` explicito para cumplir `exactOptionalPropertyTypes` de Prisma.
- `auth.routes.test.ts` contenia un test de rate limit duplicado y huerfano que impedia el parseo del archivo; se elimino el duplicado y la suite quedo verde.
- La suite completa convivio con trabajo concurrente de 1.6: la corrida final quedo 321/321 despues de que ese trabajo cerro su ciclo.
