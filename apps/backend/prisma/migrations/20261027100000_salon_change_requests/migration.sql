-- Owner issue #28: employee-suggested corrections to a shop's text details, applied only after the shop's owner approves.
CREATE TYPE "SalonChangeField" AS ENUM ('ADDRESS_LINE', 'LOCALITY_TEXT');
CREATE TYPE "SalonChangeStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN');

CREATE TABLE "salon_change_requests" (
  "id" TEXT NOT NULL,
  "salonId" TEXT NOT NULL,
  "field" "SalonChangeField" NOT NULL,
  "proposedValue" VARCHAR(200) NOT NULL,
  "previousValue" VARCHAR(200),
  "status" "SalonChangeStatus" NOT NULL DEFAULT 'PENDING',
  "pendingSlot" INTEGER,
  "requestedByUserId" TEXT NOT NULL,
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decidedByUserId" TEXT,
  "decidedAt" TIMESTAMP(3),
  "decisionNote" VARCHAR(500),
  CONSTRAINT "salon_change_requests_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "salon_change_requests_value_check" CHECK (length(btrim("proposedValue")) > 0),
  CONSTRAINT "salon_change_requests_pending_slot_check" CHECK (
    ("status" = 'PENDING' AND "pendingSlot" IS NOT DISTINCT FROM 1) OR
    ("status" <> 'PENDING' AND "pendingSlot" IS NULL)
  ),
  CONSTRAINT "salon_change_requests_decision_state_check" CHECK (
    ("status" = 'PENDING' AND "decidedByUserId" IS NULL AND "decidedAt" IS NULL) OR
    ("status" = 'WITHDRAWN' AND "decidedAt" IS NOT NULL) OR
    ("status" IN ('APPROVED', 'REJECTED') AND "decidedByUserId" IS NOT NULL AND "decidedAt" IS NOT NULL)
  )
);

CREATE UNIQUE INDEX "salon_change_requests_salonId_field_pendingSlot_key"
  ON "salon_change_requests"("salonId", "field", "pendingSlot");
CREATE INDEX "salon_change_requests_salonId_status_requestedAt_idx"
  ON "salon_change_requests"("salonId", "status", "requestedAt");
CREATE INDEX "salon_change_requests_requestedByUserId_requestedAt_idx"
  ON "salon_change_requests"("requestedByUserId", "requestedAt");

ALTER TABLE "salon_change_requests"
  ADD CONSTRAINT "salon_change_requests_salonId_fkey"
    FOREIGN KEY ("salonId") REFERENCES "salons"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "salon_change_requests_requestedByUserId_fkey"
    FOREIGN KEY ("requestedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "salon_change_requests_decidedByUserId_fkey"
    FOREIGN KEY ("decidedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
