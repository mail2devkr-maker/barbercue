-- Part 4 (auto timezone selection).
--   1. City.timezone: per-city IANA zone from the dr5hn import source (already parsed by
--      import-global-locations.ts but previously discarded before this column existed). Nullable
--      and additive only -- no existing row's data is touched by this migration; population is a
--      separate, explicitly-approved backfill run against the source dataset.
--   2. Salon.timezoneAutoDetected / Salon.timezoneManuallyOverridden: provenance flags so a future
--      auto-detect pass can tell an owner's deliberate manual choice apart from a value nobody has
--      ever explicitly confirmed. Every salon that already has a non-null timezone today is
--      backfilled to timezoneManuallyOverridden = true -- it was set by direct DB/seed access or a
--      real owner PATCH before either flag existed, and must be treated as authoritative, never as
--      a candidate for silent auto-overwrite.

-- AlterTable
ALTER TABLE "cities" ADD COLUMN     "timezone" TEXT;

-- AlterTable
ALTER TABLE "salons" ADD COLUMN     "timezoneAutoDetected" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "timezoneManuallyOverridden" BOOLEAN NOT NULL DEFAULT false;

-- Backfill: treat every already-set salon timezone as manually-confirmed/authoritative.
UPDATE "salons" SET "timezoneManuallyOverridden" = true WHERE "timezone" IS NOT NULL;
