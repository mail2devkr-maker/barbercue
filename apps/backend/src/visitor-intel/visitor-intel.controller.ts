import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  VI_INTEGRATION_PROVIDERS,
  VI_PATHS,
  VI_REPORT_FORMATS,
  VI_REPORT_TYPES,
  viAlertRuleInputSchema,
  viAskSchema,
  viCampaignExpenseLinkSchema,
  viCampaignInputSchema,
  viCollectSchema,
  viConsentSchema,
  viInsightDecisionSchema,
  viInsightTaskSchema,
  viIntegrationUpdateSchema,
  viOpportunityAssignSchema,
  viPageSchema,
  viPrivacyRequestSchema,
  viReportScheduleInputSchema,
  viSegmentInputSchema,
  viStaffRoleInputSchema,
  viTrackingSettingsSchema,
  type AuthenticatedUser,
  type ViCollectInput,
  type ViConsentInput,
  type ViIntegrationProvider,
  type ViMeDto,
  type ViReportFormat,
  type ViReportType,
} from '@barbercue/shared';
import { Public } from '../auth/decorators/public.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import type { JwtPayload } from '../auth/services/token.service';
import { PrismaService } from '../prisma/prisma.service';
import { ViAccessService } from './vi-access.service';
import { ViAlertsService } from './vi-alerts.service';
import {
  VI_BREAKDOWN_DIMS,
  ViAnalyticsService,
  type ViBreakdownDim,
} from './vi-analytics.service';
import { ViAskService } from './vi-ask.service';
import { ViCampaignsService } from './vi-campaigns.service';
import { ViConfigService } from './vi-config.service';
import { ViIngestService } from './vi-ingest.service';
import { ViInsightsService } from './vi-insights.service';
import { ViIntegrationsService } from './vi-integrations.service';
import { ViMaintenanceService } from './vi-maintenance.service';
import { ViReportsService } from './vi-reports.service';
import { ViSegmentsService } from './vi-segments.service';
import { parseViQuery, viBadRequest } from './vi-common';
import { clientIp } from './vi-geo';

const str = (v: unknown, fallback: string): string =>
  typeof v === 'string' ? v : fallback;

const page = (raw: Record<string, unknown>) => {
  const p = viPageSchema.safeParse(raw);
  if (!p.success) throw viBadRequest('Invalid paging.');
  return p.data;
};

const campaignUpdateSchema = viCampaignInputSchema
  .partial()
  .extend({ status: z.enum(['ACTIVE', 'PAUSED', 'ARCHIVED']).optional() });
const preferenceSchema = z.object({
  userId: z.string().uuid(),
  channel: z.enum([
    'WHATSAPP',
    'EMAIL',
    'SMS',
    'PUSH',
    'GOOGLE_ADS',
    'META_ADS',
  ]),
  optedIn: z.boolean(),
  suppressed: z.boolean().default(false),
  reason: z.string().max(200).optional().nullable(),
});
const selfPreferenceSchema = z.object({
  channel: z.enum([
    'WHATSAPP',
    'EMAIL',
    'SMS',
    'PUSH',
    'GOOGLE_ADS',
    'META_ADS',
  ]),
  optedIn: z.boolean(),
});

/**
 * FastQue Visitor Intelligence API (docs/visitor-intelligence/README.md (API)). Every authenticated route checks a
 * Visitor Intelligence capability through ViAccessService (backend-enforced RBAC + scope); the web app only
 * mirrors it. Ingestion routes are public, consent-gated, rate-limited and never store raw IPs.
 */
