import { Global, Module } from '@nestjs/common';
import { SalonAccessService } from './salon-access.service';

// Global (same pattern as PrismaModule) so both QueueModule and RealtimeModule can inject
// SalonAccessService without a cross-dependency between the two.
@Global()
@Module({
  providers: [SalonAccessService],
  exports: [SalonAccessService],
})
export class SalonAccessModule {}
