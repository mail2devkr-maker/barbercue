-- Junior admin add-on role for FastQue Work review decisions (KYC, worker verify, job moderation).
-- Additive only: no existing row changes.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'WORK_REVIEWER';