@Controller(VI_PATHS.root)
export class VisitorIntelController {
  constructor(
    private readonly access: ViAccessService,
    private readonly ingest: ViIngestService,
    private readonly analytics: ViAnalyticsService,
    private readonly campaigns: ViCampaignsService,
    private readonly insights: ViInsightsService,
    private readonly askService: ViAskService,
    private readonly segments: ViSegmentsService,
    private readonly alerts: ViAlertsService,
    private readonly reports: ViReportsService,
    private readonly config: ViConfigService,
    private readonly integrations: ViIntegrationsService,
    private readonly maintenance: ViMaintenanceService,
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  // ---------- Public ingestion ----------

  @Public()
  @Throttle({ default: { limit: 240, ttl: 60_000 } })
  @Post(VI_PATHS.collect)
  @HttpCode(HttpStatus.ACCEPTED)
  async collect(
    @Req() req: Request,
    @Headers('user-agent') ua: string | undefined,
    @Body(new ZodValidationPipe(viCollectSchema)) body: ViCollectInput,
  ) {
    const status = await this.ingest.enqueue({
      input: body,
      userAgent: ua ?? null,
      headers: req.headers,
      ip: clientIp(req.headers, req.socket?.remoteAddress ?? null),
      userId: this.optionalUserId(req),
      receivedAt: new Date(),
    });
    return { status };
  }

  /** Links a visitor to an account only from a valid customer session token; never from a body field. */
  private optionalUserId(req: Request): string | null {
    const h = req.headers.authorization;
    if (!h?.startsWith('Bearer ')) return null;
    try {
      return this.jwt.verify<JwtPayload>(h.slice(7)).sub ?? null;
    } catch {
      return null;
    }
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post(VI_PATHS.consent)
  @HttpCode(HttpStatus.NO_CONTENT)
  async consent(
    @Body(new ZodValidationPipe(viConsentSchema)) body: ViConsentInput,
  ) {
    if (ViConfigService.envEnabled()) await this.ingest.recordConsent(body);
  }

  @Public()
  @Get(`${VI_PATHS.config}/public`)
  async publicConfig() {
    if (!ViConfigService.envEnabled())
      return { trackingEnabled: false, samplingRate: 0 };
    const s = await this.config.get();
    return {
      trackingEnabled: ViConfigService.envEnabled() && s.trackingEnabled,
      samplingRate: s.samplingRate,
    };
  }

  @Public()
  @Get('c/:code')
  resolveCampaign(@Param('code') code: string) {
    return this.campaigns.resolve(code);
  }

  // ---------- Access ----------

  @Get(VI_PATHS.me)
  async me(@CurrentUser() user: AuthenticatedUser): Promise<ViMeDto> {
    const a = await this.access.actor(user);
    const s = await this.config.get();
    return {
      capabilities: [...a.capabilities],
      scope: a.scope,
      staffRoles: a.staffRoles,
      activityWindowMinutes: s.activityWindowMinutes,
      demoVisitors: (await this.maintenance.demoStatus()).demoVisitors,
      trackingEnabled: s.trackingEnabled && ViConfigService.envEnabled(),
    };
  }

  // ---------- Analytics ----------

  @Get(VI_PATHS.overview)
  async overview(
    @CurrentUser() user: AuthenticatedUser,
    @Query() raw: Record<string, unknown>,
  ) {
    const a = await this.access.require(user, 'overview');
    return this.analytics.overview(parseViQuery(raw), a);
  }

  @Get(VI_PATHS.drilldown)
  async drilldown(
    @CurrentUser() user: AuthenticatedUser,
    @Query() raw: Record<string, unknown>,
  ) {
    const a = await this.access.require(user, 'overview');
    const dim = str(raw.dim, 'channel') as ViBreakdownDim;
    if (!VI_BREAKDOWN_DIMS.includes(dim))
      throw viBadRequest('Unknown dimension.');
    return {
      dim,
      rows: await this.analytics.breakdown(
        parseViQuery(raw),
        a.scope,
        dim,
        200,
      ),
    };
  }

  @Get(VI_PATHS.live)
  async live(
    @CurrentUser() user: AuthenticatedUser,
    @Query() raw: Record<string, unknown>,
  ) {
    const a = await this.access.require(user, 'live');
    const w = Number(raw.window);
    return this.analytics.live(
      parseViQuery({ ...raw, period: 'today' }),
      a,
      Number.isFinite(w) && w > 0 ? w : undefined,
    );
  }

  @Get(VI_PATHS.visitors)
  async visitors(
    @CurrentUser() user: AuthenticatedUser,
    @Query() raw: Record<string, unknown>,
  ) {
    const a = await this.access.require(user, 'history');
    const p = page(raw);
    return this.analytics.visitors(
      parseViQuery(raw),
      a,
      p.page,
      p.pageSize,
      p.q,
      p.sort,
    );
  }

  @Get(`${VI_PATHS.visitors}/:id`)
  async visitor(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const a = await this.access.require(user, 'history');
    const detail = await this.analytics.visitorDetail(id, a);
    if (detail.registered && a.capabilities.has('pii'))
      await this.campaigns.audit(user.id, 'VI_PII_VIEWED', id, {});
    return detail;
  }

  @Get(`${VI_PATHS.sessions}/:id/timeline`)
  async timeline(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const a = await this.access.require(user, 'timeline');
    await this.campaigns.audit(user.id, 'VI_TIMELINE_VIEWED', id, {});
    return this.analytics.timeline(id, a);
  }

  @Get(VI_PATHS.geo)
  async geo(
    @CurrentUser() user: AuthenticatedUser,
    @Query() raw: Record<string, unknown>,
  ) {
    const a = await this.access.require(user, 'geo');
    const level = ['country', 'state', 'city', 'locality'].includes(
      String(raw.level),
    )
      ? (raw.level as 'city')
      : 'city';
    return this.analytics.geo(parseViQuery(raw), a, level);
  }

  @Get(VI_PATHS.opportunities)
  async opportunities(
    @CurrentUser() user: AuthenticatedUser,
    @Query() raw: Record<string, unknown>,
  ) {
    const a = await this.access.require(user, 'geo');
    return this.analytics.opportunities(parseViQuery(raw), a);
  }

  @Post(`${VI_PATHS.opportunities}/assign`)
  async assign(
    @CurrentUser() user: AuthenticatedUser,
    @Query() raw: Record<string, unknown>,
    @Body(new ZodValidationPipe(viOpportunityAssignSchema))
    body: z.infer<typeof viOpportunityAssignSchema>,
  ) {
    const a = await this.access.require(user, 'geo', 'assignOpportunity');
    return this.campaigns.assignOpportunity(body, parseViQuery(raw), a, user);
  }

  @Get('crm/assignees')
  async assignees(@CurrentUser() user: AuthenticatedUser) {
    await this.access.require(user, 'overview');
    return this.campaigns.assignees();
  }

  @Get(VI_PATHS.search)
  async search(
    @CurrentUser() user: AuthenticatedUser,
    @Query() raw: Record<string, unknown>,
  ) {
    const a = await this.access.require(user, 'search');
    return this.analytics.search(parseViQuery(raw), a);
  }

  @Get(VI_PATHS.funnels)
  async funnels(
    @CurrentUser() user: AuthenticatedUser,
    @Query() raw: Record<string, unknown>,
  ) {
    const a = await this.access.require(user, 'journey');
    const split = ['city', 'device', 'channel', 'campaign'].includes(
      String(raw.split),
    )
      ? (raw.split as 'city')
      : undefined;
    return this.analytics.funnel(
      parseViQuery(raw),
      a,
      str(raw.funnel, 'SALON_BOOKING'),
      split,
    );
  }

  @Get(VI_PATHS.sources)
  async sources(
    @CurrentUser() user: AuthenticatedUser,
    @Query() raw: Record<string, unknown>,
  ) {
    const a = await this.access.require(user, 'sources');
    return this.analytics.sources(parseViQuery(raw), a);
  }

  @Get(VI_PATHS.conversions)
  async conversions(
    @CurrentUser() user: AuthenticatedUser,
    @Query() raw: Record<string, unknown>,
  ) {
    const a = await this.access.require(user, 'conversions');
    return this.analytics.conversions(parseViQuery(raw), a);
  }

  @Get(`${VI_PATHS.salon}/:salonId/summary`)
  async salonSummary(
    @CurrentUser() user: AuthenticatedUser,
    @Param('salonId') salonId: string,
    @Query() raw: Record<string, unknown>,
  ) {
    await this.access.requireSalon(user, salonId);
    return this.analytics.salonSummary(
      salonId,
      parseViQuery({ period: raw.period ?? '30d', from: raw.from, to: raw.to }),
    );
  }

  // ---------- Campaigns ----------

  @Get(VI_PATHS.campaigns)
  async campaignList(
    @CurrentUser() user: AuthenticatedUser,
    @Query() raw: Record<string, unknown>,
  ) {
    await this.access.require(user, 'campaigns');
    return this.campaigns.list(parseViQuery(raw));
  }

  @Post(VI_PATHS.campaigns)
  async campaignCreate(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(viCampaignInputSchema))
    body: z.infer<typeof viCampaignInputSchema>,
  ) {
    await this.access.require(user, 'manageCampaigns');
    return this.campaigns.create(body, user.id);
  }

  @Get(`${VI_PATHS.campaigns}/finance-expenses`)
  async expenseCandidates(
    @CurrentUser() user: AuthenticatedUser,
    @Query('q') q?: string,
  ) {
    await this.access.require(user, 'manageCampaigns');
    return this.campaigns.expenseCandidates(q?.slice(0, 80));
  }

  @Get(`${VI_PATHS.campaigns}/compare`)
  async campaignCompare(
    @CurrentUser() user: AuthenticatedUser,
    @Query() raw: Record<string, unknown>,
  ) {
    await this.access.require(user, 'campaigns');
    const ids = str(raw.ids, '')
      .split(',')
      .filter((i) => /^[0-9a-f-]{36}$/i.test(i))
      .slice(0, 10);
    return this.campaigns.compare(ids, parseViQuery(raw));
  }

  @Get(`${VI_PATHS.campaigns}/:id`)
  async campaignDetail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() raw: Record<string, unknown>,
  ) {
    const a = await this.access.require(user, 'campaigns');
    return this.campaigns.detail(id, parseViQuery(raw), a);
  }

