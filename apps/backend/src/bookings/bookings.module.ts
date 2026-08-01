import { Module } from '@nestjs/common';
import { BookingInfoController } from './booking-info.controller';
import { BookingsController } from './bookings.controller';
import { AvailabilityService } from './availability.service';
import { CancellationPolicyService } from './cancellation-policy.service';
import { BookingsService } from './bookings.service';

@Module({
  controllers: [BookingInfoController, BookingsController],
  providers: [AvailabilityService, CancellationPolicyService, BookingsService],
  // AvailabilityService is reused by Phase 3C's queue module (qualified-staff-pool logic for live
  // assignment) — exported so QueueModule can inject it without duplicating the StaffService rule.
  exports: [AvailabilityService],
})
export class BookingsModule {}
