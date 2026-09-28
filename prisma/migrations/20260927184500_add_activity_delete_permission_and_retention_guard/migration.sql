-- Fase 5.4: physical activity deletion gets a dedicated permission plus a
-- database retention guard. The API already refuses non DRAFT activities,
-- archived programs, attendance and alerts; the trigger closes the direct SQL
-- path so a manual DELETE cannot bypass the retention rule.

-- The permission id is deterministic instead of a cuid because this migration
-- must be replayable; the base seed upserts by name, so it never conflicts.
INSERT INTO "permissions" ("id", "name", "description")
VALUES ('perm_activity_delete', 'activity:delete', 'Eliminar actividades en borrador sin registros.')
ON CONFLICT ("name") DO UPDATE SET "description" = EXCLUDED."description";

-- Materialize the new ORGANIZER default for existing collaborations. The grant
-- has no author because it is a system backfill, not a delegation by a user.
INSERT INTO "collaboration_permissions" (
    "collaboration_id", "permission_id", "granted_at", "granted_by_id",
    "source", "valid_from", "valid_until"
)
SELECT
    c."id",
    p."id",
    CURRENT_TIMESTAMP,
    NULL,
    'ROLE_DEFAULT',
    NULL,
    NULL
FROM "collaborations" c
CROSS JOIN "permissions" p
WHERE p."name" = 'activity:delete'
  AND c."role" = 'ORGANIZER'
ON CONFLICT ("collaboration_id", "permission_id") DO NOTHING;

CREATE FUNCTION "prevent_activity_delete"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    program_status "ProgramStatus";
BEGIN
    IF OLD."status" <> 'DRAFT' THEN
        RAISE EXCEPTION 'only DRAFT activities can be deleted'
            USING ERRCODE = '23514';
    END IF;

    -- Lock the parent program so a concurrent archival cannot slip through
    -- between the check and the delete.
    SELECT "status"
    INTO STRICT program_status
    FROM "event_programs"
    WHERE "id" = OLD."event_program_id"
    FOR UPDATE;

    IF program_status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'activities can only be deleted in an active event program'
            USING ERRCODE = '23514';
    END IF;

    RETURN OLD;
END;
$$;

CREATE TRIGGER "activities_prevent_delete"
BEFORE DELETE ON "activities"
FOR EACH ROW
EXECUTE FUNCTION "prevent_activity_delete"();
