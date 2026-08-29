import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

// PrismaService is @Global(). Exported so BookingsModule/QueueModule (and future event sources)
// can inject NotificationsService without duplicating notification-creation logic.
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
