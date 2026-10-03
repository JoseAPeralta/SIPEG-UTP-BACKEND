import 'dotenv/config';

import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';

import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../../src/generated/prisma/client.js';
import { writeAuditEvent } from '../../src/modules/audit/audit.service.js';
import { looksLikeSecret } from '../../src/modules/audit/audit.types.js';

/**
 * Purga de `audit_events` por antiguedad. Ver `docs/adr/adr-0008-durable-audit-events.md`,
 * seccion "Retencion" y el T13 del plan de logging.
 *
 * Decisiones que gobiernan el diseno:
 *
 * - **365 dias de retencion** (T13.1). Es una politica institucional, no un dato
 *   tecnico, y vive en el ADR. El corte se calcula sobre `occurred_at`, que ya
 *   tiene indice, asi que la politica no requiere migracion: cambiarla es cambiar
 *   un numero.
 * - **El corte es un instante en UTC.** `occurred_at` es `Timestamptz` y ADR-0002
 *   limita `src/utils/date.ts` a las fechas de calendario de negocio. Una ventana
 *   de retencion es un instante, no un dia habem.
 * - **Lotes transaccionales.** Cada lote abre su transaccion, deshabilita los
 *   triggers, borra y los rehabilita en `finally`. Los triggers nunca quedan
 *   abiertos entre transacciones, asi que un proceso que muera a la mitad deja la
 *   tabla igual de inmutable. Es el mismo patron que `cleanup-dev-activities.ts`.
 * - **Se respalda antes de borrar.** Un NDJSON comprimido con las filas exactas
 *   que se van a eliminar. Sin `pg_dump` en el host, y sin dependencia nueva:
 *   `node:zlib` ya esta.
 * - **La purga deja huella en la propia bitacora**, escrita DESPUES de
 *   rehabilitar los triggers para que la fila sea legitima. Es lo que hace que
 *   una intervencion sobre el historico sea detectable desde el historico.
 */

/** Politica de retencion ratificada en T13.1. */
export const AUDIT_RETENTION_DAYS = 365;

const DEFAULT_BATCH_SIZE = 10_000;

const MUTATION_TRIGGER = 'audit_events_prevent_mutation';
const TRUNCATE_TRIGGER = 'audit_events_prevent_truncate';

export interface PurgeRow {
  id: string;
  occurredAt: Date;
}

export interface PurgeOptions {
  apply: boolean;
  batchSize: number;
  retentionDays: number;
  cutoff: Date;
  operator: string | undefined;
  archive: string | undefined;
}

export interface PurgePlan {
  purge: PurgeRow[];
  keep: PurgeRow[];
  purgeCount: number;
  oldest: Date | undefined;
  newest: Date | undefined;
  safe: boolean;
  reason?: string;
}

const readFlag = (argv: readonly string[], name: string): string | undefined => {
  const prefix = `--${name}=`;
  const found = argv.find((argument) => argument.startsWith(prefix));

  return found === undefined ? undefined : found.slice(prefix.length);
};

const readPositiveInteger = (argv: readonly string[], name: string, fallback: number): number => {
  const raw = readFlag(argv, name);
  if (raw === undefined) {
    return fallback;
  }

  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`--${name} debe ser un entero positivo, no "${raw}".`);
  }

  return parsed;
};

/**
 * El operador se escribe en la bitacora durable, asi que pasa por el mismo
 * validador que cualquier otro valor: sin arroba y sin nada que parezca un
 * secreto. Un correo esta prohibido a proposito, no por rigidez del formulario.
 */
export const validateOperator = (operator: string): void => {
  if (operator.trim() === '') {
    throw new Error('--operator no puede estar vacio: la purga debe ser atribuible.');
  }

  if (operator.includes('@')) {
    throw new Error(
      '--operator no puede ser un correo: el validador de la bitacora prohibe la arroba. Usa un identificador institucional.',
    );
  }

  if (looksLikeSecret(operator)) {
    throw new Error('--operator no puede parecer un secreto (token, hash o credencial).');
  }
};

/** Un respaldo de auditoria dentro del repo acabaria en un commit. */
export const isArchiveOutsideProject = (archive: string, projectRoot: string): boolean => {
  const target = resolve(archive);
  const root = resolve(projectRoot);

  return target !== root && !target.startsWith(`${root}/`);
};

export const parsePurgeArgs = (argv: readonly string[], context: { now: Date }): PurgeOptions => {
  const apply = argv.includes('--apply');
  const retentionDays = readPositiveInteger(argv, 'retention-days', AUDIT_RETENTION_DAYS);
  const batchSize = readPositiveInteger(argv, 'batch-size', DEFAULT_BATCH_SIZE);
  const operator = readFlag(argv, 'operator');
  const archive = readFlag(argv, 'archive');

  if (apply) {
    if (operator === undefined) {
      throw new Error('--apply exige --operator para atribuir quien interviene el historico.');
    }
    if (archive === undefined) {
      throw new Error('--apply exige --archive: el respaldo previo no es opcional.');
    }
  }

  if (operator !== undefined) {
    validateOperator(operator);
  }

  return {
    apply,
    batchSize,
    retentionDays,
    cutoff: new Date(context.now.getTime() - retentionDays * 24 * 60 * 60 * 1000),
    operator,
    archive,
  };
};

