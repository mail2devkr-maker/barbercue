import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminMonitoringService } from './admin-monitoring.service';
import { AdminVerificationService } from './admin-verification.service';
import { AdminSalonManagementService } from './admin-salon-management.service';

@Module({
  controllers: [AdminController],
  providers: [
    AdminMonitoringService,
    AdminVerificationService,
    AdminSalonManagementService,
  ],
})
export class AdminModule {}
