CREATE TYPE "SalonOwnerInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'REVOKED');

CREATE TABLE "salon_owner_invitations" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "email" VARCHAR(320) NOT NULL,
    "targetUserId" TEXT,
    "expectedOwnerUserId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "reason" VARCHAR(1000) NOT NULL,
    "transferConfirmed" BOOLEAN NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "status" "SalonOwnerInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "salon_owner_invitations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "salon_owner_invitations_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "salons"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "salon_owner_invitations_targetUserId_fkey" FOREIGN KEY ("targetUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "salon_owner_invitations_expectedOwnerUserId_fkey" FOREIGN KEY ("expectedOwnerUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "salon_owner_invitations_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "salon_owner_invitations_tokenHash_key" ON "salon_owner_invitations"("tokenHash");
CREATE INDEX "salon_owner_invitations_salonId_status_idx" ON "salon_owner_invitations"("salonId", "status");
CREATE INDEX "salon_owner_invitations_targetUserId_status_idx" ON "salon_owner_invitations"("targetUserId", "status");
CREATE UNIQUE INDEX "salon_owner_invitations_one_pending_per_salon" ON "salon_owner_invitations"("salonId") WHERE "status" = 'PENDING';
