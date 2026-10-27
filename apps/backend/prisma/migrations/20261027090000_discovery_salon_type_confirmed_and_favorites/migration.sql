-- Discovery upgrade (docs/discovery-upgrade/PLAN.md). Additive only.
-- salonTypeConfirmed: existing salons start FALSE — their UNISEX value is only the column default,
-- so discovery treats them as "type not set" until an owner confirms (no silent reclassification).
-- customer_favorites: one row per (customer, salon), deleted with either side.

-- AlterTable
ALTER TABLE "salons" ADD COLUMN     "salonTypeConfirmed" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "customer_favorites" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_favorites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_favorites_userId_createdAt_idx" ON "customer_favorites"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "customer_favorites_salonId_idx" ON "customer_favorites"("salonId");

-- CreateIndex
CREATE UNIQUE INDEX "customer_favorites_userId_salonId_key" ON "customer_favorites"("userId", "salonId");

-- AddForeignKey
ALTER TABLE "customer_favorites" ADD CONSTRAINT "customer_favorites_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_favorites" ADD CONSTRAINT "customer_favorites_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "salons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

