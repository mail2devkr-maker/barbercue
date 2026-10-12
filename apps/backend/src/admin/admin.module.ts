import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { AdminMonitoringService } from './admin-monitoring.service';
import { AdminVerificationService } from './admin-verification.service';
import { AdminSalonManagementService } from './admin-salon-management.service';
import { SalonSetupModule } from '../salon-setup/salon-setup.module';
import { AuthModule } from '../auth/auth.module';
import { AdminEmployeeManagementService } from './admin-employee-management.service';
import { AdminCrmService } from './admin-crm.service';
import { AdminAccessManagementService } from './admin-access-management.service';
import { AdminSalonOwnerAccessService } from './admin-salon-owner-access.service';
import {
  AdminSalonOwnerAccessController,
  OwnerInvitationAcceptanceController,
} from './admin-salon-owner-access.controller';

@Module({
  imports: [SalonSetupModule, AuthModule],
  controllers: [
    AdminController,
    AdminSalonOwnerAccessController,
    OwnerInvitationAcceptanceController,
  ],
  providers: [
    AdminMonitoringService,
    AdminVerificationService,
    AdminSalonManagementService,
    AdminEmployeeManagementService,
    AdminCrmService,
    AdminAccessManagementService,
    AdminSalonOwnerAccessService,
  ],
})
export class AdminModule {}
