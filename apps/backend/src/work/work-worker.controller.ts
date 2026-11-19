import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { z } from 'zod';
import {
  draftWorkJobFromText,
  WORK_LIMITS,
  workCancelSchema,
  workCheckInSchema,
  workDisputeOpenSchema,
  workDraftRequestSchema,
  workerProfileUpsertSchema,
  workTaskResponseSchema,
  type AuthenticatedUser,
  type WorkCheckInInput,
  type WorkerProfileUpsertInput,
} from '@barbercue/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Idempotent } from '../common/decorators/idempotent.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { WorkAssignmentsService } from './work-assignments.service';
import { WorkDisputesService } from './work-disputes.service';
import { WorkEnabledGuard } from './work-enabled.guard';
import { WorkJobsService } from './work-jobs.service';
import { WorkWorkersService } from './work-workers.service';

const applySchema = z.object({ note: z.string().trim().max(600).optional() });
const offerResponseSchema = z.object({ response: z.enum(['ACCEPT', 'DECLINE']) });
const ITEM_ID = /^[a-z0-9-]{1,40}$/;

/**
 * Worker-side routes. Any signed-in account can be a worker; everything is scoped to the caller
 * (their profile, their applications, their assignments). Authorization is enforced in the
 * services, never by the client.
 */
@Controller('work')
@UseGuards(WorkEnabledGuard)
export class WorkWorkerController {
  constructor(
    private readonly workers: WorkWorkersService,
    private readonly jobs: WorkJobsService,
    private readonly assignments: WorkAssignmentsService,
    private readonly disputes: WorkDisputesService,
  ) {}

  @Get('me/profile')
  profile(@CurrentUser() user: AuthenticatedUser) {
    return this.workers.getProfile(user.id);
  }

  @Put('me/profile')
  saveProfile(@CurrentUser() user: AuthenticatedUser, @Body(new ZodValidationPipe(workerProfileUpsertSchema)) body: WorkerProfileUpsertInput) {
    return this.workers.upsertProfile(user.id, body);
  }

  @Get('me/dashboard')
  dashboard(@CurrentUser() user: AuthenticatedUser) {
    return this.workers.dashboard(user.id);
  }

  @Get('me/earnings')
  earnings(@CurrentUser() user: AuthenticatedUser) {
    return this.workers.earnings(user.id);
  }

  @Get('me/jobs/:jobId')
  jobForMe(@CurrentUser() user: AuthenticatedUser, @Param('jobId', ParseUUIDPipe) jobId: string) {
    return this.jobs.viewerDetail(user.id, jobId);
  }

  @Post('jobs/:jobId/accept')
  @Idempotent()
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  accept(@CurrentUser() user: AuthenticatedUser, @Param('jobId', ParseUUIDPipe) jobId: string) {
    return this.assignments.acceptInstant(user.id, jobId);
  }

  @Post('jobs/:jobId/apply')
  @Throttle({ default: { ttl: 60_000, limit: 20 } })
  apply(@CurrentUser() user: AuthenticatedUser, @Param('jobId', ParseUUIDPipe) jobId: string, @Body(new ZodValidationPipe(applySchema)) body: z.infer<typeof applySchema>) {
    return this.assignments.apply(user.id, jobId, body.note);
  }

  @Post('applications/:applicationId/withdraw')
  @HttpCode(HttpStatus.OK)
  withdraw(@CurrentUser() user: AuthenticatedUser, @Param('applicationId', ParseUUIDPipe) id: string) {
    return this.assignments.withdrawApplication(user.id, id);
  }

  @Post('applications/:applicationId/respond')
  @HttpCode(HttpStatus.OK)
  respond(@CurrentUser() user: AuthenticatedUser, @Param('applicationId', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(offerResponseSchema)) body: z.infer<typeof offerResponseSchema>) {
    return this.assignments.respondToOffer(user.id, id, body.response);
  }

  @Get('assignments/:assignmentId')
  assignment(@CurrentUser() user: AuthenticatedUser, @Param('assignmentId', ParseUUIDPipe) id: string) {
    return this.assignments.detail(user.id, id);
  }

  @Post('assignments/:assignmentId/check-in')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  checkIn(@CurrentUser() user: AuthenticatedUser, @Param('assignmentId', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(workCheckInSchema)) body: WorkCheckInInput) {
    return this.assignments.checkIn(user.id, id, body);
  }

  @Put('assignments/:assignmentId/responses/:itemId')
  saveResponse(
    @CurrentUser() user: AuthenticatedUser,
    @Param('assignmentId', ParseUUIDPipe) id: string,
    @Param('itemId') itemId: string,
    @Body(new ZodValidationPipe(workTaskResponseSchema)) body: z.infer<typeof workTaskResponseSchema>,
  ) {
    if (!ITEM_ID.test(itemId)) return this.assignments.saveResponse(user.id, id, '__invalid__', body);
    return this.assignments.saveResponse(user.id, id, itemId, body);
  }

  @Post('assignments/:assignmentId/evidence/:itemId')
  @Throttle({ default: { ttl: 60_000, limit: 30 } })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: WORK_LIMITS.maxEvidenceBytes, files: 1 } }))
  uploadEvidence(
    @CurrentUser() user: AuthenticatedUser,
    @Param('assignmentId', ParseUUIDPipe) id: string,
    @Param('itemId') itemId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return this.assignments.uploadEvidence(user.id, id, ITEM_ID.test(itemId) ? itemId : '__invalid__', file);
  }

  /** Private evidence: only the worker, the employer's members (and admins via the admin route). */
  @Get('evidence/:fileId')
  async evidence(@CurrentUser() user: AuthenticatedUser, @Param('fileId', ParseUUIDPipe) fileId: string, @Res() res: Response) {
    const file = await this.assignments.evidenceFile(user.id, fileId);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', 'inline');
    res.send(file.content);
  }

  @Post('assignments/:assignmentId/submit')
  @HttpCode(HttpStatus.OK)
  submit(@CurrentUser() user: AuthenticatedUser, @Param('assignmentId', ParseUUIDPipe) id: string) {
    return this.assignments.submit(user.id, id);
  }

  @Post('assignments/:assignmentId/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('assignmentId', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(workCancelSchema)) body: z.infer<typeof workCancelSchema>) {
    return this.assignments.workerCancel(user.id, id, body.reason);
  }

  /** Either party (worker, or the employer's owner/manager) opens a dispute on the assignment. */
  @Post('assignments/:assignmentId/disputes')
  openDispute(@CurrentUser() user: AuthenticatedUser, @Param('assignmentId', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(workDisputeOpenSchema)) body: z.infer<typeof workDisputeOpenSchema>) {
    return this.disputes.open(user.id, id, body.reasonCode, body.description);
  }

  /** Rules-based smart draft for employers. Deterministic, no AI provider, never invents fields. */
  @Post('draft')
  @HttpCode(HttpStatus.OK)
  draft(@Body(new ZodValidationPipe(workDraftRequestSchema)) body: z.infer<typeof workDraftRequestSchema>) {
    return draftWorkJobFromText(body.text);
  }
}
