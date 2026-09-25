import { Global, Module } from '@nestjs/common';
import { DbDeadlineSchedulerService } from './db-deadline-scheduler.service';

@Global()
@Module({
  providers: [DbDeadlineSchedulerService],
  exports: [DbDeadlineSchedulerService],
})
export class DbDeadlineSchedulerModule {}
