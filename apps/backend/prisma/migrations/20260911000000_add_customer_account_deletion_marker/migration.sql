-- Account deletion V1 keeps transaction and operational foreign keys intact while recording the
-- irreversible removal of direct customer identifiers and authentication material in application
-- code. Nullable and additive: no existing account or production record is modified by migrate.
ALTER TABLE "users" ADD COLUMN "deletedAt" TIMESTAMP(3);
