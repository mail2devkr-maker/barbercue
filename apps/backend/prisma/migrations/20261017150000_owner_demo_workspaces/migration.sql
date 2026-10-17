-- Private synthetic dashboard examples are stored outside real operating and financial tables.
-- One active row per salon is serialized by the API and protected by this unique constraint.
CREATE TYPE "OwnerDemoWorkspaceAuditAction" AS ENUM ('IMPORTED', 'REUSED', 'DELETED');

CREATE TABLE "owner_demo_workspaces" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "schemaVersion" INTEGER NOT NULL DEFAULT 1,
    "payload" JSONB NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "owner_demo_workspaces_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "owner_demo_workspaces_schema_version_check" CHECK ("schemaVersion" = 1),
    CONSTRAINT "owner_demo_workspaces_payload_object_check" CHECK (jsonb_typeof("payload") = 'object'),
    CONSTRAINT "owner_demo_workspaces_payload_size_check" CHECK (octet_length("payload"::text) <= 262144)
);

CREATE UNIQUE INDEX "owner_demo_workspaces_salonId_key" ON "owner_demo_workspaces"("salonId");

CREATE TABLE "owner_demo_workspace_audit" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "action" "OwnerDemoWorkspaceAuditAction" NOT NULL,
    "recordCounts" JSONB NOT NULL,
    "idempotencyKeyHash" TEXT,
    "requestHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "owner_demo_workspace_audit_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "owner_demo_workspace_audit_counts_object_check" CHECK (jsonb_typeof("recordCounts") = 'object'),
    CONSTRAINT "owner_demo_workspace_audit_counts_size_check" CHECK (octet_length("recordCounts"::text) <= 4096),
    CONSTRAINT "owner_demo_workspace_audit_idempotency_check" CHECK (
      ("action" IN ('IMPORTED', 'REUSED') AND "idempotencyKeyHash" ~ '^[0-9a-f]{64}$' AND "requestHash" ~ '^[0-9a-f]{64}$') OR
      ("action" = 'DELETED' AND "idempotencyKeyHash" IS NULL AND "requestHash" IS NULL)
    )
);

CREATE INDEX "owner_demo_workspace_audit_salonId_createdAt_idx"
    ON "owner_demo_workspace_audit"("salonId", "createdAt");
CREATE INDEX "owner_demo_workspace_audit_workspaceId_createdAt_idx"
    ON "owner_demo_workspace_audit"("workspaceId", "createdAt");
CREATE UNIQUE INDEX "owner_demo_workspace_audit_import_idempotency_key"
    ON "owner_demo_workspace_audit"("salonId", "actorUserId", "idempotencyKeyHash");

ALTER TABLE "owner_demo_workspaces"
    ADD CONSTRAINT "owner_demo_workspaces_salonId_fkey"
    FOREIGN KEY ("salonId") REFERENCES "salons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "owner_demo_workspaces"
    ADD CONSTRAINT "owner_demo_workspaces_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE FUNCTION reject_owner_demo_workspace_audit_mutation() RETURNS trigger AS $$
BEGIN
    RAISE EXCEPTION 'owner demo workspace audit is append-only' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "owner_demo_workspace_audit_no_row_mutation"
    BEFORE UPDATE OR DELETE ON "owner_demo_workspace_audit"
    FOR EACH ROW EXECUTE FUNCTION reject_owner_demo_workspace_audit_mutation();
CREATE TRIGGER "owner_demo_workspace_audit_no_truncate"
    BEFORE TRUNCATE ON "owner_demo_workspace_audit"
    FOR EACH STATEMENT EXECUTE FUNCTION reject_owner_demo_workspace_audit_mutation();
