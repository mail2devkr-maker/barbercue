-- FastQue CRM foundation: field-executive identity and dedicated session audience.
-- Additive only. No existing user, role, session, salon or operational row is rewritten.

ALTER TYPE "Role" ADD VALUE 'FIELD_EXECUTIVE';
ALTER TYPE "SessionAudience" ADD VALUE 'EMPLOYEE';

CREATE TABLE "employee_profiles" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "employeeCode" TEXT NOT NULL,
  "fullName" TEXT NOT NULL,
  "territory" TEXT,
  "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "employee_profiles_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "employee_profiles_userId_key" ON "employee_profiles"("userId");
CREATE UNIQUE INDEX "employee_profiles_employeeCode_key" ON "employee_profiles"("employeeCode");

ALTER TABLE "employee_profiles"
  ADD CONSTRAINT "employee_profiles_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;
