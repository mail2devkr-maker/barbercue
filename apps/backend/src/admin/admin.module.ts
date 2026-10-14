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
import { AdminSecurityController } from './admin-security.controller';
import { AdminShopDeletionRequestsService } from './admin-shop-deletion-requests.service';
import { AdminSecurityAuditService } from './admin-security-audit.service';

@Module({
  imports: [SalonSetupModule, AuthModule],
  controllers: [AdminController, AdminSecurityController],
  providers: [
    AdminMonitoringService,
    AdminVerificationService,
    AdminSalonManagementService,
    AdminEmployeeManagementService,
    AdminCrmService,
    AdminAccessManagementService,
    AdminShopDeletionRequestsService,
    AdminSecurityAuditService,
  ],
})
export class AdminModule {}
