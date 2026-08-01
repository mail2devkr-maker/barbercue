-- AlterTable
ALTER TABLE "bookings" ADD COLUMN     "preferredStaffId" TEXT;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_preferredStaffId_fkey" FOREIGN KEY ("preferredStaffId") REFERENCES "salon_staff"("id") ON DELETE SET NULL ON UPDATE CASCADE;
