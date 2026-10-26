-- Administrator-authorized shop owner transfer + backend-enforced mandatory password change.
ALTER TABLE "users"
  ADD COLUMN "passwordChangeRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "temporaryPasswordExpiresAt" TIMESTAMP(3);

CREATE TYPE "OwnerTransferStatus" AS ENUM ('PREPARED', 'VERIFIED', 'COMPLETED', 'CANCELLED');
CREATE TYPE "OwnerVerificationMethod" AS ENUM ('OFFLINE_DOCUMENT', 'REGISTERED_PHONE_CALLBACK');

CREATE TABLE "salon_owner_transfers" (
  "id" TEXT NOT NULL,
  "salonId" TEXT NOT NULL,
  "fromUserId" TEXT NOT NULL,
  "toUserId" TEXT,
  "newEmail" VARCHAR(254) NOT NULL,
  "status" "OwnerTransferStatus" NOT NULL DEFAULT 'PREPARED',
  "openSlot" INTEGER,
  "verificationMethod" "OwnerVerificationMethod",
  "verificationReference" VARCHAR(200),
  "verifiedByAdminId" TEXT,
  "verifiedAt" TIMESTAMP(3),
  "preparedByAdminId" TEXT NOT NULL,
  "preparedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  CONSTRAINT "salon_owner_transfers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "salon_owner_transfers_open_slot_check" CHECK (
    ("status" IN ('PREPARED', 'VERIFIED') AND "openSlot" IS NOT DISTINCT FROM 1) OR
    ("status" IN ('COMPLETED', 'CANCELLED') AND "openSlot" IS NULL)
  ),
  CONSTRAINT "salon_owner_transfers_verified_check" CHECK (
    "status" IN ('PREPARED', 'CANCELLED') OR
    ("verificationMethod" IS NOT NULL AND "verificationReference" IS NOT NULL AND "verifiedByAdminId" IS NOT NULL AND "verifiedAt" IS NOT NULL)
  ),
  CONSTRAINT "salon_owner_transfers_completed_check" CHECK (
    ("status" = 'COMPLETED' AND "toUserId" IS NOT NULL AND "completedAt" IS NOT NULL) OR
    ("status" <> 'COMPLETED' AND "completedAt" IS NULL)
  )
);

CREATE UNIQUE INDEX "salon_owner_transfers_salonId_openSlot_key" ON "salon_owner_transfers"("salonId", "openSlot");
CREATE INDEX "salon_owner_transfers_salonId_preparedAt_idx" ON "salon_owner_transfers"("salonId", "preparedAt");

ALTER TABLE "salon_owner_transfers"
  ADD CONSTRAINT "salon_owner_transfers_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "salons"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "salon_owner_transfers_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "salon_owner_transfers_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
