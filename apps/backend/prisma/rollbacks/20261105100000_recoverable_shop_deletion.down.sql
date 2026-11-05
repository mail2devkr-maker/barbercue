-- ROLLBACK for 20261105100000_recoverable_shop_deletion (NOT run by `prisma migrate deploy`).
-- Safe ONLY while no shop is quarantined (the script refuses otherwise, so a quarantined shop can never
-- silently become operational). Run inside one transaction, then delete the ledger row:
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20261105100000_recoverable_shop_deletion';
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "salons" WHERE "softDeletedAt" IS NOT NULL) THEN
    RAISE EXCEPTION 'ROLLBACK_REFUSED: a shop is in recovery Trash; restore it first';
  END IF;
END $$;

DROP TRIGGER IF EXISTS "salons_quarantine_obligations_guard" ON "salons";
DROP TRIGGER IF EXISTS "platform_subsidy_quarantine_write_guard" ON "platform_shop_subsidy_entries";
DROP TRIGGER IF EXISTS "customer_ledger_quarantine_write_guard" ON "customer_ledger_entries";
DROP TRIGGER IF EXISTS "refunds_quarantine_write_guard" ON "refunds";
DROP TRIGGER IF EXISTS "payments_quarantine_write_guard" ON "payments";
DROP TRIGGER IF EXISTS "service_sessions_quarantine_write_guard" ON "service_sessions";
DROP TRIGGER IF EXISTS "manual_chair_occupancies_quarantine_write_guard" ON "manual_chair_occupancies";
DROP TRIGGER IF EXISTS "queue_entries_quarantine_write_guard" ON "queue_entries";
DROP TRIGGER IF EXISTS "bookings_quarantine_write_guard" ON "bookings";
DROP TRIGGER IF EXISTS "service_sessions_quarantine_insert_guard" ON "service_sessions";
DROP TRIGGER IF EXISTS "manual_chair_occupancies_quarantine_insert_guard" ON "manual_chair_occupancies";
DROP TRIGGER IF EXISTS "queue_entries_quarantine_insert_guard" ON "queue_entries";
DROP TRIGGER IF EXISTS "bookings_quarantine_insert_guard" ON "bookings";
DROP TRIGGER IF EXISTS "salons_hard_delete_guard" ON "salons";
DROP TRIGGER IF EXISTS "salons_quarantine_update_guard" ON "salons";
DROP FUNCTION IF EXISTS "assert_no_open_salon_obligations_on_quarantine"();
DROP FUNCTION IF EXISTS "deny_quarantined_salon_related_write"();
DROP FUNCTION IF EXISTS "deny_quarantined_service_session_insert"();
DROP FUNCTION IF EXISTS "deny_quarantined_salon_child_insert"();
DROP FUNCTION IF EXISTS "deny_salon_hard_delete"();
DROP FUNCTION IF EXISTS "guard_quarantined_salon_update"();
ALTER TABLE "salons" DROP CONSTRAINT IF EXISTS "salons_soft_deletion_state_check";
DROP INDEX IF EXISTS "salons_softDeletionRequestId_idx";
DROP INDEX IF EXISTS "salons_softDeletedAt_restoreEligibleUntil_idx";
ALTER TABLE "salons"
  DROP COLUMN IF EXISTS "statusBeforeSoftDelete",
  DROP COLUMN IF EXISTS "softDeletionRequestId",
  DROP COLUMN IF EXISTS "softDeletedByUserId",
  DROP COLUMN IF EXISTS "restoreEligibleUntil",
  DROP COLUMN IF EXISTS "softDeletedAt";
-- Request history is preserved: rows are COPIED into a plain archive table (no constraints, no enum) before
-- the live table and its type are dropped, so an audited rollback never destroys records and a later
-- re-apply of the migration works. Drop the archive only with a separate owner decision.
CREATE TABLE IF NOT EXISTS "shop_deletion_requests_rollback_archive" AS
  SELECT r.*, r."status"::text AS "statusText", now() AS "archivedAt"
  FROM "shop_deletion_requests" r WITH NO DATA;
ALTER TABLE "shop_deletion_requests_rollback_archive" DROP COLUMN IF EXISTS "status";
INSERT INTO "shop_deletion_requests_rollback_archive"
  ("id","salonId","shopName","shopPublicId","requestedByUserId","reason","requestedAt",
   "decidedByUserId","decidedAt","decisionNote","statusText","archivedAt")
  SELECT "id","salonId","shopName","shopPublicId","requestedByUserId","reason","requestedAt",
   "decidedByUserId","decidedAt","decisionNote","status"::text, now()
  FROM "shop_deletion_requests";
DROP TABLE "shop_deletion_requests";
DROP TYPE "ShopDeletionRequestStatus";
