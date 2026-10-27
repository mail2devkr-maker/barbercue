-- Rollback for migration 20261027140000_owner_transfer_password_gate.
-- ONLY valid while no owner transfer has been recorded that must be kept: it drops salon_owner_transfers (the audit_logs
-- rows written for each transfer remain). It does NOT undo an ownership change; reverse an ownership change with a new
-- verified transfer. Run inside a transaction on a disposable copy first.
BEGIN;
DROP TABLE IF EXISTS "salon_owner_transfers";
DROP TYPE IF EXISTS "OwnerTransferStatus";
DROP TYPE IF EXISTS "OwnerEvidenceKind";
ALTER TABLE "users"
  DROP COLUMN IF EXISTS "passwordChangeRequired",
  DROP COLUMN IF EXISTS "temporaryPasswordExpiresAt";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261027140000_owner_transfer_password_gate';
COMMIT;
