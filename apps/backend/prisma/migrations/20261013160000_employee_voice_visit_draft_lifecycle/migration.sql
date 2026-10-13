-- Extend the field-visit notes additively; previously saved notes become resumable drafts.
BEGIN;

ALTER TABLE "employee_crm_leads"
  ADD CONSTRAINT "employee_crm_leads_id_employeeProfileId_key"
  UNIQUE ("id", "employeeProfileId");

ALTER TABLE "employee_voice_visit_logs"
  DROP CONSTRAINT "employee_voice_visit_logs_leadId_fkey";

ALTER TABLE "employee_voice_visit_logs"
  ADD COLUMN "status" VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN "submissionKey" VARCHAR(80),
  ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "confirmedAt" TIMESTAMP(3);

DROP INDEX "employee_voice_visit_logs_employeeProfileId_leadId_createdAt_idx";

ALTER TABLE "employee_voice_visit_logs"
  ADD CONSTRAINT "employee_voice_visit_logs_status_check"
  CHECK ("status" IN ('DRAFT', 'CONFIRMED'));

ALTER TABLE "employee_voice_visit_logs"
  ADD CONSTRAINT "employee_voice_visit_logs_leadId_employeeProfileId_fkey"
  FOREIGN KEY ("leadId", "employeeProfileId")
  REFERENCES "employee_crm_leads"("id", "employeeProfileId")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "employee_voice_visit_logs_employeeProfileId_submissionKey_key"
  ON "employee_voice_visit_logs"("employeeProfileId", "submissionKey");

CREATE INDEX "employee_voice_visit_logs_employeeProfileId_leadId_status_createdAt_id_idx"
  ON "employee_voice_visit_logs"("employeeProfileId", "leadId", "status", "createdAt", "id");

COMMIT;
