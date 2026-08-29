-- Phase 12 (Appointment Reminders): additive only.

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN "reminderSentAt" TIMESTAMP(3);
