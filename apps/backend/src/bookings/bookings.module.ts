import { Module, forwardRef } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { PushNotificationsModule } from '../push-notifications/push-notifications.module';
import { QueueModule } from '../queue/queue.module';
import { CustomerCreditsModule } from '../credits/customer-credits.module';
import { BookingInfoController } from './booking-info.controller';
import { BookingsController } from './bookings.controller';
import { AvailabilityService } from './availability.service';
import { ReservationService } from './reservation.service';
import { CancellationPolicyService } from './cancellation-policy.service';
import { BookingsService } from './bookings.service';
import { BookingExpiryService } from './booking-expiry.service';
import { BookingNoShowService } from './booking-no-show.service';
import { BookingPaymentInfoService } from './booking-payment-info.service';
import { ArrivalAlertsService } from './arrival-alerts.service';

@Module({
  // forwardRef: QueueModule already imports BookingsModule (for AvailabilityService/
  // CancellationPolicyService); this is the other direction of that same genuine circular
  // relationship — see the matching comment in queue.module.ts.
  imports: [
    RealtimeModule,
    NotificationsModule,
    PushNotificationsModule,
    CustomerCreditsModule,
    forwardRef(() => QueueModule),
  ],
  controllers: [BookingInfoController, BookingsController],
  providers: [
    AvailabilityService,
    ReservationService,
    CancellationPolicyService,
    BookingsService,
    BookingExpiryService,
    BookingNoShowService,
    BookingPaymentInfoService,
    ArrivalAlertsService,
  ],
  // AvailabilityService is reused by Phase 3C's queue module (qualified-staff-pool logic for live
  // assignment) — exported so QueueModule can inject it without duplicating the StaffService rule.
  // ReservationService (booking/queue resource-reservation mission) is exported for the same
  // reason: QueueService's assign()/reassign()/getCapacitySummary()/recomputeEtas() all need the
  // one authoritative reservation-overlap rule, never a second copy of it.
  // CancellationPolicyService is exported too, so QueueModule's QueueEntryExpiryService can reuse
  // the same per-salon grace-period lookup rather than a duplicate provider registration.
  // BookingNoShowService/ArrivalAlertsService are exported (P0 arrival-alert mission) so
  // DashboardQueueController — which already lives in QueueModule and already imports BookingsModule
  // for the two exports above — can mount the new manual no-show/correction/alert endpoints without
  // a second, competing controller.
  exports: [AvailabilityService, ReservationService, CancellationPolicyService, BookingNoShowService, ArrivalAlertsService],
})
export class BookingsModule {}
