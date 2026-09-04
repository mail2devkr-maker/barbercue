-- FastQue Credits / Wallet V1: a promotional customer wallet, deliberately separate from
-- CustomerLedgerEntry (customer dues owed the other direction) and from Payment/Refund (the
-- unimplemented real-money gateway) — see schema.prisma's own doc comments on each new model.

-- CreateEnum
CREATE TYPE "CreditTransactionType" AS ENUM ('EARNED', 'REDEEMED', 'RESTORED', 'MANUAL_ADJUSTMENT');

-- CreateEnum
CREATE TYPE "SubsidyLedgerStatus" AS ENUM ('OUTSTANDING', 'SETTLED', 'VOIDED');

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "creditsEarnedAmount" DECIMAL(10,2),
ADD COLUMN     "creditsRedeemedAmount" DECIMAL(10,2);

-- AlterTable
ALTER TABLE "salon_payment_policies" ADD COLUMN     "paymentQrImageUrl" TEXT;

-- CreateTable
CREATE TABLE "customer_credit_accounts" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "balance" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_credit_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_credit_transactions" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "type" "CreditTransactionType" NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "bookingId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customer_credit_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_shop_subsidy_entries" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "bookingId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "status" "SubsidyLedgerStatus" NOT NULL DEFAULT 'OUTSTANDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "platform_shop_subsidy_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "customer_credit_accounts_userId_key" ON "customer_credit_accounts"("userId");

-- CreateIndex
CREATE INDEX "customer_credit_transactions_accountId_createdAt_idx" ON "customer_credit_transactions"("accountId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "platform_shop_subsidy_entries_bookingId_key" ON "platform_shop_subsidy_entries"("bookingId");

-- CreateIndex
CREATE INDEX "platform_shop_subsidy_entries_salonId_status_idx" ON "platform_shop_subsidy_entries"("salonId", "status");

-- AddForeignKey
ALTER TABLE "customer_credit_accounts" ADD CONSTRAINT "customer_credit_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_credit_transactions" ADD CONSTRAINT "customer_credit_transactions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "customer_credit_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_credit_transactions" ADD CONSTRAINT "customer_credit_transactions_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_shop_subsidy_entries" ADD CONSTRAINT "platform_shop_subsidy_entries_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "salons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "platform_shop_subsidy_entries" ADD CONSTRAINT "platform_shop_subsidy_entries_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "bookings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
