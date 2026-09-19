import type { PrismaClient } from '../../src/generated/prisma/client.js';
import type { UnitType } from '../../src/generated/prisma/enums.js';
import {
  PERMISSION_DESCRIPTIONS,
  PERMISSION_NAMES,
} from '../../src/modules/authorization/permissions.js';
import { logStep, seedId, requireEntry } from './helpers.js';

interface UnitCatalogEntry {
  key: string;
  code: string;
  name: string;
  type: UnitType;
  description: string;
}

interface CareerCatalogEntry {
  key: string;
  code: string;
  name: string;
  unitKey: string;
}

export const FACULTIES: readonly UnitCatalogEntry[] = [
  {
    key: 'fic',
    code: 'FIC',
    name: 'Facultad de Ingeniería Civil',
    type: 'FACULTY',
    description: 'Facultad de Ingeniería Civil de la Universidad Tecnológica de Panamá.',
  },
  {
    key: 'fie',
    code: 'FIE',
    name: 'Facultad de Ingeniería Eléctrica',
    type: 'FACULTY',
    description: 'Facultad de Ingeniería Eléctrica de la Universidad Tecnológica de Panamá.',
  },
  {
    key: 'fii',
    code: 'FII',
    name: 'Facultad de Ingeniería Industrial',
    type: 'FACULTY',
    description: 'Facultad de Ingeniería Industrial de la Universidad Tecnológica de Panamá.',
  },
  {
    key: 'fim',
    code: 'FIM',
    name: 'Facultad de Ingeniería Mecánica',
    type: 'FACULTY',
    description: 'Facultad de Ingeniería Mecánica de la Universidad Tecnológica de Panamá.',
  },
  {
    key: 'fisc',
    code: 'FISC',
    name: 'Facultad de Ingeniería de Sistemas Computacionales',
    type: 'FACULTY',
    description:
      'Facultad de Ingeniería de Sistemas Computacionales de la Universidad Tecnológica de Panamá.',
  },
  {
    key: 'fct',
    code: 'FCT',
    name: 'Facultad de Ciencias y Tecnología',
    type: 'FACULTY',
    description: 'Facultad de Ciencias y Tecnología de la Universidad Tecnológica de Panamá.',
  },
];

export const SUBDIRECTORATES: readonly UnitCatalogEntry[] = [
  {
    key: 'sub-acad',
    code: 'SUB-ACAD',
    name: 'Subdirección Académica',
    type: 'SUBDIRECTORATE',
    description: 'Subdirección Académica de la Universidad Tecnológica de Panamá.',
  },
  {
    key: 'sub-admin',
    code: 'SUB-ADMIN',
    name: 'Subdirección Administrativa',
    type: 'SUBDIRECTORATE',
    description: 'Subdirección Administrativa de la Universidad Tecnológica de Panamá.',
  },
  {
    key: 'sub-vida',
    code: 'SUB-VIDA',
    name: 'Subdirección de Vida Universitaria',
    type: 'SUBDIRECTORATE',
    description: 'Subdirección de Vida Universitaria de la Universidad Tecnológica de Panamá.',
  },
  {
    key: 'sub-ipe',
    code: 'SUB-IPE',
    name: 'Subdirección de Investigación, Postgrado y Extensión',
    type: 'SUBDIRECTORATE',
    description:
      'Subdirección de Investigación, Postgrado y Extensión de la Universidad Tecnológica de Panamá.',
  },
];

export const UNITS: readonly UnitCatalogEntry[] = [...FACULTIES, ...SUBDIRECTORATES];

