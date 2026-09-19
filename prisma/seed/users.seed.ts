import type { PrismaClient } from '../../src/generated/prisma/client.js';
import type { GlobalRole } from '../../src/generated/prisma/enums.js';
import { logStep, requireEntry, seedId } from './helpers.js';
import type { OrganizationCatalog } from './organizations.seed.js';

export interface UserCatalogEntry {
  key: string;
  email: string;
  firstName: string;
  lastName: string;
  identificationNumber: string;
  globalRole: GlobalRole;
  unitKey: string | null;
  careerCode: string | null;
}

export const ADMIN_KEY = 'admin';

export const USERS: readonly UserCatalogEntry[] = [
  {
    key: 'admin',
    email: 'admin@utp.ac.pa',
    firstName: 'Administrador',
    lastName: 'SIPEG',
    identificationNumber: 'SEED-8-000-0001',
    globalRole: 'ADMIN',
    unitKey: null,
    careerCode: null,
  },
  {
    key: 'org-fic',
    email: 'organizador.fic@utp.ac.pa',
    firstName: 'Ricardo',
    lastName: 'Arosemena',
    identificationNumber: 'SEED-8-101-0001',
    globalRole: 'USER',
    unitKey: 'fic',
    careerCode: 'FIC-CIV',
  },
  {
    key: 'org-fie',
    email: 'organizador.fie@utp.ac.pa',
    firstName: 'Elena',
    lastName: 'Batista',
    identificationNumber: 'SEED-8-102-0002',
    globalRole: 'USER',
    unitKey: 'fie',
    careerCode: 'FIE-ELE',
  },
  {
    key: 'org-fii',
    email: 'organizador.fii@utp.ac.pa',
    firstName: 'Mario',
    lastName: 'Cedeño',
    identificationNumber: 'SEED-8-103-0003',
    globalRole: 'USER',
    unitKey: 'fii',
    careerCode: 'FII-IND',
  },
  {
    key: 'org-fim',
    email: 'organizador.fim@utp.ac.pa',
    firstName: 'Lourdes',
    lastName: 'Dominguez',
    identificationNumber: 'SEED-8-104-0004',
    globalRole: 'USER',
    unitKey: 'fim',
    careerCode: 'FIM-MEC',
  },
  {
    key: 'org-fisc',
    email: 'organizador.fisc@utp.ac.pa',
    firstName: 'Nestor',
    lastName: 'Espinosa',
    identificationNumber: 'SEED-8-105-0005',
    globalRole: 'USER',
    unitKey: 'fisc',
    careerCode: 'FISC-SIS',
  },
  {
    key: 'org-fct',
    email: 'organizador.fct@utp.ac.pa',
    firstName: 'Marisol',
    lastName: 'Fernandez',
    identificationNumber: 'SEED-8-106-0006',
    globalRole: 'USER',
    unitKey: 'fct',
    careerCode: 'FCT-ALI',
  },
  {
    key: 'org-sub-acad',
    email: 'organizador.sub-acad@utp.ac.pa',
    firstName: 'Gisela',
    lastName: 'Gonzalez',
    identificationNumber: 'SEED-8-107-0007',
    globalRole: 'USER',
    unitKey: 'sub-acad',
    careerCode: null,
  },
  {
    key: 'org-sub-admin',
    email: 'organizador.sub-admin@utp.ac.pa',
    firstName: 'Rafael',
    lastName: 'Herrera',
    identificationNumber: 'SEED-8-108-0008',
    globalRole: 'USER',
    unitKey: 'sub-admin',
    careerCode: null,
  },
  {
    key: 'org-sub-vida',
    email: 'organizador.sub-vida@utp.ac.pa',
    firstName: 'Yolanda',
    lastName: 'Iglesias',
    identificationNumber: 'SEED-8-109-0009',
    globalRole: 'USER',
    unitKey: 'sub-vida',
    careerCode: null,
  },
  {
    key: 'org-sub-ipe',
    email: 'organizador.sub-ipe@utp.ac.pa',
    firstName: 'Alberto',
    lastName: 'Jaen',
    identificationNumber: 'SEED-8-110-0010',
    globalRole: 'USER',
    unitKey: 'sub-ipe',
    careerCode: null,
  },
  {
    key: 'editor',
    email: 'editor.eventos@utp.ac.pa',
    firstName: 'Paola',
    lastName: 'Kim',
    identificationNumber: 'SEED-8-111-0011',
    globalRole: 'USER',
    unitKey: 'fisc',
    careerCode: 'FISC-SOF',
  },
  {
    key: 'visor',
    email: 'visor.eventos@utp.ac.pa',
    firstName: 'Hector',
    lastName: 'Lasso',
    identificationNumber: 'SEED-8-112-0012',
    globalRole: 'USER',
    unitKey: 'fct',
    careerCode: 'FCT-CEB',
  },
  {
    key: 'speaker-ana',
    email: 'ponente.ana.perez@utp.ac.pa',
    firstName: 'Ana',
    lastName: 'Perez',
    identificationNumber: 'SEED-8-113-0013',
    globalRole: 'USER',
    unitKey: 'fisc',
    careerCode: 'FISC-CCP',
  },
  {
    key: 'speaker-carlos',
    email: 'ponente.carlos.rivera@utp.ac.pa',
    firstName: 'Carlos',
    lastName: 'Rivera',
    identificationNumber: 'SEED-8-114-0014',
    globalRole: 'USER',
    unitKey: 'fie',
    careerCode: 'FIE-ETC',
  },
  {
    key: 'speaker-diana',
    email: 'ponente.diana.gomez@utp.ac.pa',
    firstName: 'Diana',
    lastName: 'Gomez',
    identificationNumber: 'SEED-8-115-0015',
    globalRole: 'USER',
    unitKey: 'fii',
    careerCode: 'FII-LOG',
  },
  {
    key: 'speaker-ivan',
    email: 'ponente.ivan.morales@utp.ac.pa',
    firstName: 'Ivan',
    lastName: 'Morales',
    identificationNumber: 'SEED-8-116-0016',
    globalRole: 'USER',
    unitKey: 'fct',
    careerCode: 'FCT-QUI',
  },
  {
    key: 'student-01',
    email: 'estudiante01@utp.ac.pa',
    firstName: 'Adriana',
    lastName: 'Nunez',
    identificationNumber: 'SEED-8-117-0017',
    globalRole: 'USER',
    unitKey: 'fisc',
    careerCode: 'FISC-SIS',
  },
  {
    key: 'student-02',
    email: 'estudiante02@utp.ac.pa',
    firstName: 'Bruno',
    lastName: 'Obaldia',
    identificationNumber: 'SEED-8-118-0018',
    globalRole: 'USER',
    unitKey: 'fisc',
    careerCode: 'FISC-SOF',
  },
  {
    key: 'student-03',
    email: 'estudiante03@utp.ac.pa',
    firstName: 'Carla',
    lastName: 'Pineda',
    identificationNumber: 'SEED-8-119-0019',
    globalRole: 'USER',
    unitKey: 'fisc',
    careerCode: 'FISC-CIB',
  },
  {
    key: 'student-04',
    email: 'estudiante04@utp.ac.pa',
    firstName: 'Diego',
    lastName: 'Quintero',
    identificationNumber: 'SEED-8-120-0020',
    globalRole: 'USER',
    unitKey: 'fie',
    careerCode: 'FIE-ELE',
  },
  {
    key: 'student-05',
    email: 'estudiante05@utp.ac.pa',
    firstName: 'Erika',
    lastName: 'Rangel',
    identificationNumber: 'SEED-8-121-0021',
    globalRole: 'USER',
    unitKey: 'fie',
    careerCode: 'FIE-ETC',
  },
  {
    key: 'student-06',
    email: 'estudiante06@utp.ac.pa',
    firstName: 'Fabio',
    lastName: 'Salazar',
    identificationNumber: 'SEED-8-122-0022',
    globalRole: 'USER',
    unitKey: 'fii',
    careerCode: 'FII-IND',
  },
  {
    key: 'student-07',
    email: 'estudiante07@utp.ac.pa',
    firstName: 'Gabriela',
    lastName: 'Tello',
    identificationNumber: 'SEED-8-123-0023',
    globalRole: 'USER',
    unitKey: 'fii',
    careerCode: 'FII-LOG',
  },
  {
    key: 'student-08',
    email: 'estudiante08@utp.ac.pa',
    firstName: 'Hugo',
    lastName: 'Ureña',
    identificationNumber: 'SEED-8-124-0024',
    globalRole: 'USER',
    unitKey: 'fic',
    careerCode: 'FIC-CIV',
  },
  {
    key: 'student-09',
    email: 'estudiante09@utp.ac.pa',
    firstName: 'Ilse',
    lastName: 'Vargas',
    identificationNumber: 'SEED-8-125-0025',
    globalRole: 'USER',
    unitKey: 'fim',
    careerCode: 'FIM-MEC',
  },
  {
    key: 'student-10',
    email: 'estudiante10@utp.ac.pa',
    firstName: 'Javier',
    lastName: 'Wong',
    identificationNumber: 'SEED-8-126-0026',
    globalRole: 'USER',
    unitKey: 'fct',
    careerCode: 'FCT-ALI',
  },
  {
    key: 'student-11',
    email: 'estudiante11@utp.ac.pa',
    firstName: 'Karla',
    lastName: 'Xu',
    identificationNumber: 'SEED-8-127-0027',
    globalRole: 'USER',
    unitKey: 'fct',
    careerCode: 'FCT-CEB',
  },
  {
    key: 'student-12',
    email: 'estudiante12@utp.ac.pa',
    firstName: 'Luis',
    lastName: 'Zamora',
    identificationNumber: 'SEED-8-128-0028',
    globalRole: 'USER',
    unitKey: 'fii',
    careerCode: 'FII-ADM',
  },
];

