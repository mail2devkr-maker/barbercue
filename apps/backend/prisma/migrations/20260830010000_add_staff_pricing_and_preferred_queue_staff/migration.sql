-- Launch-fixes (Issue 6): per-staff commercial overrides, a display-only staff level, a real
-- price/duration snapshot on Booking (so a later Service price edit never rewrites a past
-- booking's displayed amount), and a customer-requested-staff column on QueueEntry (the walk-in
-- queue's equivalent of Booking.preferredStaffId, foundational for a per-professional waitlist).

-- 1. Per-staff price/duration override — nullable, "unset" means "use Service's own values".
ALTER TABLE "staff_services" ADD COLUMN "priceOverride" DECIMAL(10,2);
ALTER TABLE "staff_services" ADD COLUMN "durationOverrideMinutes" INTEGER;

-- 2. Display-only commercial tier label on SalonStaff.
ALTER TABLE "salon_staff" ADD COLUMN "level" TEXT;

-- 3. Booking price/duration snapshot: add nullable, backfill every existing row from its own
-- service's current price/duration (the only honest value available for rows created before this
-- column existed), then require it going forward.
ALTER TABLE "bookings" ADD COLUMN "effectiveServicePrice" DECIMAL(10,2);
ALTER TABLE "bookings" ADD COLUMN "effectiveServiceDurationMinutes" INTEGER;

UPDATE "bookings" b
SET "effectiveServicePrice" = s."price",
    "effectiveServiceDurationMinutes" = s."durationMinutes"
FROM "services" s
WHERE b."serviceId" = s."id"
  AND b."effectiveServicePrice" IS NULL;

ALTER TABLE "bookings" ALTER COLUMN "effectiveServicePrice" SET NOT NULL;
ALTER TABLE "bookings" ALTER COLUMN "effectiveServiceDurationMinutes" SET NOT NULL;

-- 4. Customer-requested staff on the walk-in queue, mirroring Booking.preferredStaffId. Nullable
-- FK to salon_staff, no ON DELETE behavior change needed (matches the existing assignedStaffId
-- column's own unspecified/default RESTRICT-equivalent Prisma default on this table).
ALTER TABLE "queue_entries" ADD COLUMN "preferredStaffId" TEXT;
ALTER TABLE "queue_entries"
  ADD CONSTRAINT "queue_entries_preferredStaffId_fkey"
  FOREIGN KEY ("preferredStaffId") REFERENCES "salon_staff"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
