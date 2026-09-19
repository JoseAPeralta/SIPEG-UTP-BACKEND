BEGIN;

-- CreateEnum
CREATE TYPE "GlobalRole" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "CollaborationRole" AS ENUM ('ORGANIZER', 'EDITOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "ProgramStatus" AS ENUM ('DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ActivityStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'ONGOING', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ClassroomType" AS ENUM ('LABORATORY', 'CLASSROOM');

-- CreateEnum
CREATE TYPE "ActivityType" AS ENUM ('WORKSHOP', 'SEMINAR', 'TALK', 'OTHER');

-- CreateEnum
CREATE TYPE "AttendanceMethod" AS ENUM ('QR', 'MANUAL');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AlertType" AS ENUM ('PROPOSAL_RECEIVED', 'PROPOSAL_UPDATED', 'PROPOSAL_RESPONDED', 'PROGRAM_UPDATED', 'PROGRAM_ARCHIVED', 'ACTIVITY_UPDATED', 'ACTIVITY_CANCELLED', 'CERTIFICATE_ISSUED');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "first_name" VARCHAR(100) NOT NULL,
    "last_name" VARCHAR(100) NOT NULL,
    "identification_number" VARCHAR(30) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "global_role" "GlobalRole" NOT NULL DEFAULT 'USER',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "faculty_id" TEXT,
    "career_id" TEXT,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "faculties" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "faculties_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subdirectorates" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "subdirectorates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "careers" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "faculty_id" TEXT NOT NULL,

    CONSTRAINT "careers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "permissions" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "description" VARCHAR(200),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_programs" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "label" VARCHAR(100),
    "banner_url" VARCHAR(500),
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "start_date" DATE,
    "end_date" DATE,
    "status" "ProgramStatus" NOT NULL DEFAULT 'DRAFT',
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "faculty_id" TEXT,
    "subdirectorate_id" TEXT,
    "created_by_id" TEXT,

    CONSTRAINT "event_programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activities" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "description" TEXT,
    "type" "ActivityType" NOT NULL,
    "date" DATE NOT NULL,
    "start_time" TIME(3) NOT NULL,
    "end_time" TIME(3) NOT NULL,
    "max_capacity" INTEGER,
    "banner_url" VARCHAR(500),
    "qr_code" VARCHAR(50) NOT NULL,
    "manual_code" VARCHAR(20),
    "status" "ActivityStatus" NOT NULL DEFAULT 'DRAFT',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "event_program_id" TEXT NOT NULL,
    "classroom_id" TEXT,
    "speaker_id" TEXT,

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_equipment" (
    "activity_id" TEXT NOT NULL,
    "name" VARCHAR(255) NOT NULL,

    CONSTRAINT "activity_equipment_pkey" PRIMARY KEY ("activity_id","name")
);

