import { Module } from '@nestjs/common';
import { DashboardReviewsController } from './dashboard-reviews.controller';
import { DashboardReviewsService } from './dashboard-reviews.service';

// PrismaService and SalonAccessService are both @Global() — no imports needed here.
@Module({
  controllers: [DashboardReviewsController],
  providers: [DashboardReviewsService],
})
export class DashboardReviewsModule {}
