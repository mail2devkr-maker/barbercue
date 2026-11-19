import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { CrmAccessService } from './crm-access.service';
import { CrmActivityService } from './crm-activity.service';
import { CrmAnalyticsService } from './crm-analytics.service';
import { CrmController } from './crm.controller';
import { CrmLeadsService } from './crm-leads.service';
import { CrmRecordingsService } from './crm-recordings.service';
import { CrmSchedulerService } from './crm-scheduler.service';
import { CrmTicketsService } from './crm-tickets.service';

/** FastQue Employee CRM 2.0 — field sales CRM on top of the existing employee CRM and onboarding. */
@Module({
  imports: [StorageModule],
  controllers: [CrmController],
  providers: [
    CrmAccessService,
    CrmLeadsService,
    CrmActivityService,
    CrmRecordingsService,
    CrmTicketsService,
    CrmAnalyticsService,
    CrmSchedulerService,
  ],
})
export class CrmModule {}
