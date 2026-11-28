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
  Put,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import { z } from 'zod';
import {
  connectActionDecisionSchema,
  connectActionRequestSchema,
  connectAdminAccessSchema,
  connectAssignSchema,
  connectComplaintSchema,
  connectConversationPatchSchema,
  connectEditSchema,
  connectInboxQuerySchema,
  connectLocationSchema,
  connectNoteSchema,
  connectPrefsSchema,
  connectQuotationDecisionSchema,
  connectQuotationSchema,
  connectReactSchema,
  connectReadSchema,
  connectReportSchema,
  connectSalonSettingsSchema,
  connectSavedReplySchema,
  connectSendSchema,
  connectStaffGrantSchema,
  connectTranslateSchema,
  connectUserPrefsSchema,
  CONNECT_TEMPLATES,
  Role,
  type AuthenticatedUser,
} from '@barbercue/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Public } from '../auth/decorators/public.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { ConnectAccessService } from './connect-access.service';
import { ConnectActionsService } from './connect-actions.service';
import { ConnectBusinessService } from './connect-business.service';
import {
  ConnectConfigService,
  ConnectEnabledGuard,
  connectError,
  connectFlag,
  connectFlags,
  connectNotFound,
} from './connect-config';
import { ConnectConversationsService } from './connect-conversations.service';
import { ConnectInsightsService, parseRange } from './connect-insights.service';
import { ConnectLinksService } from './connect-links.service';
import { verifyMediaSignature } from './connect-media';
import { ConnectMessagesService } from './connect-messages.service';
import { ConnectAiService } from './ai/connect-ai.service';

const upload = FileInterceptor('file', {
  storage: memoryStorage(),
  limits: { fileSize: 26 * 1024 * 1024, files: 1 },
});
const ensureSchema = z
  .object({
    bookingId: z.string().uuid().optional(),
    queueEntryId: z.string().uuid().optional(),
    homeBookingId: z.string().uuid().optional(),
    homeBookingCode: z.string().regex(/^[A-Z0-9-]{4,16}$/).optional(),
  })
  .refine(
    (x) =>
      [x.bookingId, x.queueEntryId, x.homeBookingId, x.homeBookingCode].filter(Boolean).length ===
      1,
    { message: 'Give exactly one booking.' },
  );
const pageSchema = z.object({
  before: z.coerce.number().int().min(0).optional(),
  after: z.coerce.number().int().min(0).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});
const rangeSchema = z.object({
  period: z.enum(['day', 'week', 'month']).optional(),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
const reviewSchema = z.object({
  status: z.enum(['REVIEWED', 'ACTIONED', 'DISMISSED']),
  hideMessage: z.boolean().default(false),
});
const reopenSchema = z.object({
  days: z.number().int().min(1).max(30),
  reason: z.string().trim().min(5).max(300),
});
const customerListSchema = z.object({
  q: z.string().trim().max(80).optional(),
  archived: z.enum(['true', 'false']).optional(),
});
const ADMIN_READ = [Role.PLATFORM_ADMIN, Role.CO_FOUNDER, Role.PLATFORM_VIEWER];

/** Public: is Connect on? Lets clients hide entry points without a 404 round trip. No data. */
@Controller('connect')
export class ConnectStatusController {
  constructor(private readonly messages: ConnectMessagesService) {}

  @Public()
  @Get('status')
  @Header('Cache-Control', 'public, max-age=60')
  status() {
    const f = connectFlags();
    return {
      enabled: f.FASTQUE_CONNECT_ENABLED,
      ai: f.CONNECT_AI_ENABLED,
      actions: f.CONNECT_BOOKING_ACTIONS_ENABLED,
      quotations: f.CONNECT_QUOTATIONS_ENABLED,
      translation: f.CONNECT_TRANSLATION_ENABLED,
      location: f.CONNECT_LOCATION_SHARING_ENABLED,
      templates: CONNECT_TEMPLATES,
    };
  }

  /** Signed, expiring, viewer-bound media URL. The signature alone is not enough: participation is re-checked. */
  @Public()
  @Get('media/:id')
  @UseGuards(ConnectEnabledGuard)
  async media(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('u') u: string,
    @Query('e') e: string,
    @Query('s') s: string,
    @Res() res: Response,
  ) {
    if (!u || !s || !verifyMediaSignature(id, u, Number(e), s))
      throw connectNotFound();
    const file = await this.messages.download(id, u);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    const inline =
      file.mimeType.startsWith('image/') || file.mimeType.startsWith('audio/');
    res.setHeader(
      'Content-Disposition',
      `${inline ? 'inline' : 'attachment'}; filename="${file.fileName.replace(/"/g, '')}"`,
    );
    res.send(file.body);
  }
}

@Controller('connect/me')
@UseGuards(ConnectEnabledGuard)
export class ConnectCustomerController {
  constructor(
    private readonly conversations: ConnectConversationsService,
    private readonly links: ConnectLinksService,
  ) {}

  @Get('conversations')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(customerListSchema))
    q: z.infer<typeof customerListSchema>,
  ) {
    return this.conversations.customerList(user.id, {
      q: q.q,
      archived: q.archived === 'true',
    });
  }

  @Get('unread')
  async unread(@CurrentUser() user: AuthenticatedUser) {
    return { unread: await this.conversations.unreadTotal(user.id) };
  }

  @Post('conversations')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async ensure(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(ensureSchema))
    body: z.infer<typeof ensureSchema>,
  ) {
    const conv = await this.links.ensureForCustomer(user.id, body);
    return { id: conv.id };
  }

  @Get('prefs')
  prefs(@CurrentUser() user: AuthenticatedUser) {
    return this.conversations.userPrefs(user.id);
  }

  @Put('prefs')
  setPrefs(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(connectUserPrefsSchema))
    body: z.infer<typeof connectUserPrefsSchema>,
  ) {
    return this.conversations.setUserPrefs(user.id, body);
  }

  @Get('export')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  exportMine(@CurrentUser() user: AuthenticatedUser) {
    return this.conversations.exportMine(user.id);
  }
}

