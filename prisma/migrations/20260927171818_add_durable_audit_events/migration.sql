-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('USER', 'ANONYMOUS', 'SYSTEM');

-- CreateTable
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "action" VARCHAR(80) NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actor_type" "AuditActorType" NOT NULL DEFAULT 'USER',
    "actor_id" TEXT,
    "resource_type" VARCHAR(50) NOT NULL,
    "resource_id" TEXT,
    "scope_type" VARCHAR(30),
    "scope_id" TEXT,
    "target_user_id" TEXT,
    "request_id" TEXT,
    "changes" JSONB,
    "metadata" JSONB,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_events_resource_type_resource_id_occurred_at_idx" ON "audit_events"("resource_type", "resource_id", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_events_actor_id_occurred_at_idx" ON "audit_events"("actor_id", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_events_action_occurred_at_idx" ON "audit_events"("action", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_events_scope_type_scope_id_occurred_at_idx" ON "audit_events"("scope_type", "scope_id", "occurred_at");

-- CreateIndex
CREATE INDEX "audit_events_occurred_at_idx" ON "audit_events"("occurred_at");

-- Audit events are append-only durable evidence: no update, delete or truncate.
CREATE FUNCTION "prevent_audit_event_mutation"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'audit events are append-only';
END;
$$;

CREATE TRIGGER "audit_events_prevent_mutation"
BEFORE UPDATE OR DELETE ON "audit_events"
FOR EACH ROW
EXECUTE FUNCTION "prevent_audit_event_mutation"();

CREATE TRIGGER "audit_events_prevent_truncate"
BEFORE TRUNCATE ON "audit_events"
FOR EACH STATEMENT
EXECUTE FUNCTION "prevent_audit_event_mutation"();
