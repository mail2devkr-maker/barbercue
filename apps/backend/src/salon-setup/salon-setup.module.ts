import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SalonSetupController } from './salon-setup.controller';
import { SalonServicesService } from './salon-services.service';
import { SalonChairsService } from './salon-chairs.service';
import { SalonStaffService } from './salon-staff.service';
import { SalonActivationService } from './salon-activation.service';
import { SalonOperatingHoursService } from './salon-operating-hours.service';

@Module({
  // AuthModule provides EMAIL_SENDER, which SalonStaffService reuses to deliver barber
  // invitations through the exact same transport the forgot-password flow already uses.
  // SalonAccessService comes from the @Global() SalonAccessModule, same as everywhere else.
  imports: [AuthModule],
  controllers: [SalonSetupController],
  providers: [
    SalonServicesService,
    SalonChairsService,
    SalonStaffService,
    SalonActivationService,
    SalonOperatingHoursService,
  ],
})
export class SalonSetupModule {}
