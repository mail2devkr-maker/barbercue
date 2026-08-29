-- Phase 11 (Notification Center): additive only, no existing column touched or dropped.

-- AlterEnum
ALTER TYPE "NotificationChannel" ADD VALUE 'IN_APP';

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN "readAt" TIMESTAMP(3);
ALTER TABLE "notifications" ADD COLUMN "deepLink" TEXT;
