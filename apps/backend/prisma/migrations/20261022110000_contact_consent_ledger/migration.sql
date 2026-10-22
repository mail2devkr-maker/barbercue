-- Contact consent ledger (requirement 13). Additive: two new tables, no change to any existing table or row.
-- No phone number is stored in plaintext: "phoneHash" is HMAC-SHA256(E.164, CONTACT_LEDGER_HASH_KEY) in lowercase hex.
-- Nothing in this schema sends anything; invitation dispatch remains blocked behind provider and approval gates.

-- CreateTable
CREATE TABLE "contact_consent_records" (
    "id" TEXT NOT NULL,
    "salonId" TEXT NOT NULL,
    "phoneHash" VARCHAR(64) NOT NULL,
    "purpose" VARCHAR(32) NOT NULL DEFAULT 'BOOKING_INVITATION',
    "source" VARCHAR(24) NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedByUserId" TEXT NOT NULL,
    "policyVersion" VARCHAR(40) NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'ACTIVE',
    "withdrawnAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contact_consent_records_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "contact_consent_records_status_check" CHECK ("status"::text = ANY (ARRAY['ACTIVE'::text, 'WITHDRAWN'::text])),
    CONSTRAINT "contact_consent_records_withdrawn_consistency_check" CHECK (("status"::text = 'WITHDRAWN'::text) = ("withdrawnAt" IS NOT NULL)),
    CONSTRAINT "contact_consent_records_phoneHash_format_check" CHECK ("phoneHash"::text ~ '^[0-9a-f]{64}$'::text),
    CONSTRAINT "contact_consent_records_expiry_check" CHECK ("expiresAt" > "capturedAt")
);

-- CreateTable
CREATE TABLE "contact_suppressions" (
    "phoneHash" VARCHAR(64) NOT NULL,
    "reason" VARCHAR(24) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT,

    CONSTRAINT "contact_suppressions_pkey" PRIMARY KEY ("phoneHash"),
    CONSTRAINT "contact_suppressions_reason_check" CHECK ("reason"::text = ANY (ARRAY['OPT_OUT'::text, 'ERASURE_REQUEST'::text, 'ADMIN'::text])),
    CONSTRAINT "contact_suppressions_phoneHash_format_check" CHECK ("phoneHash"::text ~ '^[0-9a-f]{64}$'::text)
);

-- CreateIndex
CREATE INDEX "contact_consent_records_salonId_status_expiresAt_idx" ON "contact_consent_records"("salonId", "status", "expiresAt");

-- CreateIndex
CREATE INDEX "contact_consent_records_expiresAt_idx" ON "contact_consent_records"("expiresAt");

-- CreateIndex
CREATE INDEX "contact_consent_records_phoneHash_idx" ON "contact_consent_records"("phoneHash");

-- CreateIndex
CREATE UNIQUE INDEX "contact_consent_records_salonId_phoneHash_purpose_key" ON "contact_consent_records"("salonId", "phoneHash", "purpose");

-- AddForeignKey
ALTER TABLE "contact_consent_records" ADD CONSTRAINT "contact_consent_records_salonId_fkey" FOREIGN KEY ("salonId") REFERENCES "salons"("id") ON DELETE CASCADE ON UPDATE CASCADE;
