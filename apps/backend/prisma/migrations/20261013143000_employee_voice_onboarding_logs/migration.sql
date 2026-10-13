-- Employee voice notes are PRIVATE CRM records, never public salon catalog items.
-- Only new table/indexes: safe additive migration; no existing rows rewritten.
CREATE TABLE "employee_onboarding_voice_logs" (
  "id" TEXT NOT NULL,
  "employeeProfileId" TEXT NOT NULL,
  "leadId" TEXT,
  "clientRequestId" UUID NOT NULL,
  "shopName" VARCHAR(180) NOT NULL,
  "transcript" TEXT NOT NULL,
  "language" VARCHAR(16) NOT NULL,
  "consentConfirmed" BOOLEAN NOT NULL,
  "contactName" VARCHAR(120),
  "phone" VARCHAR(32),
  "city" VARCHAR(120),
  "locality" VARCHAR(160),
  "addressLine" VARCHAR(300),
  "latitude" DOUBLE PRECISION,
  "longitude" DOUBLE PRECISION,
  "chairCount" INTEGER,
  "staffCount" INTEGER,
  "services" JSONB NOT NULL,
  "notes" VARCHAR(2000),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "employee_onboarding_voice_logs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "voice_log_explicit_consent_check" CHECK ("consentConfirmed" = true),
  CONSTRAINT "voice_log_coordinates_pair_check" CHECK (("latitude" IS NULL) = ("longitude" IS NULL)),
  CONSTRAINT "voice_log_coordinates_range_check" CHECK (
    ("latitude" IS NULL OR "latitude" BETWEEN -90 AND 90) AND
    ("longitude" IS NULL OR "longitude" BETWEEN -180 AND 180)
  ),
  CONSTRAINT "voice_log_counts_check" CHECK (
    ("chairCount" IS NULL OR "chairCount" BETWEEN 0 AND 1000) AND
    ("staffCount" IS NULL OR "staffCount" BETWEEN 0 AND 10000)
  ),
  CONSTRAINT "voice_log_services_array_check" CHECK (jsonb_typeof("services") = 'array' AND jsonb_array_length("services") <= 200)
);

CREATE UNIQUE INDEX "voice_log_employee_request_uq"
  ON "employee_onboarding_voice_logs"("employeeProfileId", "clientRequestId");
CREATE INDEX "voice_log_employee_created_idx"
  ON "employee_onboarding_voice_logs"("employeeProfileId", "createdAt");
CREATE INDEX "voice_log_lead_created_idx"
  ON "employee_onboarding_voice_logs"("leadId", "createdAt");
ALTER TABLE "employee_onboarding_voice_logs"
  ADD CONSTRAINT "voice_log_employee_fkey"
  FOREIGN KEY ("employeeProfileId") REFERENCES "employee_profiles"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "employee_onboarding_voice_logs"
  ADD CONSTRAINT "voice_log_lead_fkey"
  FOREIGN KEY ("leadId") REFERENCES "employee_crm_leads"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
