import type { PrismaClient } from '../../src/generated/prisma/client.js';
import { logStep, requireEntry, seedId } from './helpers.js';
import type { SeedUser } from './users.seed.js';

export interface SeedSpeaker {
  id: string;
  key: string;
  userId: string | null;
}

interface UserSpeakerEntry {
  key: string;
  userKey: string;
  organization?: string;
}

interface ExternalSpeakerEntry {
  key: string;
  userKey?: never;
  firstName: string;
  lastName: string;
  email: string | null;
  organization: string | null;
}

export type SpeakerCatalogEntry = UserSpeakerEntry | ExternalSpeakerEntry;

export const SPEAKERS: readonly SpeakerCatalogEntry[] = [
  { key: 'speaker-ana', userKey: 'speaker-ana' },
  { key: 'speaker-carlos', userKey: 'speaker-carlos' },
  { key: 'speaker-diana', userKey: 'speaker-diana' },
  { key: 'speaker-ivan', userKey: 'speaker-ivan' },
  { key: 'org-fic', userKey: 'org-fic' },
  { key: 'org-fii', userKey: 'org-fii' },
  { key: 'org-fim', userKey: 'org-fim' },
  { key: 'org-sub-acad', userKey: 'org-sub-acad' },
  { key: 'org-sub-admin', userKey: 'org-sub-admin' },
  { key: 'org-sub-vida', userKey: 'org-sub-vida' },
  { key: 'org-sub-ipe', userKey: 'org-sub-ipe' },
  {
    key: 'speaker-externo-luisa',
    firstName: 'Luisa',
    lastName: 'Fernandez',
    email: 'luisa.fernandez@ponentes.utp.ac.pa',
    organization: 'Universidad Tecnologica de Panama',
  },
  {
    key: 'speaker-externo-marco',
    firstName: 'Marco',
    lastName: 'Santos',
    email: null,
    organization: 'Colegio de Ingenieros de Panama',
  },
];

export const seedSpeakers = async (
  prisma: PrismaClient,
  input: { users: Map<string, SeedUser> },
): Promise<Map<string, SeedSpeaker>> => {
  logStep('Sembrando catalogo de ponentes...');
  const speakers = new Map<string, SeedSpeaker>();

  for (const speaker of SPEAKERS) {
    const id = seedId('speaker', speaker.key);

    if (speaker.userKey !== undefined) {
      const user = requireEntry(input.users, speaker.userKey, 'usuario ponente');
      const data = {
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        organization: speaker.organization ?? null,
        userId: user.id,
      };

      const record = await prisma.speaker.upsert({
        where: { userId: user.id },
        update: data,
        create: { id, ...data },
        select: { id: true },
      });

      speakers.set(speaker.key, { id: record.id, key: speaker.key, userId: user.id });
      continue;
    }

    const data = {
      firstName: speaker.firstName,
      lastName: speaker.lastName,
      email: speaker.email,
      organization: speaker.organization,
      userId: null,
    };

    const record =
      speaker.email !== null
        ? await prisma.speaker.upsert({
            where: { email: speaker.email },
            update: data,
            create: { id, ...data },
            select: { id: true },
          })
        : await prisma.speaker.upsert({
            where: { id },
            update: data,
            create: { id, ...data },
            select: { id: true },
          });

    speakers.set(speaker.key, { id: record.id, key: speaker.key, userId: null });
  }

  return speakers;
};
