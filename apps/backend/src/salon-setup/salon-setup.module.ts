import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SalonSetupController } from './salon-setup.controller';
import { SalonServicesService } from './salon-services.service';
import { SalonChairsService } from './salon-chairs.service';
import { SalonStaffService } from './salon-staff.service';
import { SalonActivationService } from './salon-activation.service';
import { SalonOperatingHoursService } from './salon-operating-hours.service';
import { SalonPhotosService } from './salon-photos.service';
import { StorageModule } from '../storage/storage.module';

@Module({
  // AuthModule provides EMAIL_SENDER, which SalonStaffService reuses to deliver barber
  // invitations through the exact same transport the forgot-password flow already uses.
  // SalonAccessService comes from the @Global() SalonAccessModule, same as everywhere else.
  // StorageModule provides ObjectStorageService, which SalonPhotosService uses to put
  // owner-uploaded photos into S3-compatible object storage (Cloudflare R2 for V1).
  imports: [AuthModule, StorageModule],
  controllers: [SalonSetupController],
  providers: [
    SalonServicesService,
    SalonChairsService,
    SalonStaffService,
    SalonActivationService,
    SalonOperatingHoursService,
    SalonPhotosService,
  ],
})
export class SalonSetupModule {}
