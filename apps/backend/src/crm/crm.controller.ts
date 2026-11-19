import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { z } from 'zod';
import {
  CRM_PATHS as P,
  SALES_RECORDING_MAX_BYTES,
  crmAnalyticsQuerySchema,
  crmAssignSchema,
  crmBulkAssignSchema,
  crmBulkTaskSchema,
  crmCallInputSchema,
  crmCallLogSchema,
  crmImportPreviewSchema,
  crmLeadInputSchema,
  crmLeadListQuerySchema,
  crmLeadUpdateSchema,
  crmMeetingInputSchema,
  crmMeetingUpdateSchema,
  crmNoteSchema,
  crmRangeQuerySchema,
  crmTaskInputSchema,
  crmTaskListQuerySchema,
  crmTaskUpdateSchema,
  salesRecordingMetaSchema,
  salesReviewSchema,
  supportCommentSchema,
  supportTicketInputSchema,
  supportTicketListQuerySchema,
  supportTicketUpdateSchema,
  type AuthenticatedUser,
  type CrmAnalyticsQuery,
  type CrmCallInput,
  type CrmCallLogInput,
  type CrmLeadInput,
  type CrmLeadListQuery,
  type CrmLeadUpdateInput,
  type CrmMeetingInput,
  type CrmMeetingUpdateInput,
  type CrmRangeQuery,
  type CrmTaskInput,
  type CrmTaskListQuery,
  type CrmTaskStatus,
  type CrmTaskUpdateInput,
  type SalesRecordingMeta,
  type SupportTicketInput,
  type SupportTicketListQuery,
  type SupportTicketUpdateInput,
} from '@barbercue/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AppException } from '../common/exceptions/app.exception';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { PrismaService } from '../prisma/prisma.service';
import { CRM_ROLES, CrmAccessService } from './crm-access.service';
import { CrmActivityService } from './crm-activity.service';
import { CrmAnalyticsService } from './crm-analytics.service';
import { CrmLeadsService, employeeSelect, toEmployeeRef } from './crm-leads.service';
import { CrmRecordingsService } from './crm-recordings.service';
import { ATTACHMENT_MAX_BYTES, CrmTicketsService } from './crm-tickets.service';

const leadImportUpload = FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 5 } });
const recordingUpload = FileInterceptor('audio', { storage: memoryStorage(), limits: { fileSize: SALES_RECORDING_MAX_BYTES, files: 1, fields: 12 } });
const attachmentUpload = FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: ATTACHMENT_MAX_BYTES, files: 1 } });
const listQuery = z.object({ leadId: z.string().uuid().optional(), employeeId: z.string().uuid().optional() }).strict();
const queueQuery = z.object({ employeeId: z.string().uuid().optional() }).strict();

/**
 * FastQue Employee CRM 2.0 API (crm/...). One API for field employees (/employee portal) and for
 * sales managers / admins (admin dashboard). What each caller sees is decided server-side by
 * CrmAccessService from their own roles — ids in requests never widen access.
 */
@Controller(P.root)
@Roles(...CRM_ROLES)
export class CrmController {
  constructor(
    private readonly access: CrmAccessService,
    private readonly leads: CrmLeadsService,
    private readonly activity: CrmActivityService,
    private readonly recordings: CrmRecordingsService,
    private readonly tickets: CrmTicketsService,
    private readonly analyticsService: CrmAnalyticsService,
    private readonly prisma: PrismaService,
  ) {}

  @Get(P.me)
  @Header('Cache-Control', 'private, no-store')
  async me(@CurrentUser() user: AuthenticatedUser) {
    const a = await this.access.actor(user);
    const e = a.employeeProfileId ? await this.prisma.employeeProfile.findUnique({ where: { id: a.employeeProfileId }, select: employeeSelect }) : null;
    return this.access.me(a, e ? toEmployeeRef(e) : null);
  }

  @Get(P.dashboard)
  @Header('Cache-Control', 'private, no-store')
  async dashboard(@CurrentUser() user: AuthenticatedUser, @Query(new ZodValidationPipe(crmAnalyticsQuerySchema)) q: CrmAnalyticsQuery) {
    return this.analyticsService.dashboard(await this.access.actor(user), q);
  }

