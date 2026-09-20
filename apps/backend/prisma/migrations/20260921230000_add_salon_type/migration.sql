-- FastQue onboarding: persist the salon audience used to filter service-pack presets.
CREATE TYPE "SalonType" AS ENUM ('GENTS', 'LADIES', 'UNISEX');

ALTER TABLE "salons"
ADD COLUMN "salonType" "SalonType" NOT NULL DEFAULT 'UNISEX';
