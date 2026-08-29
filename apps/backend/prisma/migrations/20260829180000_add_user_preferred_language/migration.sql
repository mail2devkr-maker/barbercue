-- Phase 14 (Localization & Voice Operations): additive only.

-- CreateEnum
CREATE TYPE "Language" AS ENUM ('EN', 'HI');

-- AlterTable
ALTER TABLE "users" ADD COLUMN "preferredLanguage" "Language" NOT NULL DEFAULT 'EN';
