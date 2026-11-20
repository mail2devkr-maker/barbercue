import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { z } from 'zod';
import {
  workCancelSchema,
  workJobUpsertSchema,
  workOrgUpsertSchema,
  workReviewSchema,
  type AuthenticatedUser,
  type WorkJobUpsertInput,
  type WorkOrgUpsertInput,
  type WorkReviewInput,
} from '@barbercue/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Idempotent } from '../common/decorators/idempotent.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { WorkAdminService } from './work-admin.service';
import { WorkAssignmentsService } from './work-assignments.service';
import { WorkEnabledGuard } from './work-enabled.guard';
import { WorkJobsService } from './work-jobs.service';
import { WorkOrgsService } from './work-orgs.service';
import { WorkPaymentsService } from './work-payments.service';

const versionSchema = z.object({ version: z.number().int().min(1) });
const decideSchema = z.object({ decision: z.enum(['OFFER', 'REJECT']) });

/**
 * Employer (business) routes. Every route under orgs/:orgId resolves the caller's membership of
 * that organization server-side (WorkAccessService) before anything else is read or written.
 */
@Controller('work/orgs')
@UseGuards(WorkEnabledGuard)
export class WorkEmployerController {
  constructor(
    private readonly orgs: WorkOrgsService,
    private readonly jobs: WorkJobsService,
    private readonly assignments: WorkAssignmentsService,
    private readonly payments: WorkPaymentsService,
    private readonly admin: WorkAdminService,
  ) {}

  @Get('mine')
  mine(@CurrentUser() user: AuthenticatedUser) {
    return this.orgs.mine(user.id);
  }

  @Post()
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(workOrgUpsertSchema)) body: WorkOrgUpsertInput,
  ) {
    return this.orgs.create(user.id, body);
  }

  @Put(':orgId')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body(new ZodValidationPipe(workOrgUpsertSchema)) body: WorkOrgUpsertInput,
  ) {
    return this.orgs.update(user.id, orgId, body);
  }

  @Post(':orgId/submit')
  @HttpCode(HttpStatus.OK)
  submit(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
  ) {
    return this.orgs.submit(user.id, orgId);
  }

  @Get(':orgId/report')
  report(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
  ) {
    return this.admin.orgReport(user.id, orgId);
  }

  @Get(':orgId/jobs')
  listJobs(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
  ) {
    return this.jobs.listForOrg(user.id, orgId);
  }

  @Post(':orgId/jobs')
  createJob(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Body(new ZodValidationPipe(workJobUpsertSchema)) body: WorkJobUpsertInput,
  ) {
    return this.jobs.createDraft(user.id, orgId, body);
  }

  @Get(':orgId/jobs/:jobId')
  getJob(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ) {
    return this.jobs.employerJob(user.id, orgId, jobId);
  }

  @Put(':orgId/jobs/:jobId')
  updateJob(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Body(new ZodValidationPipe(workJobUpsertSchema)) body: WorkJobUpsertInput,
  ) {
    return this.jobs.updateDraft(user.id, orgId, jobId, body);
  }

  /** The employer has reviewed the full preview and quote; `version` is the one they approved. */
  @Post(':orgId/jobs/:jobId/publish')
  @HttpCode(HttpStatus.OK)
  publish(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Body(new ZodValidationPipe(versionSchema))
    body: z.infer<typeof versionSchema>,
  ) {
    return this.jobs.publish(user.id, orgId, jobId, body.version);
  }

  @Post(':orgId/jobs/:jobId/fund')
  @Idempotent()
  fund(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Body(new ZodValidationPipe(versionSchema))
    body: z.infer<typeof versionSchema>,
    @Headers('idempotency-key') key: string,
  ) {
    return this.payments.createFunding(
      user.id,
      orgId,
      jobId,
      body.version,
      key,
    );
  }

  @Post(':orgId/jobs/:jobId/cancel')
  @HttpCode(HttpStatus.OK)
  async cancelJob(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('jobId', ParseUUIDPipe) jobId: string,
    @Body(new ZodValidationPipe(workCancelSchema))
    body: z.infer<typeof workCancelSchema>,
  ) {
    const r = await this.jobs.cancelJob(
      user.id,
      orgId,
      jobId,
      body.reason,
      async (tx, assignmentId) => {
        await this.assignments.employerCancelInTx(
          tx,
          assignmentId,
          user.id,
          body.reason,
        );
      },
    );
    await this.payments.initiatePendingPayoutsFor();
    return r;
  }

  @Post(':orgId/jobs/:jobId/close')
  @HttpCode(HttpStatus.OK)
  close(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('jobId', ParseUUIDPipe) jobId: string,
  ) {
    return this.jobs.closeJob(user.id, orgId, jobId);
  }

  @Post(':orgId/applications/:applicationId/decide')
  @HttpCode(HttpStatus.OK)
  decide(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('applicationId', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(decideSchema))
    body: z.infer<typeof decideSchema>,
  ) {
    return this.assignments.decideApplication(
      user.id,
      orgId,
      id,
      body.decision,
    );
  }

  @Post(':orgId/assignments/:assignmentId/review')
  @HttpCode(HttpStatus.OK)
  review(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('assignmentId', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(workReviewSchema)) body: WorkReviewInput,
  ) {
    return this.assignments.review(user.id, orgId, id, body);
  }

  @Post(':orgId/assignments/:assignmentId/confirm-attendance')
  @HttpCode(HttpStatus.OK)
  confirmAttendance(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('assignmentId', ParseUUIDPipe) id: string,
  ) {
    return this.assignments.confirmAttendance(user.id, orgId, id);
  }

  @Post(':orgId/assignments/:assignmentId/no-show')
  @HttpCode(HttpStatus.OK)
  noShow(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('assignmentId', ParseUUIDPipe) id: string,
  ) {
    return this.assignments.flagNoShow(user.id, orgId, id);
  }

  @Post(':orgId/assignments/:assignmentId/cancel')
  @HttpCode(HttpStatus.OK)
  cancelAssignment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Param('assignmentId', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(workCancelSchema))
    body: z.infer<typeof workCancelSchema>,
  ) {
    return this.assignments.employerCancel(user.id, orgId, id, body.reason);
  }
}