/** One conversation, either side. Every handler starts at the access gate. */
@Controller('connect/conversations/:id')
@UseGuards(ConnectEnabledGuard)
export class ConnectConversationController {
  constructor(
    private readonly access: ConnectAccessService,
    private readonly conversations: ConnectConversationsService,
    private readonly messages: ConnectMessagesService,
    private readonly ai: ConnectAiService,
    private readonly actions: ConnectActionsService,
    private readonly business: ConnectBusinessService,
  ) {}

  private v(id: string, user: AuthenticatedUser) {
    return this.access.load(id, user.id);
  }

  @Get()
  async detail(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.conversations.detail(await this.v(id, user));
  }

  @Get('messages')
  async list(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(pageSchema)) q: z.infer<typeof pageSchema>,
  ) {
    return this.messages.list(await this.v(id, user), q);
  }

  @Post('messages')
  @Throttle({ default: { limit: 40, ttl: 60_000 } })
  async send(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(connectSendSchema))
    body: z.infer<typeof connectSendSchema>,
  ) {
    return this.messages.send(await this.v(id, user), body);
  }

  @Post('attachments')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseInterceptors(upload)
  async upload(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile() file: Express.Multer.File | undefined,
  ) {
    return this.messages.upload(await this.v(id, user), file);
  }

  @Put('messages/:mid')
  async edit(
    @Param('id') id: string,
    @Param('mid', ParseUUIDPipe) mid: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(connectEditSchema))
    body: z.infer<typeof connectEditSchema>,
  ) {
    return this.messages.edit(await this.v(id, user), mid, body.body);
  }

  @Delete('messages/:mid')
  async remove(
    @Param('id') id: string,
    @Param('mid', ParseUUIDPipe) mid: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.messages.remove(await this.v(id, user), mid);
  }

  @Get('messages/:mid/history')
  async history(
    @Param('id') id: string,
    @Param('mid', ParseUUIDPipe) mid: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.messages.history(await this.v(id, user), mid);
  }

  @Post('messages/:mid/reactions')
  @HttpCode(HttpStatus.OK)
  async react(
    @Param('id') id: string,
    @Param('mid', ParseUUIDPipe) mid: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(connectReactSchema))
    body: z.infer<typeof connectReactSchema>,
  ) {
    return this.messages.react(await this.v(id, user), mid, body.emoji);
  }

  @Post('messages/:mid/translate')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async translate(
    @Param('id') id: string,
    @Param('mid', ParseUUIDPipe) mid: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(connectTranslateSchema))
    body: z.infer<typeof connectTranslateSchema>,
  ) {
    return this.ai.translate(await this.v(id, user), mid, body.target);
  }

  @Post('read')
  @HttpCode(HttpStatus.OK)
  async read(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(connectReadSchema))
    body: z.infer<typeof connectReadSchema>,
  ) {
    return this.messages.markRead(await this.v(id, user), body.seq);
  }

  @Post('typing')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async typing(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.messages.typing(await this.v(id, user));
  }

  @Put('prefs')
  async prefs(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(connectPrefsSchema))
    body: z.infer<typeof connectPrefsSchema>,
  ) {
    return this.conversations.setPrefs(await this.v(id, user), body);
  }

  @Post('report')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async report(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(connectReportSchema))
    body: z.infer<typeof connectReportSchema>,
  ) {
    return this.business.report(await this.v(id, user), body);
  }

  @Get('complaints')
  async complaints(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.business.complaints(await this.v(id, user));
  }

  @Post('complaints')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async complain(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(connectComplaintSchema))
    body: z.infer<typeof connectComplaintSchema>,
  ) {
    return this.business.complain(await this.v(id, user), body);
  }

  // ----- Salon-side tools (the gate decides the side; services re-check it) -----

  @Patch()
  async patch(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(connectConversationPatchSchema))
    body: z.infer<typeof connectConversationPatchSchema>,
  ) {
    return this.conversations.patch(await this.v(id, user), body);
  }

  @Post('assign')
  @HttpCode(HttpStatus.OK)
  async assign(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(connectAssignSchema))
    body: z.infer<typeof connectAssignSchema>,
  ) {
    return this.conversations.assign(await this.v(id, user), body.userId);
  }

  @Get('notes')
  async notes(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.conversations.notes(await this.v(id, user));
  }

  @Post('notes')
  async addNote(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(connectNoteSchema))
    body: z.infer<typeof connectNoteSchema>,
  ) {
    return this.conversations.addNote(await this.v(id, user), body.body);
  }

  @Get('history')
  async customerHistory(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.conversations.history(await this.v(id, user));
  }

  @Get('suggestions')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  async suggestions(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const v = await this.v(id, user);
    if (v.side !== 'SALON') throw connectNotFound();
    return this.ai.suggestions(v);
  }

  @Post('summary')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async summary(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const v = await this.v(id, user);
    if (v.side !== 'SALON') throw connectNotFound();
    if (!connectFlag('CONNECT_AI_ENABLED'))
      throw connectError(
        'CONNECT_AI_OFF',
        'Connect AI is not switched on.',
        HttpStatus.NOT_FOUND,
      );
    return this.ai.summary(v);
  }

  // ----- Booking actions -----

  @Get('actions')
  async listActions(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.actions.list(await this.v(id, user));
  }

  @Post('actions')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async requestAction(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(
      new ZodValidationPipe(
        connectActionRequestSchema.extend({ serviceId: z.string().optional() }),
      ),
    )
    body: z.infer<typeof connectActionRequestSchema> & { serviceId?: string },
  ) {
    return this.actions.request(await this.v(id, user), body);
  }

  @Post('actions/:aid/decision')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async decide(
    @Param('id') id: string,
    @Param('aid', ParseUUIDPipe) aid: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(connectActionDecisionSchema))
    body: z.infer<typeof connectActionDecisionSchema>,
  ) {
    return this.actions.decide(await this.v(id, user), aid, body);
  }

  // ----- Quotations -----

  @Get('quotations')
  async quotations(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.business.quotations(await this.v(id, user));
  }

  @Post('quotations')
  async createQuotation(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(connectQuotationSchema))
    body: z.infer<typeof connectQuotationSchema>,
  ) {
    return this.business.createQuotation(await this.v(id, user), body);
  }

  @Post('quotations/:qid/revise')
  async revise(
    @Param('id') id: string,
    @Param('qid', ParseUUIDPipe) qid: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(connectQuotationSchema))
    body: z.infer<typeof connectQuotationSchema>,
  ) {
    return this.business.reviseQuotation(await this.v(id, user), qid, body);
  }

  @Post('quotations/:qid/decision')
  @HttpCode(HttpStatus.OK)
  async decideQuote(
    @Param('id') id: string,
    @Param('qid', ParseUUIDPipe) qid: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(connectQuotationDecisionSchema))
    body: z.infer<typeof connectQuotationDecisionSchema>,
  ) {
    return this.business.decideQuotation(await this.v(id, user), qid, body);
  }

  // ----- Location -----

  @Get('location')
  async locations(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.business.locations(await this.v(id, user));
  }

  @Post('location')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async share(
    @Param('id') id: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(connectLocationSchema))
    body: z.infer<typeof connectLocationSchema>,
  ) {
    return this.business.shareLocation(await this.v(id, user), body);
  }

  @Delete('location')
  async stop(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.business.stopLocation(await this.v(id, user));
  }
}

