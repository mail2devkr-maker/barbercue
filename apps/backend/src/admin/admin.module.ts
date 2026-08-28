import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminMonitoringService } from './admin-monitoring.service';

@Module({
  controllers: [AdminController],
  providers: [AdminMonitoringService],
})
export class AdminModule {}
