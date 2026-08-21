-- AlterTable: add nullable columns first — publicId can't be NOT NULL yet because existing
-- salon rows (the seeded demo salon) have no value to backfill from.
ALTER TABLE "salons" ADD COLUMN "publicId" TEXT;
ALTER TABLE "salons" ADD COLUMN "email" TEXT;

-- Hand-written (not expressible in schema.prisma's DSL): a dedicated sequence backing the
-- "BC-SHOP-000001" format. Guarantees uniqueness/monotonicity at the database level — no
-- read-max-then-increment race between two concurrent shop registrations.
CREATE SEQUENCE "salon_public_id_seq";

-- Backfill every existing row (the seeded demo salon) before the column can become NOT NULL.
UPDATE "salons"
SET "publicId" = 'BC-SHOP-' || LPAD(nextval('salon_public_id_seq')::text, 6, '0')
WHERE "publicId" IS NULL;

-- Now safe to enforce NOT NULL, and set the sequence-backed default so every future INSERT that
-- doesn't explicitly supply a publicId (i.e. every real one — SalonsService never sets it) gets
-- one automatically.
ALTER TABLE "salons" ALTER COLUMN "publicId" SET NOT NULL;
ALTER TABLE "salons" ALTER COLUMN "publicId" SET DEFAULT 'BC-SHOP-' || LPAD(nextval('salon_public_id_seq')::text, 6, '0');

-- CreateIndex (matches Prisma's default @unique naming convention for this table/column)
CREATE UNIQUE INDEX "salons_publicId_key" ON "salons"("publicId");
