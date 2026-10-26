-- Administrator-authorized shop owner transfer (accepted by the holder of the destination e-mail) + backend-enforced
-- mandatory password change for accounts an administrator flags.
ALTER TABLE "users"
  ADD COLUMN "passwordChangeRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "temporaryPasswordExpiresAt" TIMESTAMP(3);

CREATE TYPE "OwnerTransferStatus" AS ENUM ('PREPARED', 'VERIFIED', 'INVITED', 'COMPLETED', 'CANCELLED');
CREATE TYPE "OwnerEvidenceKind" AS ENUM (
  'GOVERNMENT_ID',
  'IN_PERSON_VISIT',
  'BUSINESS_OR_SHOP_PROOF',
  'CURRENT_OWNER_WRITTEN_CONSENT',
  'REGISTERED_PHONE_CALLBACK'
);

CREATE TABLE "salon_owner_transfers" (
  "id" TEXT NOT NULL,
  "salonId" TEXT NOT NULL,
  "fromUserId" TEXT NOT NULL,
  "targetUserId" TEXT,
  "toUserId" TEXT,
  "newEmail" VARCHAR(254) NOT NULL,
  "status" "OwnerTransferStatus" NOT NULL DEFAULT 'PREPARED',
  "openSlot" INTEGER,
  "verificationEvidence" "OwnerEvidenceKind"[] NOT NULL DEFAULT ARRAY[]::"OwnerEvidenceKind"[],
  "verificationReference" VARCHAR(300),
  "verifiedByAdminId" TEXT,
  "verifiedAt" TIMESTAMP(3),
  "breakGlassJustification" VARCHAR(500),
  "inviteNotBefore" TIMESTAMP(3),
  "preparedByAdminId" TEXT NOT NULL,
  "preparedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "invitationTokenHash" VARCHAR(64),
  "invitationExpiresAt" TIMESTAMP(3),
  "invitationCount" INTEGER NOT NULL DEFAULT 0,
  "lastInvitedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "cancelledAt" TIMESTAMP(3),
  CONSTRAINT "salon_owner_transfers_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "salon_owner_transfers_open_slot_check" CHECK (
    ("status" IN ('PREPARED', 'VERIFIED', 'INVITED') AND "openSlot" IS NOT DISTINCT FROM 1) OR
    ("status" IN ('COMPLETED', 'CANCELLED') AND "openSlot" IS NULL)
  ),
  -- Once verified, the evidence must cover BOTH who the person is and their authority over the shop.
  CONSTRAINT "salon_owner_transfers_evidence_check" CHECK (
    "status" IN ('PREPARED', 'CANCELLED') OR (
      "verifiedByAdminId" IS NOT NULL AND "verifiedAt" IS NOT NULL AND "verificationReference" IS NOT NULL AND
      ("verificationEvidence" && ARRAY['GOVERNMENT_ID', 'IN_PERSON_VISIT']::"OwnerEvidenceKind"[]) AND
      ("verificationEvidence" && ARRAY['BUSINESS_OR_SHOP_PROOF', 'CURRENT_OWNER_WRITTEN_CONSENT']::"OwnerEvidenceKind"[])
    )
  ),
  CONSTRAINT "salon_owner_transfers_invited_check" CHECK (
    "status" <> 'INVITED' OR "invitationExpiresAt" IS NOT NULL
  ),
  CONSTRAINT "salon_owner_transfers_completed_check" CHECK (
    ("status" = 'COMPLETED' AND "toUserId" IS NOT NULL AND "completedAt" IS NOT NULL AND "invitationTokenHash" IS NULL) OR
    ("status" <> 'COMPLETED' AND "completedAt" IS NULL)
  ),
  CONSTRAINT "salon_owner_transfers_invitation_count_check" CHECK ("invitationCount" >= 0 AND "invitationCount" <= 3)
);

CREATE UNIQUE INDEX "salon_owner_transfers_salonId_openSlot_key" ON "salon_owner_transfers"("salonId", "openSlot");
CREATE UNIQUE INDEX "salon_owner_transfers_invitationTokenHash_key" ON "salon_owner_transfers"("invitationTokenHash");
CREATE INDEX "salon_owner_transfers_salonId_preparedAt_idx" ON "salon_owner_transfers"("salonId", "preparedAt");

ALTER TABLE "salon_owner_transfers"
  ADD CONSTRAINT "salon_owner_transfers_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "salons"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "salon_owner_transfers_fromUserId_fkey" FOREIGN KEY ("fromUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "salon_owner_transfers_toUserId_fkey" FOREIGN KEY ("toUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
