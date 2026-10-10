-- Make the additional-program archive guard temporal: a published activity that
-- already ended must not block archiving its event program. The effective
-- activity status is derived at read time with the institutional time zone.
-- See docs/adr/adr-0010-read-time-activity-status-derivation.md.
CREATE OR REPLACE FUNCTION "validate_event_program_transition"()
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
              AND "status" IN ('SCHEDULED', 'ONGOING', 'COMPLETED')
              AND ("date" + "end_time") > (now() AT TIME ZONE 'America/Panama')
            LIMIT 1;

            IF FOUND THEN
                RAISE EXCEPTION 'an event program with scheduled or ongoing activities cannot be archived';
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;
