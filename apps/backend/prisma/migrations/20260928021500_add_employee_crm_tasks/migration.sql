-- FastQue internal CRM: assignable employee tasks with priority, due date and completion evidence.

CREATE TYPE "CrmTaskStatus" AS ENUM (
  'TODO',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED'
);

CREATE TYPE "CrmTaskPriority" AS ENUM (
  'LOW',
  'MEDIUM',
  'HIGH',
  'URGENT'
);

CREATE TABLE "employee_crm_tasks" (
  "id" TEXT NOT NULL,
  "employeeProfileId" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "dueAt" TIMESTAMP(3),
  "priority" "CrmTaskPriority" NOT NULL DEFAULT 'MEDIUM',
  "status" "CrmTaskStatus" NOT NULL DEFAULT 'TODO',
  "completedAt" TIMESTAMP(3),
  "completionNotes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "employee_crm_tasks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "employee_crm_tasks_employeeProfileId_status_dueAt_idx"
ON "employee_crm_tasks"("employeeProfileId", "status", "dueAt");

CREATE INDEX "employee_crm_tasks_status_dueAt_idx"
ON "employee_crm_tasks"("status", "dueAt");

ALTER TABLE "employee_crm_tasks"
ADD CONSTRAINT "employee_crm_tasks_employeeProfileId_fkey"
FOREIGN KEY ("employeeProfileId") REFERENCES "employee_profiles"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
