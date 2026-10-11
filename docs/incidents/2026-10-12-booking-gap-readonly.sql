-- FASTQUE P0 / 2026-10-12. READ ONLY BOOKING-GAP EVIDENCE COLLECTION
-- Execute ONLY on the production database after independently verifying its host/identity
-- with an authorized read-only account. Never put DATABASE_URL, tokens, or individual
-- customer/booking IDs into GitHub issues or logs. This file does not repair any data.
-- If the database is not the intended production primary: STOP, do not run any writes.
--
-- Dates are calendar dates in Asia/Kolkata. For historical row comparison:
-- 25 Sep 2026 23:59:59 IST = 2026-09-25 18:29:59 UTC.
-- All counts below are aggregate-only; no person-identifying fields are selected.

BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '20s';
SET LOCAL lock_timeout = '2s';

-- A. Snapshot / overall health. createdAt tracks when an appointment was booked;
-- slotStart tracks when the appointment was scheduled. They are NOT interchangeable.
SELECT
  (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata') AS audit_time_ist,
  COUNT(*) AS booking_rows_total,
  MIN("createdAt") AS first_booking_created_utc,
  MAX("createdAt") AS last_booking_created_utc,
  MAX("slotStart") AS latest_booking_slot_utc,
  COUNT(*) FILTER (
    WHERE "createdAt" >= TIMESTAMPTZ '2026-09-25 18:30:00+00'
  ) AS created_from_26_sep_ist,
  COUNT(*) FILTER (
    WHERE "slotStart" >= TIMESTAMPTZ '2026-09-25 18:30:00+00'
  ) AS slots_from_26_sep_ist
FROM bookings;

-- B. Show every IST calendar day (including days with zero bookings) from 20 Sep.
WITH days AS (
  SELECT generate_series(
    DATE '2026-09-20',
    (CURRENT_TIMESTAMP AT TIME ZONE 'Asia/Kolkata')::date,
    INTERVAL '1 day'
  )::date AS day_ist
), created AS (
  SELECT ("createdAt" AT TIME ZONE 'Asia/Kolkata')::date AS day_ist,
         COUNT(*) AS created_count
  FROM bookings
  WHERE "createdAt" >= TIMESTAMPTZ '2026-09-19 18:30:00+00'
  GROUP BY 1
), scheduled AS (
  SELECT ("slotStart" AT TIME ZONE 'Asia/Kolkata')::date AS day_ist,
         COUNT(*) AS scheduled_count
  FROM bookings
  WHERE "slotStart" >= TIMESTAMPTZ '2026-09-19 18:30:00+00'
  GROUP BY 1
)
SELECT d.day_ist,
       COALESCE(c.created_count, 0) AS created_count,
       COALESCE(s.scheduled_count, 0) AS scheduled_count
FROM days d
LEFT JOIN created c USING (day_ist)
LEFT JOIN scheduled s USING (day_ist)
ORDER BY d.day_ist;

-- C. Were there bookings after 25 Sep, but with different statuses/sources?
SELECT "source"::text AS booking_source, "status"::text AS booking_status,
       COUNT(*) AS booking_count
FROM bookings
WHERE "createdAt" >= TIMESTAMPTZ '2026-09-25 18:30:00+00'
GROUP BY "source", "status"
ORDER BY booking_count DESC, booking_source, booking_status;

-- D. Did walk-in/queue activity continue while booking creates went silent?
SELECT ("joinedAt" AT TIME ZONE 'Asia/Kolkata')::date AS day_ist,
       COUNT(*) AS queue_entries_created,
       COUNT(*) FILTER (WHERE "bookingId" IS NOT NULL) AS linked_to_booking
FROM queue_entries
WHERE "joinedAt" >= TIMESTAMPTZ '2026-09-19 18:30:00+00'
GROUP BY 1
ORDER BY day_ist;

-- E. Migration metadata only; no prod schema modification or migration execution.
SELECT migration_name, finished_at, rolled_back_at
FROM _prisma_migrations
WHERE started_at >= TIMESTAMPTZ '2026-09-20 00:00:00+00'
ORDER BY started_at;

COMMIT;

-- Interpretation / STOP conditions:
-- If created_from_26_sep_ist > 0, booking rows exist: inspect owner/admin filters,
-- session scopes, pagination, server query and UI (do not restore a backup).
-- If created_from_26_sep_ist = 0, compare preserved successful confirmations
-- against live DB target AND historic create requests. No requests means we must
-- investigate frontend/mobile funnel or low customer traffic, NOT assume deletion.
-- If confirmations exist but rows do not, preserve evidence and verify PITR and
-- previous DB target in an isolated environment BEFORE any restoration.
