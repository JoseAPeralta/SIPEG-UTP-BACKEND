-- Label and banner are optional metadata for additional event programs.
ALTER TABLE "event_programs" DROP CONSTRAINT "event_programs_metadata_check";

ALTER TABLE "event_programs" ADD CONSTRAINT "event_programs_metadata_check"
CHECK (
    ("is_default" AND "start_date" IS NULL AND "end_date" IS NULL)
    OR
    (
        NOT "is_default"
        AND "start_date" IS NOT NULL
        AND "end_date" IS NOT NULL
        AND "start_date" <= "end_date"
    )
);
