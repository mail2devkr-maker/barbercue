import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import {
  WorkDisputeStatus,
  WorkJobStatus,
  WorkOrgStatus,
  WorkPayoutStatus,
} from '@prisma/client';
import {
  Role,
  workDisputeResolveSchema,
  workJobModerationSchema,
  workManualFundingConfirmSchema,
  workManualPayoutConfirmSchema,
  workOrgReviewSchema,
  type WorkManualFundingConfirmInput,
  type WorkManualPayoutConfirmInput,
  type AuthenticatedUser,
} from '@barbercue/shared';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { WorkAdminService } from './work-admin.service';
import { WorkAssignmentsService } from './work-assignments.service';
import { WorkDisputesService } from './work-disputes.service';
import { WorkEnabledGuard } from './work-enabled.guard';
import { WorkJobsService } from './work-jobs.service';
import { WorkOrgsService } from './work-orgs.service';
import { WorkPaymentsService } from './work-payments.service';
import { WorkWorkersService } from './work-workers.service';

const READ_ROLES = [Role.PLATFORM_ADMIN, Role.CO_FOUNDER, Role.PLATFORM_VIEWER];
// WORK_REVIEWER (junior admin) is an add-on to one of the READ_ROLES above, so it inherits read
// access from that role and is only listed on the three review routes below. Everything that moves
// money, suspends people, resolves disputes or runs the sweep stays PLATFORM_ADMIN only.
const statusQuery = <T extends Record<string, string>>(e: T) =>
  z.object({ status: z.nativeEnum(e).optional() });
const auditQuery = z.object({
  jobId: z.string().uuid().optional(),
  orgId: z.string().uuid().optional(),
  entityType: z.string().max(40).optional(),
  entityId: z.string().max(80).optional(),
});
const verifySchema = z.object({ note: z.string().trim().min(5).max(1000) });
const suspendSchema = z.object({
  suspended: z.boolean(),
  reason: z.string().trim().min(5).max(1000),
});
const workerQuery = z.object({ q: z.string().trim().max(80).optional() });

/**
 * Platform control centre for FastQue Work. Reads are open to admins, co-founders and read-only
 * viewers; every write is PLATFORM_ADMIN only (an ADMIN-audience, TOTP-gated session — see
 * RolesGuard) and is recorded in the append-only audit trail.
 */
@Controller('work/admin')
@UseGuards(WorkEnabledGuard)
@Roles(...READ_ROLES)
export class WorkAdminController {
  constructor(
    private readonly admin: WorkAdminService,
    private readonly orgs: WorkOrgsService,
    private readonly jobs: WorkJobsService,
    private readonly workers: WorkWorkersService,
    private readonly assignments: WorkAssignmentsService,
    private readonly disputes: WorkDisputesService,
    private readonly payments: WorkPaymentsService,
  ) {}

  @Get('overview')
  overview() {
    return this.admin.overview();
  }

  @Get('ledger')
  ledger() {
    return this.admin.trialBalance();
  }

  @Get('orgs')
  listOrgs(
    @Query(new ZodValidationPipe(statusQuery(WorkOrgStatus)))
    q: {
      status?: WorkOrgStatus;
    },
  ) {
    return this.orgs.adminList(q.status);
  }

  @Post('orgs/:orgId/review')
  @Roles(Role.PLATFORM_ADMIN, Role.WORK_REVIEWER)
  @HttpCode(HttpStatus.OK)
  reviewOrg(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body(new ZodValidationPipe(workOrgReviewSchema))
    body: z.infer<typeof workOrgReviewSchema>,
  ) {
    return this.orgs.adminReview(user.id, orgId, body.decision, body.reason);
  }

  @Get('jobs')
  listJobs(
    @Query(new ZodValidationPipe(statusQuery(WorkJobStatus)))
    q: {
      status?: WorkJobStatus;
    },
  ) {
    return this.jobs.adminList(q.status);
  }

