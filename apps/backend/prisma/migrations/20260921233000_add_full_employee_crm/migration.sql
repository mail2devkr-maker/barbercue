-- FastQue internal field CRM: employee leads, field visits, follow-ups and shop attribution.

CREATE TYPE "CrmLeadStatus" AS ENUM (
  'NEW',
  'CONTACTED',
  'INTERESTED',
  'DEMO_SCHEDULED',
  'FOLLOW_UP',
  'ONBOARDED',
  'LOST'
);

CREATE TYPE "CrmLeadSource" AS ENUM (
  'FIELD_VISIT',
  'REFERRAL',
  'COLD_CALL',
  'WHATSAPP',
  'SOCIAL_MEDIA',
  'INBOUND',
  'OTHER'
);

CREATE TYPE "CrmVisitOutcome" AS ENUM (
  'CONTACTED',
  'INTERESTED',
  'DEMO_COMPLETED',
  'FOLLOW_UP_REQUIRED',
  'NOT_INTERESTED',
  'ONBOARDING_ASSISTED',
  'OTHER'
);

CREATE TYPE "CrmFollowUpChannel" AS ENUM (
  'CALL',
  'WHATSAPP',
  'VISIT',
  'EMAIL',
  'OTHER'
);

CREATE TYPE "CrmFollowUpStatus" AS ENUM (
  'OPEN',
  'COMPLETED',
  'CANCELLED'
);

CREATE TABLE "employee_crm_leads" (
  "id" TEXT NOT NULL,
  "employeeProfileId" TEXT NOT NULL,
  "shopName" TEXT NOT NULL,
  "contactName" TEXT,
  "phone" TEXT,
  "email" TEXT,
  "city" TEXT,
  "locality" TEXT,
  "addressLine" TEXT,
  "source" "CrmLeadSource" NOT NULL DEFAULT 'FIELD_VISIT',
  "status" "CrmLeadStatus" NOT NULL DEFAULT 'NEW',
  "notes" TEXT,
  "lostReason" TEXT,
  "onboardedSalonId" TEXT,
  "onboardedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "employee_crm_leads_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "employee_crm_visits" (
  "id" TEXT NOT NULL,
  "employeeProfileId" TEXT NOT NULL,
  "leadId" TEXT,
  "shopName" TEXT NOT NULL,
  "visitedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "outcome" "CrmVisitOutcome" NOT NULL,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "employee_crm_visits_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "employee_crm_follow_ups" (
  "id" TEXT NOT NULL,
  "employeeProfileId" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "dueAt" TIMESTAMP(3) NOT NULL,
  "channel" "CrmFollowUpChannel" NOT NULL,
  "status" "CrmFollowUpStatus" NOT NULL DEFAULT 'OPEN',
  "notes" TEXT,
  "outcome" TEXT,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "employee_crm_follow_ups_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "employee_crm_leads_onboardedSalonId_key"
ON "employee_crm_leads"("onboardedSalonId");

CREATE INDEX "employee_crm_leads_employeeProfileId_status_idx"
ON "employee_crm_leads"("employeeProfileId", "status");

CREATE INDEX "employee_crm_leads_employeeProfileId_createdAt_idx"
ON "employee_crm_leads"("employeeProfileId", "createdAt");

CREATE INDEX "employee_crm_leads_phone_idx"
ON "employee_crm_leads"("phone");

CREATE INDEX "employee_crm_leads_email_idx"
ON "employee_crm_leads"("email");

CREATE INDEX "employee_crm_visits_employeeProfileId_visitedAt_idx"
ON "employee_crm_visits"("employeeProfileId", "visitedAt");

CREATE INDEX "employee_crm_visits_leadId_visitedAt_idx"
ON "employee_crm_visits"("leadId", "visitedAt");

CREATE INDEX "employee_crm_follow_ups_employeeProfileId_status_dueAt_idx"
ON "employee_crm_follow_ups"("employeeProfileId", "status", "dueAt");

CREATE INDEX "employee_crm_follow_ups_leadId_dueAt_idx"
ON "employee_crm_follow_ups"("leadId", "dueAt");

ALTER TABLE "employee_crm_leads"
ADD CONSTRAINT "employee_crm_leads_employeeProfileId_fkey"
FOREIGN KEY ("employeeProfileId") REFERENCES "employee_profiles"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "employee_crm_leads"
ADD CONSTRAINT "employee_crm_leads_onboardedSalonId_fkey"
FOREIGN KEY ("onboardedSalonId") REFERENCES "salons"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "employee_crm_visits"
ADD CONSTRAINT "employee_crm_visits_employeeProfileId_fkey"
FOREIGN KEY ("employeeProfileId") REFERENCES "employee_profiles"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "employee_crm_visits"
ADD CONSTRAINT "employee_crm_visits_leadId_fkey"
FOREIGN KEY ("leadId") REFERENCES "employee_crm_leads"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "employee_crm_follow_ups"
ADD CONSTRAINT "employee_crm_follow_ups_employeeProfileId_fkey"
FOREIGN KEY ("employeeProfileId") REFERENCES "employee_profiles"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "employee_crm_follow_ups"
ADD CONSTRAINT "employee_crm_follow_ups_leadId_fkey"
FOREIGN KEY ("leadId") REFERENCES "employee_crm_leads"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
