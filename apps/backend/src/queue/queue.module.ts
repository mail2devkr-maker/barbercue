import { Module, forwardRef } from '@nestjs/common';
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
import { ManualChairOccupancyController } from './manual-chair-occupancy.controller';
import { ManualChairOccupancyService } from './manual-chair-occupancy.service';
import { AssignmentReleaseModule } from './assignment-release.module';

@Module({
  // forwardRef: BookingsService now also depends back on QueueService (Issue 3 — a cancelled
  // booking's linked queue entry must transition to CANCELLED and its salon's ETAs must
  // recompute), so this is a genuine two-way dependency between the two modules, not accidental
  // coupling. NestJS's documented pattern for a real circular module relationship.
  imports: [
    forwardRef(() => BookingsModule),
    RealtimeModule,
    NotificationsModule,
    AssignmentReleaseModule,
  ],
  controllers: [
    SalonQueueController,
    QueueEntriesController,
    BookingCheckInController,
    DashboardQueueController,
    ManualChairOccupancyController,
  ],
  providers: [QueueService, StaffStatusService, QueueEntryExpiryService, ManualChairOccupancyService],
  // Phase 9: PublicQueueModule reuses this exact QueueService (joinWalkIn) for the QR flow rather
  // than duplicating queue logic — no other change to this module.
  // QueueAutoAssignTrigger is the seam the owner-operations allocator registers itself on.
  // AssignmentReleaseModule re-exports QueueAutoAssignTrigger and QueueAssignmentReleaseService.
  exports: [QueueService, AssignmentReleaseModule],
})
export class QueueModule {}
