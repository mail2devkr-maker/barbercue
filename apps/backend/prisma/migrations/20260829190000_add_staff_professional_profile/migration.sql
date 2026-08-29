-- Phase 17 (Barber Professional Profile): additive only.

-- AlterTable
ALTER TABLE "salon_staff" ADD COLUMN     "bio" TEXT,
ADD COLUMN     "photoUrl" TEXT,
ADD COLUMN     "yearsExperience" INTEGER;
