-- Live Queue operations mission: additive only. No column is dropped or rewritten and no row is
-- deleted.

-- AlterTable
ALTER TABLE "queue_entries"
  ADD COLUMN "contactName" TEXT,
  ADD COLUMN "contactPhone" TEXT,
  ADD COLUMN "arrivedAt" TIMESTAMP(3);

-- Backfill arrivedAt only where arrival is already a known fact, so existing history reads
-- truthfully:
--  * an appointment-sourced entry only exists because arrival was confirmed (customer check-in or
--    the owner's ARRIVED confirmation);
--  * an entry that reached service, or was completed, was physically served.
-- Remote/QR walk-ins still WAITING/CALLED are deliberately left NULL ("not yet acknowledged"):
-- whether they are in the shop is unknown, and staff can mark them arrived.
UPDATE "queue_entries"
SET "arrivedAt" = COALESCE("serviceStartedAt", "calledAt", "joinedAt")
WHERE "arrivedAt" IS NULL
  AND ("source" = 'APPOINTMENT' OR "status" IN ('IN_SERVICE', 'COMPLETED'));
