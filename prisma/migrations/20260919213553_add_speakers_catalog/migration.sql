-- DropForeignKey
ALTER TABLE "speaker_proposals" DROP CONSTRAINT "speaker_proposals_speaker_id_fkey";

-- CreateTable
CREATE TABLE "speakers" (
    "id" TEXT NOT NULL,
    "first_name" VARCHAR(100) NOT NULL,
    "last_name" VARCHAR(100) NOT NULL,
    "email" VARCHAR(254),
    "organization" VARCHAR(150),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "user_id" TEXT,

    CONSTRAINT "speakers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_speakers" (
    "activity_id" TEXT NOT NULL,
    "speaker_id" TEXT NOT NULL,

    CONSTRAINT "activity_speakers_pkey" PRIMARY KEY ("activity_id","speaker_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "speakers_email_key" ON "speakers"("email");

-- CreateIndex
CREATE UNIQUE INDEX "speakers_user_id_key" ON "speakers"("user_id");

-- CreateIndex
CREATE INDEX "speakers_last_name_first_name_idx" ON "speakers"("last_name", "first_name");

-- CreateIndex
CREATE INDEX "activity_speakers_speaker_id_idx" ON "activity_speakers"("speaker_id");

-- AddForeignKey
ALTER TABLE "speakers" ADD CONSTRAINT "speakers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: one speaker per user referenced by activities or proposals
INSERT INTO "speakers" ("id", "first_name", "last_name", "email", "organization", "created_at", "updated_at", "user_id")
SELECT gen_random_uuid()::text, u."first_name", u."last_name", u."email", NULL, now(), now(), u."id"
FROM "users" u
WHERE EXISTS (SELECT 1 FROM "activities" a WHERE a."speaker_id" = u."id")
   OR EXISTS (SELECT 1 FROM "speaker_proposals" p WHERE p."speaker_id" = u."id");

-- Backfill: repoint proposals to the new speaker catalog
UPDATE "speaker_proposals" p
SET "speaker_id" = s."id"
FROM "speakers" s
WHERE s."user_id" = p."speaker_id";

-- Backfill: link existing activities to their backfilled speakers
INSERT INTO "activity_speakers" ("activity_id", "speaker_id")
SELECT a."id", s."id"
FROM "activities" a
JOIN "speakers" s ON s."user_id" = a."speaker_id";

-- DropForeignKey
ALTER TABLE "activities" DROP CONSTRAINT "activities_speaker_id_fkey";

-- DropIndex
DROP INDEX "activities_speaker_id_idx";

-- AlterTable
ALTER TABLE "activities" DROP COLUMN "speaker_id";

-- AddForeignKey
ALTER TABLE "activity_speakers" ADD CONSTRAINT "activity_speakers_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "activities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_speakers" ADD CONSTRAINT "activity_speakers_speaker_id_fkey" FOREIGN KEY ("speaker_id") REFERENCES "speakers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "speaker_proposals" ADD CONSTRAINT "speaker_proposals_speaker_id_fkey" FOREIGN KEY ("speaker_id") REFERENCES "speakers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