  @Post('jobs/:jobId/moderate')
  @Roles(Role.PLATFORM_ADMIN, Role.WORK_REVIEWER)
  @HttpCode(HttpStatus.OK)
  moderate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Body(new ZodValidationPipe(workJobModerationSchema))
    body: z.infer<typeof workJobModerationSchema>,
  ) {
    return this.jobs.moderate(user.id, jobId, body.decision, body.reason);
  }

  @Get('workers')
  listWorkers(
    @Query(new ZodValidationPipe(workerQuery)) q: z.infer<typeof workerQuery>,
  ) {
    return this.workers.adminList(q.q);
  }

  @Post('workers/:userId/verify')
  @Roles(Role.PLATFORM_ADMIN, Role.WORK_REVIEWER)
  @HttpCode(HttpStatus.OK)
  verifyWorker(
    @CurrentUser() user: AuthenticatedUser,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body(new ZodValidationPipe(verifySchema))
    body: z.infer<typeof verifySchema>,
  ) {
    return this.workers.adminVerify(user.id, userId, body.note);
  }

  @Post('workers/:userId/suspension')
  @Roles(Role.PLATFORM_ADMIN)
  @HttpCode(HttpStatus.OK)
  suspendWorker(
    @CurrentUser() user: AuthenticatedUser,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body(new ZodValidationPipe(suspendSchema))
    body: z.infer<typeof suspendSchema>,
  ) {
    return this.workers.adminSetSuspended(
      user.id,
      userId,
      body.suspended,
      body.reason,
    );
  }

  @Get('assignments/:assignmentId')
  assignment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('assignmentId', ParseUUIDPipe) id: string,
  ) {
    return this.assignments.detail(user.id, id, true);
  }

  @Get('evidence/:fileId')
  async evidence(
    @CurrentUser() user: AuthenticatedUser,
    @Param('fileId', ParseUUIDPipe) fileId: string,
    @Res() res: Response,
  ) {
    const file = await this.assignments.evidenceFile(user.id, fileId, true);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(file.content);
  }

  @Get('payouts')
  listPayouts(
    @Query(new ZodValidationPipe(statusQuery(WorkPayoutStatus)))
    q: {
      status?: WorkPayoutStatus;
    },
  ) {
    return this.admin.payouts(q.status);
  }

  /** Which payment method is active, so the console shows the matching controls. */
  @Get('payments/config')
  paymentsConfig() {
    return {
      provider: this.payments.providerName,
      sandbox: this.payments.isSandbox,
      payoutMethod: this.payments.payoutMethod,
    };
  }

  /** Manual bank transfer: employer transfers waiting to be matched on the bank statement. */
  @Get('fundings/manual')
  manualFundings() {
    return this.payments.pendingManualFundings();
  }

  @Post('fundings/:fundingId/manual-confirm')
  @Roles(Role.PLATFORM_ADMIN)
  @HttpCode(HttpStatus.OK)
  confirmManualFunding(
    @CurrentUser() user: AuthenticatedUser,
    @Param('fundingId', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(workManualFundingConfirmSchema))
    body: WorkManualFundingConfirmInput,
  ) {
    return this.payments.confirmManualFunding(user.id, id, body);
  }

  @Post('payouts/:payoutId/manual-confirm')
  @Roles(Role.PLATFORM_ADMIN)
  @HttpCode(HttpStatus.OK)
  confirmManualPayout(
    @CurrentUser() user: AuthenticatedUser,
    @Param('payoutId', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(workManualPayoutConfirmSchema))
    body: WorkManualPayoutConfirmInput,
  ) {
    return this.payments.confirmManualPayout(user.id, id, body);
  }

  /** NEFT batch with workers' bank account numbers. PLATFORM_ADMIN only; each export is audited. */
  @Get('payouts/neft-export.csv')
  @Roles(Role.PLATFORM_ADMIN)
  async neftExport(
    @CurrentUser() user: AuthenticatedUser,
    @Res() res: Response,
  ) {
    const csv = await this.payments.manualPayoutCsv(user.id);
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="fastque-work-neft-${stamp}.csv"`,
    );
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(csv);
  }

  @Post('payouts/process')
  @Roles(Role.PLATFORM_ADMIN)
  @HttpCode(HttpStatus.OK)
  async processPayouts() {
    return { attempted: await this.payments.initiatePendingPayoutsFor() };
  }

  @Post('payouts/:payoutId/retry')
  @Roles(Role.PLATFORM_ADMIN)
  @HttpCode(HttpStatus.OK)
  retryPayout(
    @CurrentUser() user: AuthenticatedUser,
    @Param('payoutId', ParseUUIDPipe) id: string,
  ) {
    return this.payments.retryPayout(user.id, id);
  }

  @Get('disputes')
  listDisputes(
    @Query(new ZodValidationPipe(statusQuery(WorkDisputeStatus)))
    q: {
      status?: WorkDisputeStatus;
    },
  ) {
    return this.disputes.adminList(q.status);
  }

  @Post('disputes/:disputeId/resolve')
  @Roles(Role.PLATFORM_ADMIN)
  @HttpCode(HttpStatus.OK)
  resolve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('disputeId', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(workDisputeResolveSchema))
    body: z.infer<typeof workDisputeResolveSchema>,
  ) {
    return this.disputes.resolve(user.id, id, body.awardPaise, body.note);
  }

  @Get('audit')
  audit(
    @Query(new ZodValidationPipe(auditQuery)) q: z.infer<typeof auditQuery>,
  ) {
    return this.admin.auditTrail(q);
  }

  /** Runs the default-resolution deadlines now (they also run on their own schedule). */
  @Post('sweep')
  @Roles(Role.PLATFORM_ADMIN)
  @HttpCode(HttpStatus.OK)
  sweep() {
    return this.assignments.sweep();
  }
}
