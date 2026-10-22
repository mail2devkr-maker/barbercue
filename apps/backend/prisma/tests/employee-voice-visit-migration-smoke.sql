-- Disposable PostgreSQL smoke test for the two committed employee voice visit migrations.
-- The fixture tables are deliberately minimal and are created only in the CI job's fresh DB.
CREATE TABLE "employee_profiles" (
  "id" TEXT NOT NULL,
  CONSTRAINT "employee_profiles_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "employee_crm_leads" (
  "id" TEXT NOT NULL,
  "employeeProfileId" TEXT NOT NULL,
  CONSTRAINT "employee_crm_leads_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "employee_crm_leads_employeeProfileId_fkey"
    FOREIGN KEY ("employeeProfileId") REFERENCES "employee_profiles"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

\ir ../migrations/20261013143000_employee_voice_visit_logs/migration.sql
\ir ../migrations/20261013160000_employee_voice_visit_draft_lifecycle/migration.sql

INSERT INTO "employee_profiles" ("id") VALUES ('employee-a'), ('employee-b');
INSERT INTO "employee_crm_leads" ("id", "employeeProfileId")
VALUES ('lead-a', 'employee-a'), ('lead-b', 'employee-b');

INSERT INTO "employee_voice_visit_logs"
  ("id", "employeeProfileId", "leadId", "transcript", "structuredDraft", "submissionKey", "updatedAt")
VALUES
  ('log-a', 'employee-a', 'lead-a', 'Salon. Haircut 100.', '{}'::jsonb,
   'e7d76876-8133-4760-957d-2d7d720b99c6', CURRENT_TIMESTAMP);

DO $$
BEGIN
  IF (SELECT "status" FROM "employee_voice_visit_logs" WHERE "id" = 'log-a') <> 'DRAFT' THEN
    RAISE EXCEPTION 'Existing voice rows must default to DRAFT';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'employee_voice_visit_logs_status_check'
  ) THEN
    RAISE EXCEPTION 'Draft lifecycle status constraint is missing';
  END IF;
  IF to_regclass('"employee_voice_visit_logs_employeeProfileId_submissionKey_key"') IS NULL THEN
    RAISE EXCEPTION 'Submission idempotency unique index is missing';
  END IF;

  BEGIN
    INSERT INTO "employee_voice_visit_logs"
      ("id", "employeeProfileId", "leadId", "transcript", "structuredDraft", "submissionKey", "updatedAt")
    VALUES ('log-duplicate', 'employee-a', 'lead-a', 'duplicate', '{}'::jsonb,
      'e7d76876-8133-4760-957d-2d7d720b99c6', CURRENT_TIMESTAMP);
    RAISE EXCEPTION 'Duplicate submission key unexpectedly succeeded';
  EXCEPTION WHEN unique_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO "employee_voice_visit_logs"
      ("id", "employeeProfileId", "leadId", "transcript", "structuredDraft", "updatedAt")
    VALUES ('log-cross-owner', 'employee-a', 'lead-b', 'cross owner', '{}'::jsonb, CURRENT_TIMESTAMP);
    RAISE EXCEPTION 'Cross-employee lead association unexpectedly succeeded';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;

  BEGIN
    INSERT INTO "employee_voice_visit_logs"
      ("id", "employeeProfileId", "leadId", "transcript", "structuredDraft", "status", "updatedAt")
    VALUES ('log-invalid-status', 'employee-a', 'lead-a', 'invalid', '{}'::jsonb, 'PUBLISHED', CURRENT_TIMESTAMP);
    RAISE EXCEPTION 'Invalid lifecycle status unexpectedly succeeded';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;
END
$$;
