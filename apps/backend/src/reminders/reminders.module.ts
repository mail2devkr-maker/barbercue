import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { RemindersService } from './reminders.service';

// PrismaService is @Global(). No controller — this module is a background sweep only, nothing to
// expose over HTTP.
@Module({
  imports: [NotificationsModule],
  providers: [RemindersService],
  exports: [RemindersService],
})
export class RemindersModule {}