const HEADS: ReadonlyArray<{ unitKey: string; userKey: string }> = [
  { unitKey: 'fic', userKey: 'org-fic' },
  { unitKey: 'fie', userKey: 'org-fie' },
  { unitKey: 'fii', userKey: 'org-fii' },
  { unitKey: 'fim', userKey: 'org-fim' },
  { unitKey: 'fisc', userKey: 'org-fisc' },
  { unitKey: 'fct', userKey: 'org-fct' },
  { unitKey: 'sub-acad', userKey: 'org-sub-acad' },
  { unitKey: 'sub-admin', userKey: 'org-sub-admin' },
  { unitKey: 'sub-vida', userKey: 'org-sub-vida' },
  { unitKey: 'sub-ipe', userKey: 'org-sub-ipe' },
];

export interface SeedUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
}

export const seedUsers = async (
  prisma: PrismaClient,
  catalog: OrganizationCatalog,
  passwordHash: string,
): Promise<Map<string, SeedUser>> => {
  logStep('Sembrando usuarios y cuentas de credenciales...');
  const users = new Map<string, SeedUser>();

  for (const user of USERS) {
    const unit = user.unitKey ? requireEntry(catalog.units, user.unitKey, 'unidad') : null;
    const careerId = user.careerCode
      ? requireEntry(catalog.careers, user.careerCode, 'carrera')
      : null;
    const name = `${user.firstName} ${user.lastName}`;

    const existing = await prisma.user.findUnique({
      where: { email: user.email },
      select: { id: true },
    });

    const record = existing
      ? await prisma.user.update({
          where: { id: existing.id },
          data: {
            name,
            firstName: user.firstName,
            lastName: user.lastName,
            identificationNumber: user.identificationNumber,
            globalRole: user.globalRole,
            isActive: true,
            emailVerified: true,
            unitId: unit?.id ?? null,
            careerId,
          },
          select: { id: true, email: true, firstName: true, lastName: true },
        })
      : await prisma.user.create({
          data: {
            id: seedId('user', user.key),
            name,
            firstName: user.firstName,
            lastName: user.lastName,
            identificationNumber: user.identificationNumber,
            email: user.email,
            emailVerified: true,
            globalRole: user.globalRole,
            isActive: true,
            unitId: unit?.id ?? null,
            careerId,
          },
          select: { id: true, email: true, firstName: true, lastName: true },
        });

    const account = await prisma.account.findFirst({
      where: { userId: record.id, providerId: 'credential' },
      select: { id: true },
    });

    if (account) {
      await prisma.account.update({
        where: { id: account.id },
        data: { password: passwordHash },
      });
    } else {
      await prisma.account.create({
        data: {
          id: seedId('account', user.key),
          accountId: record.id,
          providerId: 'credential',
          userId: record.id,
          password: passwordHash,
        },
      });
    }

    users.set(user.key, record);
  }

  logStep('Asignando encargados a las unidades organizativas...');
  for (const head of HEADS) {
    const unit = requireEntry(catalog.units, head.unitKey, 'unidad');
    const user = requireEntry(users, head.userKey, 'usuario');
    await prisma.organizationalUnit.update({
      where: { id: unit.id },
      data: { headId: user.id },
    });
  }

  return users;
};
