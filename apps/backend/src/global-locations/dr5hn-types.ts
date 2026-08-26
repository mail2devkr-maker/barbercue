/**
 * Column orders verified directly against dr5hn v3.2-export.7's `sql/schema.sql` CREATE TABLE
 * statements during the Phase 0/2 investigation -- not guessed, not assumed from README prose.
 */

export const COUNTRY_COLUMNS = [
  'id',
  'name',
  'iso3',
  'numeric_code',
  'iso2',
  'phonecode',
  'capital',
  'currency',
  'currency_name',
  'currency_symbol',
  'tld',
  'native',
  'population',
  'gdp',
  'region',
  'region_id',
  'subregion',
  'subregion_id',
  'nationality',
  'area_sq_km',
  'postal_code_format',
  'postal_code_regex',
  'timezones',
  'translations',
  'latitude',
  'longitude',
  'emoji',
  'emojiU',
  'created_at',
  'updated_at',
  'flag',
  'wikiDataId',
] as const;

export const STATE_COLUMNS = [
  'id',
  'name',
  'country_id',
  'country_code',
  'fips_code',
  'iso2',
  'iso3166_2',
  'type',
  'level',
  'parent_id',
  'native',
  'latitude',
  'longitude',
  'timezone',
  'translations',
  'created_at',
  'updated_at',
  'flag',
  'wikiDataId',
  'population',
] as const;

export const CITY_COLUMNS = [
  'id',
  'name',
  'state_id',
  'state_code',
  'country_id',
  'country_code',
  'type',
  'level',
  'parent_id',
  'latitude',
  'longitude',
  'native',
  'population',
  'timezone',
  'translations',
  'created_at',
  'updated_at',
  'flag',
  'wikiDataId',
] as const;

export type Dr5hnCountryRow = Record<
  (typeof COUNTRY_COLUMNS)[number],
  string | null
>;
export type Dr5hnStateRow = Record<
  (typeof STATE_COLUMNS)[number],
  string | null
>;
export type Dr5hnCityRow = Record<(typeof CITY_COLUMNS)[number], string | null>;
