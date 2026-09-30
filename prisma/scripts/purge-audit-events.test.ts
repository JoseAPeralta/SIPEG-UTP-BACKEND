import { describe, expect, it } from 'vitest';

import {
  AUDIT_RETENTION_DAYS,
  isArchiveOutsideProject,
  parsePurgeArgs,
  planAuditPurge,
  validateOperator,
  type PurgeRow,
} from './purge-audit-events.js';

const row = (id: string, occurredAt: string): PurgeRow => ({
  id,
  occurredAt: new Date(occurredAt),
});

const CUTOFF = new Date('2026-09-29T00:00:00.000Z');
const NOW = new Date('2026-09-30T00:00:00.000Z');

describe('parsePurgeArgs', () => {
  it('simula por defecto: no borra, con la retencion de la politica', () => {
    const options = parsePurgeArgs([], { now: NOW });

    expect(options.apply).toBe(false);
    expect(options.retentionDays).toBe(AUDIT_RETENTION_DAYS);
    expect(options.batchSize).toBe(10_000);
    expect(options.operator).toBeUndefined();
    expect(options.archive).toBeUndefined();
  });

  it('acepta los tres flags del modo destructivo', () => {
    const options = parsePurgeArgs(
      ['--apply', '--operator=sistemas', '--archive=/var/backups/audit.ndjson.gz'],
      { now: NOW },
    );

    expect(options.apply).toBe(true);
    expect(options.operator).toBe('sistemas');
    expect(options.archive).toBe('/var/backups/audit.ndjson.gz');
  });

  it('acepta un batchSize explicito y rechaza uno no entero o no positivo', () => {
    expect(parsePurgeArgs(['--batch-size=500'], { now: NOW }).batchSize).toBe(500);
    expect(() => parsePurgeArgs(['--batch-size=0'], { now: NOW })).toThrow(/batch-size/);
    expect(() => parsePurgeArgs(['--batch-size=mil'], { now: NOW })).toThrow(/batch-size/);
  });

  it('rechaza una retencion no entera o no positiva', () => {
    expect(() => parsePurgeArgs(['--retention-days=0'], { now: NOW })).toThrow(/retention-days/);
    expect(() => parsePurgeArgs(['--retention-days=-1'], { now: NOW })).toThrow(/retention-days/);
  });

  it('rechaza un --apply sin --operator, porque la purga debe ser atribuible', () => {
    expect(() => parsePurgeArgs(['--apply'], { now: NOW })).toThrow(/--operator/);
  });

  it('rechaza un --apply sin --archive, porque el respaldo no es opcional', () => {
    expect(() => parsePurgeArgs(['--apply', '--operator=sistemas'], { now: NOW })).toThrow(
      /--archive/,
    );
  });

  it('no exige operator ni archive en simulacion', () => {
    expect(() => parsePurgeArgs([], { now: NOW })).not.toThrow();
  });

  it('calcula el corte restando la retencion al instante actual', () => {
    const options = parsePurgeArgs(['--retention-days=10'], { now: NOW });

    expect(options.cutoff.toISOString()).toBe('2026-09-20T00:00:00.000Z');
  });
});

describe('validateOperator', () => {
  it('acepta un identificador institucional sin arroba', () => {
    expect(() => {
      validateOperator('jperez');
    }).not.toThrow();
  });

  it('rechaza un correo, porque el validador de ADR-0008 prohibe la arroba', () => {
    // No es una limitacion arbitraria: `looksLikeSecret` rechaza cualquier valor
    // con `@`, y escribir un email en la bitacora durable esta prohibido.
    expect(() => {
      validateOperator('jperez@utp.ac.pa');
    }).toThrow(/correo|@/);
  });

  it('rechaza un valor vacio', () => {
    expect(() => {
      validateOperator('');
    }).toThrow(/--operator/);
  });

  it('rechaza un valor que parece un secreto', () => {
    expect(() => {
      validateOperator('token-abc123');
    }).toThrow(/--operator/);
  });
});

