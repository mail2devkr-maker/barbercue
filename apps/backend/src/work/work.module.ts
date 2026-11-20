import { Logger, Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { configuredWorkPaymentProvider } from './work-config';
import {
  SandboxWorkPaymentProvider,
  UnconfiguredWorkPaymentProvider,
  WORK_PAYMENT_PROVIDER,
  type WorkPaymentProvider,
} from './payments/work-payment-provider';
import { WorkAccessService } from './work-access.service';
import { WorkAdminController } from './work-admin.controller';
import { WorkAdminService } from './work-admin.service';
import { WorkAssignmentsService } from './work-assignments.service';
import { WorkAuditService } from './work-audit.service';
import { WorkDisputesService } from './work-disputes.service';
import { WorkEmployerController } from './work-employer.controller';
import { WorkEnabledGuard } from './work-enabled.guard';
import { WorkJobsService } from './work-jobs.service';
import { WorkLedgerService } from './work-ledger.service';
import { WorkOrgsService } from './work-orgs.service';
import { WorkPaymentsController } from './work-payments.controller';
import { WorkPaymentsService } from './work-payments.service';
import { WorkPublicController } from './work-public.controller';
import { WorkWorkerController } from './work-worker.controller';
import { WorkWorkersService } from './work-workers.service';

/**
 * FastQue Work — student and gig workforce marketplace. See docs/work-marketplace/.
 * Off by default (WORK_MARKETPLACE_ENABLED); payments default to "not configured".
 */
@Module({
  imports: [NotificationsModule],
  controllers: [
    WorkPublicController,
    WorkWorkerController,
    WorkEmployerController,
    WorkPaymentsController,
    WorkAdminController,
  ],
  providers: [
    WorkEnabledGuard,
    WorkAccessService,
    WorkAuditService,
    WorkLedgerService,
    WorkPaymentsService,
    WorkOrgsService,
    WorkWorkersService,
    WorkJobsService,
    WorkAssignmentsService,
    WorkDisputesService,
    WorkAdminService,
    {
      provide: WORK_PAYMENT_PROVIDER,
      useFactory: (): WorkPaymentProvider => {
        if (configuredWorkPaymentProvider() === 'sandbox') {
          new Logger('WorkModule').warn(
            'FastQue Work is using the SANDBOX payment provider. No real money moves.',
          );
          return new SandboxWorkPaymentProvider(
            process.env.WORK_SANDBOX_WEBHOOK_SECRET ?? '',
          );
        }
        return new UnconfiguredWorkPaymentProvider();
      },
    },
  ],
})
export class WorkModule {}
