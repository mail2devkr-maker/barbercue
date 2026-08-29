import { Module } from '@nestjs/common';
import { DashboardOverviewController } from './dashboard-overview.controller';
import { DashboardOverviewService } from './dashboard-overview.service';

// PrismaService is @Global() — no imports needed here.
@Module({
  controllers: [DashboardOverviewController],
  providers: [DashboardOverviewService],
})
export class DashboardOverviewModule {}