  @Get(P.analytics)
  @Header('Cache-Control', 'private, no-store')
  async analytics(@CurrentUser() user: AuthenticatedUser, @Query(new ZodValidationPipe(crmAnalyticsQuerySchema)) q: CrmAnalyticsQuery) {
    return this.analyticsService.analytics(await this.access.actor(user), q);
  }

  // ---------- Leads ----------

  @Get(P.leads)
  @Header('Cache-Control', 'private, no-store')
  async listLeads(@CurrentUser() user: AuthenticatedUser, @Query(new ZodValidationPipe(crmLeadListQuerySchema)) q: CrmLeadListQuery) {
    return this.leads.list(await this.access.actor(user), q);
  }

  @Post(P.leads)
  async createLead(@CurrentUser() user: AuthenticatedUser, @Body(new ZodValidationPipe(crmLeadInputSchema)) body: CrmLeadInput) {
    return this.leads.create(await this.access.actor(user), body);
  }

  @Post(P.bulkAssign)
  @HttpCode(HttpStatus.OK)
  async bulkAssign(@CurrentUser() user: AuthenticatedUser, @Body(new ZodValidationPipe(crmBulkAssignSchema)) body: { leadIds: string[]; employeeId: string }) {
    return this.leads.assign(await this.access.actor(user), body.leadIds, body.employeeId);
  }

  @Get(P.importTemplate)
  async importTemplate(@CurrentUser() user: AuthenticatedUser, @Res() res: Response) {
    this.access.assertManage(await this.access.actor(user));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="fastque-lead-import-template.csv"');
    res.send(this.leads.templateCsv());
  }

  @Post(P.importPreview)
  @UseInterceptors(leadImportUpload)
  async importPreview(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body(new ZodValidationPipe(crmImportPreviewSchema)) body: { mapping?: string; defaultEmployeeId?: string },
  ) {
    if (!file?.buffer?.length) throw new AppException('CRM_IMPORT_FILE', 'Choose a CSV or Excel (.xlsx) file.', HttpStatus.BAD_REQUEST);
    if (!/\.(csv|xlsx|txt)$/i.test(file.originalname ?? '')) throw new AppException('CRM_IMPORT_FILE', 'Upload a .csv or .xlsx file.', HttpStatus.BAD_REQUEST);
    return this.leads.importPreview(await this.access.actor(user), file, body.mapping, body.defaultEmployeeId);
  }

  @Get(P.imports)
  @Header('Cache-Control', 'private, no-store')
  async imports(@CurrentUser() user: AuthenticatedUser) {
    return this.leads.imports(await this.access.actor(user));
  }

  @Post(`${P.imports}/:jobId/${P.importCommit}`)
  @HttpCode(HttpStatus.OK)
  async importCommit(@CurrentUser() user: AuthenticatedUser, @Param('jobId', ParseUUIDPipe) jobId: string) {
    return this.leads.importCommit(await this.access.actor(user), jobId);
  }

  @Get(`${P.leads}/:id`)
  @Header('Cache-Control', 'private, no-store')
  async getLead(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.leads.get(await this.access.actor(user), id);
  }

