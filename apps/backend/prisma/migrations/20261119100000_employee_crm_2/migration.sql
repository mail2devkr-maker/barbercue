-- FastQue Employee CRM 2.0. Purely additive:
--   * new enum values on "CrmLeadStatus" and "OnboardingMediaCategory" (existing values unchanged)
--   * new enums and tables: crm_lead_import_jobs, crm_lead_activities, crm_tasks, crm_meetings,
--     crm_calls, sales_recordings, sales_recording_analyses, support_tickets,
--     support_ticket_comments, support_ticket_attachments
--   * new nullable/defaulted columns on employee_crm_leads, salon_onboarding_applications and
--     salon_onboarding_media
-- No existing row is rewritten. Rollback: see docs/crm/CRM_2.md ("Rolling back").
-- CreateEnum
CREATE TYPE "CrmLeadPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "CrmTaskType" AS ENUM ('CALL_OWNER', 'SCHEDULE_MEETING', 'COMPLETE_MEETING', 'REVISIT_SALON', 'COMPLETE_ONBOARDING', 'CAPTURE_PHOTOS', 'UPLOAD_MENU', 'VERIFY_GPS', 'PRICING_FOLLOW_UP', 'INSTALL_QR', 'TRAIN_OWNER', 'ACTIVATE_SALON', 'RESOLVE_SUPPORT', 'OTHER');

-- CreateEnum
CREATE TYPE "CrmTaskStatus" AS ENUM ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED', 'BLOCKED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CrmMeetingMode" AS ENUM ('PHYSICAL', 'ONLINE', 'PHONE');