describe('isArchiveOutsideProject', () => {
  const project = '/srv/sipeg-utp-backend';

  it('acepta una ruta fuera del proyecto', () => {
    expect(isArchiveOutsideProject('/var/backups/audit.ndjson.gz', project)).toBe(true);
  });

  it('rechaza una ruta dentro del proyecto, para que no acabe en un commit', () => {
    expect(isArchiveOutsideProject(`${project}/audit.ndjson.gz`, project)).toBe(false);
    expect(isArchiveOutsideProject(`${project}/backups/audit.ndjson.gz`, project)).toBe(false);
  });

  it('no confunde un directorio que empieza igual con el proyecto', () => {
    expect(isArchiveOutsideProject(`${project}-backups/audit.ndjson.gz`, project)).toBe(true);
  });
});

describe('planAuditPurge', () => {
  it('purga lo anterior al corte y conserva lo posterior', () => {
    const plan = planAuditPurge(
      [
        row('a', '2025-01-01T00:00:00.000Z'),
        row('b', '2026-09-28T23:59:59.999Z'),
        row('c', '2026-09-29T00:00:00.000Z'),
        row('d', '2026-09-30T00:00:00.000Z'),
      ],
      { cutoff: CUTOFF, now: NOW },
    );

    expect(plan.purge.map((item) => item.id)).toEqual(['a', 'b']);
    expect(plan.keep.map((item) => item.id)).toEqual(['c', 'd']);
    expect(plan.purgeCount).toBe(2);
  });

  it('el corte es exclusivo: un evento justo en el limite se conserva', () => {
    const plan = planAuditPurge([row('c', '2026-09-29T00:00:00.000Z')], {
      cutoff: CUTOFF,
      now: NOW,
    });

    expect(plan.purgeCount).toBe(0);
    expect(plan.keep.map((item) => item.id)).toEqual(['c']);
  });

  it('reporta el rango de lo que se va a purgar', () => {
    const plan = planAuditPurge(
      [row('a', '2024-03-01T10:00:00.000Z'), row('b', '2025-07-02T11:00:00.000Z')],
      { cutoff: CUTOFF, now: NOW },
    );

    expect(plan.oldest?.toISOString()).toBe('2024-03-01T10:00:00.000Z');
    expect(plan.newest?.toISOString()).toBe('2025-07-02T11:00:00.000Z');
  });

  it('no se inventa un rango cuando no hay nada que purgar', () => {
    const plan = planAuditPurge([row('c', '2026-09-30T00:00:00.000Z')], {
      cutoff: CUTOFF,
      now: NOW,
    });

    expect(plan.oldest).toBeUndefined();
    expect(plan.newest).toBeUndefined();
  });

  it('es una operacion vacia y segura si la tabla esta vacia', () => {
    const plan = planAuditPurge([], { cutoff: CUTOFF, now: NOW });

    expect(plan.purgeCount).toBe(0);
    expect(plan.safe).toBe(true);
  });

  it('rechaza un corte en el futuro, que borraria todo por un error de configuracion', () => {
    const future = new Date('2027-01-01T00:00:00.000Z');
    const plan = planAuditPurge([row('a', '2025-01-01T00:00:00.000Z')], {
      cutoff: future,
      now: NOW,
    });

    expect(plan.safe).toBe(false);
    expect(plan.purgeCount).toBe(0);
    expect(plan.reason).toMatch(/futuro/);
  });

  it('ordena lo purgable de mas antiguo a mas reciente, para que el respaldo sea legible', () => {
    const plan = planAuditPurge(
      [row('b', '2025-07-02T00:00:00.000Z'), row('a', '2024-03-01T00:00:00.000Z')],
      { cutoff: CUTOFF, now: NOW },
    );

    expect(plan.purge.map((item) => item.id)).toEqual(['a', 'b']);
  });
});
