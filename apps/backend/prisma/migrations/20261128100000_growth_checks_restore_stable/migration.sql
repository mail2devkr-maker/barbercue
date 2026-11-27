-- Rewrite the Growth AI enum-style CHECKs on varchar columns as flat OR lists.
-- `col IN (...)` on varchar is written back by pg_dump with a different ARRAY cast,
-- which fails the CI backup-and-restore comparison. The allowed values are unchanged.

ALTER TABLE "growth_staff_roles" DROP CONSTRAINT "growth_staff_roles_role_check";
ALTER TABLE "growth_staff_roles" ADD CONSTRAINT "growth_staff_roles_role_check"
  CHECK ("role" = 'ADMIN' OR "role" = 'MARKETING_MANAGER' OR "role" = 'ANALYST' OR "role" = 'READ_ONLY');

ALTER TABLE "growth_keyword_runs" DROP CONSTRAINT "growth_keyword_runs_provider_check";
ALTER TABLE "growth_keyword_runs" ADD CONSTRAINT "growth_keyword_runs_provider_check"
  CHECK ("provider" = 'mock' OR "provider" = 'google_ads');

ALTER TABLE "growth_keyword_runs" DROP CONSTRAINT "growth_keyword_runs_status_check";
ALTER TABLE "growth_keyword_runs" ADD CONSTRAINT "growth_keyword_runs_status_check"
  CHECK ("status" = 'COMPLETED' OR "status" = 'FAILED');

ALTER TABLE "growth_keyword_ideas" DROP CONSTRAINT "growth_keyword_ideas_competition_check";
ALTER TABLE "growth_keyword_ideas" ADD CONSTRAINT "growth_keyword_ideas_competition_check"
  CHECK ("competition" = 'LOW' OR "competition" = 'MEDIUM' OR "competition" = 'HIGH' OR "competition" = 'UNKNOWN');

ALTER TABLE "growth_proposals" DROP CONSTRAINT "growth_proposals_status_check";
ALTER TABLE "growth_proposals" ADD CONSTRAINT "growth_proposals_status_check"
  CHECK ("status" = 'DRAFT' OR "status" = 'REVIEW' OR "status" = 'APPROVED' OR "status" = 'REJECTED' OR "status" = 'ARCHIVED');

ALTER TABLE "growth_proposals" DROP CONSTRAINT "growth_proposals_copy_source_check";
ALTER TABLE "growth_proposals" ADD CONSTRAINT "growth_proposals_copy_source_check"
  CHECK ("adCopySource" IS NULL OR "adCopySource" = 'AI_GENERATED' OR "adCopySource" = 'TEMPLATE');
