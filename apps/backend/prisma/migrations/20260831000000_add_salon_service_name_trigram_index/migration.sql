-- Issue 3: trigram search support for GET /search/suggest (typo-tolerant shop/service
-- autosuggest). Mirrors 20260826183132_add_city_name_trigram_index exactly -- pg_trgm is already
-- installed by that migration, so CREATE EXTENSION IF NOT EXISTS here is a no-op guard, not a
-- second install. Purely additive: no table/column changes, no data touched.
--
-- Same CONCURRENTLY caveat as the city migration: this Prisma version (5.22) wraps every
-- migration in a transaction, and CREATE INDEX CONCURRENTLY cannot run inside one (Postgres error
-- 25001). A plain CREATE INDEX briefly locks salons/services for writes while it builds -- fine on
-- this local, single-developer database, but a production run of this same migration would need
-- CONCURRENTLY executed outside Prisma's transaction wrapper instead.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "salons_name_trgm_idx" ON "salons" USING gin (name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS "services_name_trgm_idx" ON "services" USING gin (name gin_trgm_ops);