export const CAREERS: readonly CareerCatalogEntry[] = [
  { key: 'fic-civ', code: 'FIC-CIV', name: 'Licenciatura en Ingeniería Civil', unitKey: 'fic' },
  { key: 'fic-geo', code: 'FIC-GEO', name: 'Licenciatura en Ingeniería Geomática', unitKey: 'fic' },
  {
    key: 'fic-amb',
    code: 'FIC-AMB',
    name: 'Licenciatura en Ingeniería Ambiental',
    unitKey: 'fic',
  },
  { key: 'fic-top', code: 'FIC-TOP', name: 'Licenciatura en Topografía', unitKey: 'fic' },
  { key: 'fie-ele', code: 'FIE-ELE', name: 'Licenciatura en Ingeniería Eléctrica', unitKey: 'fie' },
  {
    key: 'fie-etc',
    code: 'FIE-ETC',
    name: 'Licenciatura en Ingeniería Electrónica y Telecomunicaciones',
    unitKey: 'fie',
  },
  {
    key: 'fie-eme',
    code: 'FIE-EME',
    name: 'Licenciatura en Ingeniería Electromecánica',
    unitKey: 'fie',
  },
  {
    key: 'fie-ctr',
    code: 'FIE-CTR',
    name: 'Licenciatura en Ingeniería de Control y Automatización',
    unitKey: 'fie',
  },
  {
    key: 'fii-ind',
    code: 'FII-IND',
    name: 'Licenciatura en Ingeniería Industrial',
    unitKey: 'fii',
  },
  {
    key: 'fii-log',
    code: 'FII-LOG',
    name: 'Licenciatura en Ingeniería Logística y Cadena de Suministro',
    unitKey: 'fii',
  },
  {
    key: 'fii-adm',
    code: 'FII-ADM',
    name: 'Licenciatura en Gestión Administrativa',
    unitKey: 'fii',
  },
  {
    key: 'fii-seg',
    code: 'FII-SEG',
    name: 'Licenciatura en Ingeniería en Seguridad Industrial e Higiene Ocupacional',
    unitKey: 'fii',
  },
  {
    key: 'fim-mec',
    code: 'FIM-MEC',
    name: 'Licenciatura en Ingeniería Mecánica',
    unitKey: 'fim',
  },
  {
    key: 'fim-aer',
    code: 'FIM-AER',
    name: 'Licenciatura en Ingeniería Aeronáutica',
    unitKey: 'fim',
  },
  {
    key: 'fim-man',
    code: 'FIM-MAN',
    name: 'Licenciatura en Ingeniería de Mantenimiento',
    unitKey: 'fim',
  },
  {
    key: 'fim-aut',
    code: 'FIM-AUT',
    name: 'Licenciatura en Mecánica Automotriz',
    unitKey: 'fim',
  },
  {
    key: 'fisc-sis',
    code: 'FISC-SIS',
    name: 'Licenciatura en Ingeniería de Sistemas y Computación',
    unitKey: 'fisc',
  },
  {
    key: 'fisc-sof',
    code: 'FISC-SOF',
    name: 'Licenciatura en Ingeniería de Software',
    unitKey: 'fisc',
  },
  {
    key: 'fisc-cib',
    code: 'FISC-CIB',
    name: 'Licenciatura en Ciberseguridad',
    unitKey: 'fisc',
  },
  {
    key: 'fisc-ccp',
    code: 'FISC-CCP',
    name: 'Licenciatura en Ciencias de la Computación',
    unitKey: 'fisc',
  },
  {
    key: 'fct-ali',
    code: 'FCT-ALI',
    name: 'Licenciatura en Ingeniería en Alimentos',
    unitKey: 'fct',
  },
  {
    key: 'fct-qui',
    code: 'FCT-QUI',
    name: 'Licenciatura en Ingeniería Química',
    unitKey: 'fct',
  },
  {
    key: 'fct-for',
    code: 'FCT-FOR',
    name: 'Licenciatura en Ingeniería Forestal',
    unitKey: 'fct',
  },
  {
    key: 'fct-ceb',
    code: 'FCT-CEB',
    name: 'Licenciatura en Comunicación Ejecutiva Bilingüe',
    unitKey: 'fct',
  },
];

export interface SeedUnit {
  id: string;
  code: string;
  type: UnitType;
  programId: string;
}

export interface OrganizationCatalog {
  units: Map<string, SeedUnit>;
  careers: Map<string, string>;
}

const ensureDefaultProgram = async (
  prisma: PrismaClient,
  unit: { id: string; key: string; name: string },
): Promise<string> => {
  const existing = await prisma.eventProgram.findFirst({
    where: { organizationalUnitId: unit.id, isDefault: true },
    select: { id: true },
  });

  if (existing) {
    await prisma.eventProgram.update({
      where: { id: existing.id },
      data: {
        name: `Programa de Eventos - ${unit.name}`,
        description: `Programa predeterminado de ${unit.name}.`,
      },
    });
    return existing.id;
  }

  const created = await prisma.eventProgram.create({
    data: {
      id: seedId('program', unit.key, 'default'),
      name: `Programa de Eventos - ${unit.name}`,
      description: `Programa predeterminado de ${unit.name}.`,
      organizationalUnitId: unit.id,
      isDefault: true,
      status: 'ACTIVE',
    },
    select: { id: true },
  });

  return created.id;
};

export const seedOrganizations = async (prisma: PrismaClient): Promise<OrganizationCatalog> => {
  logStep('Sembrando catálogo de permisos...');
  for (const name of PERMISSION_NAMES) {
    const description = PERMISSION_DESCRIPTIONS[name];
    await prisma.permission.upsert({
      where: { name },
      update: { description },
      create: { name, description },
    });
  }

  logStep('Sembrando unidades organizativas y programas predeterminados...');
  const units = new Map<string, SeedUnit>();

  for (const unit of UNITS) {
    const existing = await prisma.organizationalUnit.findUnique({
      where: { code: unit.code },
      select: { id: true },
    });

    const record = existing
      ? await prisma.organizationalUnit.update({
          where: { id: existing.id },
          data: { name: unit.name, description: unit.description, type: unit.type },
          select: { id: true, code: true, type: true },
        })
      : await prisma.organizationalUnit.create({
          data: {
            id: seedId('unit', unit.key),
            code: unit.code,
            name: unit.name,
            description: unit.description,
            type: unit.type,
            isActive: true,
          },
          select: { id: true, code: true, type: true },
        });

    const programId = await ensureDefaultProgram(prisma, {
      id: record.id,
      key: unit.key,
      name: unit.name,
    });

    units.set(unit.key, {
      id: record.id,
      code: record.code,
      type: record.type,
      programId,
    });
  }

  logStep('Sembrando carreras...');
  const careers = new Map<string, string>();

  for (const career of CAREERS) {
    const unit = requireEntry(units, career.unitKey, 'unidad organizativa');
    const existing = await prisma.career.findUnique({
      where: { code: career.code },
      select: { id: true },
    });

    const record = existing
      ? await prisma.career.update({
          where: { id: existing.id },
          data: { name: career.name, unitId: unit.id },
          select: { id: true },
        })
      : await prisma.career.create({
          data: {
            id: seedId('career', career.key),
            code: career.code,
            name: career.name,
            unitId: unit.id,
            isActive: true,
          },
          select: { id: true },
        });

    careers.set(career.code, record.id);
  }

  return { units, careers };
};
