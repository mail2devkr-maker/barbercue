import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { CrmActivityService } from './crm-activity.service';
import { CrmRecordingsService } from './crm-recordings.service';

/** Reminders (deduplicated) every 15 minutes; recording retention purge nightly. */
@Injectable()
export class CrmSchedulerService {
  private readonly log = new Logger(CrmSchedulerService.name);
  constructor(
    private readonly activity: CrmActivityService,
    private readonly recordings: CrmRecordingsService,
  ) {}

  @Cron('*/15 * * * *')
  async reminders(): Promise<void> {
    if (process.env.CRM_REMINDERS_ENABLED === 'false') return;
    try {
      await this.activity.remind();
    } catch (error) {
      this.log.warn(
        `CRM reminders failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  @Cron('30 3 * * *')
  async retention(): Promise<void> {
    try {
      await this.recordings.purgeExpired();
    } catch (error) {
      this.log.warn(
        `Recording retention purge failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
