-- Rollback for migration 20261027152000_live_queue_guest_arrival (PR #330). Valid only before guests/arrival data must be kept:
-- it drops the six additive columns and both indexes of queue_entries. Existing queue rows, customers, bookings are untouched.
BEGIN;
DROP INDEX IF EXISTS "queue_entries_arrival_prompt_candidates_idx";
DROP INDEX IF EXISTS "queue_entries_guestAccessHash_key";
ALTER TABLE "queue_entries"
  DROP COLUMN IF EXISTS "guestAccessHash",
  DROP COLUMN IF EXISTS "guestAccessExpiresAt",
  DROP COLUMN IF EXISTS "guestExpoPushToken",
  DROP COLUMN IF EXISTS "arrivalPromptSentAt",
  DROP COLUMN IF EXISTS "customerArrivalResponse",
  DROP COLUMN IF EXISTS "customerArrivalResponseAt";
DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261027152000_live_queue_guest_arrival';
COMMIT;
