-- Re-express the voice-visit status check in the form PostgreSQL round-trips unchanged.
--
-- Migration 20261013160000 declared it as `"status" IN ('DRAFT', 'CONFIRMED')` on a varchar column. PostgreSQL stores
-- that as `(status)::text = ANY ((ARRAY['DRAFT'::varchar, 'CONFIRMED'::varchar])::text[])`, and a pg_dump/pg_restore
-- cycle rewrites it as `ANY (ARRAY[('DRAFT'::varchar)::text, ...])`. The meaning is identical, but the text differs, which
-- the platform recovery guard (scripts/verify-platform-recovery.sh) correctly reports as schema drift after a restore.
-- The text[] form below is its own fixed point. Same accepted values, same constraint name; the table is new and empty
-- when this runs, so the brief lock is irrelevant. 20261013160000 itself is left byte-for-byte untouched.
BEGIN;

ALTER TABLE "employee_voice_visit_logs"
  DROP CONSTRAINT "employee_voice_visit_logs_status_check";

ALTER TABLE "employee_voice_visit_logs"
  ADD CONSTRAINT "employee_voice_visit_logs_status_check"
  CHECK ("status"::text = ANY (ARRAY['DRAFT'::text, 'CONFIRMED'::text]));

COMMIT;
