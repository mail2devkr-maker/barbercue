-- Booking-source attribution is additive. The existing Booking.source enum and every historical
-- source value remain untouched; this relation records only external channels backed by a
-- server-issued, salon-scoped opaque campaign token.
CREATE TYPE "BookingAttributionCampaignSource" AS ENUM (
  'FACEBOOK',
  'INSTAGRAM',
  'CHATGPT',
  'OTHER'
);

CREATE TABLE "booking_attribution_campaigns" (
  "id" TEXT NOT NULL,
  "salonId" TEXT NOT NULL,
  "source" "BookingAttributionCampaignSource" NOT NULL,
  "label" VARCHAR(120) NOT NULL,
  "tokenHash" CHAR(64) NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "startsAt" TIMESTAMP(3),
  "endsAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "booking_attribution_campaigns_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "booking_attribution_campaigns_salonId_id_key" UNIQUE ("salonId", "id"),
  CONSTRAINT "booking_attribution_campaigns_window_check"
    CHECK ("startsAt" IS NULL OR "endsAt" IS NULL OR "endsAt" > "startsAt"),
  CONSTRAINT "booking_attribution_campaigns_salonId_fkey"
    FOREIGN KEY ("salonId") REFERENCES "salons"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "booking_attribution_campaigns_tokenHash_key"
  ON "booking_attribution_campaigns"("tokenHash");
CREATE INDEX "booking_attribution_campaigns_salonId_createdAt_idx"
  ON "booking_attribution_campaigns"("salonId", "createdAt");
CREATE INDEX "booking_attribution_campaigns_salonId_source_revokedAt_idx"
  ON "booking_attribution_campaigns"("salonId", "source", "revokedAt");

ALTER TABLE "bookings" ADD COLUMN "attributionCampaignId" TEXT;
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_attributionCampaignId_fkey"
  FOREIGN KEY ("salonId", "attributionCampaignId") REFERENCES "booking_attribution_campaigns"("salonId", "id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "bookings_salonId_attributionCampaignId_createdAt_idx"
  ON "bookings"("salonId", "attributionCampaignId", "createdAt");
CREATE INDEX "bookings_salonId_createdAt_idx"
  ON "bookings"("salonId", "createdAt");
