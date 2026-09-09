-- Manual/local chair occupancy is an operational state distinct from Chair.status.
CREATE TABLE "manual_chair_occupancies" (
  "id" TEXT NOT NULL,
  "salonId" TEXT NOT NULL,
  "chairId" TEXT NOT NULL,
  "startedByUserId" TEXT NOT NULL,
  "endedByUserId" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "manual_chair_occupancies_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "manual_chair_occupancies"
  ADD CONSTRAINT "manual_chair_occupancies_salonId_fkey"
  FOREIGN KEY ("salonId") REFERENCES "salons"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_chair_occupancies"
  ADD CONSTRAINT "manual_chair_occupancies_chairId_fkey"
  FOREIGN KEY ("chairId") REFERENCES "chairs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_chair_occupancies"
  ADD CONSTRAINT "manual_chair_occupancies_startedByUserId_fkey"
  FOREIGN KEY ("startedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "manual_chair_occupancies"
  ADD CONSTRAINT "manual_chair_occupancies_endedByUserId_fkey"
  FOREIGN KEY ("endedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "manual_chair_occupancies_salonId_endedAt_idx"
  ON "manual_chair_occupancies"("salonId", "endedAt");
CREATE INDEX "manual_chair_occupancies_chairId_endedAt_idx"
  ON "manual_chair_occupancies"("chairId", "endedAt");

-- Prisma cannot express partial unique indexes. This prevents two active manual/local occupancies
-- on the same chair. Cross-table overlap with ACTIVE service_sessions is prevented by the shared
-- per-chair advisory transaction lock in application code.
CREATE UNIQUE INDEX "manual_chair_occupancy_chair_active_uq"
  ON "manual_chair_occupancies"("chairId")
  WHERE "endedAt" IS NULL;