-- CreateTable
CREATE TABLE "collaborations" (
    "id" TEXT NOT NULL,
    "role" "CollaborationRole" NOT NULL DEFAULT 'VIEWER',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "event_program_id" TEXT,
    "activity_id" TEXT,
    "user_id" TEXT NOT NULL,

    CONSTRAINT "collaborations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collaboration_permissions" (
    "collaboration_id" TEXT NOT NULL,
    "permission_id" TEXT NOT NULL,

    CONSTRAINT "collaboration_permissions_pkey" PRIMARY KEY ("collaboration_id","permission_id")
);

-- CreateTable
CREATE TABLE "attendance" (
    "id" TEXT NOT NULL,
    "registered_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "method" "AttendanceMethod",
    "used_code" VARCHAR(50),
    "checked_in_at" TIMESTAMPTZ(3),
    "activity_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,

    CONSTRAINT "attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "certificates" (
    "id" TEXT NOT NULL,
    "code" VARCHAR(50) NOT NULL,
    "pdf_url" VARCHAR(500),
    "issued_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attendance_id" TEXT NOT NULL,

    CONSTRAINT "certificates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classrooms" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(50) NOT NULL,
    "type" "ClassroomType" NOT NULL,
    "capacity" INTEGER NOT NULL,
    "building" VARCHAR(50),
    "floor" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "classrooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classroom_amenities" (
    "classroom_id" TEXT NOT NULL,
    "amenity" VARCHAR(50) NOT NULL,

    CONSTRAINT "classroom_amenities_pkey" PRIMARY KEY ("classroom_id","amenity")
);

-- CreateTable
CREATE TABLE "classroom_availability" (
    "id" TEXT NOT NULL,
    "day_of_week" INTEGER NOT NULL,
    "start_time" TIME(3) NOT NULL,
    "end_time" TIME(3) NOT NULL,
    "period" VARCHAR(30),
    "classroom_id" TEXT NOT NULL,

    CONSTRAINT "classroom_availability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "speaker_proposals" (
    "id" TEXT NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "content" TEXT NOT NULL,
    "proposal_type" "ActivityType" NOT NULL,
    "estimated_duration" INTEGER,
    "cv_url" VARCHAR(500),
    "status" "ProposalStatus" NOT NULL DEFAULT 'PENDING',
    "submitted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "speaker_id" TEXT NOT NULL,
    "event_program_id" TEXT NOT NULL,

    CONSTRAINT "speaker_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposal_versions" (
    "id" TEXT NOT NULL,
    "version_number" INTEGER NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "content" TEXT NOT NULL,
    "proposal_type" "ActivityType" NOT NULL,
    "estimated_duration" INTEGER,
    "cv_url" VARCHAR(500),
    "submitted_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "proposal_id" TEXT NOT NULL,

    CONSTRAINT "proposal_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposal_feedback" (
    "id" TEXT NOT NULL,
    "content" TEXT,
    "image_url" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "proposal_id" TEXT NOT NULL,
    "author_id" TEXT NOT NULL,

    CONSTRAINT "proposal_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" TEXT NOT NULL,
    "type" "AlertType" NOT NULL,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recipient_id" TEXT NOT NULL,
    "proposal_id" TEXT,
    "event_program_id" TEXT,
    "activity_id" TEXT,
    "certificate_id" TEXT,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_identification_number_key" ON "users"("identification_number");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_faculty_id_idx" ON "users"("faculty_id");

-- CreateIndex
CREATE INDEX "users_career_id_idx" ON "users"("career_id");

-- CreateIndex
CREATE UNIQUE INDEX "faculties_code_key" ON "faculties"("code");

-- CreateIndex
CREATE UNIQUE INDEX "subdirectorates_code_key" ON "subdirectorates"("code");

-- CreateIndex
CREATE UNIQUE INDEX "careers_code_key" ON "careers"("code");

-- CreateIndex
CREATE INDEX "careers_faculty_id_idx" ON "careers"("faculty_id");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_name_key" ON "permissions"("name");

-- CreateIndex
CREATE INDEX "event_programs_faculty_id_status_idx" ON "event_programs"("faculty_id", "status");

-- CreateIndex
CREATE INDEX "event_programs_subdirectorate_id_status_idx" ON "event_programs"("subdirectorate_id", "status");

-- CreateIndex
CREATE INDEX "event_programs_created_by_id_idx" ON "event_programs"("created_by_id");

-- CreateIndex
CREATE UNIQUE INDEX "event_programs_default_faculty_key" ON "event_programs"("faculty_id") WHERE ("is_default" = true);

-- CreateIndex
CREATE UNIQUE INDEX "event_programs_default_subdirectorate_key" ON "event_programs"("subdirectorate_id") WHERE ("is_default" = true);

-- CreateIndex
CREATE UNIQUE INDEX "activities_qr_code_key" ON "activities"("qr_code");

-- CreateIndex
CREATE INDEX "activities_event_program_id_date_status_idx" ON "activities"("event_program_id", "date", "status");

-- CreateIndex
CREATE INDEX "activities_classroom_id_date_start_time_idx" ON "activities"("classroom_id", "date", "start_time");

-- CreateIndex
CREATE INDEX "activities_speaker_id_idx" ON "activities"("speaker_id");

-- CreateIndex
CREATE UNIQUE INDEX "activities_event_program_id_manual_code_key" ON "activities"("event_program_id", "manual_code");

-- CreateIndex
CREATE INDEX "collaborations_user_id_idx" ON "collaborations"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "collaborations_program_user_key" ON "collaborations"("event_program_id", "user_id") WHERE ("event_program_id" IS NOT NULL);

-- CreateIndex
CREATE UNIQUE INDEX "collaborations_activity_user_key" ON "collaborations"("activity_id", "user_id") WHERE ("activity_id" IS NOT NULL);

-- CreateIndex
CREATE INDEX "collaboration_permissions_permission_id_idx" ON "collaboration_permissions"("permission_id");

-- CreateIndex
CREATE INDEX "attendance_user_id_checked_in_at_idx" ON "attendance"("user_id", "checked_in_at");

-- CreateIndex
CREATE UNIQUE INDEX "attendance_activity_id_user_id_key" ON "attendance"("activity_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "certificates_code_key" ON "certificates"("code");

-- CreateIndex
CREATE UNIQUE INDEX "certificates_attendance_id_key" ON "certificates"("attendance_id");

-- CreateIndex
CREATE UNIQUE INDEX "classroom_availability_classroom_id_day_of_week_start_time__key" ON "classroom_availability"("classroom_id", "day_of_week", "start_time", "end_time");

-- CreateIndex
CREATE INDEX "speaker_proposals_event_program_id_status_submitted_at_idx" ON "speaker_proposals"("event_program_id", "status", "submitted_at");

-- CreateIndex
CREATE INDEX "speaker_proposals_speaker_id_idx" ON "speaker_proposals"("speaker_id");

-- CreateIndex
CREATE UNIQUE INDEX "proposal_versions_proposal_id_version_number_key" ON "proposal_versions"("proposal_id", "version_number");

-- CreateIndex
CREATE INDEX "proposal_feedback_proposal_id_idx" ON "proposal_feedback"("proposal_id");

-- CreateIndex
CREATE INDEX "proposal_feedback_author_id_idx" ON "proposal_feedback"("author_id");

-- CreateIndex
CREATE INDEX "alerts_recipient_id_is_read_created_at_idx" ON "alerts"("recipient_id", "is_read", "created_at");

-- CreateIndex
CREATE INDEX "alerts_proposal_id_idx" ON "alerts"("proposal_id");

-- CreateIndex
CREATE INDEX "alerts_event_program_id_idx" ON "alerts"("event_program_id");

-- CreateIndex
CREATE INDEX "alerts_activity_id_idx" ON "alerts"("activity_id");

-- CreateIndex
CREATE INDEX "alerts_certificate_id_idx" ON "alerts"("certificate_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_faculty_id_fkey" FOREIGN KEY ("faculty_id") REFERENCES "faculties"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_career_id_fkey" FOREIGN KEY ("career_id") REFERENCES "careers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "careers" ADD CONSTRAINT "careers_faculty_id_fkey" FOREIGN KEY ("faculty_id") REFERENCES "faculties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_programs" ADD CONSTRAINT "event_programs_faculty_id_fkey" FOREIGN KEY ("faculty_id") REFERENCES "faculties"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_programs" ADD CONSTRAINT "event_programs_subdirectorate_id_fkey" FOREIGN KEY ("subdirectorate_id") REFERENCES "subdirectorates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_programs" ADD CONSTRAINT "event_programs_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_event_program_id_fkey" FOREIGN KEY ("event_program_id") REFERENCES "event_programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_classroom_id_fkey" FOREIGN KEY ("classroom_id") REFERENCES "classrooms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_speaker_id_fkey" FOREIGN KEY ("speaker_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_equipment" ADD CONSTRAINT "activity_equipment_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "activities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collaborations" ADD CONSTRAINT "collaborations_event_program_id_fkey" FOREIGN KEY ("event_program_id") REFERENCES "event_programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collaborations" ADD CONSTRAINT "collaborations_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "activities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collaborations" ADD CONSTRAINT "collaborations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collaboration_permissions" ADD CONSTRAINT "collaboration_permissions_collaboration_id_fkey" FOREIGN KEY ("collaboration_id") REFERENCES "collaborations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collaboration_permissions" ADD CONSTRAINT "collaboration_permissions_permission_id_fkey" FOREIGN KEY ("permission_id") REFERENCES "permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "activities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "certificates" ADD CONSTRAINT "certificates_attendance_id_fkey" FOREIGN KEY ("attendance_id") REFERENCES "attendance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classroom_amenities" ADD CONSTRAINT "classroom_amenities_classroom_id_fkey" FOREIGN KEY ("classroom_id") REFERENCES "classrooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classroom_availability" ADD CONSTRAINT "classroom_availability_classroom_id_fkey" FOREIGN KEY ("classroom_id") REFERENCES "classrooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "speaker_proposals" ADD CONSTRAINT "speaker_proposals_speaker_id_fkey" FOREIGN KEY ("speaker_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "speaker_proposals" ADD CONSTRAINT "speaker_proposals_event_program_id_fkey" FOREIGN KEY ("event_program_id") REFERENCES "event_programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_versions" ADD CONSTRAINT "proposal_versions_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "speaker_proposals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_feedback" ADD CONSTRAINT "proposal_feedback_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "speaker_proposals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_feedback" ADD CONSTRAINT "proposal_feedback_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "speaker_proposals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_event_program_id_fkey" FOREIGN KEY ("event_program_id") REFERENCES "event_programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_activity_id_fkey" FOREIGN KEY ("activity_id") REFERENCES "activities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alerts" ADD CONSTRAINT "alerts_certificate_id_fkey" FOREIGN KEY ("certificate_id") REFERENCES "certificates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddCheckConstraints
ALTER TABLE "event_programs"
ADD CONSTRAINT "event_programs_owner_xor_check"
CHECK (("faculty_id" IS NOT NULL) <> ("subdirectorate_id" IS NOT NULL));

ALTER TABLE "event_programs"
ADD CONSTRAINT "event_programs_metadata_check"
CHECK (
    ("is_default" AND "start_date" IS NULL AND "end_date" IS NULL)
    OR
    (
        NOT "is_default"
        AND "start_date" IS NOT NULL
        AND "end_date" IS NOT NULL
        AND "label" IS NOT NULL
        AND "banner_url" IS NOT NULL
        AND "start_date" <= "end_date"
    )
);

ALTER TABLE "event_programs"
ADD CONSTRAINT "event_programs_default_status_check"
CHECK (NOT "is_default" OR "status" IN ('ACTIVE', 'ARCHIVED'));

ALTER TABLE "event_programs"
ADD CONSTRAINT "event_programs_archive_state_check"
CHECK (("status" = 'ARCHIVED') = ("archived_at" IS NOT NULL));

ALTER TABLE "event_programs"
ADD CONSTRAINT "event_programs_creator_check"
CHECK ("is_default" OR "created_by_id" IS NOT NULL);

ALTER TABLE "activities"
ADD CONSTRAINT "activities_time_range_check"
CHECK ("start_time" < "end_time");

ALTER TABLE "activities"
ADD CONSTRAINT "activities_max_capacity_check"
CHECK ("max_capacity" IS NULL OR "max_capacity" > 0);

ALTER TABLE "collaborations"
ADD CONSTRAINT "collaborations_scope_xor_check"
CHECK (("event_program_id" IS NOT NULL) <> ("activity_id" IS NOT NULL));

ALTER TABLE "attendance"
ADD CONSTRAINT "attendance_check_in_state_check"
CHECK (
    (
        "checked_in_at" IS NULL
        AND "method" IS NULL
        AND "used_code" IS NULL
    )
    OR
    (
        "checked_in_at" IS NOT NULL
        AND "method" IS NOT NULL
        AND "used_code" IS NOT NULL
        AND "checked_in_at" >= "registered_at"
    )
);

ALTER TABLE "classrooms"
ADD CONSTRAINT "classrooms_capacity_check"
CHECK ("capacity" > 0);

ALTER TABLE "classroom_availability"
ADD CONSTRAINT "classroom_availability_day_check"
CHECK ("day_of_week" BETWEEN 1 AND 7);

ALTER TABLE "classroom_availability"
ADD CONSTRAINT "classroom_availability_time_range_check"
CHECK ("start_time" < "end_time");

ALTER TABLE "speaker_proposals"
ADD CONSTRAINT "speaker_proposals_duration_check"
CHECK ("estimated_duration" IS NULL OR "estimated_duration" > 0);

ALTER TABLE "proposal_versions"
ADD CONSTRAINT "proposal_versions_number_check"
CHECK ("version_number" > 0);

ALTER TABLE "proposal_versions"
ADD CONSTRAINT "proposal_versions_duration_check"
CHECK ("estimated_duration" IS NULL OR "estimated_duration" > 0);

ALTER TABLE "proposal_feedback"
ADD CONSTRAINT "proposal_feedback_content_check"
CHECK (
    NULLIF(BTRIM("content"), '') IS NOT NULL
    OR NULLIF(BTRIM("image_url"), '') IS NOT NULL
);

ALTER TABLE "alerts"
ADD CONSTRAINT "alerts_target_check"
CHECK (
    num_nonnulls("proposal_id", "event_program_id", "activity_id", "certificate_id") = 1
    AND (
        ("type" IN ('PROPOSAL_RECEIVED', 'PROPOSAL_UPDATED', 'PROPOSAL_RESPONDED') AND "proposal_id" IS NOT NULL)
        OR ("type" IN ('PROGRAM_UPDATED', 'PROGRAM_ARCHIVED') AND "event_program_id" IS NOT NULL)
        OR ("type" IN ('ACTIVITY_UPDATED', 'ACTIVITY_CANCELLED') AND "activity_id" IS NOT NULL)
        OR ("type" = 'CERTIFICATE_ISSUED' AND "certificate_id" IS NOT NULL)
    )
);

-- Prevent overlapping classroom reservations while allowing adjacent activities.
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "activities"
ADD CONSTRAINT "activities_classroom_no_overlap"
EXCLUDE USING gist (
    "classroom_id" WITH =,
    "date" WITH =,
    tsrange(("date" + "start_time")::timestamp, ("date" + "end_time")::timestamp, '[)') WITH &&
)
WHERE ("classroom_id" IS NOT NULL AND "status" IN ('SCHEDULED', 'ONGOING'));

-- Event programs are archived, never physically deleted.
CREATE FUNCTION "prevent_event_program_delete"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'event programs cannot be deleted; archive the program instead';
END;
$$;

CREATE TRIGGER "event_programs_prevent_delete"
BEFORE DELETE ON "event_programs"
FOR EACH ROW
EXECUTE FUNCTION "prevent_event_program_delete"();

CREATE TRIGGER "event_programs_prevent_truncate"
BEFORE TRUNCATE ON "event_programs"
FOR EACH STATEMENT
EXECUTE FUNCTION "prevent_event_program_delete"();

-- Default identity is immutable, and a default program never changes owner.
CREATE FUNCTION "protect_event_program_identity"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW."is_default" IS DISTINCT FROM OLD."is_default" THEN
        RAISE EXCEPTION 'event program default identity is immutable';
    END IF;

    IF OLD."is_default" AND (
        NEW."faculty_id" IS DISTINCT FROM OLD."faculty_id"
        OR NEW."subdirectorate_id" IS DISTINCT FROM OLD."subdirectorate_id"
    ) THEN
        RAISE EXCEPTION 'default event program owner is immutable';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER "event_programs_protect_identity"
BEFORE UPDATE ON "event_programs"
FOR EACH ROW
EXECUTE FUNCTION "protect_event_program_identity"();

-- Validate program lifecycle rules while holding the rows used by activity writes.
CREATE FUNCTION "validate_event_program_transition"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    owner_is_active BOOLEAN;
BEGIN
    IF NOT NEW."is_default" AND (
        TG_OP = 'INSERT'
        OR NEW."created_by_id" IS DISTINCT FROM OLD."created_by_id"
    ) THEN
        PERFORM 1
        FROM "users"
        WHERE "id" = NEW."created_by_id" AND "global_role" = 'ADMIN'
        FOR KEY SHARE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'additional event programs must be created by an administrator';
        END IF;
    END IF;

    IF TG_OP = 'UPDATE' AND NOT NEW."is_default" AND (
        NEW."start_date" IS DISTINCT FROM OLD."start_date"
        OR NEW."end_date" IS DISTINCT FROM OLD."end_date"
    ) THEN
        PERFORM 1
        FROM "activities"
        WHERE "event_program_id" = NEW."id"
          AND ("date" < NEW."start_date" OR "date" > NEW."end_date")
        LIMIT 1;

        IF FOUND THEN
            RAISE EXCEPTION 'event program dates cannot exclude existing activities';
        END IF;
    END IF;

    IF NEW."status" = 'ARCHIVED' AND (
        TG_OP = 'INSERT'
        OR OLD."status" <> 'ARCHIVED'
    ) THEN
        IF NEW."is_default" THEN
            IF NEW."faculty_id" IS NOT NULL THEN
                SELECT "is_active"
                INTO STRICT owner_is_active
                FROM "faculties"
                WHERE "id" = NEW."faculty_id";
            ELSE
                SELECT "is_active"
                INTO STRICT owner_is_active
                FROM "subdirectorates"
                WHERE "id" = NEW."subdirectorate_id";
            END IF;

            IF owner_is_active THEN
                RAISE EXCEPTION 'a default event program cannot be archived while its owner is active';
            END IF;
        ELSE
            PERFORM 1
            FROM "activities"
            WHERE "event_program_id" = NEW."id"
              AND "status" IN ('SCHEDULED', 'ONGOING')
            LIMIT 1;

            IF FOUND THEN
                RAISE EXCEPTION 'an event program with scheduled or ongoing activities cannot be archived';
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER "event_programs_validate_transition"
BEFORE INSERT OR UPDATE OF "status", "start_date", "end_date", "created_by_id" ON "event_programs"
FOR EACH ROW
EXECUTE FUNCTION "validate_event_program_transition"();

-- Activity writes lock the parent program to serialize against archival.
CREATE FUNCTION "validate_activity_program"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    program_is_default BOOLEAN;
    program_start_date DATE;
    program_end_date DATE;
    program_status "ProgramStatus";
    requires_active_program BOOLEAN;
BEGIN
    SELECT "is_default", "start_date", "end_date", "status"
    INTO STRICT program_is_default, program_start_date, program_end_date, program_status
    FROM "event_programs"
    WHERE "id" = NEW."event_program_id"
    FOR UPDATE;

    IF TG_OP = 'INSERT' THEN
        requires_active_program := true;
    ELSE
        requires_active_program :=
            NEW."event_program_id" IS DISTINCT FROM OLD."event_program_id"
            OR NEW."date" IS DISTINCT FROM OLD."date"
            OR (
                NEW."status" IS DISTINCT FROM OLD."status"
                AND NEW."status" IN ('SCHEDULED', 'ONGOING')
            );
    END IF;

    IF requires_active_program AND program_status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'activities can only be created or scheduled in an active event program';
    END IF;

    IF NOT program_is_default AND (
        NEW."date" < program_start_date
        OR NEW."date" > program_end_date
    ) THEN
        RAISE EXCEPTION 'activity date must be within the event program date range';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER "activities_validate_program"
BEFORE INSERT OR UPDATE OF "event_program_id", "date", "status" ON "activities"
FOR EACH ROW
EXECUTE FUNCTION "validate_activity_program"();

-- Reactivating an organizational unit restores its existing default program atomically.
CREATE FUNCTION "reactivate_default_event_program"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    updated_programs INTEGER;
BEGIN
    IF NEW."is_active" AND NOT OLD."is_active" THEN
        IF TG_TABLE_NAME = 'faculties' THEN
            UPDATE "event_programs"
            SET "status" = 'ACTIVE', "archived_at" = NULL, "updated_at" = CURRENT_TIMESTAMP
            WHERE "faculty_id" = NEW."id" AND "is_default";
        ELSE
            UPDATE "event_programs"
            SET "status" = 'ACTIVE', "archived_at" = NULL, "updated_at" = CURRENT_TIMESTAMP
            WHERE "subdirectorate_id" = NEW."id" AND "is_default";
        END IF;

        GET DIAGNOSTICS updated_programs = ROW_COUNT;

        IF updated_programs <> 1 THEN
            RAISE EXCEPTION 'an organizational unit must have exactly one default event program';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER "faculties_reactivate_default_program"
AFTER UPDATE OF "is_active" ON "faculties"
FOR EACH ROW
EXECUTE FUNCTION "reactivate_default_event_program"();

CREATE TRIGGER "subdirectorates_reactivate_default_program"
AFTER UPDATE OF "is_active" ON "subdirectorates"
FOR EACH ROW
EXECUTE FUNCTION "reactivate_default_event_program"();

-- Proposal versions are append-only historical snapshots.
CREATE FUNCTION "prevent_proposal_version_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'proposal versions are immutable';
END;
$$;

CREATE TRIGGER "proposal_versions_prevent_mutation"
BEFORE UPDATE OR DELETE ON "proposal_versions"
FOR EACH ROW
EXECUTE FUNCTION "prevent_proposal_version_mutation"();

CREATE TRIGGER "proposal_versions_prevent_truncate"
BEFORE TRUNCATE ON "proposal_versions"
FOR EACH STATEMENT
EXECUTE FUNCTION "prevent_proposal_version_mutation"();

COMMIT;
