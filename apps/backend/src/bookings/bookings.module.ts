import { Module } from '@nestjs/common';
import { BookingInfoController } from './booking-info.controller';
import { BookingsController } from './bookings.controller';
import { AvailabilityService } from './availability.service';
import { CancellationPolicyService } from './cancellation-policy.service';
import { BookingsService } from './bookings.service';

@Module({
  controllers: [BookingInfoController, BookingsController],
  providers: [AvailabilityService, CancellationPolicyService, BookingsService],
})
export class BookingsModule {}
