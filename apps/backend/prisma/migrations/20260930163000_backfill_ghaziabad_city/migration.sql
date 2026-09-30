-- Production data repair: ensure Ghaziabad, Uttar Pradesh is selectable in FastQue onboarding.
--
-- Root cause verified on 2026-09-30:
--   the production cities table has no Ghaziabad row at all, while the India country and
--   Uttar Pradesh region master rows are present and healthy. The application city-search
--   fallback is already deployed; without a city row, no UI/search change can surface it.
--
-- This migration is idempotent. It creates the row when missing and repairs country/region
-- linkage on an existing Ghaziabad row. It deliberately does not invent source-dataset IDs
-- or coordinates that were not verified from the production import source.

DO $$
DECLARE
  india_country_id TEXT;
  up_region_id TEXT;
  existing_city_id TEXT;
BEGIN
  SELECT c.id
    INTO india_country_id
  FROM "Country" c
  WHERE c."isoCode2" = 'IN'
  LIMIT 1;

  IF india_country_id IS NULL THEN
    RAISE EXCEPTION 'FastQue Ghaziabad repair aborted: India country master row not found';
  END IF;

  SELECT r.id
    INTO up_region_id
  FROM "Region" r
  WHERE r."countryId" = india_country_id
    AND (r.code = 'IN-UP' OR lower(r.name) = 'uttar pradesh')
  ORDER BY CASE WHEN r.code = 'IN-UP' THEN 0 ELSE 1 END, r.id
  LIMIT 1;

  IF up_region_id IS NULL THEN
    RAISE EXCEPTION 'FastQue Ghaziabad repair aborted: Uttar Pradesh region master row not found';
  END IF;

  SELECT c.id
    INTO existing_city_id
  FROM "cities" c
  WHERE c."countryCode" = 'IN'
    AND (lower(c.name) = 'ghaziabad' OR c.slug = 'ghaziabad')
  ORDER BY CASE WHEN c.slug = 'ghaziabad' THEN 0 ELSE 1 END, c.id
  LIMIT 1;

  IF existing_city_id IS NOT NULL THEN
    UPDATE "cities"
    SET
      name = 'Ghaziabad',
      slug = 'ghaziabad',
      "countryCode" = 'IN',
      "regionCode" = 'IN-UP',
      state = 'Uttar Pradesh',
      country = 'India',
      "countryId" = india_country_id,
      "regionId" = up_region_id,
      timezone = COALESCE(timezone, 'Asia/Kolkata')
    WHERE id = existing_city_id;
  ELSE
    INSERT INTO "cities" (
      id,
      name,
      slug,
      "countryCode",
      "regionCode",
      state,
      country,
      "countryId",
      "regionId",
      timezone
    )
    VALUES (
      '7f62a911-71d2-4c97-a9f4-092026093001',
      'Ghaziabad',
      'ghaziabad',
      'IN',
      'IN-UP',
      'Uttar Pradesh',
      'India',
      india_country_id,
      up_region_id,
      'Asia/Kolkata'
    )
    ON CONFLICT ("countryCode", slug) DO NOTHING;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM "cities" c
    WHERE c."countryCode" = 'IN'
      AND c.slug = 'ghaziabad'
      AND c."countryId" = india_country_id
      AND c."regionId" = up_region_id
      AND c."regionCode" = 'IN-UP'
  ) THEN
    RAISE EXCEPTION 'FastQue Ghaziabad repair failed: expected linked Ghaziabad row not present';
  END IF;
END $$;
