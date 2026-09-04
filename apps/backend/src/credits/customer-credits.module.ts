import { Module } from '@nestjs/common';
import { CustomerCreditsController } from './customer-credits.controller';
import { AdminCreditsController } from './admin-credits.controller';
import { CustomerCreditsService } from './customer-credits.service';

@Module({
  controllers: [CustomerCreditsController, AdminCreditsController],
  providers: [CustomerCreditsService],
  // BookingsModule (redeem/restore) calls this service directly.
  exports: [CustomerCreditsService],
})
export class CustomerCreditsModule {}
