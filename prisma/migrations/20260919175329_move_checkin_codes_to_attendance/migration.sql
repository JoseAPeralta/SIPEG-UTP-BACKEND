-- Move check-in codes from activities to attendance as a single per-registration code.

-- 1. Drop the old attendance state check (it references the legacy used_code column).
ALTER TABLE "attendance" DROP CONSTRAINT "attendance_check_in_state_check";

-- 2. Add the unified attendance code and backfill existing rows with fresh unique values.
--    Do not reuse used_code: it held the activity code and repeats across attendees.
ALTER TABLE "attendance" ADD COLUMN "code" VARCHAR(64);
UPDATE "attendance" SET "code" = gen_random_uuid()::text WHERE "code" IS NULL;
ALTER TABLE "attendance" ALTER COLUMN "code" SET NOT NULL;

-- 3. Enforce global uniqueness of the per-registration code.
CREATE UNIQUE INDEX "attendance_code_key" ON "attendance"("code");

-- 4. Remove the legacy codes carried by the activity (their unique indexes drop with them).
ALTER TABLE "attendance" DROP COLUMN "used_code";
ALTER TABLE "activities" DROP COLUMN "qr_code";
ALTER TABLE "activities" DROP COLUMN "manual_code";

-- 5. Re-create the attendance state check without the legacy used_code column.
ALTER TABLE "attendance"
ADD CONSTRAINT "attendance_check_in_state_check"
CHECK (
    (
        "checked_in_at" IS NULL
        AND "method" IS NULL
    )
    OR
    (
        "checked_in_at" IS NOT NULL
        AND "method" IS NOT NULL
        AND "checked_in_at" >= "registered_at"
    )
);
