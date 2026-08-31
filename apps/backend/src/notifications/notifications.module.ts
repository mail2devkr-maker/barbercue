import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { PushDevicesController } from './push-devices.controller';
import { PushDevicesService } from './push-devices.service';
import { PushDeliveryService } from './push-delivery.service';
import { ExpoPushSender } from './expo-push.sender';
import { PUSH_SENDER } from './push-sender';

// PrismaService is @Global(). Exported so BookingsModule/QueueModule (and future event sources)
// can inject NotificationsService without duplicating notification-creation logic.
@Module({
  controllers: [NotificationsController, PushDevicesController],
  providers: [
    NotificationsService,
    PushDevicesService,
    PushDeliveryService,
    ExpoPushSender,
    { provide: PUSH_SENDER, useExisting: ExpoPushSender },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
