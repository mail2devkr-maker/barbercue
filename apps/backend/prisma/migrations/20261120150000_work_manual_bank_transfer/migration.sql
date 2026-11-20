-- FastQue Work: manual bank transfer (NEFT) settlement. Additive only: new nullable columns and
-- unique indexes on them. No existing row or behaviour changes.

ALTER TABLE "worker_profiles"
    ADD COLUMN "payoutBankAccountEncrypted" TEXT,
    ADD COLUMN "payoutBankAccountLast4" VARCHAR(4),
    ADD COLUMN "payoutBankIfsc" VARCHAR(11),
    ADD COLUMN "payoutBankAccountName" VARCHAR(120);

ALTER TABLE "work_fundings"
    ADD COLUMN "manualUtr" VARCHAR(40),
    ADD COLUMN "manualConfirmedById" TEXT;

ALTER TABLE "work_payouts"
    ADD COLUMN "manualUtr" VARCHAR(40),
    ADD COLUMN "manualConfirmedById" TEXT;

CREATE UNIQUE INDEX "work_fundings_manualUtr_key" ON "work_fundings"("manualUtr");
CREATE UNIQUE INDEX "work_payouts_manualUtr_key" ON "work_payouts"("manualUtr");
