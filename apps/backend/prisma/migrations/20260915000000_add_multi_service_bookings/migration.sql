-- Multi-service booking core mission — additive, backward-compatible booking-service snapshots.
-- Booking.serviceId remains the primary/first-service compatibility pointer.

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

-- One service can appear only once in an appointment.
CREATE UNIQUE INDEX "booking_services_bookingId_serviceId_key"
  ON "booking_services"("bookingId", "serviceId");

-- One ordering position can belong to only one service in an appointment.
CREATE UNIQUE INDEX "booking_services_bookingId_sortOrder_key"
  ON "booking_services"("bookingId", "sortOrder");

CREATE INDEX "booking_services_bookingId_idx"
  ON "booking_services"("bookingId");

-- Existing bookings predate BookingService snapshots. Backfill the only truthful snapshot still
-- recoverable: the booking's primary service values as they exist at migration time.
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

-- Rolling-deploy durability:
-- Railway runs migrations before all old backend instances have necessarily drained. An old binary
-- can therefore INSERT a Booking after the one-time backfill while knowing nothing about the new
-- booking_services table. A read-time fallback prevents zero values, but it is not historically
-- durable: later Service edits could rewrite the apparent old appointment.
--
-- A deferred constraint trigger closes that window at the database boundary. For an old binary,
-- it creates sortOrder=0 from the Service row before the transaction commits. For the new backend,
-- Prisma already creates BookingService rows in the same transaction; because this trigger is
-- INITIALLY DEFERRED it runs at commit, sees the primary snapshot already present, and the targeted
-- ON CONFLICT becomes a no-op. Thus old and new binaries safely coexist without duplicate rows.
CREATE OR REPLACE FUNCTION "fastque_snapshot_primary_booking_service"()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO "booking_services" (
    "id",
    "bookingId",
    "serviceId",
    "sortOrder",
    "serviceName",
    "durationMinutes",
    "price",
    "createdAt"
  )
  SELECT
    gen_random_uuid(),
    NEW."id",
    NEW."serviceId",
    0,
    s."name",
    s."durationMinutes",
    s."price",
    NEW."createdAt"
  FROM "services" s
  WHERE s."id" = NEW."serviceId"
  ON CONFLICT ("bookingId", "serviceId") DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER "booking_services_snapshot_primary_after_booking_insert"
AFTER INSERT ON "bookings"
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION "fastque_snapshot_primary_booking_service"();
