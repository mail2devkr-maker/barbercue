import { Module } from '@nestjs/common';
import { DashboardCustomersController } from './dashboard-customers.controller';
import { DashboardCustomersService } from './dashboard-customers.service';
import { CancellationCourtesyWaiverController } from './cancellation-courtesy-waiver.controller';
import { CancellationCourtesyWaiverService } from './cancellation-courtesy-waiver.service';

// PrismaService and SalonAccessService are both @Global() — no imports needed here.
@Module({
  controllers: [DashboardCustomersController, CancellationCourtesyWaiverController],
  providers: [DashboardCustomersService, CancellationCourtesyWaiverService],
})
export class DashboardCustomersModule {}
