import { Module } from '@nestjs/common';
import { PushNotificationsModule } from '../push-notifications/push-notifications.module';
import { NotificationDeliveryService } from './notification-delivery.service';
import { NotificationsModule } from './notifications.module';

// PrismaService and DbDeadlineSchedulerService are @Global(). A separate module (rather than a
// provider on NotificationsModule) because the ledger needs BOTH the in-app notification service and
// the push dispatcher, and NotificationsModule must stay importable from modules that have no
// push dependency.
@Module({
  imports: [NotificationsModule, PushNotificationsModule],
  providers: [NotificationDeliveryService],
  exports: [NotificationDeliveryService],
})
export class NotificationDeliveryModule {}