/** The salon's FastQue Connect tab. Owner, or staff with a Connect grant. */
@Controller('connect/salons/:salonId')
@UseGuards(ConnectEnabledGuard)
export class ConnectSalonController {
  constructor(
    private readonly access: ConnectAccessService,
    private readonly conversations: ConnectConversationsService,
    private readonly insights: ConnectInsightsService,
  ) {}

  private async owner(userId: string, salonId: string) {
    const role = await this.access.assertSalonInbox(userId, salonId);
    if (role !== 'OWNER')
      throw connectError(
        'CONNECT_FORBIDDEN',
        'Only the salon owner can change this.',
        HttpStatus.FORBIDDEN,
      );
  }

  @Get('inbox')
  async inbox(
    @Param('salonId') salonId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(connectInboxQuerySchema))
    q: z.infer<typeof connectInboxQuerySchema>,
  ) {
    const role = await this.access.assertSalonInbox(user.id, salonId);
    return {
      role,
      ...(await this.conversations.inbox(
        user.id,
        { salonId, homeProviderId: null },
        role,
        q,
      )),
    };
  }

  @Get('saved-replies')
  async savedReplies(
    @Param('salonId') salonId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.access.assertSalonInbox(user.id, salonId);
    return this.conversations.savedReplies(salonId);
  }

  @Post('saved-replies')
  async addSavedReply(
    @Param('salonId') salonId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(connectSavedReplySchema))
    body: z.infer<typeof connectSavedReplySchema>,
  ) {
    const role = await this.access.assertSalonInbox(user.id, salonId);
    if (role === 'STYLIST')
      throw connectError(
        'CONNECT_FORBIDDEN',
        'Ask the owner or a manager to add saved replies.',
        HttpStatus.FORBIDDEN,
      );
    return this.conversations.addSavedReply(salonId, user.id, body);
  }

  @Delete('saved-replies/:rid')
  async deleteSavedReply(
    @Param('salonId') salonId: string,
    @Param('rid', ParseUUIDPipe) rid: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    const role = await this.access.assertSalonInbox(user.id, salonId);
    if (role !== 'OWNER' && role !== 'MANAGER')
      throw connectError(
        'CONNECT_FORBIDDEN',
        'Only the owner or a manager can remove saved replies.',
        HttpStatus.FORBIDDEN,
      );
    return this.conversations.deleteSavedReply(salonId, rid);
  }

  @Get('staff')
  async staff(
    @Param('salonId') salonId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.owner(user.id, salonId);
    return this.conversations.grants(salonId);
  }

  @Put('staff')
  async setStaff(
    @Param('salonId') salonId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(connectStaffGrantSchema))
    body: z.infer<typeof connectStaffGrantSchema>,
  ) {
    await this.owner(user.id, salonId);
    return this.conversations.setGrant(salonId, user.id, body);
  }

  @Get('settings')
  async settings(
    @Param('salonId') salonId: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    await this.access.assertSalonInbox(user.id, salonId);
    return this.conversations.salonSettings({ salonId, homeProviderId: null });
  }

  @Put('settings')
  async saveSettings(
    @Param('salonId') salonId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(connectSalonSettingsSchema))
    body: z.infer<typeof connectSalonSettingsSchema>,
  ) {
    await this.owner(user.id, salonId);
    return this.conversations.saveSalonSettings(
      { salonId, homeProviderId: null },
      user.id,
      body,
    );
  }

  @Get('analytics')
  async analytics(
    @Param('salonId') salonId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(rangeSchema)) q: z.infer<typeof rangeSchema>,
  ) {
    const role = await this.access.assertSalonInbox(user.id, salonId);
    if (role !== 'OWNER' && role !== 'MANAGER')
      throw connectError(
        'CONNECT_FORBIDDEN',
        'Only the owner or a manager can see analytics.',
        HttpStatus.FORBIDDEN,
      );
    return this.insights.salonAnalytics(
      { salonId, homeProviderId: null },
      parseRange(q),
    );
  }

  @Get('analytics.csv')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  async analyticsCsv(
    @Param('salonId') salonId: string,
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(rangeSchema)) q: z.infer<typeof rangeSchema>,
    @Res() res: Response,
  ) {
    const role = await this.access.assertSalonInbox(user.id, salonId);
    if (role !== 'OWNER')
      throw connectError(
        'CONNECT_FORBIDDEN',
        'Only the owner can export analytics.',
        HttpStatus.FORBIDDEN,
      );
    const csv = this.insights.toCsv(
      await this.insights.salonAnalytics(
        { salonId, homeProviderId: null },
        parseRange(q),
      ),
    );
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="fastque-connect-analytics.csv"',
    );
    res.send(csv);
  }
}

