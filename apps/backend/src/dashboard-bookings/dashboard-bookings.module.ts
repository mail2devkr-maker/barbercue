import { Module } from '@nestjs/common';
import { BookingsModule } from '../bookings/bookings.module';
import { DashboardBookingsController } from './dashboard-bookings.controller';
import { DashboardBookingsService } from './dashboard-bookings.service';

// PrismaService and SalonAccessService are both @Global() (see their own modules) — no imports
// needed here, same as most other dashboard-style modules. BookingsModule is imported (P0
// arrival-alert mission) purely for its exported CancellationPolicyService, which
// DashboardBookingsService now needs to compute arrivalAlertDue/noShowEligible — a one-directional
// edge, BookingsModule never imports this module back.
@Module({
  imports: [BookingsModule],
  controllers: [DashboardBookingsController],
  providers: [DashboardBookingsService],
})
export class DashboardBookingsModule {}
