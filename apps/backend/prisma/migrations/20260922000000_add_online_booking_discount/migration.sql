-- Shop-specific FastQue APP/WEB booking discount. Original Service prices are never rewritten.
ALTER TABLE "salons"
  ADD COLUMN "onlineBookingDiscountPercent" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "bookings"
  ADD COLUMN "onlineBookingDiscountPercent" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "onlineBookingDiscountAmount" DECIMAL(10,2) NOT NULL DEFAULT 0;

ALTER TABLE "salons"
  ADD CONSTRAINT "salons_onlineBookingDiscountPercent_check"
  CHECK ("onlineBookingDiscountPercent" BETWEEN 0 AND 100);

ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_onlineBookingDiscountPercent_check"
  CHECK ("onlineBookingDiscountPercent" BETWEEN 0 AND 100),
  ADD CONSTRAINT "bookings_onlineBookingDiscountAmount_check"
  CHECK ("onlineBookingDiscountAmount" >= 0);