  @Patch(`${VI_PATHS.campaigns}/:id`)
  async campaignUpdate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(campaignUpdateSchema))
    body: z.infer<typeof campaignUpdateSchema>,
  ) {
    await this.access.require(user, 'manageCampaigns');
    return this.campaigns.update(id, body, user.id);
  }

  @Post(`${VI_PATHS.campaigns}/:id/expenses`)
  async linkExpense(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(viCampaignExpenseLinkSchema))
    body: { financeExpenseId: string },
  ) {
    await this.access.require(user, 'manageCampaigns');
    return this.campaigns.linkExpense(id, body.financeExpenseId, user.id);
  }

  @Delete(`${VI_PATHS.campaigns}/:id/expenses/:expenseId`)
  async unlinkExpense(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('expenseId', ParseUUIDPipe) expenseId: string,
  ) {
    await this.access.require(user, 'manageCampaigns');
    return this.campaigns.unlinkExpense(id, expenseId, user.id);
  }

  // ---------- AI ----------

  @Get(VI_PATHS.insights)
  async insightList(
    @CurrentUser() user: AuthenticatedUser,
    @Query() raw: Record<string, unknown>,
  ) {
    await this.access.require(user, 'insights');
    const p = page(raw);
    const [list, counts] = await Promise.all([
      this.insights.list(
        raw.status as string | undefined,
        raw.department as string | undefined,
        p.page,
        p.pageSize,
      ),
      this.insights.counts(),
    ]);
    return { ...list, counts };
  }

  @Post(`${VI_PATHS.insights}/generate`)
  async insightGenerate(@CurrentUser() user: AuthenticatedUser) {
    await this.access.require(user, 'decideInsights');
    return this.insights.generate();
  }

  @Post(`${VI_PATHS.insights}/:id/decision`)
  async insightDecide(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(viInsightDecisionSchema))
    body: z.infer<typeof viInsightDecisionSchema>,
  ) {
    await this.access.require(user, 'decideInsights');
    return this.insights.decide(id, body.status, body.note, user.id);
  }

  @Post(`${VI_PATHS.insights}/:id/task`)
  async insightTask(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(viInsightTaskSchema))
    body: z.infer<typeof viInsightTaskSchema>,
  ) {
    await this.access.require(user, 'decideInsights');
    return this.insights.createTask(
      id,
      body.assigneeEmployeeId,
      body.dueAt,
      user,
    );
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post(VI_PATHS.ask)
  async ask(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(viAskSchema)) body: z.infer<typeof viAskSchema>,
  ) {
    const a = await this.access.require(user, 'ask');
    return this.askService.ask(
      body.question,
      a,
      body.period === 'custom' ? undefined : body.period,
    );
  }

  // ---------- Segments ----------

  @Get(VI_PATHS.segments)
  async segmentList(@CurrentUser() user: AuthenticatedUser) {
    await this.access.require(user, 'segments');
    return this.segments.list();
  }

  @Post(VI_PATHS.segments)
  async segmentCreate(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(viSegmentInputSchema))
    body: z.infer<typeof viSegmentInputSchema>,
  ) {
    await this.access.require(user, 'manageSegments');
    return this.segments.create(body, user.id);
  }

  @Delete(`${VI_PATHS.segments}/:id`)
  async segmentDelete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.access.require(user, 'manageSegments');
    return this.segments.remove(id);
  }

  @Get(`${VI_PATHS.segments}/:id/audience`)
  async audience(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Query('channel') channel = 'WHATSAPP',
  ) {
    const a = await this.access.require(user, 'manageSegments');
    const rows = await this.segments.audience(
      id.slice(0, 40),
      a,
      channel.slice(0, 20),
    );
    await this.campaigns.audit(
      user.id,
      'VI_SEGMENT_AUDIENCE_VIEWED',
      id.slice(0, 40),
      { channel, rows: rows.length },
    );
    return { rows };
  }

  @Put(`${VI_PATHS.segments}/preferences`)
  async setPreference(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(preferenceSchema))
    body: z.infer<typeof preferenceSchema>,
  ) {
    await this.access.require(user, 'manageSegments');
    await this.campaigns.audit(
      user.id,
      'VI_MARKETING_PREFERENCE_SET',
      body.userId,
      {
        channel: body.channel,
        optedIn: body.optedIn,
        suppressed: body.suppressed,
      },
    );
    return this.segments.setPreference(
      body.userId,
      body.channel,
      body.optedIn,
      body.suppressed,
      body.reason ?? null,
    );
  }

  /** Any signed-in customer: their own marketing choices. */
  @Get(`${VI_PATHS.me}/marketing-preferences`)
  myPreferences(@CurrentUser() user: AuthenticatedUser) {
    return this.segments.preferences(user.id);
  }

  @Put(`${VI_PATHS.me}/marketing-preferences`)
  setMyPreference(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(selfPreferenceSchema))
    body: z.infer<typeof selfPreferenceSchema>,
  ) {
    return this.segments.setPreference(
      user.id,
      body.channel,
      body.optedIn,
      false,
      body.optedIn ? null : 'Opted out by customer',
    );
  }

  // ---------- Alerts ----------

  @Get(`${VI_PATHS.alerts}/rules`)
  async alertRules(@CurrentUser() user: AuthenticatedUser) {
    await this.access.require(user, 'alerts');
    return this.alerts.rules();
  }

  @Post(`${VI_PATHS.alerts}/rules`)
  async alertCreate(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(viAlertRuleInputSchema))
    body: z.infer<typeof viAlertRuleInputSchema>,
  ) {
    await this.access.require(user, 'manageAlerts');
    return this.alerts.upsertRule(null, body, user.id);
  }

  @Put(`${VI_PATHS.alerts}/rules/:id`)
  async alertUpdate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(viAlertRuleInputSchema))
    body: z.infer<typeof viAlertRuleInputSchema>,
  ) {
    await this.access.require(user, 'manageAlerts');
    return this.alerts.upsertRule(id, body, user.id);
  }

  @Delete(`${VI_PATHS.alerts}/rules/:id`)
  async alertDelete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.access.require(user, 'manageAlerts');
    return this.alerts.deleteRule(id);
  }

  @Get(`${VI_PATHS.alerts}/events`)
  async alertEvents(
    @CurrentUser() user: AuthenticatedUser,
    @Query() raw: Record<string, unknown>,
  ) {
    await this.access.require(user, 'alerts');
    const p = page(raw);
    return this.alerts.events(raw.open === 'true', p.page, p.pageSize);
  }

  @Post(`${VI_PATHS.alerts}/events/:id/ack`)
  async alertAck(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.access.require(user, 'alerts');
    return this.alerts.acknowledge(id, user.id);
  }

  @Post(`${VI_PATHS.alerts}/evaluate`)
  async alertEvaluate(@CurrentUser() user: AuthenticatedUser) {
    await this.access.require(user, 'manageAlerts');
    return { fired: await this.alerts.evaluate() };
  }

  // ---------- Reports ----------

  @Get(`${VI_PATHS.reports}/export`)
  async export(
    @CurrentUser() user: AuthenticatedUser,
    @Query() raw: Record<string, unknown>,
    @Res() res: Response,
  ) {
    const a = await this.access.require(user, 'reports', 'export');
    const type = String(raw.type) as ViReportType;
    const format = str(raw.format, 'csv') as ViReportFormat;
    if (!VI_REPORT_TYPES.includes(type) || !VI_REPORT_FORMATS.includes(format))
      throw viBadRequest('Unknown report or format.');
    const file = await this.reports.export(type, format, parseViQuery(raw), a);
    res.setHeader('Content-Type', file.contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${file.filename}"`,
    );
    res.setHeader('Cache-Control', 'no-store');
    res.send(file.body);
  }

  @Get(`${VI_PATHS.reports}/schedules`)
  async schedules(@CurrentUser() user: AuthenticatedUser) {
    await this.access.require(user, 'reports');
    return this.reports.schedules();
  }

  @Post(`${VI_PATHS.reports}/schedules`)
  async createSchedule(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(viReportScheduleInputSchema))
    body: z.infer<typeof viReportScheduleInputSchema>,
  ) {
    await this.access.require(user, 'reports', 'export');
    return this.reports.createSchedule(body, user.id);
  }

  @Delete(`${VI_PATHS.reports}/schedules/:id`)
  async deleteSchedule(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.access.require(user, 'reports', 'export');
    return this.reports.deleteSchedule(id);
  }

  // ---------- Settings, integrations, privacy, roles ----------

  @Get(VI_PATHS.settings)
  async settings(@CurrentUser() user: AuthenticatedUser) {
    await this.access.require(user, 'settings');
    return {
      settings: await this.config.get(),
      env: {
        trackingEnabled: ViConfigService.envEnabled(),
        integrationsEnabled: ViIntegrationsService.globallyEnabled(),
        geoipDatabase: !!process.env.VI_GEOIP_MMDB_PATH,
        geminiKey: !!process.env.GEMINI_API_KEY,
        ollamaUrl: process.env.VI_OLLAMA_URL ?? null,
        emailConfigured:
          process.env.VI_EMAIL_ENABLED === 'true' &&
          !!process.env.RESEND_API_KEY &&
          !!process.env.VI_EMAIL_FROM,
      },
      health: { ...this.ingest.stats, queueLength: this.ingest.queueLength },
      demo: await this.maintenance.demoStatus(),
    };
  }

  @Put(VI_PATHS.settings)
  async updateSettings(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(viTrackingSettingsSchema))
    body: z.infer<typeof viTrackingSettingsSchema>,
  ) {
    await this.access.require(user, 'settings');
    await this.campaigns.audit(user.id, 'VI_SETTINGS_UPDATED', 'config', body);
    return this.config.update(body, user.id);
  }

  @Post(`${VI_PATHS.settings}/rollup`)
  async rollup(@CurrentUser() user: AuthenticatedUser) {
    await this.access.require(user, 'settings');
    const today = new Date();
    let rows = 0;
    for (let i = 0; i < 7; i++)
      rows += await this.maintenance.rollup(
        new Date(today.getTime() - i * 86_400_000),
      );
    return { rows };
  }

  @Get(VI_PATHS.integrations)
  async integrationList(@CurrentUser() user: AuthenticatedUser) {
    await this.access.require(user, 'integrations');
    return this.integrations.list();
  }

  @Put(`${VI_PATHS.integrations}/:provider`)
  async integrationUpdate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('provider') provider: string,
    @Body(new ZodValidationPipe(viIntegrationUpdateSchema))
    body: z.infer<typeof viIntegrationUpdateSchema>,
  ) {
    await this.access.require(user, 'integrations');
    if (!VI_INTEGRATION_PROVIDERS.includes(provider as ViIntegrationProvider))
      throw viBadRequest('Unknown integration.');
    await this.campaigns.audit(user.id, 'VI_INTEGRATION_UPDATED', provider, {
      enabled: body.enabled,
      fields: Object.keys(body.values),
    });
    return this.integrations.update(
      provider as ViIntegrationProvider,
      body.enabled,
      body.values,
      user.id,
    );
  }

  @Post(`${VI_PATHS.integrations}/:provider/sync`)
  async integrationSync(
    @CurrentUser() user: AuthenticatedUser,
    @Param('provider') provider: string,
  ) {
    await this.access.require(user, 'integrations');
    if (!VI_INTEGRATION_PROVIDERS.includes(provider as ViIntegrationProvider))
      throw viBadRequest('Unknown integration.');
    return this.integrations.sync(provider as ViIntegrationProvider);
  }

  @Get(VI_PATHS.privacy)
  async privacyList(@CurrentUser() user: AuthenticatedUser) {
    await this.access.require(user, 'privacy');
    return this.maintenance.privacyRequests();
  }

  @Post(VI_PATHS.privacy)
  async privacyRequest(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(viPrivacyRequestSchema))
    body: z.infer<typeof viPrivacyRequestSchema>,
  ) {
    await this.access.require(user, 'privacy');
    return this.maintenance.handlePrivacy(
      body.type,
      { visitorId: body.visitorId, userId: body.userId },
      body.note,
      user.id,
    );
  }

  @Get(VI_PATHS.staffRoles)
  async staffRoles(@CurrentUser() user: AuthenticatedUser) {
    await this.access.require(user, 'staffRoles');
    const rows = await this.prisma.viStaffRole.findMany({
      orderBy: { createdAt: 'desc' },
    });
    const users = await this.prisma.user.findMany({
      where: { id: { in: rows.map((r) => r.userId) } },
      select: { id: true, email: true, phone: true },
    });
    return rows.map((r) => ({
      ...r,
      user: users.find((u) => u.id === r.userId) ?? null,
    }));
  }

  @Get(`${VI_PATHS.staffRoles}/candidates`)
  async staffCandidates(@CurrentUser() user: AuthenticatedUser) {
    await this.access.require(user, 'staffRoles');
    const rows = await this.prisma.userRole.findMany({
      where: {
        role: {
          in: [
            'PLATFORM_ADMIN',
            'CO_FOUNDER',
            'HR_ADMIN',
            'SALES_ADMIN',
            'PLATFORM_VIEWER',
          ],
        },
        salonId: null,
      },
      select: {
        userId: true,
        role: true,
        user: { select: { email: true, phone: true } },
      },
      take: 500,
    });
    return rows.map((r) => ({
      userId: r.userId,
      role: r.role,
      email: r.user.email,
      phone: r.user.phone,
    }));
  }

  @Post(VI_PATHS.staffRoles)
  async grantStaffRole(
    @CurrentUser() user: AuthenticatedUser,
    @Body(new ZodValidationPipe(viStaffRoleInputSchema))
    body: z.infer<typeof viStaffRoleInputSchema>,
  ) {
    await this.access.require(user, 'staffRoles');
    const internal = await this.prisma.userRole.findFirst({
      where: {
        userId: body.userId,
        salonId: null,
        role: {
          in: [
            'PLATFORM_ADMIN',
            'CO_FOUNDER',
            'HR_ADMIN',
            'SALES_ADMIN',
            'PLATFORM_VIEWER',
          ],
        },
      },
    });
    if (!internal)
      throw viBadRequest(
        'Visitor Intelligence responsibilities can only be given to internal admin users.',
      );
    const row = await this.prisma.viStaffRole.upsert({
      where: { userId_role: { userId: body.userId, role: body.role } },
      create: { ...body, grantedByUserId: user.id },
      update: {},
    });
    await this.campaigns.audit(user.id, 'VI_STAFF_ROLE_GRANTED', body.userId, {
      role: body.role,
    });
    return row;
  }

  @Delete(`${VI_PATHS.staffRoles}/:id`)
  async revokeStaffRole(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    await this.access.require(user, 'staffRoles');
    const row = await this.prisma.viStaffRole
      .delete({ where: { id } })
      .catch(() => null);
    if (row)
      await this.campaigns.audit(user.id, 'VI_STAFF_ROLE_REVOKED', row.userId, {
        role: row.role,
      });
    return { ok: true };
  }

  // ---------- Demo (development only) ----------

  @Post(`${VI_PATHS.demo}/seed`)
  async seedDemo(
    @CurrentUser() user: AuthenticatedUser,
    @Query('visitors') visitors?: string,
  ) {
    await this.access.require(user, 'settings');
    return this.maintenance.seedDemo(
      visitors ? Math.min(5000, Number(visitors) || 400) : 400,
    );
  }

  @Delete(VI_PATHS.demo)
  async clearDemo(@CurrentUser() user: AuthenticatedUser) {
    await this.access.require(user, 'settings');
    return this.maintenance.clearDemo();
  }
}
