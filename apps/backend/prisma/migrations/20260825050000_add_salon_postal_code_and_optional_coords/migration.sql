-- Phase 11 UX pass. Hand-authored to match Prisma's generated conventions, because
-- `prisma migrate dev` cannot run against this project's shadow database (see the pre-existing
-- defect in 20260814185740_add_booking_selected_style_name). NOT YET APPLIED to any database.
--
-- Every statement below is additive or constraint-relaxing. No row is read, rewritten, or
-- deleted; no column is dropped or retyped; no default is added or removed. Existing salons keep
-- their current lat/lng values untouched and simply gain a NULL postalCode.

-- AlterTable
ALTER TABLE "salons" ADD COLUMN "postalCode" TEXT;

-- AlterTable
-- Widening only: NOT NULL -> NULL. Rows that already hold coordinates are unaffected; this only
-- permits future rows to omit them (an owner who denied GPS permission, or registered from a
-- desktop). Their sole consumer is the schema.org `geo` block on the public salon page, which
-- now omits itself when they are absent.
ALTER TABLE "salons" ALTER COLUMN "lat" DROP NOT NULL;
ALTER TABLE "salons" ALTER COLUMN "lng" DROP NOT NULL;
