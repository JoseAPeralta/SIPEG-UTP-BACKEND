-- Unify faculties and subdirectorates into organizational_units and collapse
-- EventProgram owner columns into a single organizational_unit_id.

-- CreateEnum
CREATE TYPE "UnitType" AS ENUM ('FACULTY', 'SUBDIRECTORATE');

-- Drop functions and triggers that depend on the legacy tables/columns before
-- reshaping. plpgsql bodies are late-bound, so PostgreSQL does not track these
-- dependencies automatically.
DROP TRIGGER IF EXISTS "event_programs_protect_identity" ON "event_programs";
DROP FUNCTION IF EXISTS "protect_event_program_identity"();
DROP TRIGGER IF EXISTS "event_programs_validate_transition" ON "event_programs";
DROP FUNCTION IF EXISTS "validate_event_program_transition"();
DROP TRIGGER IF EXISTS "faculties_reactivate_default_program" ON "faculties";
DROP TRIGGER IF EXISTS "subdirectorates_reactivate_default_program" ON "subdirectorates";
DROP FUNCTION IF EXISTS "reactivate_default_event_program"();

-- CreateTable
CREATE TABLE "organizational_units" (
    "id" TEXT NOT NULL,
    "name" VARCHAR(150) NOT NULL,
    "code" VARCHAR(20) NOT NULL,
    "description" TEXT,
    "type" "UnitType" NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "head_id" TEXT,

    CONSTRAINT "organizational_units_pkey" PRIMARY KEY ("id")
);

-- Backfill legacy units. Codes were unique per table, so a cross-table collision
-- would break the unified unique constraint; fail loudly instead.
DO $$
BEGIN
    IF EXISTS (
        SELECT "code" FROM "faculties"
        INTERSECT
        SELECT "code" FROM "subdirectorates"
    ) THEN
        RAISE EXCEPTION 'cannot unify organizational units: duplicate code across faculties and subdirectorates';
    END IF;
END
$$;

INSERT INTO "organizational_units" ("id", "name", "code", "description", "type", "is_active", "created_at", "updated_at")
SELECT "id", "name", "code", "description", 'FACULTY', "is_active", "created_at", "updated_at"
FROM "faculties";

INSERT INTO "organizational_units" ("id", "name", "code", "description", "type", "is_active", "created_at", "updated_at")
SELECT "id", "name", "code", "description", 'SUBDIRECTORATE', "is_active", "created_at", "updated_at"
FROM "subdirectorates";

-- CreateIndex
CREATE UNIQUE INDEX "organizational_units_code_key" ON "organizational_units"("code");

-- CreateIndex
CREATE INDEX "organizational_units_type_is_active_idx" ON "organizational_units"("type", "is_active");

-- CreateIndex
CREATE INDEX "organizational_units_head_id_idx" ON "organizational_units"("head_id");

-- AddForeignKey
ALTER TABLE "organizational_units" ADD CONSTRAINT "organizational_units_head_id_fkey" FOREIGN KEY ("head_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Reshape event_programs: add the unified owner column, backfill and enforce NOT NULL.
ALTER TABLE "event_programs" ADD COLUMN "organizational_unit_id" TEXT;

UPDATE "event_programs"
SET "organizational_unit_id" = COALESCE("faculty_id", "subdirectorate_id");

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM "event_programs" WHERE "organizational_unit_id" IS NULL) THEN
        RAISE EXCEPTION 'cannot unify event program owners: a program has no owning unit';
    END IF;
END
$$;

ALTER TABLE "event_programs" ALTER COLUMN "organizational_unit_id" SET NOT NULL;

ALTER TABLE "event_programs" DROP CONSTRAINT IF EXISTS "event_programs_owner_xor_check";
ALTER TABLE "event_programs" DROP CONSTRAINT IF EXISTS "event_programs_faculty_id_fkey";
ALTER TABLE "event_programs" DROP CONSTRAINT IF EXISTS "event_programs_subdirectorate_id_fkey";

