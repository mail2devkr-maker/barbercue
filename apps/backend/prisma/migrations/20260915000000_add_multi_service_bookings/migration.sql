-- Multi-service booking core mission — the scheduling flaw this fixes: a single-chair shop showed
-- overlapping slots (9:15/9:30/9:45) as bookable for a customer who had already selected 80 minutes
-- of combined services starting at 9:00, because a Booking (and every capacity/availability query)
-- only ever knew about one service. This migration adds the missing multi-service record.
--
-- Purely additive: "bookings"."serviceId" is NOT touched (not dropped, not made nullable, no
-- constraint changed) — every existing consumer of Booking.serviceId/service keeps reading exactly
-- what it always did. This table is new, read by new code paths only, and the backfill below is a
-- one-time INSERT that cannot fail an old (pre-migration) binary's writes: that binary knows
-- nothing about "booking_services" and will simply keep inserting into "bookings" exactly as
-- before for as long as it's still serving traffic during a Railway pre-deploy migration window.

-- CreateTable
CREATE TABLE "booking_services" (
  "id"              TEXT NOT NULL,
  "bookingId"       TEXT NOT NULL,
  "serviceId"       TEXT NOT NULL,
  "sortOrder"       INTEGER NOT NULL,
  "serviceName"     TEXT NOT NULL,
  "durationMinutes" INTEGER NOT NULL,
  "price"           DECIMAL(10,2) NOT NULL,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "booking_services_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "booking_services"
  ADD CONSTRAINT "booking_services_bookingId_fkey"
  FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "booking_services"
  ADD CONSTRAINT "booking_services_serviceId_fkey"
  FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- The same service cannot appear twice on one appointment (see schema.prisma's own doc comment on
-- this model for why this is a DB guarantee, not just an application-layer check).
CREATE UNIQUE INDEX "booking_services_bookingId_serviceId_key"
  ON "booking_services"("bookingId", "serviceId");

-- Every read of a booking's services is "give me this bookingId's rows, in order" — the one query
-- shape this table exists to serve.
CREATE INDEX "booking_services_bookingId_idx"
  ON "booking_services"("bookingId");

-- Backfill: every booking that already existed gets exactly one booking_services row, derived from
-- its own (unchanged) serviceId and that service's CURRENT name/duration/price. This is the only
-- honest backfill available — no historical per-booking snapshot of the service's name/duration/
-- price at the time it was originally booked exists anywhere to recover, so "the service's values
-- as they stand today" is what a customer/owner would already see for that booking's single
-- serviceName/servicePrice/serviceDurationMinutes fields before this migration, and remains
-- consistent with what they'll see afterwards. sortOrder 0 is correct by construction: a
-- pre-migration booking only ever had one service, so it is unambiguously "first".
INSERT INTO "booking_services" ("id", "bookingId", "serviceId", "sortOrder", "serviceName", "durationMinutes", "price", "createdAt")
SELECT
  gen_random_uuid(),
  b."id",
  b."serviceId",
  0,
  s."name",
  s."durationMinutes",
  s."price",
  b."createdAt"
FROM "bookings" b
JOIN "services" s ON s."id" = b."serviceId";
