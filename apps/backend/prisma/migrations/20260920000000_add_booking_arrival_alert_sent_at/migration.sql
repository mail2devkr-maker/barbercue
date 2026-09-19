-- P0 arrival-alert mission: additive only, same shape as reminderSentAt.

-- AlterTable
ALTER TABLE "bookings" ADD COLUMN "arrivalAlertSentAt" TIMESTAMP(3);