-- CreateEnum
CREATE TYPE "CrmMeetingStatus" AS ENUM ('SCHEDULED', 'CONFIRMED', 'COMPLETED', 'RESCHEDULED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "CrmCallOutcome" AS ENUM ('CONNECTED', 'NO_ANSWER', 'BUSY', 'SWITCHED_OFF', 'INVALID_NUMBER', 'CALLBACK_REQUESTED', 'INTERESTED', 'NOT_INTERESTED', 'MEETING_SCHEDULED', 'OTHER');

-- CreateEnum
CREATE TYPE "SalesRecordingStatus" AS ENUM ('UPLOADED', 'DELETED');

-- CreateEnum
CREATE TYPE "SalesAnalysisStatus" AS ENUM ('NOT_CONFIGURED', 'DISABLED', 'QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "SupportTicketCategory" AS ENUM ('APP_PROBLEM', 'CRM_ISSUE', 'ONBOARDING_ISSUE', 'CAMERA_GPS', 'LEAD_ASSIGNMENT', 'OWNER_DASHBOARD', 'LOGIN_PASSWORD', 'INCORRECT_SALON_INFO', 'OWNER_COMPLAINT', 'PRICING_DISPUTE', 'FIELD_OPERATIONS', 'QR_CODE', 'PAYMENT_SUBSCRIPTION', 'OTHER');

-- CreateEnum
CREATE TYPE "SupportTicketStatus" AS ENUM ('OPEN', 'ASSIGNED', 'IN_PROGRESS', 'WAITING_EMPLOYEE', 'WAITING_SALON', 'RESOLVED', 'CLOSED', 'REOPENED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CrmLeadStatus" ADD VALUE 'ASSIGNED';
ALTER TYPE "CrmLeadStatus" ADD VALUE 'CALL_PENDING';
ALTER TYPE "CrmLeadStatus" ADD VALUE 'CONTACT_ATTEMPTED';
ALTER TYPE "CrmLeadStatus" ADD VALUE 'NO_ANSWER';
ALTER TYPE "CrmLeadStatus" ADD VALUE 'CALLBACK_REQUESTED';
ALTER TYPE "CrmLeadStatus" ADD VALUE 'MEETING_COMPLETED';
ALTER TYPE "CrmLeadStatus" ADD VALUE 'ONBOARDING_STARTED';
ALTER TYPE "CrmLeadStatus" ADD VALUE 'PENDING_APPROVAL';
ALTER TYPE "CrmLeadStatus" ADD VALUE 'APPROVED';
ALTER TYPE "CrmLeadStatus" ADD VALUE 'REJECTED';
ALTER TYPE "CrmLeadStatus" ADD VALUE 'DUPLICATE';
ALTER TYPE "CrmLeadStatus" ADD VALUE 'INVALID_CONTACT';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OnboardingMediaCategory" ADD VALUE 'ENTRANCE';
ALTER TYPE "OnboardingMediaCategory" ADD VALUE 'INTERIOR_LEFT';
ALTER TYPE "OnboardingMediaCategory" ADD VALUE 'INTERIOR_RIGHT';
ALTER TYPE "OnboardingMediaCategory" ADD VALUE 'WASH_STATIONS';
ALTER TYPE "OnboardingMediaCategory" ADD VALUE 'WAITING_AREA';
ALTER TYPE "OnboardingMediaCategory" ADD VALUE 'EQUIPMENT';
ALTER TYPE "OnboardingMediaCategory" ADD VALUE 'RETAIL_DISPLAY';

-- AlterTable
ALTER TABLE "employee_crm_leads" ADD COLUMN     "alternatePhone" VARCHAR(20),
ADD COLUMN     "assignedAt" TIMESTAMP(3),
ADD COLUMN     "assignedByUserId" TEXT,
ADD COLUMN     "businessType" VARCHAR(40),
ADD COLUMN     "chairCount" INTEGER,
ADD COLUMN     "contactAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "createdByUserId" TEXT,
ADD COLUMN     "existingSoftware" VARCHAR(120),
ADD COLUMN     "importJobId" UUID,
ADD COLUMN     "interestLevel" INTEGER,
ADD COLUMN     "lastContactedAt" TIMESTAMP(3),
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION,
ADD COLUMN     "managerName" VARCHAR(120),
ADD COLUMN     "mapsUrl" VARCHAR(500),
ADD COLUMN     "meetingAt" TIMESTAMP(3),
ADD COLUMN     "nextAction" VARCHAR(200),
ADD COLUMN     "nextFollowUpAt" TIMESTAMP(3),
ADD COLUMN     "objections" VARCHAR(1000),
ADD COLUMN     "ownerName" VARCHAR(120),
ADD COLUMN     "postalCode" VARCHAR(12),
ADD COLUMN     "priority" "CrmLeadPriority" NOT NULL DEFAULT 'NORMAL',
ADD COLUMN     "salonSize" VARCHAR(40),
ADD COLUMN     "state" VARCHAR(80),
ADD COLUMN     "territory" VARCHAR(80),
ADD COLUMN     "whatsappPhone" VARCHAR(20);

-- AlterTable
ALTER TABLE "salon_onboarding_applications" ADD COLUMN     "amenities" JSONB,
ADD COLUMN     "consentByName" VARCHAR(120),
ADD COLUMN     "consentByRole" VARCHAR(40),
ADD COLUMN     "consentEvidence" JSONB,
ADD COLUMN     "consentMethod" VARCHAR(30),
ADD COLUMN     "gpsAccuracyMeters" DOUBLE PRECISION,
ADD COLUMN     "gpsCapturedAt" TIMESTAMP(3),
ADD COLUMN     "gpsCapturedById" TEXT,
ADD COLUMN     "inventoryInterest" BOOLEAN,
ADD COLUMN     "locationVerified" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ownerTrainingStatus" VARCHAR(20),
ADD COLUMN     "qrInstallReady" BOOLEAN,
ADD COLUMN     "washStationCount" INTEGER,
ADD COLUMN     "weeklyHolidays" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "salon_onboarding_media" ADD COLUMN     "captureAccuracy" DOUBLE PRECISION,
ADD COLUMN     "captureLatitude" DOUBLE PRECISION,
ADD COLUMN     "captureLongitude" DOUBLE PRECISION,
ADD COLUMN     "capturedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "crm_lead_import_jobs" (
    "id" UUID NOT NULL,
    "uploadedByUserId" TEXT NOT NULL,
    "fileName" VARCHAR(255) NOT NULL,
    "fileSha256" VARCHAR(64) NOT NULL,
    "status" VARCHAR(20) NOT NULL DEFAULT 'PREVIEWED',
    "columnMapping" JSONB,
    "parsedRows" JSONB,
    "issues" JSONB,
    "defaultEmployeeProfileId" TEXT,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(6),

    CONSTRAINT "crm_lead_import_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_lead_activities" (
    "id" UUID NOT NULL,
    "leadId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "type" VARCHAR(40) NOT NULL,
    "summary" VARCHAR(500) NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_lead_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_tasks" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "subject" VARCHAR(200) NOT NULL,
    "description" VARCHAR(2000),
    "type" "CrmTaskType" NOT NULL DEFAULT 'OTHER',
    "priority" "CrmLeadPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "CrmTaskStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "leadId" TEXT,
    "onboardingApplicationId" TEXT,
    "assigneeEmployeeId" TEXT NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "dueAt" TIMESTAMPTZ(6),
    "completedAt" TIMESTAMPTZ(6),
    "blockedReason" VARCHAR(300),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "crm_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_meetings" (
    "id" UUID NOT NULL,
    "leadId" TEXT NOT NULL,
    "employeeProfileId" TEXT NOT NULL,
    "contactName" VARCHAR(120),
    "contactPhone" VARCHAR(20),
    "startsAt" TIMESTAMPTZ(6) NOT NULL,
    "endsAt" TIMESTAMPTZ(6),
    "mode" "CrmMeetingMode" NOT NULL DEFAULT 'PHYSICAL',
    "location" VARCHAR(300),
    "purpose" VARCHAR(200),
    "agenda" VARCHAR(1000),
    "status" "CrmMeetingStatus" NOT NULL DEFAULT 'SCHEDULED',
    "outcome" VARCHAR(1000),
    "notes" VARCHAR(2000),
    "nextAction" VARCHAR(200),
    "followUpAt" TIMESTAMPTZ(6),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "crm_meetings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_calls" (
    "id" UUID NOT NULL,
    "leadId" TEXT NOT NULL,
    "employeeProfileId" TEXT NOT NULL,
    "scheduledAt" TIMESTAMPTZ(6),
    "calledAt" TIMESTAMPTZ(6),
    "outcome" "CrmCallOutcome",
    "durationSeconds" INTEGER,
    "notes" VARCHAR(2000),
    "nextCallbackAt" TIMESTAMPTZ(6),
    "interestLevel" INTEGER,
    "nextAction" VARCHAR(200),
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "crm_calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_recordings" (
    "id" UUID NOT NULL,
    "leadId" TEXT NOT NULL,
    "meetingId" UUID,
    "employeeProfileId" TEXT NOT NULL,
    "storageKey" VARCHAR(300),
    "mimeType" VARCHAR(60) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" VARCHAR(64) NOT NULL,
    "durationSeconds" INTEGER NOT NULL,
    "language" VARCHAR(16) NOT NULL DEFAULT 'hi-IN',
    "consentGiven" BOOLEAN NOT NULL,
    "consentMethod" VARCHAR(30) NOT NULL,
    "consentStatement" VARCHAR(1000) NOT NULL,
    "consentAt" TIMESTAMPTZ(6) NOT NULL,
    "participants" VARCHAR(300),
    "status" "SalesRecordingStatus" NOT NULL DEFAULT 'UPLOADED',
    "analysisStatus" "SalesAnalysisStatus" NOT NULL DEFAULT 'NOT_CONFIGURED',
    "retentionUntil" TIMESTAMPTZ(6),
    "deletedAt" TIMESTAMPTZ(6),
    "deletedByUserId" TEXT,
    "submissionKey" VARCHAR(80) NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sales_recordings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sales_recording_analyses" (
    "id" UUID NOT NULL,
    "recordingId" UUID NOT NULL,
    "provider" VARCHAR(40) NOT NULL,
    "model" VARCHAR(80),
    "status" "SalesAnalysisStatus" NOT NULL,
    "transcript" TEXT,
    "report" JSONB,
    "overallScore" INTEGER,
    "errorMessage" VARCHAR(500),
    "estimatedCostUsd" DECIMAL(10,4),
    "reviewedByUserId" TEXT,
    "reviewerNotes" VARCHAR(2000),
    "correctedScore" INTEGER,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(6),

    CONSTRAINT "sales_recording_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_tickets" (
    "id" UUID NOT NULL,
    "number" SERIAL NOT NULL,
    "createdByUserId" TEXT NOT NULL,
    "leadId" TEXT,
    "salonId" TEXT,
    "category" "SupportTicketCategory" NOT NULL,
    "subject" VARCHAR(200) NOT NULL,
    "description" VARCHAR(5000) NOT NULL,
    "priority" "CrmLeadPriority" NOT NULL DEFAULT 'NORMAL',
    "status" "SupportTicketStatus" NOT NULL DEFAULT 'OPEN',
    "assignedToUserId" TEXT,
    "slaDueAt" TIMESTAMPTZ(6) NOT NULL,
    "firstResponseAt" TIMESTAMPTZ(6),
    "escalatedAt" TIMESTAMPTZ(6),
    "resolutionNotes" VARCHAR(2000),
    "resolvedAt" TIMESTAMPTZ(6),
    "closedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "support_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_ticket_comments" (
    "id" UUID NOT NULL,
    "ticketId" UUID NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "body" VARCHAR(5000) NOT NULL,
    "internal" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_ticket_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "support_ticket_attachments" (
    "id" UUID NOT NULL,
    "ticketId" UUID NOT NULL,
    "storageKey" VARCHAR(300) NOT NULL,
    "mimeType" VARCHAR(60) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "support_ticket_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "crm_lead_import_jobs_createdAt_idx" ON "crm_lead_import_jobs"("createdAt");

-- CreateIndex
CREATE INDEX "crm_lead_import_jobs_fileSha256_idx" ON "crm_lead_import_jobs"("fileSha256");

-- CreateIndex
CREATE INDEX "crm_lead_activities_leadId_createdAt_idx" ON "crm_lead_activities"("leadId", "createdAt");

-- CreateIndex
CREATE INDEX "crm_lead_activities_type_createdAt_idx" ON "crm_lead_activities"("type", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "crm_tasks_number_key" ON "crm_tasks"("number");

-- CreateIndex
CREATE INDEX "crm_tasks_assigneeEmployeeId_status_dueAt_idx" ON "crm_tasks"("assigneeEmployeeId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "crm_tasks_leadId_idx" ON "crm_tasks"("leadId");

-- CreateIndex
CREATE INDEX "crm_tasks_status_dueAt_idx" ON "crm_tasks"("status", "dueAt");

-- CreateIndex
CREATE INDEX "crm_meetings_employeeProfileId_startsAt_idx" ON "crm_meetings"("employeeProfileId", "startsAt");

-- CreateIndex
CREATE INDEX "crm_meetings_leadId_startsAt_idx" ON "crm_meetings"("leadId", "startsAt");

-- CreateIndex
CREATE INDEX "crm_meetings_status_startsAt_idx" ON "crm_meetings"("status", "startsAt");

-- CreateIndex
CREATE INDEX "crm_calls_employeeProfileId_scheduledAt_idx" ON "crm_calls"("employeeProfileId", "scheduledAt");

-- CreateIndex
CREATE INDEX "crm_calls_employeeProfileId_calledAt_idx" ON "crm_calls"("employeeProfileId", "calledAt");

-- CreateIndex
CREATE INDEX "crm_calls_leadId_createdAt_idx" ON "crm_calls"("leadId", "createdAt");

-- CreateIndex
CREATE INDEX "sales_recordings_leadId_createdAt_idx" ON "sales_recordings"("leadId", "createdAt");

-- CreateIndex
CREATE INDEX "sales_recordings_employeeProfileId_createdAt_idx" ON "sales_recordings"("employeeProfileId", "createdAt");

-- CreateIndex
CREATE INDEX "sales_recordings_analysisStatus_idx" ON "sales_recordings"("analysisStatus");

-- CreateIndex
CREATE UNIQUE INDEX "sales_recordings_employeeProfileId_submissionKey_key" ON "sales_recordings"("employeeProfileId", "submissionKey");

-- CreateIndex
CREATE INDEX "sales_recording_analyses_recordingId_createdAt_idx" ON "sales_recording_analyses"("recordingId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "support_tickets_number_key" ON "support_tickets"("number");

-- CreateIndex
CREATE INDEX "support_tickets_createdByUserId_createdAt_idx" ON "support_tickets"("createdByUserId", "createdAt");

-- CreateIndex
CREATE INDEX "support_tickets_status_slaDueAt_idx" ON "support_tickets"("status", "slaDueAt");

-- CreateIndex
CREATE INDEX "support_tickets_assignedToUserId_status_idx" ON "support_tickets"("assignedToUserId", "status");

-- CreateIndex
CREATE INDEX "support_ticket_comments_ticketId_createdAt_idx" ON "support_ticket_comments"("ticketId", "createdAt");

-- CreateIndex
CREATE INDEX "support_ticket_attachments_ticketId_idx" ON "support_ticket_attachments"("ticketId");

-- CreateIndex
CREATE INDEX "employee_crm_leads_status_updatedAt_idx" ON "employee_crm_leads"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "employee_crm_leads_territory_status_idx" ON "employee_crm_leads"("territory", "status");

-- CreateIndex
CREATE INDEX "employee_crm_leads_city_idx" ON "employee_crm_leads"("city");

-- CreateIndex
CREATE INDEX "employee_crm_leads_nextFollowUpAt_idx" ON "employee_crm_leads"("nextFollowUpAt");

-- CreateIndex
CREATE INDEX "employee_crm_leads_importJobId_idx" ON "employee_crm_leads"("importJobId");

-- AddForeignKey
ALTER TABLE "employee_crm_leads" ADD CONSTRAINT "employee_crm_leads_importJobId_fkey" FOREIGN KEY ("importJobId") REFERENCES "crm_lead_import_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_lead_import_jobs" ADD CONSTRAINT "crm_lead_import_jobs_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_lead_activities" ADD CONSTRAINT "crm_lead_activities_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "employee_crm_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_lead_activities" ADD CONSTRAINT "crm_lead_activities_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_tasks" ADD CONSTRAINT "crm_tasks_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "employee_crm_leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_tasks" ADD CONSTRAINT "crm_tasks_assigneeEmployeeId_fkey" FOREIGN KEY ("assigneeEmployeeId") REFERENCES "employee_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_tasks" ADD CONSTRAINT "crm_tasks_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_meetings" ADD CONSTRAINT "crm_meetings_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "employee_crm_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_meetings" ADD CONSTRAINT "crm_meetings_employeeProfileId_fkey" FOREIGN KEY ("employeeProfileId") REFERENCES "employee_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_calls" ADD CONSTRAINT "crm_calls_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "employee_crm_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_calls" ADD CONSTRAINT "crm_calls_employeeProfileId_fkey" FOREIGN KEY ("employeeProfileId") REFERENCES "employee_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_recordings" ADD CONSTRAINT "sales_recordings_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "employee_crm_leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_recordings" ADD CONSTRAINT "sales_recordings_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "crm_meetings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_recordings" ADD CONSTRAINT "sales_recordings_employeeProfileId_fkey" FOREIGN KEY ("employeeProfileId") REFERENCES "employee_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sales_recording_analyses" ADD CONSTRAINT "sales_recording_analyses_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "sales_recordings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "employee_crm_leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_ticket_comments" ADD CONSTRAINT "support_ticket_comments_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_ticket_comments" ADD CONSTRAINT "support_ticket_comments_authorUserId_fkey" FOREIGN KEY ("authorUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "support_ticket_attachments" ADD CONSTRAINT "support_ticket_attachments_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "support_tickets"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Sanity rules the database enforces.
ALTER TABLE "employee_crm_leads" ADD CONSTRAINT "employee_crm_leads_interest_check" CHECK ("interestLevel" IS NULL OR "interestLevel" BETWEEN 1 AND 5);
ALTER TABLE "employee_crm_leads" ADD CONSTRAINT "employee_crm_leads_attempts_check" CHECK ("contactAttempts" >= 0);
ALTER TABLE "crm_calls" ADD CONSTRAINT "crm_calls_duration_check" CHECK ("durationSeconds" IS NULL OR "durationSeconds" >= 0);
ALTER TABLE "crm_calls" ADD CONSTRAINT "crm_calls_interest_check" CHECK ("interestLevel" IS NULL OR "interestLevel" BETWEEN 1 AND 5);
ALTER TABLE "crm_meetings" ADD CONSTRAINT "crm_meetings_time_check" CHECK ("endsAt" IS NULL OR "endsAt" >= "startsAt");
-- A recording can only exist with consent given.
ALTER TABLE "sales_recordings" ADD CONSTRAINT "sales_recordings_consent_check" CHECK ("consentGiven" = true);
ALTER TABLE "sales_recordings" ADD CONSTRAINT "sales_recordings_size_check" CHECK ("sizeBytes" > 0 AND "durationSeconds" > 0);
