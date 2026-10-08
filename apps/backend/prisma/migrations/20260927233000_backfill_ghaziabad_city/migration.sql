-- Production data repair: ensure Ghaziabad, Uttar Pradesh is selectable in shop onboarding.
--
-- Root cause verified against the current production city master: Ghaziabad is absent entirely,
-- so the country-scoped city typeahead cannot return it. This migration is intentionally
-- idempotent: if an IN/ghaziabad row already exists by the time it runs, it only backfills
-- nullable normalized location links/metadata and never rewrites the protected identity fields.
--
-- The INSERT/UPDATE shape was verified on a Neon temporary branch against the current production
-- schema and search query before this migration was added to source control.

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
SELECT
  'f1e2dabd-ac72-4a63-9d17-5f148795ea2b',
  'Ghaziabad',
  'ghaziabad',
  'IN',
  'IN-UP',
  'Uttar Pradesh',
  'India',
  c.id,
  r.id,
  'Asia/Kolkata'
FROM "Country" c
JOIN "Region" r
  ON r."countryId" = c.id
 AND (r.code = 'IN-UP' OR lower(r.name) = 'uttar pradesh')
WHERE c."isoCode2" = 'IN'
ORDER BY CASE WHEN r.code = 'IN-UP' THEN 0 ELSE 1 END, r.id
LIMIT 1
ON CONFLICT ("countryCode", slug) DO UPDATE
SET
  "countryId" = COALESCE("cities"."countryId", EXCLUDED."countryId"),
  "regionId" = COALESCE("cities"."regionId", EXCLUDED."regionId"),
  "regionCode" = COALESCE("cities"."regionCode", EXCLUDED."regionCode"),
  state = CASE WHEN "cities".state = '' THEN EXCLUDED.state ELSE "cities".state END,
  country = CASE WHEN "cities".country = '' THEN EXCLUDED.country ELSE "cities".country END,
  timezone = COALESCE("cities".timezone, EXCLUDED.timezone);
