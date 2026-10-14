-- Requests deliberately reference shop/user IDs as durable snapshots: an approved
-- request must remain queryable even after the shop is hard deleted.
CREATE TYPE "ShopDeletionRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "shop_deletion_requests" (
  "id" TEXT NOT NULL,
  "salonId" TEXT NOT NULL,
  "shopName" TEXT NOT NULL,
  "shopPublicId" TEXT NOT NULL,
  "requestedByUserId" TEXT NOT NULL,
  "reason" VARCHAR(500) NOT NULL,
  "status" "ShopDeletionRequestStatus" NOT NULL DEFAULT 'PENDING',
  "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decidedByUserId" TEXT,
  "decidedAt" TIMESTAMP(3),
  "decisionNote" VARCHAR(500),
  CONSTRAINT "shop_deletion_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "shop_deletion_requests_status_requestedAt_idx"
ON "shop_deletion_requests" ("status", "requestedAt");
CREATE INDEX "shop_deletion_requests_salonId_status_idx"
ON "shop_deletion_requests" ("salonId", "status");
-- Prisma cannot represent partial unique indexes. Prevent duplicate pending
-- approvals for the same shop even under simultaneous co-founder requests.
CREATE UNIQUE INDEX "shop_deletion_one_pending_per_shop"
ON "shop_deletion_requests" ("salonId") WHERE "status" = 'PENDING';
