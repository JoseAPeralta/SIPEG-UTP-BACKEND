import type { PrismaClient } from '../../src/generated/prisma/client.js';
import type { ActivityType, ProposalStatus } from '../../src/generated/prisma/enums.js';
import { instantOffset, logStep, requireEntry, seedId } from './helpers.js';
import type { OrganizationCatalog } from './organizations.seed.js';
import type { SeedSpeaker } from './speakers.seed.js';
import type { SeedUser } from './users.seed.js';

interface ProposalVersionCatalogEntry {
  title: string;
  content: string;
  estimatedDuration: number;
}

interface ProposalFeedbackCatalogEntry {
  authorKey: string;
  content: string;
  offsetDays: number;
}

interface ProposalCatalogEntry {
  key: string;
  unitKey: string;
  speakerKey: string;
  reviewerKey: string;
  title: string;
  content: string;
  proposalType: ActivityType;
  estimatedDuration: number;
  cvUrl: string;
  status: ProposalStatus;
  submittedOffsetDays: number;
  respondedOffsetDays: number | null;
  versions: readonly ProposalVersionCatalogEntry[];
  feedback: readonly ProposalFeedbackCatalogEntry[];
}

export const PROPOSALS: readonly ProposalCatalogEntry[] = [
  {
    key: 'ciberseguridad-defensiva',
    unitKey: 'fisc',
    speakerKey: 'speaker-ana',
    reviewerKey: 'org-fisc',
    title: 'Ciberseguridad defensiva para infraestructuras críticas',
    content:
      'Propuesta de taller práctico sobre detección, contención y respuesta a incidentes en infraestructuras críticas.',
    proposalType: 'WORKSHOP',
    estimatedDuration: 180,
    cvUrl: '/cv/seed-ana-perez.pdf',
    status: 'APPROVED',
    submittedOffsetDays: -45,
    respondedOffsetDays: -38,
    versions: [
      {
        title: 'Ciberseguridad defensiva para infraestructuras críticas',
        content:
          'Propuesta de taller práctico sobre detección, contención y respuesta a incidentes.',
        estimatedDuration: 180,
      },
      {
        title: 'Ciberseguridad defensiva para infraestructuras críticas',
        content:
          'Versión ampliada: se agrega un laboratorio de análisis forense y un caso de estudio local.',
        estimatedDuration: 240,
      },
    ],
    feedback: [
      {
        authorKey: 'org-fisc',
        content: 'Propuesta aprobada. Ajustar la duración a 4 horas para el congreso.',
        offsetDays: -38,
      },
    ],
  },
  {
    key: 'logistica-analitica',
    unitKey: 'fii',
    speakerKey: 'speaker-diana',
    reviewerKey: 'org-fii',
    title: 'Analítica de datos aplicada a la cadena de suministro',
    content:
      'Propuesta de seminario sobre modelos predictivos para la gestión de inventarios y rutas.',
    proposalType: 'SEMINAR',
    estimatedDuration: 120,
    cvUrl: '/cv/seed-diana-gomez.pdf',
    status: 'PENDING',
    submittedOffsetDays: -12,
    respondedOffsetDays: null,
    versions: [
      {
        title: 'Analítica de datos aplicada a la cadena de suministro',
        content: 'Seminario introductorio con casos de estudio regionales.',
        estimatedDuration: 120,
      },
    ],
    feedback: [],
  },
  {
    key: 'gestion-conocimiento',
    unitKey: 'sub-ipe',
    speakerKey: 'speaker-carlos',
    reviewerKey: 'org-sub-ipe',
    title: 'Gestión del conocimiento en proyectos de investigación',
    content:
      'Propuesta de charla sobre transferencia de conocimiento y propiedad intelectual en la UTP.',
    proposalType: 'TALK',
    estimatedDuration: 90,
    cvUrl: '/cv/seed-carlos-rivera.pdf',
    status: 'PENDING',
    submittedOffsetDays: -8,
    respondedOffsetDays: null,
    versions: [
      {
        title: 'Gestión del conocimiento en proyectos de investigación',
        content: 'Charla de 90 minutos con espacio para preguntas.',
        estimatedDuration: 90,
      },
    ],
    feedback: [],
  },
  {
    key: 'alimentos-funcionales',
    unitKey: 'fct',
    speakerKey: 'speaker-ivan',
    reviewerKey: 'org-fct',
    title: 'Desarrollo de alimentos funcionales a partir de productos locales',
    content:
      'Propuesta de seminario sobre formulación y validación de alimentos funcionales panameños.',
    proposalType: 'SEMINAR',
    estimatedDuration: 150,
    cvUrl: '/cv/seed-ivan-morales.pdf',
    status: 'REJECTED',
    submittedOffsetDays: -60,
    respondedOffsetDays: -52,
    versions: [
      {
        title: 'Desarrollo de alimentos funcionales a partir de productos locales',
        content: 'Seminario con demostración de laboratorio.',
        estimatedDuration: 150,
      },
    ],
    feedback: [
      {
        authorKey: 'org-fct',
        content:
          'No se dispone de laboratorio disponible en la fecha propuesta. Reenviar para el próximo semestre.',
        offsetDays: -52,
      },
    ],
  },
];

