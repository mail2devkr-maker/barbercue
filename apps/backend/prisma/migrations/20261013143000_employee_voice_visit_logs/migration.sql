-- Additive, employee-owned field visit dictation log. Never writes approved shop catalog.
CREATE TABLE "employee_voice_visit_logs" (
  "id" TEXT NOT NULL,
  "employeeProfileId" TEXT NOT NULL,
  "leadId" TEXT NOT NULL,
  "transcript" TEXT NOT NULL,
  "structuredDraft" JSONB NOT NULL,
  "language" VARCHAR(16) NOT NULL DEFAULT 'hi-IN',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "employee_voice_visit_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "employee_voice_visit_logs_employeeProfileId_leadId_createdAt_idx" ON "employee_voice_visit_logs"("employeeProfileId", "leadId", "createdAt");
ALTER TABLE "employee_voice_visit_logs" ADD CONSTRAINT "employee_voice_visit_logs_employeeProfileId_fkey" FOREIGN KEY ("employeeProfileId") REFERENCES "employee_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "employee_voice_visit_logs" ADD CONSTRAINT "employee_voice_visit_logs_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "employee_crm_leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
