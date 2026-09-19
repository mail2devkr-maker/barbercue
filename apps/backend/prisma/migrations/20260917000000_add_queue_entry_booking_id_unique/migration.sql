-- Queue check-in race hardening. QueueService.checkIn()'s duplicate guard was a plain read
-- before the create, with no database-level backstop: two concurrent check-in requests for the
-- same booking (a double-tap, or a client retry using a fresh idempotency key) could both pass
-- that read before either transaction committed, producing two QueueEntry rows for one booking.
--
-- Defensive cleanup first, so this migration can never fail on a database that already has
-- latent duplicates from that exact race: for any bookingId with more than one QueueEntry, keep
-- only the earliest (by joinedAt) linked to the booking and null out bookingId on every later
-- duplicate. This never deletes a row (queue/audit history is preserved), it only severs the
-- extra rows' link back to the booking they raced on.
UPDATE "queue_entries" qe
SET "bookingId" = NULL
WHERE "bookingId" IS NOT NULL
  AND "id" NOT IN (
    SELECT DISTINCT ON ("bookingId") "id"
    FROM "queue_entries"
    WHERE "bookingId" IS NOT NULL
    ORDER BY "bookingId", "joinedAt" ASC
  );

-- Postgres unique indexes allow multiple NULLs, so walk-ins (bookingId always null) are
-- unaffected — only an appointment-sourced booking is limited to at most one QueueEntry ever.
CREATE UNIQUE INDEX "queue_entries_bookingId_key" ON "queue_entries"("bookingId");
