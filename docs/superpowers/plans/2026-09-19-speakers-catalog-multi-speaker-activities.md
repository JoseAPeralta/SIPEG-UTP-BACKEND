# Plan: catálogo de ponentes sin cuenta + múltiples ponentes por actividad

## Objetivo

Modelar los ponentes como un catálogo `Speaker` independiente de `User` (vínculo opcional)
y permitir N ponentes por actividad. Adaptar POST/GET de actividades, propuestas, seed,
migración, tests y documentación. Sin CRUD `/api/v1/speakers` en este trabajo.

## Decisiones

- `Speaker`: `firstName`, `lastName`, `email?` (único, trim+lowercase), `organization?`,
  `userId?` (único, vínculo opcional a cuenta) y timestamps.
- `ActivitySpeaker`: tabla puente explícita con PK compuesta y `onDelete: Cascade`.
- `SpeakerProposal.speakerId` pasa a apuntar a `Speaker` (`onDelete: Restrict`).
- `User.presentedActivities` se elimina; `User.speakerProfile Speaker?` opcional.
- POST `/activities` acepta `speakers` inline; reutiliza por email y vincula `userId`
  si existe una cuenta con ese email. Sin email se crea un ponente nuevo.
- Respuestas exponen `speakers: ActivitySpeakerSummary[]` (sin email) ordenados por
  apellido/nombre. Máximo 10 ponentes y emails únicos por actividad.
- Escritura atómica: nested writes de Prisma dentro de `activity.create`.

## Archivos

- `prisma/schema.prisma` + migración nueva con backfill.
- `prisma/seed/speakers.seed.ts` (nuevo), `activities.seed.ts`, `proposals.seed.ts`, `index.ts`.
- `src/modules/activities/activities.{types,schemas,service}.ts` y tests.
- `src/modules/activities/activities.openapi.ts`, `openapi.json`.
- `bruno/Activities/Create an activity.bru`.
- `README.md`, `CONTEXT.md`, `AGENTS.md`.

## Fase 1 - Schema y migración

1. Editar `prisma/schema.prisma` (Speaker, ActivitySpeaker, Activity, User, SpeakerProposal).
2. `pnpm prisma validate`, `prisma format`.
3. `pnpm prisma migrate dev --create-only --name add_speakers_catalog`.
4. Editar SQL: crear tablas, insertar speakers desde users referenciados por
   `activities.speaker_id` y `speaker_proposals.speaker_id`, remapear
   `speaker_proposals.speaker_id`, insertar `activity_speakers`, y solo entonces
   aplicar los DROP/FK generados.
5. `pnpm prisma migrate dev` + `pnpm prisma generate`.

## Fase 2 - Seed

- `speakers.seed.ts`: 4 ponentes vinculados a sus users + 2 externos sin cuenta.
- `activities.seed.ts`: `speakerKey` → `speakerKeys[]` (una actividad con 2 ponentes).
- `proposals.seed.ts`: resolver speaker desde el catálogo de ponentes.
- `index.ts`: `seedSpeakers` tras `seedUsers`; pasar map a activities/proposals; conteo.

## Fase 3 - API Actividades (TDD)

- Tests de schemas (RED → GREEN): `speakers` array, máx 10, emails duplicados, sin `speakerId`.
- Tests de service (RED → GREEN): mapper de `speakers`, reutilización por email,
  creación sin email, vínculo `userId`, sin validación de User activo.
- Tests de ruta: body con `speakers` y respuesta con array.

## Fase 4 - OpenAPI, Bruno y docs

- `activitySpeakerInputSchema` con `.meta({ id: 'ActivitySpeakerInput' })`.
- `pnpm run docs:generate` + `docs:check`; request Bruno actualizado.
- README (body de creación + breaking change), CONTEXT (definiciones y propuestas),
  AGENTS (regla de cuenta para propuestas).

## Verificación

```bash
pnpm prisma validate && pnpm prisma format && pnpm prisma generate
pnpm prisma migrate status
pnpm prisma:seed
pnpm test
pnpm run typecheck && pnpm run lint
pnpm run docs:generate && pnpm run docs:check && pnpm run format:check
```

## Breaking changes

- `ActivityListItem.speaker` / `ActivityDetail.speaker` → `speakers: ActivitySpeakerSummary[]`.
- POST `/api/v1/activities`: `speakerId` → `speakers[]` inline.

## Fuera de alcance

CRUD `/api/v1/speakers`, endpoints de propuestas, regeneración del `.drawio` ER.
