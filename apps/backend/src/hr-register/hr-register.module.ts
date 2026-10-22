import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { HrCodeAllocator } from './hr-code-allocator.service';
import { HrPrivacyService } from './hr-privacy.service';
import { HrReconciliationService } from './hr-reconciliation.service';
import { HrRegisterController } from './hr-register.controller';
import { HrRegisterService } from './hr-register.service';

@Module({
  imports: [AuthModule],
  controllers: [HrRegisterController],
  providers: [
    HrRegisterService,
    HrReconciliationService,
    HrPrivacyService,
    HrCodeAllocator,
  ],
  // The legacy admin employee service allocates through the SAME allocator so IDs can never collide.
  exports: [HrCodeAllocator, HrRegisterService],
})
export class HrRegisterModule {}
