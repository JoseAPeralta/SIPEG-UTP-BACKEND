import type { AuditContext } from '../modules/audit/audit.types.js';

export type AuditContextSource = Pick<Express.Request, 'id' | 'user'>;

export const toAuditContext = (req: AuditContextSource): AuditContext => {
  const actorId = req.user?.id;

  return {
    actorId,
    actorType: actorId ? 'USER' : 'ANONYMOUS',
    requestId: req.id,
  };
};
