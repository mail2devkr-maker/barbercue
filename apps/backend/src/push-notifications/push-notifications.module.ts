import { Module } from '@nestjs/common';
import { PushNotificationsController } from './push-notifications.controller';
import { PushDeviceService } from './push-device.service';
import { PushDispatchService } from './push-dispatch.service';
import { ExpoPushSender } from './expo-push-sender';

// PrismaService is @Global(). PushDispatchService is exported so BookingsModule (and future
// event sources — queue.entry.called, etc.) can trigger a push without duplicating dispatch logic.
@Module({
  controllers: [PushNotificationsController],
  providers: [PushDeviceService, PushDispatchService, ExpoPushSender],
  exports: [PushDeviceService, PushDispatchService],
})
export class PushNotificationsModule {}