/** An independent FastQue Home professional's own inbox. */
@Controller('connect/provider')
@UseGuards(ConnectEnabledGuard)
export class ConnectProviderController {
  constructor(
    private readonly access: ConnectAccessService,
    private readonly conversations: ConnectConversationsService,
  ) {}

  @Get('inbox')
  async inbox(
    @CurrentUser() user: AuthenticatedUser,
    @Query(new ZodValidationPipe(connectInboxQuerySchema))
    q: z.infer<typeof connectInboxQuerySchema>,
  ) {
    const tenant = await this.access.providerTenantFor(user.id);
    if (!tenant) throw connectNotFound();
    return {
      role: 'PROVIDER',
      ...(await this.conversations.inbox(user.id, tenant, 'PROVIDER', q)),
    };
  }
}

/** FastQue admin: Communication Management. Aggregates; no conversation browsing. */
@Controller('connect/admin')
@UseGuards(ConnectEnabledGuard)
export class ConnectAdminController {
  constructor(
    private readonly insights: ConnectInsightsService,
    private readonly config: ConnectConfigService,
  ) {}

  @Get('overview')
  @Roles(...ADMIN_READ)
  overview(
    @Query(new ZodValidationPipe(rangeSchema)) q: z.infer<typeof rangeSchema>,
  ) {
    return this.insights.adminOverview(parseRange(q));
  }

