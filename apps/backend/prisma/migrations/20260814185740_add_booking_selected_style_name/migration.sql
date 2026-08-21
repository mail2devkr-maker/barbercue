-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "selectedStyleName" TEXT;

-- Phase 8A migration-history repair (uncommitted, single-dev-DB only — see ARCHITECTURE.md/final
-- report for full justification): this migration's file NAME sorts before
-- 20260814190000_add_salon_public_id, but it was actually generated and applied AFTER it (see
-- that migration's real applied timestamp in _prisma_migrations vs. this one). At the time it was
-- auto-generated, `prisma migrate dev`'s diff engine saw a DB-level DEFAULT on salons.publicId
-- that schema.prisma didn't yet declare (the DEFAULT was hand-written raw SQL) and "reconciled"
-- by stray-including `ALTER TABLE "salons" ALTER COLUMN "publicId" DROP DEFAULT;` here — unrelated
-- to this migration's actual purpose (adding bookings.selectedStyleName) and fatal to a fresh
-- from-scratch replay, since publicId doesn't exist yet at this point in filename order.
-- 20260815012700_restore_salon_public_id_default's own SET DEFAULT exactly cancels this dropped
-- default back out, so removing the stray statement here is a provable no-op for the final
-- schema — not a behavior change, just removing an accidental drop/restore round-trip that only
-- existed because these two migrations were generated out of their filename order in the first
-- place. schema.prisma's Salon.publicId now carries @default(dbgenerated(...)) explicitly, so a
-- freshly-generated migration will never reproduce this again.