  @Patch(`${P.leads}/:id`)
  async updateLead(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(crmLeadUpdateSchema)) body: CrmLeadUpdateInput) {
    return this.leads.update(await this.access.actor(user), id, body);
  }

  @Post(`${P.leads}/:id/${P.assign}`)
  @HttpCode(HttpStatus.OK)
  async assign(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(crmAssignSchema)) body: { employeeId: string; note?: string | null }) {
    const a = await this.access.actor(user);
    const result = await this.leads.assign(a, [id], body.employeeId, body.note);
    if (!result.assigned && result.skipped[0]) throw new AppException('CRM_ASSIGN_SKIPPED', result.skipped[0].reason, HttpStatus.CONFLICT);
    return this.leads.get(a, id);
  }

  @Get(`${P.leads}/:id/${P.timeline}`)
  @Header('Cache-Control', 'private, no-store')
  async timeline(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.leads.timeline(await this.access.actor(user), id);
  }

  @Post(`${P.leads}/:id/${P.notes}`)
  async addNote(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(crmNoteSchema)) body: { body: string }) {
    return this.leads.addNote(await this.access.actor(user), id, body.body);
  }

  @Get(P.employees)
  @Header('Cache-Control', 'private, no-store')
  async employees(@CurrentUser() user: AuthenticatedUser) {
    return this.leads.employees(await this.access.actor(user));
  }

  // ---------- Tasks ----------

  @Get(P.tasks)
  @Header('Cache-Control', 'private, no-store')
  async listTasks(@CurrentUser() user: AuthenticatedUser, @Query(new ZodValidationPipe(crmTaskListQuerySchema)) q: CrmTaskListQuery) {
    return this.activity.listTasks(await this.access.actor(user), q);
  }

  @Post(P.tasks)
  async createTask(@CurrentUser() user: AuthenticatedUser, @Body(new ZodValidationPipe(crmTaskInputSchema)) body: CrmTaskInput) {
    return this.activity.createTask(await this.access.actor(user), body);
  }

  @Post(`${P.tasks}/bulk`)
  @HttpCode(HttpStatus.OK)
  async bulkTasks(@CurrentUser() user: AuthenticatedUser, @Body(new ZodValidationPipe(crmBulkTaskSchema)) body: { taskIds: string[]; status?: CrmTaskStatus; assigneeEmployeeId?: string }) {
    return this.activity.bulkTasks(await this.access.actor(user), body.taskIds, body.status, body.assigneeEmployeeId);
  }

  @Patch(`${P.tasks}/:id`)
  async updateTask(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(crmTaskUpdateSchema)) body: CrmTaskUpdateInput) {
    return this.activity.updateTask(await this.access.actor(user), id, body);
  }

  // ---------- Meetings ----------

  @Get(P.meetings)
  @Header('Cache-Control', 'private, no-store')
  async listMeetings(@CurrentUser() user: AuthenticatedUser, @Query(new ZodValidationPipe(crmRangeQuerySchema)) q: CrmRangeQuery) {
    return this.activity.listMeetings(await this.access.actor(user), q);
  }

  @Post(P.meetings)
  async createMeeting(@CurrentUser() user: AuthenticatedUser, @Body(new ZodValidationPipe(crmMeetingInputSchema)) body: CrmMeetingInput) {
    return this.activity.createMeeting(await this.access.actor(user), body);
  }

  @Patch(`${P.meetings}/:id`)
  async updateMeeting(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(crmMeetingUpdateSchema)) body: CrmMeetingUpdateInput) {
    return this.activity.updateMeeting(await this.access.actor(user), id, body);
  }

  // ---------- Calls ----------

  @Get(P.callQueue)
  @Header('Cache-Control', 'private, no-store')
  async callQueue(@CurrentUser() user: AuthenticatedUser, @Query(new ZodValidationPipe(queueQuery)) q: { employeeId?: string }) {
    return this.activity.callQueue(await this.access.actor(user), q.employeeId);
  }

  @Get(P.calls)
  @Header('Cache-Control', 'private, no-store')
  async listCalls(@CurrentUser() user: AuthenticatedUser, @Query(new ZodValidationPipe(crmRangeQuerySchema)) q: CrmRangeQuery) {
    return this.activity.listCalls(await this.access.actor(user), q);
  }

  @Post(P.calls)
  async createCall(@CurrentUser() user: AuthenticatedUser, @Body(new ZodValidationPipe(crmCallInputSchema)) body: CrmCallInput) {
    return this.activity.createCall(await this.access.actor(user), body);
  }

  @Post(`${P.calls}/:id/log`)
  @HttpCode(HttpStatus.OK)
  async logCall(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(crmCallLogSchema)) body: CrmCallLogInput) {
    return this.activity.logCall(await this.access.actor(user), id, body);
  }

  // ---------- Sales conversations ----------

  @Get(P.aiStatus)
  @Header('Cache-Control', 'private, no-store')
  async aiStatus(@CurrentUser() user: AuthenticatedUser) {
    const a = await this.access.actor(user);
    return { ...this.recordings.aiStatus(a), usage: a.manage ? await this.recordings.usage(a) : null };
  }

  @Get(P.recordings)
  @Header('Cache-Control', 'private, no-store')
  async listRecordings(@CurrentUser() user: AuthenticatedUser, @Query(new ZodValidationPipe(listQuery)) q: { leadId?: string; employeeId?: string }) {
    return this.recordings.list(await this.access.actor(user), q);
  }

  @Post(P.recordings)
  @UseInterceptors(recordingUpload)
  async uploadRecording(@CurrentUser() user: AuthenticatedUser, @UploadedFile() file: Express.Multer.File | undefined, @Body(new ZodValidationPipe(salesRecordingMetaSchema)) body: SalesRecordingMeta) {
    return this.recordings.upload(await this.access.actor(user), file, body);
  }

  @Get(`${P.recordings}/:id/${P.audio}`)
  async audio(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const { body, mimeType } = await this.recordings.audio(await this.access.actor(user), id);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Disposition', 'inline');
    res.send(body);
  }

  @Post(`${P.recordings}/:id/${P.analyze}`)
  @HttpCode(HttpStatus.OK)
  async analyse(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.recordings.analyse(await this.access.actor(user), id);
  }

  @Patch(`${P.recordings}/:id/${P.review}`)
  async review(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(salesReviewSchema)) body: { reviewerNotes?: string | null; correctedScore?: number | null }) {
    return this.recordings.review(await this.access.actor(user), id, body);
  }

  @Delete(`${P.recordings}/:id`)
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteRecording(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.recordings.remove(await this.access.actor(user), id);
  }

  // ---------- Support ----------

  @Get(`${P.tickets}/agents`)
  @Header('Cache-Control', 'private, no-store')
  async agents(@CurrentUser() user: AuthenticatedUser) {
    return this.tickets.agents(await this.access.actor(user));
  }

  @Get(P.tickets)
  @Header('Cache-Control', 'private, no-store')
  async listTickets(@CurrentUser() user: AuthenticatedUser, @Query(new ZodValidationPipe(supportTicketListQuerySchema)) q: SupportTicketListQuery) {
    return this.tickets.list(await this.access.actor(user), q);
  }

  @Post(P.tickets)
  async createTicket(@CurrentUser() user: AuthenticatedUser, @Body(new ZodValidationPipe(supportTicketInputSchema)) body: SupportTicketInput) {
    return this.tickets.create(await this.access.actor(user), body);
  }

  @Get(`${P.tickets}/:id`)
  @Header('Cache-Control', 'private, no-store')
  async getTicket(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.tickets.get(await this.access.actor(user), id);
  }

  @Patch(`${P.tickets}/:id`)
  async updateTicket(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(supportTicketUpdateSchema)) body: SupportTicketUpdateInput) {
    return this.tickets.update(await this.access.actor(user), id, body);
  }

  @Post(`${P.tickets}/:id/${P.comments}`)
  async comment(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodValidationPipe(supportCommentSchema)) body: { body: string; internal: boolean }) {
    return this.tickets.comment(await this.access.actor(user), id, body.body, body.internal);
  }

  @Post(`${P.tickets}/:id/${P.attachments}`)
  @UseInterceptors(attachmentUpload)
  async attach(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File | undefined) {
    return this.tickets.attach(await this.access.actor(user), id, file);
  }

  @Get(`${P.tickets}/:id/${P.attachments}/:attachmentId`)
  async attachment(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string, @Param('attachmentId', ParseUUIDPipe) attachmentId: string, @Res() res: Response) {
    const { body, mimeType } = await this.tickets.attachmentFile(await this.access.actor(user), id, attachmentId);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Cache-Control', 'private, no-store');
    res.send(body);
  }

  // ---------- Notifications ----------

  @Get(P.notifications)
  @Header('Cache-Control', 'private, no-store')
  async notifications(@CurrentUser() user: AuthenticatedUser) {
    return this.analyticsService.notifications(await this.access.actor(user));
  }

  @Post(`${P.notifications}/:id/read`)
  @HttpCode(HttpStatus.NO_CONTENT)
  async markRead(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    if (id !== 'all' && !/^[0-9a-f-]{36}$/i.test(id)) throw new AppException('CRM_NOT_FOUND', 'Notification not found.', HttpStatus.NOT_FOUND);
    await this.analyticsService.markRead(await this.access.actor(user), id);
  }
}
