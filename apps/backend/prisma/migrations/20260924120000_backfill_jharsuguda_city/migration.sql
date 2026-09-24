-- Production data repair: ensure Jharsuguda, Odisha is selectable in city typeahead/onboarding.
--
-- Why this is needed:
--   City search is country-scoped by Country.id. A manually-added/legacy City row can still be a
--   perfectly valid salon city while its newer nullable countryId/regionId enrichment fields are
--   NULL. Such a row is reachable by the legacy countryCode/slug registration contract but was
--   invisible to the newer typeahead. The application fix in this change makes search resilient
--   to that class of legacy row; this migration also repairs/creates the known Jharsuguda row so
--   the city is available even if the bulk global-location import never inserted it.
--
-- Source identity/coordinates:
--   dr5hn countries-states-cities-database v3.2-export.7, source city id 132269.
-- Protected identity fields on an existing row (id/name/slug/countryCode) are never rewritten.

DO $$
DECLARE
  india_country_id TEXT;
  odisha_region_id TEXT;
  existing_city_id TEXT;
BEGIN
  SELECT c.id
    INTO india_country_id
  FROM "Country" c
  WHERE c."isoCode2" = 'IN'
  LIMIT 1;

  SELECT r.id
    INTO odisha_region_id
  FROM "Region" r
  WHERE r."countryId" = india_country_id
    AND (r.code = 'IN-OR' OR lower(r.name) = 'odisha')
  ORDER BY CASE WHEN r.code = 'IN-OR' THEN 0 ELSE 1 END, r.id
  LIMIT 1;

  SELECT c.id
    INTO existing_city_id
  FROM "cities" c
  WHERE c."countryCode" = 'IN'
    AND lower(c.name) = 'jharsuguda'
  ORDER BY CASE WHEN c.slug = 'jharsuguda' THEN 0 ELSE 1 END, c.id
  LIMIT 1;

  IF existing_city_id IS NOT NULL THEN
    UPDATE "cities"
    SET
      "countryId" = COALESCE("countryId", india_country_id),
      "regionId" = COALESCE("regionId", odisha_region_id),
      "regionCode" = COALESCE("regionCode", 'IN-OR'),
      state = COALESCE(NULLIF(state, ''), 'Odisha'),
      country = COALESCE(NULLIF(country, ''), 'India'),
      latitude = COALESCE(latitude, 21.85531),
      longitude = COALESCE(longitude, 84.00698),
      timezone = COALESCE(timezone, 'Asia/Kolkata'),
      "sourceDataset" = COALESCE("sourceDataset", 'dr5hn'),
      "sourceId" = COALESCE("sourceId", 132269),
      "sourceVersion" = COALESCE("sourceVersion", 'v3.2-export.7')
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
      latitude,
      longitude,
      timezone,
      "sourceDataset",
      "sourceId",
      "sourceVersion"
    )
    VALUES (
      '5f8ef749-6a36-4da2-bd40-132269000001',
      'Jharsuguda',
      'jharsuguda',
      'IN',
      'IN-OR',
      'Odisha',
      'India',
      india_country_id,
      odisha_region_id,
      21.85531,
      84.00698,
      'Asia/Kolkata',
      'dr5hn',
      132269,
      'v3.2-export.7'
    )
    ON CONFLICT ("countryCode", slug) DO NOTHING;
  END IF;
END $$;