export const planAuditPurge = (
  rows: readonly PurgeRow[],
  context: { cutoff: Date; now: Date },
): PurgePlan => {
  if (context.cutoff.getTime() > context.now.getTime()) {
    return {
      purge: [],
      keep: [...rows],
      purgeCount: 0,
      oldest: undefined,
      newest: undefined,
      safe: false,
      reason:
        'El corte cae en el futuro: un reloj adelantado o un --retention-days negativo borraria la bitacora entera. No se ejecuta nada.',
    };
  }

  const purge = rows
    .filter((item) => item.occurredAt.getTime() < context.cutoff.getTime())
    .sort((left, right) => left.occurredAt.getTime() - right.occurredAt.getTime());
  const keep = rows.filter((item) => item.occurredAt.getTime() >= context.cutoff.getTime());

  return {
    purge,
    keep,
    purgeCount: purge.length,
    oldest: purge[0]?.occurredAt,
    newest: purge[purge.length - 1]?.occurredAt,
    safe: true,
  };
};

const chunk = <T>(items: readonly T[], size: number): T[][] => {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }

  return batches;
};

const readRows = async (prisma: PrismaClient): Promise<PurgeRow[]> => {
  const rows = await prisma.auditEvent.findMany({
    select: { id: true, occurredAt: true },
    orderBy: { occurredAt: 'asc' },
  });

  return rows;
};

const writeArchive = async (
  prisma: PrismaClient,
  archivePath: string,
  ids: readonly string[],
): Promise<number> => {
  const rows = await prisma.auditEvent.findMany({
    where: { id: { in: [...ids] } },
    orderBy: { occurredAt: 'asc' },
  });

  // Un registro por linea (NDJSON): se puede inspeccionar y procesar con `zcat`
  // sin necesidad de un parser de JSON completo.
  const payload = rows.map((row) => `${JSON.stringify(row)}\n`).join('');
  await writeFile(archivePath, gzipSync(payload, { level: 9 }));

  return rows.length;
};

const deleteBatch = async (prisma: PrismaClient, ids: readonly string[]): Promise<number> => {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`ALTER TABLE "audit_events" DISABLE TRIGGER "${MUTATION_TRIGGER}"`);
    await tx.$executeRawUnsafe(`ALTER TABLE "audit_events" DISABLE TRIGGER "${TRUNCATE_TRIGGER}"`);

    try {
      return await tx.$executeRawUnsafe(
        `DELETE FROM "audit_events" WHERE "id" = ANY(string_to_array($1, ','))`,
        ids.join(','),
      );
    } finally {
      await tx.$executeRawUnsafe(`ALTER TABLE "audit_events" ENABLE TRIGGER "${MUTATION_TRIGGER}"`);
      await tx.$executeRawUnsafe(`ALTER TABLE "audit_events" ENABLE TRIGGER "${TRUNCATE_TRIGGER}"`);
    }
  });
};

const main = async (): Promise<void> => {
  const connectionString = process.env['DATABASE_URL'];
  if (connectionString === undefined) {
    throw new Error('Falta DATABASE_URL: la purga se ejecuta contra la base de la aplicacion.');
  }

  const projectRoot = resolve(process.cwd());
  const options = parsePurgeArgs(process.argv.slice(2), { now: new Date() });

  if (options.archive !== undefined && !isArchiveOutsideProject(options.archive, projectRoot)) {
    throw new Error(
      `--archive debe estar fuera del proyecto (${projectRoot}): un respaldo de auditoria dentro del repo acabaria en un commit.`,
    );
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  try {
    const rows = await readRows(prisma);
    const plan = planAuditPurge(rows, { cutoff: options.cutoff, now: new Date() });

    console.log(`Eventos totales: ${rows.length}`);
    console.log(`Retencion: ${options.retentionDays} dias`);
    console.log(`Corte (UTC): ${options.cutoff.toISOString()}`);
    console.log(`A purgar: ${plan.purgeCount}`);
    console.log(`Se conservan: ${plan.keep.length}`);

    if (plan.oldest !== undefined && plan.newest !== undefined) {
      console.log(`Rango a purgar: ${plan.oldest.toISOString()} .. ${plan.newest.toISOString()}`);
    }

    if (!plan.safe) {
      console.log(`No se ejecuta nada: ${plan.reason}`);
      return;
    }

    if (!options.apply) {
      console.log('Simulacion. Usa --apply para purgar de verdad.');
      return;
    }

    if (plan.purgeCount === 0) {
      console.log('Nada que purgar.');
      return;
    }

    const archive = options.archive as string;
    const operator = options.operator as string;

    await writeArchive(
      prisma,
      archive,
      plan.purge.map((item) => item.id),
    );
    console.log(`Respaldo escrito en ${archive}`);
    let purged = 0;
    for (const batch of chunk(plan.purge, options.batchSize)) {
      purged += await deleteBatch(
        prisma,
        batch.map((item) => item.id),
      );
      console.log(`  lote purgado: ${batch.length} eventos (total ${purged})`);
    }

    // DESPUES de rehabilitar los triggers, para que la fila sea legitima. Es la
    // unica constancia de la propia intervencion: el log del contenedor vive 90
    // dias y no es evidencia.
    await prisma.$transaction((tx) =>
      writeAuditEvent(tx, {
        action: 'audit.purged',
        resourceType: 'audit_log',
        actorType: 'SYSTEM',
        metadata: {
          purgedRowCount: purged,
          retentionDays: options.retentionDays,
          cutoff: options.cutoff.toISOString(),
          operator,
        },
      }),
    );

    console.log(`Purgados ${purged} eventos. Evento audit.purged registrado.`);
  } finally {
    await prisma.$disconnect();
  }
};

const isDirectRun = (): boolean => {
  const entry = process.argv[1] ?? '';

  return entry.endsWith('purge-audit-events.ts') || entry.endsWith('purge-audit-events.js');
};

if (isDirectRun()) {
  main().catch((error: unknown) => {
    console.error('La purga de auditoria fallo.', error);
    process.exit(1);
  });
}
