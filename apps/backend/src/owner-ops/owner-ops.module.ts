import { Module } from '@nestjs/common';
import { BookingsModule } from '../bookings/bookings.module';
import { NotificationDeliveryModule } from '../notifications/notification-delivery.module';
import { PushNotificationsModule } from '../push-notifications/push-notifications.module';
import { QueueModule } from '../queue/queue.module';
import { RealtimeModule } from '../realtime/realtime.module';
import { CancellationAnalyticsService } from './cancellation-analytics.service';
import { InvoicesService } from './invoices.service';
import { OwnerOverviewService } from './owner-overview.service';
import {
  CustomerInvoicesController,
  OwnerOpsController,
} from './owner-ops.controller';
import { OwnerSearchService } from './owner-search.service';
import { QueueAutoAssignService } from './queue-auto-assign.service';
import { ShopBookingActionsService } from './shop-booking-actions.service';
import { StaffAccessService } from './staff-access.service';
import { StaffWorkService } from './staff-work.service';

/**
 * Owner-operations mission: the shop-side read models and workflows that sit on top of the existing
 * booking and queue engines (cancel/reschedule/in-shop appointments, automatic allocation, staff
 * work view, access revocation, overview/analytics/search, invoicing). PrismaService and
 * SalonAccessService are @Global().
 *
 * It must be registered BEFORE SalonsModule: its `dashboard/...` routes do not collide with the
 * `salons/...` discovery wildcard, but `invoices/mine` must be matched ahead of any parameterised
 * sibling.
 */
@Module({
  imports: [
    BookingsModule,
    QueueModule,
    RealtimeModule,
    NotificationDeliveryModule,
    PushNotificationsModule,
  ],
  controllers: [OwnerOpsController, CustomerInvoicesController],
  providers: [
    CancellationAnalyticsService,
    InvoicesService,
    OwnerOverviewService,
    OwnerSearchService,
    QueueAutoAssignService,
    ShopBookingActionsService,
    StaffAccessService,
    StaffWorkService,
  ],
  exports: [QueueAutoAssignService, InvoicesService],
})
export class OwnerOpsModule {}
