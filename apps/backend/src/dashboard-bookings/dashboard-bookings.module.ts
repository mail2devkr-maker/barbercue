import { Module } from '@nestjs/common';
import { DashboardBookingsController } from './dashboard-bookings.controller';
import { DashboardBookingsService } from './dashboard-bookings.service';

// PrismaService and SalonAccessService are both @Global() (see their own modules) — no imports
// needed here, same as most other dashboard-style modules.
@Module({
  controllers: [DashboardBookingsController],
  providers: [DashboardBookingsService],
})
export class DashboardBookingsModule {}
