-- Keep owner-proposed coordinates out of public Salon.lat/lng until an independent admin review.
CREATE TYPE "SalonLocationSource" AS ENUM ('GPS', 'MAP_PIN', 'MANUAL');
CREATE TYPE "SalonLocationProposalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SUPERSEDED');

CREATE TABLE "salon_location_proposals" (
  "id" TEXT NOT NULL,
  "salonId" TEXT NOT NULL,
  "latitude" DOUBLE PRECISION NOT NULL,
  "longitude" DOUBLE PRECISION NOT NULL,
  "source" "SalonLocationSource" NOT NULL,
  "status" "SalonLocationProposalStatus" NOT NULL DEFAULT 'PENDING',
  "pendingSlot" INTEGER,
  "submittedByUserId" TEXT NOT NULL,
  "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedByAdminId" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "reviewNote" VARCHAR(500),
  CONSTRAINT "salon_location_proposals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "salon_location_proposals_latitude_check" CHECK ("latitude" >= -90 AND "latitude" <= 90),
  CONSTRAINT "salon_location_proposals_longitude_check" CHECK ("longitude" >= -180 AND "longitude" <= 180),
  CONSTRAINT "salon_location_proposals_pending_slot_check" CHECK (
    ("status" = 'PENDING' AND "pendingSlot" = 1) OR
    ("status" <> 'PENDING' AND "pendingSlot" IS NULL)
  ),
  CONSTRAINT "salon_location_proposals_review_state_check" CHECK (
    ("status" = 'PENDING' AND "reviewedByAdminId" IS NULL AND "reviewedAt" IS NULL AND "reviewNote" IS NULL) OR
    ("status" = 'SUPERSEDED' AND "reviewedByAdminId" IS NULL AND "reviewedAt" IS NULL AND "reviewNote" IS NOT NULL) OR
    ("status" IN ('APPROVED', 'REJECTED') AND "reviewedByAdminId" IS NOT NULL AND "reviewedAt" IS NOT NULL AND "reviewNote" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "salon_location_proposals_salonId_pendingSlot_key"
  ON "salon_location_proposals"("salonId", "pendingSlot");
CREATE INDEX "salon_location_proposals_status_submittedAt_id_idx"
  ON "salon_location_proposals"("status", "submittedAt", "id");
CREATE INDEX "salon_location_proposals_salonId_submittedAt_idx"
  ON "salon_location_proposals"("salonId", "submittedAt");

ALTER TABLE "salon_location_proposals"
  ADD CONSTRAINT "salon_location_proposals_salonId_fkey"
    FOREIGN KEY ("salonId") REFERENCES "salons"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "salon_location_proposals_submittedByUserId_fkey"
    FOREIGN KEY ("submittedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "salon_location_proposals_reviewedByAdminId_fkey"
    FOREIGN KEY ("reviewedByAdminId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
