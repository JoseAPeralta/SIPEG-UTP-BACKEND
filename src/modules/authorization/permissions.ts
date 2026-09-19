import type { CollaborationRole } from '../../generated/prisma/enums.js';

export const PERMISSIONS = {
  PROGRAM_READ: 'program:read',
  PROGRAM_UPDATE: 'program:update',
  PROGRAM_ARCHIVE: 'program:archive',
  ACTIVITY_READ: 'activity:read',
  ACTIVITY_CREATE: 'activity:create',
  ACTIVITY_UPDATE: 'activity:update',
  ACTIVITY_CANCEL: 'activity:cancel',
  ATTENDANCE_REGISTER: 'attendance:register',
  ATTENDANCE_CHECKIN: 'attendance:checkin',
  ATTENDANCE_MANAGE: 'attendance:manage',
  CERTIFICATE_READ: 'certificate:read',
  CERTIFICATE_GENERATE: 'certificate:generate',
  PROPOSAL_READ: 'proposal:read',
  PROPOSAL_REVIEW: 'proposal:review',
  PROPOSAL_FEEDBACK: 'proposal:feedback',
  REPORT_VIEW: 'report:view',
  REPORT_EXPORT: 'report:export',
  PERMISSION_GRANT: 'permission:grant',
} as const;

export type PermissionName = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const PERMISSION_NAMES = Object.values(PERMISSIONS) as PermissionName[];

export const PERMISSION_DESCRIPTIONS: Record<PermissionName, string> = {
  [PERMISSIONS.PROGRAM_READ]: 'Ver programas de eventos.',
  [PERMISSIONS.PROGRAM_UPDATE]: 'Actualizar programas de eventos.',
  [PERMISSIONS.PROGRAM_ARCHIVE]: 'Archivar programas de eventos.',
  [PERMISSIONS.ACTIVITY_READ]: 'Ver actividades.',
  [PERMISSIONS.ACTIVITY_CREATE]: 'Crear actividades.',
  [PERMISSIONS.ACTIVITY_UPDATE]: 'Actualizar actividades.',
  [PERMISSIONS.ACTIVITY_CANCEL]: 'Cancelar actividades.',
  [PERMISSIONS.ATTENDANCE_REGISTER]: 'Inscribir asistentes en una actividad.',
  [PERMISSIONS.ATTENDANCE_CHECKIN]: 'Registrar check-in de asistentes.',
  [PERMISSIONS.ATTENDANCE_MANAGE]: 'Gestionar la lista de asistencia.',
  [PERMISSIONS.CERTIFICATE_READ]: 'Consultar certificados.',
  [PERMISSIONS.CERTIFICATE_GENERATE]: 'Generar certificados.',
  [PERMISSIONS.PROPOSAL_READ]: 'Ver propuestas de ponentes.',
  [PERMISSIONS.PROPOSAL_REVIEW]: 'Revisar y responder propuestas.',
  [PERMISSIONS.PROPOSAL_FEEDBACK]: 'Dar feedback a propuestas.',
  [PERMISSIONS.REPORT_VIEW]: 'Ver reportes y estadisticas.',
  [PERMISSIONS.REPORT_EXPORT]: 'Exportar reportes.',
  [PERMISSIONS.PERMISSION_GRANT]: 'Otorgar y revocar permisos y colaboradores.',
};

export const ROLE_DEFAULTS: Record<CollaborationRole, readonly PermissionName[]> = {
  VIEWER: [
    PERMISSIONS.PROGRAM_READ,
    PERMISSIONS.ACTIVITY_READ,
    PERMISSIONS.CERTIFICATE_READ,
    PERMISSIONS.PROPOSAL_READ,
    PERMISSIONS.REPORT_VIEW,
  ],
  EDITOR: [
    PERMISSIONS.PROGRAM_READ,
    PERMISSIONS.ACTIVITY_READ,
    PERMISSIONS.CERTIFICATE_READ,
    PERMISSIONS.PROPOSAL_READ,
    PERMISSIONS.REPORT_VIEW,
    PERMISSIONS.ACTIVITY_CREATE,
    PERMISSIONS.ACTIVITY_UPDATE,
    PERMISSIONS.ATTENDANCE_REGISTER,
    PERMISSIONS.ATTENDANCE_CHECKIN,
    PERMISSIONS.ATTENDANCE_MANAGE,
    PERMISSIONS.PROPOSAL_FEEDBACK,
  ],
  ORGANIZER: [
    PERMISSIONS.PROGRAM_READ,
    PERMISSIONS.ACTIVITY_READ,
    PERMISSIONS.CERTIFICATE_READ,
    PERMISSIONS.PROPOSAL_READ,
    PERMISSIONS.REPORT_VIEW,
    PERMISSIONS.ACTIVITY_CREATE,
    PERMISSIONS.ACTIVITY_UPDATE,
    PERMISSIONS.ATTENDANCE_REGISTER,
    PERMISSIONS.ATTENDANCE_CHECKIN,
    PERMISSIONS.ATTENDANCE_MANAGE,
    PERMISSIONS.PROPOSAL_FEEDBACK,
    PERMISSIONS.PROGRAM_UPDATE,
    PERMISSIONS.ACTIVITY_CANCEL,
    PERMISSIONS.CERTIFICATE_GENERATE,
    PERMISSIONS.PROPOSAL_REVIEW,
    PERMISSIONS.REPORT_EXPORT,
  ],
};
