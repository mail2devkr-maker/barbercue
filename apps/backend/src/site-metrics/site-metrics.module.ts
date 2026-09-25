import { Module } from '@nestjs/common';
import { SiteMetricsController } from './site-metrics.controller';
import { SiteMetricsService } from './site-metrics.service';

@Module({
  controllers: [SiteMetricsController],
  providers: [SiteMetricsService],
  exports: [SiteMetricsService],
})
export class SiteMetricsModule {}
