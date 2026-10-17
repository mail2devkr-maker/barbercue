import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SalonSetupController } from './salon-setup.controller';
import { SalonServicesService } from './salon-services.service';
import { ServiceCatalogImportService } from './service-catalog-import.service';
import { SalonChairsService } from './salon-chairs.service';
import { SalonStaffService } from './salon-staff.service';
import { SalonActivationService } from './salon-activation.service';
import { SalonOperatingHoursService } from './salon-operating-hours.service';
import { SalonPhotosService } from './salon-photos.service';
import { StaffWorkingHoursService } from './staff-working-hours.service';
import { SalonTimezoneService } from './salon-timezone.service';
import { SalonPaymentQrService } from './salon-payment-qr.service';
import { SalonProfileService } from './salon-profile.service';
import { SalonContactImportPreviewController } from './salon-contact-import-preview.controller';
import { SalonContactImportPreviewService } from './salon-contact-import-preview.service';
import { StorageModule } from '../storage/storage.module';
import { AssignmentReleaseModule } from '../queue/assignment-release.module';

@Module({
  // AuthModule provides EMAIL_SENDER, which SalonStaffService reuses to deliver barber
  // invitations through the exact same transport the forgot-password flow already uses.
  // SalonAccessService comes from the @Global() SalonAccessModule, same as everywhere else.
  // StorageModule provides ObjectStorageService, which SalonPhotosService/SalonPaymentQrService
  // use to put owner-uploaded images into S3-compatible object storage (Cloudflare R2 for V1).
  imports: [AuthModule, StorageModule, AssignmentReleaseModule],
  controllers: [SalonSetupController, SalonContactImportPreviewController],
  providers: [
    SalonServicesService,
    ServiceCatalogImportService,
    SalonChairsService,
    SalonStaffService,
    SalonActivationService,
    SalonOperatingHoursService,
    SalonPhotosService,
    StaffWorkingHoursService,
    SalonTimezoneService,
    SalonPaymentQrService,
    SalonProfileService,
    SalonContactImportPreviewService,
  ],
  exports: [SalonActivationService],
})
export class SalonSetupModule {}
