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
import { AdminShopActivityService } from './admin-shop-activity.service';
import { AdminExecutiveOverviewService } from './analytics/admin-executive-overview.service';
import { AdminShopStatusService } from './analytics/admin-shop-status.service';
import { AdminTimeseriesService } from './analytics/admin-timeseries.service';
import { AdminCustomerAnalyticsService } from './analytics/admin-customer-analytics.service';
import { AdminStaffAnalyticsService } from './analytics/admin-staff-analytics.service';
import { AdminDataExportService } from './analytics/admin-data-export.service';

@Module({
  imports: [SalonSetupModule, AuthModule],
  controllers: [AdminController],
  providers: [
    AdminMonitoringService,
    AdminVerificationService,
    AdminSalonManagementService,
    AdminEmployeeManagementService,
    AdminCrmService,
    AdminAccessManagementService,
    AdminShopActivityService,
    AdminExecutiveOverviewService,
    AdminShopStatusService,
    AdminTimeseriesService,
    AdminCustomerAnalyticsService,
    AdminStaffAnalyticsService,
    AdminDataExportService,
  ],
})
export class AdminModule {}
