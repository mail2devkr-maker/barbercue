-- Batch 2 (B1-B3): country-scoped cities + per-salon locale.
--
-- Hand-authored, not `prisma migrate dev` output. The generated version contained two operations
-- that were deliberately excluded after review:
--   1. `ALTER TABLE "cities" ADD COLUMN "countryCode" TEXT NOT NULL` with no default and no
--      backfill — this FAILS outright on a non-empty table, and `cities` has rows.
--   2. An unrelated `ALTER COLUMN "publicId" SET DEFAULT (...)` on `salons`, re-asserting a
--      default already present in the database. Same stray-statement class that broke
--      20260814185740_add_booking_selected_style_name; excluded rather than repeated.
--
-- Every statement below is additive or constraint-relaxing. No row is deleted, no column is
-- dropped or retyped. The only UPDATEs populate the new columns from data already present.

-- AlterTable: add nullable first so existing rows survive, backfill, then require.
ALTER TABLE "cities" ADD COLUMN "countryCode" TEXT;
ALTER TABLE "cities" ADD COLUMN "regionCode" TEXT;

-- Backfill from the existing free-text country only. No fallback value is invented: a city whose
-- country is not recognised keeps NULL and the SET NOT NULL below aborts the whole migration,
-- which is the intended outcome — a wrong country code is worse than a failed deploy.
UPDATE "cities" SET "countryCode" = 'IN' WHERE "country" = 'India';

ALTER TABLE "cities" ALTER COLUMN "countryCode" SET NOT NULL;

-- DropIndex / CreateIndex: city slug uniqueness becomes country-scoped, so London/GB and
-- London/CA can coexist. Widening an existing constraint — cannot fail on current data.
DROP INDEX "cities_slug_key";
CREATE UNIQUE INDEX "cities_countryCode_slug_key" ON "cities"("countryCode", "slug");
CREATE INDEX "cities_countryCode_idx" ON "cities"("countryCode");
-- Serves CitiesService's interim findFirst({ slug }) lookup; the composite index above cannot,
-- since `slug` is not its leading column. Removable once B9's country-scoped routes land.
CREATE INDEX "cities_slug_idx" ON "cities"("slug");

-- AlterTable: per-salon locale. Both nullable in this batch — nothing populates them at
-- registration yet (GPS is optional and no timezone lookup is wired), so NOT NULL would break
-- salon registration. AvailabilityService does not read these columns; it still uses its fixed
-- IST offset until that change is separately reviewed.
ALTER TABLE "salons" ADD COLUMN "timezone" TEXT;
ALTER TABLE "salons" ADD COLUMN "currency" TEXT;

-- Backfill existing salons from their actual country. Both values are correct for the current
-- row: it is physically in India, where Asia/Kolkata and INR apply.
UPDATE "salons" SET "timezone" = 'Asia/Kolkata', "currency" = 'INR'
  WHERE "timezone" IS NULL OR "currency" IS NULL;