  @Get('config')
  @Roles(...ADMIN_READ)
  getConfig() {
    return this.config.get();
  }

  @Put('config')
  @Roles(Role.PLATFORM_ADMIN)
  setConfig(@CurrentUser() user: AuthenticatedUser, @Body() body: unknown) {
    if (!body || typeof body !== 'object' || Array.isArray(body))
      throw connectError(
        'CONNECT_CONFIG_INVALID',
        'Send a configuration object.',
      );
    return this.config.update(body, user.id);
  }

  @Get('reports')
  @Roles(Role.PLATFORM_ADMIN, Role.CO_FOUNDER)
  reports(@Query('status') status?: string) {
    return this.insights.reports(
      status && ['OPEN', 'REVIEWED', 'ACTIONED', 'DISMISSED'].includes(status)
        ? status
        : undefined,
    );
  }

  @Post('reports/:rid/review')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.PLATFORM_ADMIN)
  review(
    @Param('rid', ParseUUIDPipe) rid: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(reviewSchema))
    body: z.infer<typeof reviewSchema>,
  ) {
    return this.insights.reviewReport(
      rid,
      user.id,
      body.status,
      body.hideMessage,
    );
  }

  @Post('conversations/:cid/access')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.PLATFORM_ADMIN)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  access(
    @Param('cid') cid: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(connectAdminAccessSchema))
    body: z.infer<typeof connectAdminAccessSchema>,
  ) {
    return this.insights.adminAccess(cid, user.id, body);
  }

  @Post('conversations/:cid/reopen')
  @HttpCode(HttpStatus.OK)
  @Roles(Role.PLATFORM_ADMIN)
  reopen(
    @Param('cid', ParseUUIDPipe) cid: string,
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(reopenSchema))
    body: z.infer<typeof reopenSchema>,
  ) {
    return this.insights.reopen(cid, user.id, body.days, body.reason);
  }

  @Get('audit')
  @Roles(Role.PLATFORM_ADMIN, Role.CO_FOUNDER)
  audit() {
    return this.insights.audit();
  }
}
