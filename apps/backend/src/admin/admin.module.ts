import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminMonitoringService } from './admin-monitoring.service';
import { AdminVerificationService } from './admin-verification.service';
import { AdminSalonManagementService } from './admin-salon-management.service';
import { SalonSetupModule } from '../salon-setup/salon-setup.module';

@Module({
  imports: [SalonSetupModule],
  controllers: [AdminController],
  providers: [
    AdminMonitoringService,
    AdminVerificationService,
    AdminSalonManagementService,
  ],
})
export class AdminModule {}
