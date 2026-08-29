import { Module } from '@nestjs/common';
import { DashboardCustomersController } from './dashboard-customers.controller';
import { DashboardCustomersService } from './dashboard-customers.service';

// PrismaService and SalonAccessService are both @Global() — no imports needed here.
@Module({
  controllers: [DashboardCustomersController],
  providers: [DashboardCustomersService],
})
export class DashboardCustomersModule {}
