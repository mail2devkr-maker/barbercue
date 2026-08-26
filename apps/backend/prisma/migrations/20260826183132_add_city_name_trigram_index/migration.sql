-- Phase 6A: adds trigram search support for the new GET /cities/search endpoint. Purely
-- additive -- no table/column changes, no data touched. Verified beforehand (read-only) that
-- pg_trgm was not installed and no equivalent index existed.
--
-- CONCURRENTLY was tried first and rejected by Postgres: this Prisma version (5.22) still wraps
-- every migration in a transaction, and `CREATE INDEX CONCURRENTLY cannot run inside a
-- transaction block` (Postgres error 25001) -- confirmed empirically, not assumed. A plain
-- CREATE INDEX briefly locks `cities` for writes while it builds; on this local, single-developer
-- database with no concurrent traffic that's an acceptable, simple, transaction-safe trade-off.
-- A production deployment of this same table would need CONCURRENTLY run outside Prisma's
-- transaction wrapper (e.g. via a separate `prisma db execute` step) -- out of scope here, since
-- this project's location work is explicitly local-only through Phase 6A.

CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS "cities_name_trgm_idx" ON "cities" USING gin (name gin_trgm_ops);
