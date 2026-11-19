-- FastQue Work: student and gig workforce marketplace (docs/work-marketplace/ARCHITECTURE.md).
-- Additive only. No existing table, column, enum or row is changed. The second half adds the
-- integrity rules Prisma's schema language cannot express: capacity CHECKs, partial unique indexes
-- for live slots and live payouts, an append-only audit/ledger, and a balanced-journal guarantee.

-- CreateEnum
CREATE TYPE "WorkOrgStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "WorkOrgMemberRole" AS ENUM ('OWNER', 'MANAGER', 'BILLING');

-- CreateEnum
CREATE TYPE "WorkOrgType" AS ENUM ('INDIVIDUAL', 'MSME', 'STARTUP', 'RETAIL', 'RESTAURANT', 'SALON', 'EVENT_ORGANIZER', 'MARKETING_AGENCY', 'ENTERPRISE', 'WORKFORCE_AGENCY');

-- CreateEnum
CREATE TYPE "WorkerType" AS ENUM ('COLLEGE_STUDENT', 'GRADUATE', 'PART_TIME', 'FREELANCER', 'SKILLED_PROFESSIONAL', 'FIELD_SALES', 'SHIFT_WORKER', 'DIGITAL_TASK');

-- CreateEnum
CREATE TYPE "WorkJobStatus" AS ENUM ('DRAFT', 'PENDING_VERIFICATION', 'FUNDING_REQUIRED', 'OPEN', 'PARTIALLY_FILLED', 'FILLED', 'IN_PROGRESS', 'COMPLETED', 'CLOSED', 'PAUSED', 'CANCELLED', 'EXPIRED', 'REJECTED');

-- CreateEnum
CREATE TYPE "WorkHiringMode" AS ENUM ('INSTANT_ACCEPT', 'APPLY_AND_SELECT');

-- CreateEnum
CREATE TYPE "WorkPayType" AS ENUM ('FIXED', 'PER_TASK', 'HOURLY', 'DAILY');

-- CreateEnum
CREATE TYPE "WorkLocationType" AS ENUM ('ON_SITE', 'REMOTE', 'HYBRID');