DROP INDEX IF EXISTS "event_programs_default_faculty_key";
DROP INDEX IF EXISTS "event_programs_default_subdirectorate_key";
DROP INDEX IF EXISTS "event_programs_faculty_id_status_idx";
DROP INDEX IF EXISTS "event_programs_subdirectorate_id_status_idx";

ALTER TABLE "event_programs" DROP COLUMN "faculty_id";
ALTER TABLE "event_programs" DROP COLUMN "subdirectorate_id";

CREATE INDEX "event_programs_organizational_unit_id_status_idx" ON "event_programs"("organizational_unit_id", "status");

CREATE UNIQUE INDEX "event_programs_default_unit_key" ON "event_programs"("organizational_unit_id") WHERE ("is_default" = true);

ALTER TABLE "event_programs" ADD CONSTRAINT "event_programs_organizational_unit_id_fkey" FOREIGN KEY ("organizational_unit_id") REFERENCES "organizational_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Reshape careers.
ALTER TABLE "careers" ADD COLUMN "unit_id" TEXT;

UPDATE "careers" SET "unit_id" = "faculty_id";

ALTER TABLE "careers" ALTER COLUMN "unit_id" SET NOT NULL;

ALTER TABLE "careers" DROP CONSTRAINT IF EXISTS "careers_faculty_id_fkey";
DROP INDEX IF EXISTS "careers_faculty_id_idx";
ALTER TABLE "careers" DROP COLUMN "faculty_id";

CREATE INDEX "careers_unit_id_idx" ON "careers"("unit_id");

ALTER TABLE "careers" ADD CONSTRAINT "careers_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "organizational_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Reshape users.
ALTER TABLE "users" ADD COLUMN "unit_id" TEXT;

UPDATE "users" SET "unit_id" = "faculty_id";

ALTER TABLE "users" DROP CONSTRAINT IF EXISTS "users_faculty_id_fkey";
DROP INDEX IF EXISTS "users_faculty_id_idx";
ALTER TABLE "users" DROP COLUMN "faculty_id";

CREATE INDEX "users_unit_id_idx" ON "users"("unit_id");

ALTER TABLE "users" ADD CONSTRAINT "users_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "organizational_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- DropTable
DROP TABLE "faculties";

-- DropTable
DROP TABLE "subdirectorates";

-- Recreate functions and triggers against the unified table.

-- Default identity is immutable, and a default program never changes owner.
CREATE FUNCTION "protect_event_program_identity"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW."is_default" IS DISTINCT FROM OLD."is_default" THEN
        RAISE EXCEPTION 'event program default identity is immutable';
    END IF;

    IF OLD."is_default" AND NEW."organizational_unit_id" IS DISTINCT FROM OLD."organizational_unit_id" THEN
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
            SELECT "is_active"
            INTO STRICT owner_is_active
            FROM "organizational_units"
            WHERE "id" = NEW."organizational_unit_id";

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

-- Reactivating an organizational unit restores its existing default program atomically.
CREATE FUNCTION "reactivate_default_event_program"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    updated_programs INTEGER;
BEGIN
    IF NEW."is_active" AND NOT OLD."is_active" THEN
        UPDATE "event_programs"
        SET "status" = 'ACTIVE', "archived_at" = NULL, "updated_at" = CURRENT_TIMESTAMP
        WHERE "organizational_unit_id" = NEW."id" AND "is_default";

        GET DIAGNOSTICS updated_programs = ROW_COUNT;

        IF updated_programs <> 1 THEN
            RAISE EXCEPTION 'an organizational unit must have exactly one default event program';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER "organizational_units_reactivate_default_program"
AFTER UPDATE OF "is_active" ON "organizational_units"
FOR EACH ROW
EXECUTE FUNCTION "reactivate_default_event_program"();
