import type { PrismaClient } from '../../src/generated/prisma/client.js';
import type { ProgramStatus } from '../../src/generated/prisma/enums.js';
import { dateOffset, instantOffset, logStep, requireEntry, seedId } from './helpers.js';
import type { OrganizationCatalog } from './organizations.seed.js';

interface AdditionalProgramCatalogEntry {
  key: string;
  unitKey: string;
  name: string;
  description: string;
  label: string;
  bannerUrl: string;
  startOffsetDays: number;
  endOffsetDays: number;
  finalStatus: ProgramStatus;
  archiveOffsetDays: number | null;
}

export const ADDITIONAL_PROGRAMS: readonly AdditionalProgramCatalogEntry[] = [
  {
    key: 'semana-ic',
    unitKey: 'fic',
    name: 'Semana de la Ingeniería Civil 2026',
    description:
      'Jornada académica de la Facultad de Ingeniería Civil con talleres y charlas técnicas.',
    label: 'SING-2026',
    bannerUrl: '/banners/semana-ingenieria-civil-2026.jpg',
    startOffsetDays: -33,
    endOffsetDays: -29,
    finalStatus: 'COMPLETED',
    archiveOffsetDays: null,
  },
  {
    key: 'congreso-cit',
    unitKey: 'fisc',
    name: 'Congreso de Innovación y Tecnología 2026',
    description:
      'Congreso de la Facultad de Ingeniería de Sistemas Computacionales sobre innovación y tecnología.',
    label: 'CIT-2026',
    bannerUrl: '/banners/congreso-innovacion-tecnologia-2026.jpg',
    startOffsetDays: 16,
    endOffsetDays: 20,
    finalStatus: 'ACTIVE',
    archiveOffsetDays: null,
  },
  {
    key: 'jornada-bienestar',
    unitKey: 'sub-vida',
    name: 'Jornada de Bienestar Universitario 2026',
    description: 'Jornada de bienestar y salud para la comunidad universitaria.',
    label: 'JBU-2026',
    bannerUrl: '/banners/jornada-bienestar-2026.jpg',
    startOffsetDays: 23,
    endOffsetDays: 27,
    finalStatus: 'ACTIVE',
    archiveOffsetDays: null,
  },
  {
    key: 'foro-ipe',
    unitKey: 'sub-ipe',
    name: 'Foro de Investigación e Innovación 2025',
    description: 'Foro de investigación, postgrado y extensión de la universidad.',
    label: 'FI-2025',
    bannerUrl: '/banners/foro-investigacion-2025.jpg',
    startOffsetDays: -320,
    endOffsetDays: -316,
    finalStatus: 'ARCHIVED',
    archiveOffsetDays: -310,
  },
  {
    key: 'feria-tec',
    unitKey: 'fie',
    name: 'Feria Tecnológica UTP 2026',
    description: 'Feria tecnológica de la Facultad de Ingeniería Eléctrica (en preparación).',
    label: 'FERTEC-2026',
    bannerUrl: '/banners/feria-tecnologica-2026.jpg',
    startOffsetDays: 45,
    endOffsetDays: 47,
    finalStatus: 'DRAFT',
    archiveOffsetDays: null,
  },
];

export interface SeedProgram {
  id: string;
  key: string;
  unitId: string;
  isDefault: boolean;
}

export const seedAdditionalPrograms = async (
  prisma: PrismaClient,
  catalog: OrganizationCatalog,
  adminUserId: string,
  now: Date = new Date(),
): Promise<Map<string, SeedProgram>> => {
  logStep('Sembrando programas adicionales...');
  const programs = new Map<string, SeedProgram>();

  for (const program of ADDITIONAL_PROGRAMS) {
    const unit = requireEntry(catalog.units, program.unitKey, 'unidad organizativa');
    const startDate = dateOffset(program.startOffsetDays, now);
    const endDate = dateOffset(program.endOffsetDays, now);

    const existing = await prisma.eventProgram.findFirst({
      where: { organizationalUnitId: unit.id, name: program.name, isDefault: false },
      select: { id: true },
    });

    const record = existing
      ? await prisma.eventProgram.update({
          where: { id: existing.id },
          data: {
            description: program.description,
            label: program.label,
            bannerUrl: program.bannerUrl,
            startDate,
            endDate,
            ...(program.finalStatus === 'DRAFT' ? { status: 'DRAFT' as const } : {}),
          },
          select: { id: true },
        })
      : await prisma.eventProgram.create({
          data: {
            id: seedId('program', program.key),
            name: program.name,
            description: program.description,
            label: program.label,
            bannerUrl: program.bannerUrl,
            startDate,
            endDate,
            status: program.finalStatus === 'DRAFT' ? 'DRAFT' : 'ACTIVE',
            organizationalUnitId: unit.id,
            createdById: adminUserId,
          },
          select: { id: true },
        });

    programs.set(program.key, {
      id: record.id,
      key: program.key,
      unitId: unit.id,
      isDefault: false,
    });
  }

  return programs;
};

export const finalizeAdditionalPrograms = async (
  prisma: PrismaClient,
  programs: Map<string, SeedProgram>,
  now: Date = new Date(),
): Promise<void> => {
  logStep('Finalizando estados de programas adicionales...');

  for (const catalogEntry of ADDITIONAL_PROGRAMS) {
    const program = requireEntry(programs, catalogEntry.key, 'programa adicional');
    const current = await prisma.eventProgram.findUnique({
      where: { id: program.id },
      select: { status: true },
    });

    if (!current || current.status === catalogEntry.finalStatus) {
      continue;
    }

    const archivedAt =
      catalogEntry.finalStatus === 'ARCHIVED'
        ? instantOffset(catalogEntry.archiveOffsetDays ?? 0, 12, 0, now)
        : null;

    await prisma.eventProgram.update({
      where: { id: program.id },
      data: { status: catalogEntry.finalStatus, archivedAt },
    });
  }
};
