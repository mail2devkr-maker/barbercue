-- Phase 7 (barber schedules): an optional per-barber refinement layer on top of a salon's own
-- operating_hours, not a replacement for it. A day with no row means "unrestricted," the opposite
-- default from operating_hours (see StaffWorkingHours' own schema.prisma doc comment) — additive,
-- backwards-compatible, no existing table touched.

-- CreateTable
CREATE TABLE "staff_working_hours" (
    "id" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "openTime" TEXT NOT NULL,
    "closeTime" TEXT NOT NULL,
    "isClosed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "staff_working_hours_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "staff_working_hours_staffId_dayOfWeek_key" ON "staff_working_hours"("staffId", "dayOfWeek");

-- AddForeignKey
ALTER TABLE "staff_working_hours" ADD CONSTRAINT "staff_working_hours_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "salon_staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