export interface SeedProposal {
  id: string;
  key: string;
  speakerId: string;
  status: ProposalStatus;
}

export const seedProposals = async (
  prisma: PrismaClient,
  input: {
    catalog: OrganizationCatalog;
    users: Map<string, SeedUser>;
    speakers: Map<string, SeedSpeaker>;
  },
  now: Date = new Date(),
): Promise<Map<string, SeedProposal>> => {
  logStep('Sembrando propuestas, versiones, feedback y alertas de propuesta...');
  const proposals = new Map<string, SeedProposal>();

  for (const proposal of PROPOSALS) {
    const unit = requireEntry(input.catalog.units, proposal.unitKey, 'unidad organizativa');
    const speaker = requireEntry(input.speakers, proposal.speakerKey, 'ponente');
    const reviewer = requireEntry(input.users, proposal.reviewerKey, 'usuario revisor');
    const submittedAt = instantOffset(proposal.submittedOffsetDays, 10, 0, now);

    const id = seedId('proposal', proposal.key);

    await prisma.speakerProposal.upsert({
      where: { id },
      update: {
        title: proposal.title,
        content: proposal.content,
        proposalType: proposal.proposalType,
        estimatedDuration: proposal.estimatedDuration,
        cvUrl: proposal.cvUrl,
        status: proposal.status,
        submittedAt,
        speakerId: speaker.id,
        eventProgramId: unit.programId,
      },
      create: {
        id,
        title: proposal.title,
        content: proposal.content,
        proposalType: proposal.proposalType,
        estimatedDuration: proposal.estimatedDuration,
        cvUrl: proposal.cvUrl,
        status: proposal.status,
        submittedAt,
        speakerId: speaker.id,
        eventProgramId: unit.programId,
      },
    });

    await prisma.proposalVersion.createMany({
      data: proposal.versions.map((version, index) => ({
        id: seedId('proposal_version', proposal.key, String(index + 1)),
        proposalId: id,
        versionNumber: index + 1,
        title: version.title,
        content: version.content,
        proposalType: proposal.proposalType,
        estimatedDuration: version.estimatedDuration,
        cvUrl: proposal.cvUrl,
        submittedAt: instantOffset(proposal.submittedOffsetDays + index, 10, 30, now),
      })),
      skipDuplicates: true,
    });

    for (const [index, feedback] of proposal.feedback.entries()) {
      const author = requireEntry(input.users, feedback.authorKey, 'usuario autor');
      const createdAt = instantOffset(feedback.offsetDays, 11, 0, now);

      await prisma.proposalFeedback.upsert({
        where: { id: seedId('proposal_feedback', proposal.key, String(index + 1)) },
        update: { content: feedback.content, authorId: author.id, createdAt },
        create: {
          id: seedId('proposal_feedback', proposal.key, String(index + 1)),
          content: feedback.content,
          authorId: author.id,
          proposalId: id,
          createdAt,
        },
      });
    }

    await prisma.alert.upsert({
      where: { id: seedId('alert', 'proposal_received', proposal.key) },
      update: { isRead: proposal.status !== 'PENDING', recipientId: reviewer.id, proposalId: id },
      create: {
        id: seedId('alert', 'proposal_received', proposal.key),
        type: 'PROPOSAL_RECEIVED',
        isRead: proposal.status !== 'PENDING',
        recipientId: reviewer.id,
        proposalId: id,
        createdAt: submittedAt,
      },
    });

    if (proposal.respondedOffsetDays !== null && speaker.userId !== null) {
      const respondedAt = instantOffset(proposal.respondedOffsetDays, 12, 0, now);
      await prisma.alert.upsert({
        where: { id: seedId('alert', 'proposal_responded', proposal.key) },
        update: { isRead: true, recipientId: speaker.userId, proposalId: id },
        create: {
          id: seedId('alert', 'proposal_responded', proposal.key),
          type: 'PROPOSAL_RESPONDED',
          isRead: true,
          recipientId: speaker.userId,
          proposalId: id,
          createdAt: respondedAt,
        },
      });
    }

    proposals.set(proposal.key, {
      id,
      key: proposal.key,
      speakerId: speaker.id,
      status: proposal.status,
    });
  }

  return proposals;
};
