-- Phase 8A: hand-authored to match Prisma's exact generated conventions (see this migration's
-- own explanation in the Phase 8A report). Content already applied to the current dev database
-- via `prisma db push` in the prior phase — this file exists to make that schema state
-- reproducible via `prisma migrate deploy` on a fresh database, and is marked as already-applied
-- on the current dev database via `prisma migrate resolve --applied` rather than re-run.

-- CreateEnum
CREATE TYPE "CustomerSubscriptionStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AiCreditTransactionType" AS ENUM ('ALLOCATION', 'RESERVATION', 'CONSUMPTION', 'RELEASE', 'MANUAL_ADJUSTMENT');

-- CreateTable
CREATE TABLE "customer_premium_plans" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "priceInr" DECIMAL(10,2) NOT NULL,
    "aiCreditsPerYear" INTEGER NOT NULL,
    "isPopular" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_premium_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_subscriptions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" "CustomerSubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "periodStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "aiCreditsAllocated" INTEGER NOT NULL,
    "aiCreditsReserved" INTEGER NOT NULL DEFAULT 0,
    "aiCreditsConsumed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_credit_transactions" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "type" "AiCreditTransactionType" NOT NULL,
    "amount" INTEGER NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_credit_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_subscriptions_userId_status_idx" ON "customer_subscriptions"("userId", "status");

-- CreateIndex
CREATE INDEX "ai_credit_transactions_subscriptionId_createdAt_idx" ON "ai_credit_transactions"("subscriptionId", "createdAt");

-- AddForeignKey
ALTER TABLE "customer_subscriptions" ADD CONSTRAINT "customer_subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_subscriptions" ADD CONSTRAINT "customer_subscriptions_planId_fkey" FOREIGN KEY ("planId") REFERENCES "customer_premium_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_credit_transactions" ADD CONSTRAINT "ai_credit_transactions_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "customer_subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
