-- FastQue Credits / Wallet V1 correction (post-review): fixes two critical misimplementations of
-- the frozen product rule caught before any production use.
--   1. floor(price/50)*10 is a REDEMPTION CAP, not an automatic earn-on-completion rate — removes
--      Booking.creditsEarnedAmount and the EARNED transaction type entirely.
--   2. Credits now enter a wallet only via an authorized PROMO_GRANT (or a RESTORED reversal) —
--      converts the ledger from a cached-balance model to a lot-based model (remainingAmount +
--      optional expiresAt per grant), so redemption eligibility and balance are always computed
--      live from valid, unexpired lots rather than a mutable counter that could drift.

-- CreateEnum
CREATE TYPE "CreditFundingSource" AS ENUM ('FASTQUE_FUNDED', 'SHOP_FUNDED');

-- AlterEnum: EARNED -> PROMO_GRANT (no existing rows use EARNED locally; verified empty before
-- writing this migration).
BEGIN;
CREATE TYPE "CreditTransactionType_new" AS ENUM ('PROMO_GRANT', 'REDEEMED', 'RESTORED', 'MANUAL_ADJUSTMENT');
ALTER TABLE "customer_credit_transactions" ALTER COLUMN "type" TYPE "CreditTransactionType_new" USING ("type"::text::"CreditTransactionType_new");
ALTER TYPE "CreditTransactionType" RENAME TO "CreditTransactionType_old";
ALTER TYPE "CreditTransactionType_new" RENAME TO "CreditTransactionType";
DROP TYPE "CreditTransactionType_old";
COMMIT;

-- AlterTable
ALTER TABLE "bookings" DROP COLUMN "creditsEarnedAmount";

-- AlterTable
ALTER TABLE "customer_credit_accounts" DROP COLUMN "balance";

-- AlterTable
ALTER TABLE "customer_credit_transactions" ADD COLUMN     "campaignRef" TEXT,
ADD COLUMN     "expiresAt" TIMESTAMP(3),
ADD COLUMN     "fundingSource" "CreditFundingSource",
ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "reason" TEXT,
ADD COLUMN     "remainingAmount" DECIMAL(10,2);

-- CreateIndex
CREATE UNIQUE INDEX "customer_credit_transactions_idempotencyKey_key" ON "customer_credit_transactions"("idempotencyKey");

-- CreateIndex
CREATE INDEX "customer_credit_transactions_bookingId_idx" ON "customer_credit_transactions"("bookingId");
