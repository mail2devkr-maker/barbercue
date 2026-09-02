import { Module } from '@nestjs/common';
import { BookingsModule } from '../bookings/bookings.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SalonQueueController } from './salon-queue.controller';
import { QueueEntriesController } from './queue-entries.controller';
import { BookingCheckInController } from './booking-check-in.controller';
import { DashboardQueueController } from './dashboard-queue.controller';
import { QueueService } from './queue.service';
import { StaffStatusService } from './staff-status.service';
import { QueueEntryExpiryService } from './queue-entry-expiry.service';

@Module({
  imports: [BookingsModule, RealtimeModule, NotificationsModule],
  controllers: [
    SalonQueueController,
    QueueEntriesController,
    BookingCheckInController,
    DashboardQueueController,
  ],
  providers: [QueueService, StaffStatusService, QueueEntryExpiryService],
  // Phase 9: PublicQueueModule reuses this exact QueueService (joinWalkIn) for the QR flow rather
  // than duplicating queue logic — no other change to this module.
  exports: [QueueService],
})
export class QueueModule {}
