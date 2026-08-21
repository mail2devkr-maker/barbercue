-- Phase 9: shop QR / public queue join. Hand-authored to match Prisma's exact generated
-- conventions (see Phase 8A's precedent) — content already applied to the current dev database
-- via `prisma db push`, then marked applied via `prisma migrate resolve --applied` rather than
-- re-run, since the DDL already exists.

-- AlterTable
ALTER TABLE "salons" ADD COLUMN "publicQueueToken" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "salons_publicQueueToken_key" ON "salons"("publicQueueToken");
