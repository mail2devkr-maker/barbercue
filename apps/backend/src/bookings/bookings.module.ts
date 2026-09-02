import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { BookingInfoController } from './booking-info.controller';
import { BookingsController } from './bookings.controller';
import { AvailabilityService } from './availability.service';
import { CancellationPolicyService } from './cancellation-policy.service';
import { BookingsService } from './bookings.service';
import { BookingExpiryService } from './booking-expiry.service';
import { BookingNoShowService } from './booking-no-show.service';

@Module({
  imports: [RealtimeModule, NotificationsModule],
  controllers: [BookingInfoController, BookingsController],
  providers: [
    AvailabilityService,
    CancellationPolicyService,
    BookingsService,
    BookingExpiryService,
    BookingNoShowService,
  ],
  // AvailabilityService is reused by Phase 3C's queue module (qualified-staff-pool logic for live
  // assignment) — exported so QueueModule can inject it without duplicating the StaffService rule.
  // CancellationPolicyService is exported too, so QueueModule's QueueEntryExpiryService can reuse
  // the same per-salon grace-period lookup rather than a duplicate provider registration.
  exports: [AvailabilityService, CancellationPolicyService],
})
export class BookingsModule {}
