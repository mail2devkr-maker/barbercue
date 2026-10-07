-- FastQue internal CRM/admin RBAC.
-- PLATFORM_ADMIN remains the only Super Admin role. The new roles are operational and must
-- always be global (salonId IS NULL), exactly like PLATFORM_ADMIN / PLATFORM_VIEWER.

ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'CO_FOUNDER';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'HR_ADMIN';
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'SALES_ADMIN';

ALTER TABLE "user_roles" DROP CONSTRAINT IF EXISTS "platform_admin_must_be_global";
ALTER TABLE "user_roles" ADD CONSTRAINT "platform_admin_roles_must_be_global"
CHECK (
  "role" NOT IN ('PLATFORM_ADMIN', 'CO_FOUNDER', 'HR_ADMIN', 'SALES_ADMIN', 'PLATFORM_VIEWER')
  OR "salonId" IS NULL
);
