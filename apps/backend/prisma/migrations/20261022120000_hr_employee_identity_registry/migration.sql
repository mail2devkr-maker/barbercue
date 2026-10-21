-- Permanent HR employee identities and append-only offer/employment history.
-- This migration preserves every existing EmployeeProfile and employeeCode, and backfills one
-- review-required identity per profile. It does not infer prior offers, join/exit state, identity
-- proof, or employee-account status from contact data.

CREATE TYPE "EmployeeIdentityVerificationStatus" AS ENUM ('NEEDS_REVIEW', 'VERIFIED');
CREATE TYPE "EmployeeIdentityVerificationMethod" AS ENUM ('IN_PERSON', 'DOCUMENT_REVIEW', 'EXISTING_EMPLOYEE_RECORD');
CREATE TYPE "EmployeeIdentityHistoryStatus" AS ENUM ('COMPLETE', 'NEEDS_REVIEW', 'UNRESOLVED');
CREATE TYPE "EmployeeIdentityContactKind" AS ENUM ('EMAIL', 'PHONE');
CREATE TYPE "EmployeeOfferSource" AS ENUM ('HR_CREATED', 'HISTORICAL_RECONCILIATION');
CREATE TYPE "EmployeeOfferStatus" AS ENUM ('UNKNOWN', 'DRAFT', 'ISSUED', 'SENT', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'NOT_JOINED', 'JOINED');
CREATE TYPE "EmployeeOfferDocumentStatus" AS ENUM ('SAVED', 'GENERATED_LOCALLY', 'EMAILED');
CREATE TYPE "EmployeeEmploymentStatus" AS ENUM ('ACTIVE', 'EXITED', 'REVIEW_REQUIRED');
CREATE TYPE "EmployeePayFrequency" AS ENUM ('MONTHLY', 'YEARLY', 'HOURLY');

-- Sequence values are never returned by transaction rollback and are never recycled. The first
-- automatically allocated ID is 101; the owner-controlled reserved block remains 1-100.
CREATE SEQUENCE "employee_code_sequence" AS BIGINT START WITH 101 INCREMENT BY 1 NO MINVALUE NO MAXVALUE CACHE 1;

CREATE TABLE "employee_identities" (
  "id" TEXT NOT NULL,
  "employeeCode" TEXT,
  "fullName" TEXT NOT NULL,
  "verificationStatus" "EmployeeIdentityVerificationStatus" NOT NULL DEFAULT 'NEEDS_REVIEW',
  "verificationMethod" "EmployeeIdentityVerificationMethod",
  "verificationEvidenceRef" TEXT,
  "verifiedAt" TIMESTAMP(3),
  "verifiedByUserId" TEXT,
  "historyStatus" "EmployeeIdentityHistoryStatus" NOT NULL DEFAULT 'COMPLETE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "employee_identities_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "employee_identities_verified_fields_check" CHECK (
    ("verificationStatus" = 'NEEDS_REVIEW' AND "verifiedAt" IS NULL AND "verificationMethod" IS NULL)
    OR ("verificationStatus" = 'VERIFIED' AND "verifiedAt" IS NOT NULL AND "verificationMethod" IS NOT NULL)
  ),
  CONSTRAINT "employee_identities_employee_code_format_check" CHECK (
    "employeeCode" IS NULL OR "employeeCode" ~ '^FQ-FE-[0-9]{5,}$'
  )
);

