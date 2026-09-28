import 'dotenv/config';

import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../../src/generated/prisma/client.js';

export type SkipReason = 'name-does-not-match' | 'has-attendance' | 'has-alerts';

export interface DevActivityRow {
  id: string;
  name: string;
  status: string;
  programStatus: string;
  attendanceCount: number;
  alertCount: number;
}

export interface SkippedActivity {
  id: string;
  reason: SkipReason;
}

export interface CleanupScope {
  purge: DevActivityRow[];
  skipped: SkippedActivity[];
}

export interface CleanupPlan extends CleanupScope {
  safe: boolean;
  reason?: 'no-match' | 'pattern-too-broad' | 'all-retained';
  total: number;
  purgeCount: number;
}

const SKIP_LABELS: Record<SkipReason, string> = {
  'name-does-not-match': 'el nombre no coincide con el patrón',
  'has-attendance': 'tiene asistencia que debe conservarse',
  'has-alerts': 'tiene alertas que deben conservarse',
};

export const describeSkip = (reason: SkipReason): string => SKIP_LABELS[reason];

export const resolveCleanupScope = (
  rows: readonly DevActivityRow[],
  likePattern: string,
): CleanupScope => {
  const purge: DevActivityRow[] = [];
  const skipped: SkippedActivity[] = [];

  if (likePattern.trim() === '') {
    return { purge, skipped };
  }

  for (const row of rows) {
    if (!likeMatches(row.name, likePattern)) {
      skipped.push({ id: row.id, reason: 'name-does-not-match' });
      continue;
    }
    if (row.attendanceCount > 0) {
      skipped.push({ id: row.id, reason: 'has-attendance' });
      continue;
    }
    if (row.alertCount > 0) {
      skipped.push({ id: row.id, reason: 'has-alerts' });
      continue;
    }
    purge.push(row);
  }

  return { purge, skipped };
};

export const planDevCleanup = (
  rows: readonly DevActivityRow[],
  likePattern: string,
): CleanupPlan => {
  const scope = resolveCleanupScope(rows, likePattern);
  const nameMismatches = scope.skipped.filter((row) => row.reason === 'name-does-not-match').length;
  const base = { ...scope, total: rows.length, purgeCount: scope.purge.length };

  if (scope.purge.length === 0) {
    const anythingMatched = rows.length > 0 && nameMismatches < rows.length;

    return { ...base, safe: false, reason: anythingMatched ? 'all-retained' : 'no-match' };
  }

  const coversEveryActivity = rows.length > 1 && nameMismatches === 0;

  if (coversEveryActivity) {
    return { ...base, safe: false, reason: 'pattern-too-broad' };
  }

  return { ...base, safe: true };
};

const likeMatches = (value: string, likePattern: string): boolean => {
  let regex = '';
  let index = 0;

  while (index < likePattern.length) {
    const character = likePattern[index];

    if (character === undefined) {
      break;
    }

    if (character === '\\') {
      const next = likePattern[index + 1];
      if (next !== undefined) {
        regex += next.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        index += 2;
        continue;
      }
      index += 1;
      continue;
    }

    if (character === '%') {
      regex += '.*';
      index += 1;
      continue;
    }

    if (character === '_') {
      regex += '.';
      index += 1;
      continue;
    }

    regex += character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    index += 1;
  }

  return new RegExp(`^${regex}$`, 's').test(value);
};

const assertNotProduction = (): void => {
  if (process.env['NODE_ENV'] !== 'production') {
    return;
  }

  if (process.env['SEED_ALLOW_PRODUCTION'] === 'true') {
    return;
  }

  throw new Error(
    'Refusing to purge development residues while NODE_ENV=production. ' +
      'Set SEED_ALLOW_PRODUCTION=true to override.',
  );
};

const ACTIVITY_FIELDS = `
  a."id"::text AS "id",
  a."name"::text AS "name",
  a."status"::text AS "status",
  ep."status"::text AS "programStatus",
  (SELECT count(*) FROM "attendance" att WHERE att."activity_id" = a."id")::int AS "attendanceCount",
  (SELECT count(*) FROM "alerts" al WHERE al."activity_id" = a."id")::int AS "alertCount"
`;

const readActivities = async (prisma: PrismaClient): Promise<DevActivityRow[]> => {
  return prisma.$queryRawUnsafe<DevActivityRow[]>(
    `SELECT ${ACTIVITY_FIELDS} FROM "activities" a JOIN "event_programs" ep ON ep."id" = a."event_program_id" ORDER BY a."id"`,
  );
};

const parseArgs = (argv: readonly string[]): { pattern: string; apply: boolean } => {
  const patternArg = argv.find((argument) => argument.startsWith('--pattern='));
  const pattern = patternArg ? patternArg.slice('--pattern='.length) : 'Actividad temporal%';
  const apply = argv.includes('--apply');

  return { pattern, apply };
};

const main = async (): Promise<void> => {
  const connectionString = process.env['DATABASE_URL'] ?? '';

  if (!connectionString) {
    throw new Error('DATABASE_URL is required to clean development residues.');
  }

  assertNotProduction();

  const { pattern, apply } = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  try {
    const rows = await readActivities(prisma);
    const plan = planDevCleanup(rows, pattern);

    console.log(`Actividades totales: ${rows.length}`);
    console.log(`Patrón: ${pattern}`);
    console.log(`A purgar: ${plan.purgeCount}`);

    for (const row of plan.skipped) {
      console.log(`  conserva ${row.id}: ${describeSkip(row.reason)}`);
    }

    if (!plan.safe) {
      console.log(`No se ejecuta nada: ${plan.reason}.`);
      return;
    }

    if (!apply) {
      console.log('Simulación. Usa --apply para borrar de verdad.');
      return;
    }

    const ids = plan.purge.map((row) => row.id);

    const deleted = await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        'ALTER TABLE "activities" DISABLE TRIGGER "activities_prevent_delete"',
      );
      await tx.$executeRawUnsafe(
        'ALTER TABLE "event_programs" DISABLE TRIGGER "event_programs_prevent_delete"',
      );

      try {
        return await tx.$executeRawUnsafe(
          `DELETE FROM "activities" WHERE "id" = ANY(string_to_array($1, ','))`,
          ids.join(','),
        );
      } finally {
        await tx.$executeRawUnsafe(
          'ALTER TABLE "activities" ENABLE TRIGGER "activities_prevent_delete"',
        );
        await tx.$executeRawUnsafe(
          'ALTER TABLE "event_programs" ENABLE TRIGGER "event_programs_prevent_delete"',
        );
      }
    });

    console.log(`Borradas ${deleted} actividades. Triggers rehabilitados.`);
  } finally {
    await prisma.$disconnect();
  }
};

const isDirectRun = (): boolean => {
  const entry = process.argv[1] ?? '';

  return entry.endsWith('cleanup-dev-activities.ts') || entry.endsWith('cleanup-dev-activities.js');
};

if (isDirectRun()) {
  main().catch((error: unknown) => {
    console.error('Development cleanup failed.', error);
    process.exit(1);
  });
}
