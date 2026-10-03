import { AsyncLocalStorage } from 'node:async_hooks';

import { createRequestLogger } from '../../config/logger.js';
import { getPrismaClient } from '../../config/prisma.js';
import { writeAuditEvent } from '../audit/audit.service.js';
import type { AuditAction } from '../audit/audit.types.js';

/**
 * Sujeto identificado por los hooks post-éxito de Better Auth.
 *
 * `emailVerification.afterEmailVerification` y `emailAndPassword.onPasswordReset`
 * se configuran en `src/lib/auth.ts` y corren DENTRO de la llamada del proveedor,
 * mientras que la escritura de auditoria tiene que ocurrir DESPUES, cuando la
 * operacion completa ya termino sin error. Para no auditar dentro del hook (que
 * en el reset corre antes de revocar las sesiones, y un fallo ahi las dejaria
 * sin revocar) el hook solo anota el `userId` en un marcador mutable y el
 * servicio lo lee al salir de la llamada.
 *
 * El marcador se crea por llamada y viaja en un `AsyncLocalStorage`, no en una
 * variable de modulo: dos resets simultaneos en peticiones distintas tendrian
 * un marcador propio y no podrian intercambiarse el sujeto.
 */
export interface AuthAuditSubjectHolder {
  userId?: string | undefined;
}

const holderStorage = new AsyncLocalStorage<AuthAuditSubjectHolder>();

/**
 * Ejecuta la llamada del proveedor y devuelve el sujeto que sus hooks hayan
 * identificado. El marcador se crea aqui y solo es visible dentro de `fn`.
 */
export async function withAuthAuditSubject<T>(
  fn: () => Promise<T>,
): Promise<{ result: T; userId: string | undefined }> {
  const holder: AuthAuditSubjectHolder = {};
  const result = await holderStorage.run(holder, fn);
  return { result, userId: holder.userId };
}

/** Lo invoca el hook de Better Auth. Silencioso si no hay llamada que capture. */
export function captureAuthAuditSubject(userId: string): void {
  const holder = holderStorage.getStore();
  if (holder) {
    holder.userId = userId;
  }
}

export interface RecordAuthAuditOptions {
  action: AuditAction;
  userId: string;
  changes?: Parameters<typeof writeAuditEvent>[1]['changes'];
}

/**
 * Escribe un evento de auditoria de un flujo propiedad de Better Auth.
 *
 * Deliberadamente NO propaga el fallo: la mutacion (alta de usuario, verificacion
 * de email, cambio de contrasena y revocacion de sesiones) ya ocurrio y es
 * irreversible desde la aplicacion. Perder esa operacion porque el registro de
 * auditoria fallo seria peor que la linea que falta, asi que el error se reporta
 * como evento de aplicacion y el flujo continua.
 *
 * Consecuencia asumida y documentada: esta escritura **no es atomica** con la
 * operacion del proveedor, que no comparte la transaccion. Ver ADR-0008.
 */
export const recordAuthAuditEvent = async ({
  action,
  userId,
  changes,
}: RecordAuthAuditOptions): Promise<boolean> => {
  const prisma = getPrismaClient();
  try {
    await prisma.$transaction((tx) =>
      writeAuditEvent(tx, {
        action,
        resourceType: 'user',
        resourceId: userId,
        targetUserId: userId,
        // El actor es el propio sujeto: registro, verificacion y reset son flujos
        // publicos sin sesion, y el unico identificador con certeza es el del
        // usuario afectado. Inventar un actor o dejarlo como SYSTEM sugeriria que
        // un administrador hizo algo que no hizo.
        actorId: userId,
        actorType: 'USER',
        changes,
      }),
    );
    return true;
  } catch (error) {
    createRequestLogger({
      event: 'audit.write.failed',
      logType: 'application',
      action,
      targetUserId: userId,
    }).error({ err: error }, 'audit.write.failed');
    return false;
  }
};