CREATE UNIQUE INDEX "employee_identities_employeeCode_key" ON "employee_identities"("employeeCode");
CREATE INDEX "employee_identities_fullName_idx" ON "employee_identities"("fullName");
CREATE INDEX "employee_identities_verificationStatus_historyStatus_idx" ON "employee_identities"("verificationStatus", "historyStatus");
ALTER TABLE "employee_identities" ADD CONSTRAINT "employee_identities_verifiedByUserId_fkey"
  FOREIGN KEY ("verifiedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "employee_identity_contacts" (
  "id" TEXT NOT NULL,
  "identityId" TEXT NOT NULL,
  "kind" "EmployeeIdentityContactKind" NOT NULL,
  "encryptedValue" TEXT NOT NULL,
  "lookupHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "employee_identity_contacts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "employee_identity_contacts_identityId_fkey"
    FOREIGN KEY ("identityId") REFERENCES "employee_identities"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "employee_identity_contacts_kind_lookupHash_idx" ON "employee_identity_contacts"("kind", "lookupHash");
CREATE INDEX "employee_identity_contacts_identityId_kind_createdAt_idx" ON "employee_identity_contacts"("identityId", "kind", "createdAt");

CREATE TABLE "employee_offer_versions" (
  "id" TEXT NOT NULL,
  "identityId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "requestFingerprint" TEXT NOT NULL,
  "source" "EmployeeOfferSource" NOT NULL DEFAULT 'HR_CREATED',
  "candidateNameSnapshot" TEXT NOT NULL,
  "position" TEXT NOT NULL,
  "reportingManager" TEXT,
  "proposedJoiningAt" TIMESTAMP(3),
  "compensationTermsCiphertext" TEXT NOT NULL,
  "sourceReference" TEXT,
  "sourceOfferDate" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "employee_offer_versions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "employee_offer_versions_version_check" CHECK ("version" > 0),
  CONSTRAINT "employee_offer_versions_identityId_fkey"
    FOREIGN KEY ("identityId") REFERENCES "employee_identities"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "employee_offer_versions_identityId_version_key" ON "employee_offer_versions"("identityId", "version");
CREATE INDEX "employee_offer_versions_identityId_idempotencyKey_idx" ON "employee_offer_versions"("identityId", "idempotencyKey");
CREATE INDEX "employee_offer_versions_identityId_createdAt_idx" ON "employee_offer_versions"("identityId", "createdAt");
CREATE INDEX "employee_offer_versions_source_sourceOfferDate_idx" ON "employee_offer_versions"("source", "sourceOfferDate");

CREATE TABLE "employee_employment_episodes" (
  "id" TEXT NOT NULL,
  "identityId" TEXT NOT NULL,
  "episodeNumber" INTEGER NOT NULL,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "offerVersionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "employee_employment_episodes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "employee_employment_episodes_number_check" CHECK ("episodeNumber" > 0),
  CONSTRAINT "employee_employment_episodes_identityId_fkey"
    FOREIGN KEY ("identityId") REFERENCES "employee_identities"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "employee_employment_episodes_offerVersionId_fkey"
    FOREIGN KEY ("offerVersionId") REFERENCES "employee_offer_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "employee_employment_episodes_identityId_episodeNumber_key" ON "employee_employment_episodes"("identityId", "episodeNumber");
CREATE INDEX "employee_employment_episodes_identityId_startedAt_idx" ON "employee_employment_episodes"("identityId", "startedAt");

CREATE TABLE "employee_hr_events" (
  "id" TEXT NOT NULL,
  "identityId" TEXT NOT NULL,
  "actorUserId" TEXT,
  "eventType" TEXT NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reasonCiphertext" TEXT,
  "metadata" JSONB,
  "idempotencyKey" TEXT,
  "requestFingerprint" TEXT,
  CONSTRAINT "employee_hr_events_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "employee_hr_events_identityId_fkey"
    FOREIGN KEY ("identityId") REFERENCES "employee_identities"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "employee_hr_events_actorUserId_fkey"
    FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "employee_hr_events_actorUserId_idempotencyKey_key" ON "employee_hr_events"("actorUserId", "idempotencyKey");
CREATE INDEX "employee_hr_events_identityId_occurredAt_idx" ON "employee_hr_events"("identityId", "occurredAt");
CREATE INDEX "employee_hr_events_entityType_entityId_occurredAt_idx" ON "employee_hr_events"("entityType", "entityId", "occurredAt");

ALTER TABLE "employee_profiles" ADD COLUMN "employeeIdentityId" TEXT;

-- One identity per existing profile; no name/contact-based merging and no employee-code rewrite.
INSERT INTO "employee_identities" (
  "id", "employeeCode", "fullName", "verificationStatus", "verificationMethod",
  "verificationEvidenceRef", "verifiedAt", "verifiedByUserId", "historyStatus", "createdAt", "updatedAt"
)
SELECT gen_random_uuid()::text, "employeeCode", "fullName", 'NEEDS_REVIEW', NULL,
  NULL, NULL, NULL, 'NEEDS_REVIEW', "createdAt", CURRENT_TIMESTAMP
FROM "employee_profiles";

UPDATE "employee_profiles" AS profile
SET "employeeIdentityId" = identity."id"
FROM "employee_identities" AS identity
WHERE identity."employeeCode" = profile."employeeCode";

ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_profiles_employeeIdentityId_key" UNIQUE ("employeeIdentityId");
ALTER TABLE "employee_profiles" ADD CONSTRAINT "employee_profiles_employeeIdentityId_fkey"
  FOREIGN KEY ("employeeIdentityId") REFERENCES "employee_identities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- These legacy rows explicitly require HR reconciliation. The old profile joinedAt is preserved
-- as source evidence but is NOT interpreted as verified employment commencement or current status.
INSERT INTO "employee_employment_episodes" ("id", "identityId", "episodeNumber", "startedAt", "offerVersionId", "createdAt")
SELECT gen_random_uuid()::text, profile."employeeIdentityId", 1, profile."joinedAt", NULL, CURRENT_TIMESTAMP
FROM "employee_profiles" AS profile;

INSERT INTO "employee_hr_events" (
  "id", "identityId", "actorUserId", "eventType", "entityType", "entityId", "occurredAt", "metadata"
)
SELECT gen_random_uuid()::text, profile."employeeIdentityId", NULL,
  'LEGACY_RECONCILIATION_REQUIRED', 'EMPLOYMENT_EPISODE', episode."id", profile."joinedAt",
  jsonb_build_object('status', 'REVIEW_REQUIRED', 'source', 'LEGACY_EMPLOYEE_PROFILE')
FROM "employee_profiles" AS profile
JOIN "employee_employment_episodes" AS episode
  ON episode."identityId" = profile."employeeIdentityId" AND episode."episodeNumber" = 1;

SELECT setval(
  '"employee_code_sequence"',
  GREATEST(
    100,
    COALESCE(MAX(substring("employeeCode" from '^FQ-FE-([0-9]+)$')::bigint), 100)
  ),
  true
)
FROM "employee_profiles";

-- Serialize all new/legacy code writes and enforce one namespace across the two tables. This
-- protects rollout overlap with older backend instances that only know employee_profiles.
CREATE FUNCTION "fastque_guard_employee_code_namespace"() RETURNS trigger AS $$
DECLARE
  identity_code TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('fastque_employee_code'));

  IF TG_TABLE_NAME = 'employee_identities' THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'employee identities are permanent and cannot be deleted' USING ERRCODE = '55000';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD."employeeCode" IS NOT NULL AND NEW."employeeCode" IS DISTINCT FROM OLD."employeeCode" THEN
      RAISE EXCEPTION 'employee codes are permanent and cannot be changed' USING ERRCODE = '55000';
    END IF;
    IF NEW."employeeCode" IS NOT NULL AND EXISTS (
      SELECT 1 FROM "employee_profiles" profile
      WHERE profile."employeeCode" = NEW."employeeCode"
        AND profile."employeeIdentityId" IS NOT NULL
        AND profile."employeeIdentityId" IS DISTINCT FROM NEW."id"
    ) THEN
      RAISE EXCEPTION 'employee code is already assigned to a different identity' USING ERRCODE = '23505';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND OLD."employeeCode" IS DISTINCT FROM NEW."employeeCode" THEN
    RAISE EXCEPTION 'employee codes are permanent and cannot be changed' USING ERRCODE = '55000';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD."employeeIdentityId" IS NOT NULL
      AND NEW."employeeIdentityId" IS DISTINCT FROM OLD."employeeIdentityId" THEN
    RAISE EXCEPTION 'employee profile identity links are permanent' USING ERRCODE = '55000';
  END IF;

  IF NEW."employeeIdentityId" IS NOT NULL THEN
    SELECT identity."employeeCode" INTO identity_code
    FROM "employee_identities" identity WHERE identity."id" = NEW."employeeIdentityId";
    IF identity_code IS DISTINCT FROM NEW."employeeCode" THEN
      RAISE EXCEPTION 'employee profile code must match its permanent identity' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM "employee_identities" identity
    WHERE identity."employeeCode" = NEW."employeeCode"
      AND identity."id" IS DISTINCT FROM NEW."employeeIdentityId"
  ) THEN
    RAISE EXCEPTION 'employee code is already reserved by a different identity' USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "employee_identities_code_guard"
BEFORE INSERT OR UPDATE OR DELETE ON "employee_identities"
FOR EACH ROW EXECUTE FUNCTION "fastque_guard_employee_code_namespace"();
CREATE TRIGGER "employee_profiles_code_guard"
BEFORE INSERT OR UPDATE ON "employee_profiles"
FOR EACH ROW EXECUTE FUNCTION "fastque_guard_employee_code_namespace"();

CREATE FUNCTION "fastque_reject_hr_history_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'HR history is append-only' USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "employee_identity_contacts_immutable"
BEFORE UPDATE OR DELETE ON "employee_identity_contacts"
FOR EACH ROW EXECUTE FUNCTION "fastque_reject_hr_history_mutation"();
CREATE TRIGGER "employee_offer_versions_immutable"
BEFORE UPDATE OR DELETE ON "employee_offer_versions"
FOR EACH ROW EXECUTE FUNCTION "fastque_reject_hr_history_mutation"();
CREATE TRIGGER "employee_employment_episodes_immutable"
BEFORE UPDATE OR DELETE ON "employee_employment_episodes"
FOR EACH ROW EXECUTE FUNCTION "fastque_reject_hr_history_mutation"();
CREATE TRIGGER "employee_hr_events_immutable"
BEFORE UPDATE OR DELETE ON "employee_hr_events"
FOR EACH ROW EXECUTE FUNCTION "fastque_reject_hr_history_mutation"();
