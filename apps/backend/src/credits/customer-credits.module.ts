import { Module } from '@nestjs/common';
import { CustomerCreditsController } from './customer-credits.controller';
import { CustomerCreditsService } from './customer-credits.service';

@Module({
  controllers: [CustomerCreditsController],
  providers: [CustomerCreditsService],
  // BookingsModule (redeem/restore) and QueueModule (earn) both call this service directly.
  exports: [CustomerCreditsService],
})
export class CustomerCreditsModule {}
