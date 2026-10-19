-- Provider-free, salon-funded offers/promotions/Daily Deals. Booking discount fields remain the
-- immutable financial snapshot; these tables record campaign configuration and redemption audit.
CREATE TYPE "OfferKind" AS ENUM ('OFFER', 'PROMOTION', 'DAILY_DEAL');
CREATE TYPE "OfferStatus" AS ENUM ('DRAFT', 'ACTIVE', 'PAUSED');
CREATE TYPE "OfferDiscountType" AS ENUM ('PERCENT', 'FLAT');
CREATE TYPE "OfferAudience" AS ENUM ('ALL', 'NEW', 'REPEAT', 'INACTIVE');

CREATE TABLE "offers" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "kind" "OfferKind" NOT NULL,
    "status" "OfferStatus" NOT NULL DEFAULT 'DRAFT',
    "title" VARCHAR(120) NOT NULL,
    "description" VARCHAR(500),
    "discountType" "OfferDiscountType" NOT NULL,
    "discountValue" DECIMAL(10,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "audience" "OfferAudience" NOT NULL DEFAULT 'ALL',
    "inactiveDays" INTEGER,
    "validFrom" TIMESTAMPTZ(6) NOT NULL,
    "validTo" TIMESTAMPTZ(6) NOT NULL,
    "maxRedemptions" INTEGER,
    "perCustomerLimit" INTEGER NOT NULL DEFAULT 1,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "offers_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "offers_valid_range_check" CHECK ("validTo" > "validFrom"),
    CONSTRAINT "offers_discount_value_check" CHECK (
      "discountValue" > 0 AND
      ("discountType" <> 'PERCENT' OR ("discountValue" <= 100 AND "discountValue" = trunc("discountValue")))
    ),
    CONSTRAINT "offers_redemption_limits_check" CHECK (
      ("maxRedemptions" IS NULL OR "maxRedemptions" > 0) AND "perCustomerLimit" > 0
    ),
    CONSTRAINT "offers_inactive_days_check" CHECK (
      ("audience" = 'INACTIVE' AND "inactiveDays" > 0) OR
      ("audience" <> 'INACTIVE' AND "inactiveDays" IS NULL)
    )
);

CREATE UNIQUE INDEX "offers_salonId_id_key" ON "offers"("salonId", "id");
CREATE INDEX "offers_salonId_status_validFrom_validTo_id_idx"
  ON "offers"("salonId", "status", "validFrom", "validTo", "id");
CREATE INDEX "offers_salonId_createdAt_id_idx" ON "offers"("salonId", "createdAt", "id");

ALTER TABLE "offers" ADD CONSTRAINT "offers_salonId_fkey"
  FOREIGN KEY ("salonId") REFERENCES "salons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "services" ADD CONSTRAINT "services_salonId_id_key" UNIQUE ("salonId", "id");
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_salonId_id_key" UNIQUE ("salonId", "id");
ALTER TABLE "bookings"
  ADD COLUMN "offerId" TEXT,
  ADD COLUMN "offerTitle" VARCHAR(120);

CREATE TABLE "offer_services" (
    "salonId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    CONSTRAINT "offer_services_pkey" PRIMARY KEY ("offerId", "serviceId")
);
CREATE INDEX "offer_services_salonId_serviceId_offerId_idx"
  ON "offer_services"("salonId", "serviceId", "offerId");
ALTER TABLE "offer_services"
  ADD CONSTRAINT "offer_services_salonId_offerId_fkey"
    FOREIGN KEY ("salonId", "offerId") REFERENCES "offers"("salonId", "id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "offer_services_salonId_serviceId_fkey"
    FOREIGN KEY ("salonId", "serviceId") REFERENCES "services"("salonId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "bookings" ADD CONSTRAINT "bookings_salonId_offerId_fkey"
  FOREIGN KEY ("salonId", "offerId") REFERENCES "offers"("salonId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "offer_redemptions" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "discountAmount" DECIMAL(10,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "redeemedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "offer_redemptions_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "offer_redemptions_discount_positive_check" CHECK ("discountAmount" > 0),
    CONSTRAINT "offer_redemptions_salonId_bookingId_key" UNIQUE ("salonId", "bookingId")
);
CREATE INDEX "offer_redemptions_salonId_offerId_redeemedAt_idx"
  ON "offer_redemptions"("salonId", "offerId", "redeemedAt");
CREATE INDEX "offer_redemptions_salonId_customerId_redeemedAt_idx"
  ON "offer_redemptions"("salonId", "customerId", "redeemedAt");
CREATE INDEX "offer_redemptions_offerId_customerId_redeemedAt_idx"
  ON "offer_redemptions"("offerId", "customerId", "redeemedAt");
ALTER TABLE "offer_redemptions"
  ADD CONSTRAINT "offer_redemptions_salonId_offerId_fkey"
    FOREIGN KEY ("salonId", "offerId") REFERENCES "offers"("salonId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "offer_redemptions_salonId_bookingId_fkey"
    FOREIGN KEY ("salonId", "bookingId") REFERENCES "bookings"("salonId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "offer_redemptions_customerId_fkey"
    FOREIGN KEY ("customerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
