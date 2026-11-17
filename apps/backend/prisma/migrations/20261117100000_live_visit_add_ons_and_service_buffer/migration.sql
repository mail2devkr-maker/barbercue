-- Live-visit add-on services + per-shop service buffer (17 Nov 2026). Additive only:
--  * salons.serviceBufferMinutes: new column with a constant default (no table rewrite on PG 11+).
--  * queue_entries.addOnMinutes: new column with a constant default 0 (existing visits unchanged).
--  * queue_entry_add_ons: new table; nothing reads it until the application writes a row.
-- Rollback: drop the table and the two columns (no existing data is modified by this migration).

-- AlterTable
ALTER TABLE "salons" ADD COLUMN "serviceBufferMinutes" INTEGER NOT NULL DEFAULT 10;

-- AlterTable
ALTER TABLE "queue_entries" ADD COLUMN "addOnMinutes" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "queue_entry_add_ons" (
    "id" TEXT NOT NULL,
    "queueEntryId" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "addedByUserId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "queue_entry_add_ons_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "queue_entry_add_ons_queueEntryId_serviceId_key" ON "queue_entry_add_ons"("queueEntryId", "serviceId");

-- AddForeignKey
ALTER TABLE "queue_entry_add_ons" ADD CONSTRAINT "queue_entry_add_ons_queueEntryId_fkey" FOREIGN KEY ("queueEntryId") REFERENCES "queue_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_entry_add_ons" ADD CONSTRAINT "queue_entry_add_ons_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Database-level guards mirroring the application's validation.
ALTER TABLE "salons" ADD CONSTRAINT "salons_serviceBufferMinutes_range" CHECK ("serviceBufferMinutes" >= 0 AND "serviceBufferMinutes" <= 30);
ALTER TABLE "queue_entries" ADD CONSTRAINT "queue_entries_addOnMinutes_nonnegative" CHECK ("addOnMinutes" >= 0);
ALTER TABLE "queue_entry_add_ons" ADD CONSTRAINT "queue_entry_add_ons_duration_positive" CHECK ("durationMinutes" > 0);