-- CreateEnum
CREATE TYPE "WorkApplicationStatus" AS ENUM ('APPLIED', 'OFFERED', 'ACCEPTED', 'REJECTED', 'DECLINED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "WorkAssignmentStatus" AS ENUM ('ACCEPTED', 'CHECKED_IN', 'SUBMITTED', 'REWORK_REQUESTED', 'DISPUTED', 'PAYABLE', 'PAID', 'NO_SHOW_REVIEW', 'WITHDRAWN', 'CANCELLED', 'CLOSED_UNPAID');

-- CreateEnum
CREATE TYPE "WorkCheckInMethod" AS ENUM ('QR_CODE', 'GPS', 'EMPLOYER_CONFIRMED', 'SELF_REPORTED');

-- CreateEnum
CREATE TYPE "WorkFundingStatus" AS ENUM ('CREATED', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "WorkPayoutStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "WorkDisputeStatus" AS ENUM ('OPEN', 'RESOLVED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "WorkDisputeReason" AS ENUM ('UNFAIR_REJECTION', 'PARTIAL_PAYMENT', 'QUALITY_ISSUE', 'NO_WORK_AVAILABLE', 'NO_SHOW', 'UNSAFE_CONDITIONS', 'PAYMENT_PROBLEM', 'OTHER');

-- CreateEnum
CREATE TYPE "WorkParty" AS ENUM ('WORKER', 'EMPLOYER', 'PLATFORM', 'SYSTEM');

-- CreateTable
CREATE TABLE "work_categories" (
    "id" TEXT NOT NULL,
    "slug" VARCHAR(60) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "description" VARCHAR(300),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_organizations" (
    "id" TEXT NOT NULL,
    "legalName" VARCHAR(160) NOT NULL,
    "displayName" VARCHAR(80) NOT NULL,
    "orgType" "WorkOrgType" NOT NULL,
    "gstin" VARCHAR(15),
    "registeredAddress" VARCHAR(300) NOT NULL,
    "city" VARCHAR(80) NOT NULL,
    "contactName" VARCHAR(120) NOT NULL,
    "contactPhone" VARCHAR(16) NOT NULL,
    "contactEmail" VARCHAR(160) NOT NULL,
    "status" "WorkOrgStatus" NOT NULL DEFAULT 'DRAFT',
    "rejectionReason" VARCHAR(1000),
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_org_members" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "WorkOrgMemberRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_org_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "worker_profiles" (
    "userId" TEXT NOT NULL,
    "fullName" VARCHAR(120) NOT NULL,
    "workerType" "WorkerType" NOT NULL,
    "dateOfBirth" DATE NOT NULL,
    "city" VARCHAR(80) NOT NULL,
    "locality" VARCHAR(80),
    "workRadiusKm" INTEGER NOT NULL DEFAULT 10,
    "languages" TEXT[],
    "skills" TEXT[],
    "preferredCategories" TEXT[],
    "collegeName" VARCHAR(160),
    "bio" VARCHAR(600),
    "payoutUpiVpa" VARCHAR(100),
    "verificationLevel" INTEGER NOT NULL DEFAULT 0,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "suspendedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "worker_profiles_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "work_jobs" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "title" VARCHAR(120) NOT NULL,
    "description" VARCHAR(4000) NOT NULL,
    "locationType" "WorkLocationType" NOT NULL,
    "addressLine" VARCHAR(300),
    "city" VARCHAR(80) NOT NULL,
    "locality" VARCHAR(80),
    "positions" INTEGER NOT NULL,
    "filledCount" INTEGER NOT NULL DEFAULT 0,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "applicationDeadline" TIMESTAMP(3),
    "payType" "WorkPayType" NOT NULL,
    "payPerWorkerPaise" INTEGER NOT NULL,
    "bonusDescription" VARCHAR(300),
    "feeBps" INTEGER NOT NULL,
    "minAge" INTEGER NOT NULL DEFAULT 18,
    "minVerificationLevel" INTEGER NOT NULL DEFAULT 1,
    "requiredSkills" TEXT[],
    "languages" TEXT[],
    "hiringMode" "WorkHiringMode" NOT NULL,
    "requiresCheckIn" BOOLEAN NOT NULL DEFAULT true,
    "checkInCode" VARCHAR(12) NOT NULL,
    "checklist" JSONB NOT NULL,
    "completionCriteria" VARCHAR(1000) NOT NULL,
    "cancellationTerms" JSONB NOT NULL,
    "reviewWindowHours" INTEGER NOT NULL DEFAULT 72,
    "status" "WorkJobStatus" NOT NULL DEFAULT 'DRAFT',
    "screeningFlags" JSONB,
    "moderationNote" VARCHAR(1000),
    "version" INTEGER NOT NULL DEFAULT 1,
    "publishedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_applications" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "status" "WorkApplicationStatus" NOT NULL DEFAULT 'APPLIED',
    "note" VARCHAR(600),
    "decidedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_assignments" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "applicationId" TEXT,
    "slotNumber" INTEGER NOT NULL,
    "status" "WorkAssignmentStatus" NOT NULL DEFAULT 'ACCEPTED',
    "agreedPayPaise" INTEGER NOT NULL,
    "termsSnapshot" JSONB NOT NULL,
    "checkedInAt" TIMESTAMP(3),
    "checkInMethod" "WorkCheckInMethod",
    "checkInLatitude" DOUBLE PRECISION,
    "checkInLongitude" DOUBLE PRECISION,
    "submittedAt" TIMESTAMP(3),
    "reviewDueAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" VARCHAR(1000),
    "approvedAmountPaise" INTEGER,
    "lateCancellation" BOOLEAN NOT NULL DEFAULT false,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_task_responses" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "itemId" VARCHAR(40) NOT NULL,
    "confirmed" BOOLEAN NOT NULL DEFAULT false,
    "text" VARCHAR(2000),
    "normalizedText" VARCHAR(2000),
    "evidenceFileId" TEXT,
    "duplicateFlag" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_task_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_evidence_files" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "mimeType" VARCHAR(40) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "content" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_evidence_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_fundings" (
    "id" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "jobVersion" INTEGER NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "provider" VARCHAR(40) NOT NULL,
    "providerOrderId" VARCHAR(120) NOT NULL,
    "status" "WorkFundingStatus" NOT NULL DEFAULT 'CREATED',
    "idempotencyKey" VARCHAR(120) NOT NULL,
    "confirmedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_fundings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_payouts" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "workerId" TEXT NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "attempt" INTEGER NOT NULL,
    "provider" VARCHAR(40) NOT NULL,
    "providerPayoutId" VARCHAR(120),
    "status" "WorkPayoutStatus" NOT NULL DEFAULT 'PENDING',
    "failureReason" VARCHAR(300),
    "idempotencyKey" VARCHAR(120) NOT NULL,
    "initiatedAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_disputes" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "openedById" TEXT NOT NULL,
    "openedByParty" "WorkParty" NOT NULL,
    "reasonCode" "WorkDisputeReason" NOT NULL,
    "description" VARCHAR(2000) NOT NULL,
    "fromStatus" "WorkAssignmentStatus" NOT NULL,
    "status" "WorkDisputeStatus" NOT NULL DEFAULT 'OPEN',
    "awardPaise" INTEGER,
    "resolutionNote" VARCHAR(2000),
    "resolvedById" TEXT,
    "slaDueAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_disputes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_webhook_events" (
    "id" TEXT NOT NULL,
    "provider" VARCHAR(40) NOT NULL,
    "providerEventId" VARCHAR(120) NOT NULL,
    "eventType" VARCHAR(60) NOT NULL,
    "payload" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_ledger_journals" (
    "id" TEXT NOT NULL,
    "kind" VARCHAR(40) NOT NULL,
    "idempotencyKey" VARCHAR(160) NOT NULL,
    "memo" VARCHAR(300),
    "jobId" TEXT,
    "assignmentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_ledger_journals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_ledger_entries" (
    "id" TEXT NOT NULL,
    "journalId" TEXT NOT NULL,
    "accountCode" VARCHAR(120) NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "work_audit_events" (
    "id" TEXT NOT NULL,
    "entityType" VARCHAR(40) NOT NULL,
    "entityId" TEXT NOT NULL,
    "action" VARCHAR(60) NOT NULL,
    "fromStatus" VARCHAR(40),
    "toStatus" VARCHAR(40),
    "actorUserId" TEXT,
    "actorParty" "WorkParty" NOT NULL,
    "orgId" TEXT,
    "jobId" TEXT,
    "note" VARCHAR(1000),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "work_categories_slug_key" ON "work_categories"("slug");

-- CreateIndex
CREATE INDEX "work_organizations_status_submittedAt_idx" ON "work_organizations"("status", "submittedAt");

-- CreateIndex
CREATE INDEX "work_org_members_userId_idx" ON "work_org_members"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "work_org_members_orgId_userId_key" ON "work_org_members"("orgId", "userId");

-- CreateIndex
CREATE INDEX "worker_profiles_city_idx" ON "worker_profiles"("city");

-- CreateIndex
CREATE INDEX "work_jobs_status_startsAt_idx" ON "work_jobs"("status", "startsAt");

-- CreateIndex
CREATE INDEX "work_jobs_orgId_createdAt_idx" ON "work_jobs"("orgId", "createdAt");

-- CreateIndex
CREATE INDEX "work_jobs_city_status_idx" ON "work_jobs"("city", "status");

-- CreateIndex
CREATE INDEX "work_applications_workerId_createdAt_idx" ON "work_applications"("workerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "work_applications_jobId_workerId_key" ON "work_applications"("jobId", "workerId");

-- CreateIndex
CREATE UNIQUE INDEX "work_assignments_applicationId_key" ON "work_assignments"("applicationId");

-- CreateIndex
CREATE INDEX "work_assignments_workerId_status_idx" ON "work_assignments"("workerId", "status");

-- CreateIndex
CREATE INDEX "work_assignments_jobId_status_idx" ON "work_assignments"("jobId", "status");

-- CreateIndex
CREATE INDEX "work_assignments_status_reviewDueAt_idx" ON "work_assignments"("status", "reviewDueAt");

-- CreateIndex
CREATE UNIQUE INDEX "work_task_responses_evidenceFileId_key" ON "work_task_responses"("evidenceFileId");

-- CreateIndex
CREATE UNIQUE INDEX "work_task_responses_assignmentId_itemId_key" ON "work_task_responses"("assignmentId", "itemId");

-- CreateIndex
CREATE INDEX "work_evidence_files_sha256_idx" ON "work_evidence_files"("sha256");

-- CreateIndex
CREATE INDEX "work_evidence_files_assignmentId_idx" ON "work_evidence_files"("assignmentId");

-- CreateIndex
CREATE UNIQUE INDEX "work_fundings_providerOrderId_key" ON "work_fundings"("providerOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "work_fundings_idempotencyKey_key" ON "work_fundings"("idempotencyKey");

-- CreateIndex
CREATE INDEX "work_fundings_jobId_idx" ON "work_fundings"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "work_payouts_providerPayoutId_key" ON "work_payouts"("providerPayoutId");

-- CreateIndex
CREATE UNIQUE INDEX "work_payouts_idempotencyKey_key" ON "work_payouts"("idempotencyKey");

-- CreateIndex
CREATE INDEX "work_payouts_status_createdAt_idx" ON "work_payouts"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "work_payouts_assignmentId_attempt_key" ON "work_payouts"("assignmentId", "attempt");

-- CreateIndex
CREATE INDEX "work_disputes_status_slaDueAt_idx" ON "work_disputes"("status", "slaDueAt");

-- CreateIndex
CREATE INDEX "work_disputes_assignmentId_idx" ON "work_disputes"("assignmentId");

-- CreateIndex
CREATE UNIQUE INDEX "work_webhook_events_provider_providerEventId_key" ON "work_webhook_events"("provider", "providerEventId");

-- CreateIndex
CREATE UNIQUE INDEX "work_ledger_journals_idempotencyKey_key" ON "work_ledger_journals"("idempotencyKey");

-- CreateIndex
CREATE INDEX "work_ledger_journals_jobId_idx" ON "work_ledger_journals"("jobId");

-- CreateIndex
CREATE INDEX "work_ledger_journals_assignmentId_idx" ON "work_ledger_journals"("assignmentId");

-- CreateIndex
CREATE INDEX "work_ledger_entries_accountCode_idx" ON "work_ledger_entries"("accountCode");

-- CreateIndex
CREATE INDEX "work_ledger_entries_journalId_idx" ON "work_ledger_entries"("journalId");

-- CreateIndex
CREATE INDEX "work_audit_events_entityType_entityId_createdAt_idx" ON "work_audit_events"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX "work_audit_events_jobId_createdAt_idx" ON "work_audit_events"("jobId", "createdAt");

-- CreateIndex
CREATE INDEX "work_audit_events_orgId_createdAt_idx" ON "work_audit_events"("orgId", "createdAt");

-- AddForeignKey
ALTER TABLE "work_organizations" ADD CONSTRAINT "work_organizations_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_org_members" ADD CONSTRAINT "work_org_members_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "work_organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_org_members" ADD CONSTRAINT "work_org_members_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "worker_profiles" ADD CONSTRAINT "worker_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_jobs" ADD CONSTRAINT "work_jobs_orgId_fkey" FOREIGN KEY ("orgId") REFERENCES "work_organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_jobs" ADD CONSTRAINT "work_jobs_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "work_categories"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_applications" ADD CONSTRAINT "work_applications_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "work_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_applications" ADD CONSTRAINT "work_applications_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_assignments" ADD CONSTRAINT "work_assignments_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "work_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_assignments" ADD CONSTRAINT "work_assignments_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_task_responses" ADD CONSTRAINT "work_task_responses_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "work_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_task_responses" ADD CONSTRAINT "work_task_responses_evidenceFileId_fkey" FOREIGN KEY ("evidenceFileId") REFERENCES "work_evidence_files"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_fundings" ADD CONSTRAINT "work_fundings_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "work_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_payouts" ADD CONSTRAINT "work_payouts_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "work_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_payouts" ADD CONSTRAINT "work_payouts_workerId_fkey" FOREIGN KEY ("workerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_disputes" ADD CONSTRAINT "work_disputes_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "work_assignments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_disputes" ADD CONSTRAINT "work_disputes_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_ledger_entries" ADD CONSTRAINT "work_ledger_entries_journalId_fkey" FOREIGN KEY ("journalId") REFERENCES "work_ledger_journals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------------------------
-- Integrity rules beyond Prisma's DSL
-- ---------------------------------------------------------------------------------------------

-- Capacity can never exceed positions or go negative, whatever the application does.
ALTER TABLE "work_jobs" ADD CONSTRAINT "work_jobs_capacity_check" CHECK ("positions" BETWEEN 1 AND 200 AND "filledCount" BETWEEN 0 AND "positions");
ALTER TABLE "work_jobs" ADD CONSTRAINT "work_jobs_pay_check" CHECK ("payPerWorkerPaise" BETWEEN 10000 AND 5000000 AND "feeBps" BETWEEN 0 AND 3000);
ALTER TABLE "work_jobs" ADD CONSTRAINT "work_jobs_min_age_check" CHECK ("minAge" >= 18);
ALTER TABLE "work_jobs" ADD CONSTRAINT "work_jobs_schedule_check" CHECK ("endsAt" > "startsAt");
ALTER TABLE "work_assignments" ADD CONSTRAINT "work_assignments_amount_check" CHECK ("agreedPayPaise" > 0 AND ("approvedAmountPaise" IS NULL OR "approvedAmountPaise" BETWEEN 0 AND "agreedPayPaise"));
ALTER TABLE "work_payouts" ADD CONSTRAINT "work_payouts_amount_check" CHECK ("amountPaise" > 0 AND "attempt" >= 1);
ALTER TABLE "work_fundings" ADD CONSTRAINT "work_fundings_amount_check" CHECK ("amountPaise" > 0);
ALTER TABLE "work_ledger_entries" ADD CONSTRAINT "work_ledger_entries_nonzero_check" CHECK ("amountPaise" <> 0);

-- A slot is held by at most one live assignment, and a worker holds at most one live slot per job.
CREATE UNIQUE INDEX "work_assignments_live_slot_uq" ON "work_assignments"("jobId", "slotNumber")
  WHERE "status" NOT IN ('WITHDRAWN', 'CANCELLED', 'CLOSED_UNPAID');
CREATE UNIQUE INDEX "work_assignments_live_worker_uq" ON "work_assignments"("jobId", "workerId")
  WHERE "status" NOT IN ('WITHDRAWN', 'CANCELLED', 'CLOSED_UNPAID');

-- At most one payout per assignment can be in flight or succeeded: a retry is only possible after
-- the previous attempt FAILED, so a worker can never be paid twice for the same work.
CREATE UNIQUE INDEX "work_payouts_live_uq" ON "work_payouts"("assignmentId")
  WHERE "status" IN ('PENDING', 'PROCESSING', 'SUCCEEDED');

-- One confirmed funding per job.
CREATE UNIQUE INDEX "work_fundings_succeeded_uq" ON "work_fundings"("jobId") WHERE "status" = 'SUCCEEDED';

-- Append-only: audit events, ledger journals and ledger entries can never be changed or removed.
CREATE OR REPLACE FUNCTION work_reject_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'work_append_only: % on % is not allowed', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "work_audit_events_append_only" BEFORE UPDATE OR DELETE ON "work_audit_events"
  FOR EACH ROW EXECUTE FUNCTION work_reject_mutation();
CREATE TRIGGER "work_ledger_journals_append_only" BEFORE UPDATE OR DELETE ON "work_ledger_journals"
  FOR EACH ROW EXECUTE FUNCTION work_reject_mutation();
CREATE TRIGGER "work_ledger_entries_append_only" BEFORE UPDATE OR DELETE ON "work_ledger_entries"
  FOR EACH ROW EXECUTE FUNCTION work_reject_mutation();

-- Double entry: at commit time every journal touched by the transaction must sum to exactly zero
-- and have at least two entries. A one-sided or unbalanced posting rolls the whole transaction back.
CREATE OR REPLACE FUNCTION work_assert_journal_balanced() RETURNS trigger AS $$
DECLARE
  total BIGINT;
  n INTEGER;
BEGIN
  SELECT COALESCE(SUM("amountPaise"), 0), COUNT(*) INTO total, n
    FROM "work_ledger_entries" WHERE "journalId" = NEW."journalId";
  IF total <> 0 OR n < 2 THEN
    RAISE EXCEPTION 'work_ledger_unbalanced: journal % sums to % over % entries', NEW."journalId", total, n
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "work_ledger_entries_balanced" AFTER INSERT ON "work_ledger_entries"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION work_assert_journal_balanced();

-- ---------------------------------------------------------------------------------------------
-- Initial category taxonomy (admins can add, rename or deactivate categories later without code).
-- ---------------------------------------------------------------------------------------------
INSERT INTO "work_categories" ("id", "slug", "name", "description", "sortOrder", "updatedAt") VALUES
  (gen_random_uuid()::text, 'merchant-onboarding', 'Merchant onboarding', 'Visit shops, explain a product and register consenting merchants', 1, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'field-sales', 'Field sales', 'In-person sales and product demonstrations', 2, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'retail-assistance', 'Retail store assistance', 'Floor help, billing support and shelf stocking', 3, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'restaurant-shifts', 'Restaurant and café shifts', 'Service, kitchen help and hosting', 4, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'event-assistance', 'Event assistance', 'Registration desks, ushering and event set-up', 5, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'brand-promotion', 'Brand promotion', 'Sampling, flyering and in-store promotion', 6, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'surveys-research', 'Surveys and market research', 'Consent-based surveys and field research', 7, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'inventory-audits', 'Inventory and stock audits', 'Counting and reconciling stock', 8, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'catalog-creation', 'Product catalog creation', 'Photographing and listing products and services', 9, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'data-entry', 'Data entry', 'Accurate entry and cleanup of records', 10, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'customer-support', 'Customer support', 'Chat, email and phone support', 11, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'telecalling', 'Telecalling', 'Consent-based outbound and inbound calling', 12, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'lead-generation', 'Lead generation', 'Finding and qualifying business leads from permitted sources', 13, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'delivery-support', 'Delivery support', 'Packing, sorting and last-mile help', 14, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'photo-video', 'Photography and video', 'Shoots for shops, products and events', 15, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'content-creation', 'Content creation', 'Writing, design and short-form video', 16, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'social-media', 'Social media marketing', 'Managing posts and community for a business', 17, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'tutoring', 'Tutoring and educational tasks', 'Teaching help, evaluation and study material', 18, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'tech-microtasks', 'Technical and IT microtasks', 'Testing, setup and small technical jobs', 19, CURRENT_TIMESTAMP),
  (gen_random_uuid()::text, 'admin-assistance', 'Administrative assistance', 'Office, scheduling and document help', 20, CURRENT_TIMESTAMP);
