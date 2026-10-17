-- Three-photo requirement for the first public activation of a new shop.
--
-- NULL is intentionally retained for every pre-existing row. Application logic interprets an
-- existing ACTIVE/SUSPENDED shop with NULL as grandfathered. New PENDING shops do not receive the
-- grandfathering exception, and successful first activation writes TRUE. This avoids a table-wide
-- data update/backfill and keeps the migration additive and compatible with the previous backend.
ALTER TABLE "salons"
  ADD COLUMN "shopPhotoRequirementGrandfathered" BOOLEAN;
