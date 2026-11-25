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
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import {
  Role,
  homeCampaignSchema,
  homeFeeRuleSchema,
  homeFieldLeadSchema,
  homeFreelancerRegisterSchema,
  homePromotionSchema,
  homeReasonSchema,
  homeSettingsSchema,
  homeSocietySchema,
  homeVerificationReviewSchema,
  type AuthenticatedUser,
} from '@barbercue/shared';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { HomeAdminService } from './home-admin.service';
import { HomeBookingService } from './home-booking.service';
import { HomeCustomerService } from './home-customer.service';
import { homeInvalid } from './home-errors';
import { HomeProviderService } from './home-provider.service';
import { HomeVisitService } from './home-visit.service';
import { code, homeParse, sendPrivate, zod } from './home.controller';

const READ = [Role.PLATFORM_ADMIN, Role.CO_FOUNDER, Role.PLATFORM_VIEWER];
/** Full addresses, phone numbers, locations and documents: administrators only, never read-only viewers. */
const SENSITIVE = [Role.PLATFORM_ADMIN, Role.CO_FOUNDER];
const page = z.coerce.number().int().min(1).max(1000).default(1);
const noteSchema = z
  .object({ note: z.string().trim().min(5).max(1000) })
  .strict();
const serviceSchema = z
  .object({
    id: z.string().uuid().optional(),
    categoryId: z.string().uuid(),
    code: z.string().regex(/^[a-z0-9-]{2,60}$/),
    name: z.string().trim().min(2).max(120),
    nameHi: z.string().trim().min(1).max(120),
    description: z.string().max(1000).optional(),
    durationMinutes: z.number().int().min(5).max(600),
    prepMinutes: z.number().int().min(0).max(120).default(5),
    cleanupMinutes: z.number().int().min(0).max(120).default(5),
    safetyInstructions: z.string().max(1000).optional(),
    customerPreparation: z.string().max(500).optional(),
    forChildren: z.boolean().default(false),
    customerProducts: z.boolean().default(false),
    minPricePaise: z.number().int().min(0).nullish(),
    maxPricePaise: z.number().int().min(0).nullish(),
    status: z.enum(['DRAFT', 'ACTIVE', 'INACTIVE']).default('ACTIVE'),
  })
  .strict();
const bookingsQuery = z.object({
  scope: z.enum(['active', 'scheduled', 'all']).default('all'),
  status: z.string().max(40).optional(),
  q: z.string().max(60).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page,
});
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** FastQue Home control centre. Works with the flags off, so existing bookings can always be resolved. */
@Controller('admin/home')
@Roles(...READ)
export class HomeAdminController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly admin: HomeAdminService,
    private readonly bookings: HomeBookingService,
    private readonly visits: HomeVisitService,
    private readonly providers: HomeProviderService,
    private readonly customers: HomeCustomerService,
  ) {}

  @Get('overview') overview() {
    return this.admin.overview();
  }
  @Get('dispatch') dispatch() {
    return this.admin.dispatch();
  }
  @Get('providers') providersList(
    @Query(
      zod(
        z.object({
          kind: z
            .enum(['SALON_MANAGED', 'INDEPENDENT_PROFESSIONAL'])
            .optional(),
          status: z
            .enum(['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'SUSPENDED'])
            .optional(),
          q: z.string().max(60).optional(),
          page,
        }),
      ),
    )
    q: {
      kind?: string;
      status?: string;
      q?: string;
      page: number;
    },
  ) {
    return this.admin.providers(q);
  }
  @Post('providers/:id/review')
  @Roles(Role.PLATFORM_ADMIN, Role.CO_FOUNDER)
  @HttpCode(HttpStatus.OK)
  review(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(
      zod(
        z
          .object({
            decision: z.enum(['APPROVED', 'REJECTED', 'SUSPENDED']),
            note: z.string().trim().min(3).max(1000),
          })
          .strict(),
      ),
    )
    b: { decision: 'APPROVED' | 'REJECTED' | 'SUSPENDED'; note: string },
  ) {
    return this.admin.reviewProvider(u.id, id, b.decision, b.note);
  }
  @Post('professionals/:id/suspend')
  @Roles(Role.PLATFORM_ADMIN)
  @HttpCode(HttpStatus.OK)
  suspend(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(
      zod(
        z
          .object({
            suspended: z.boolean(),
            note: z.string().trim().min(5).max(1000),
          })
          .strict(),
      ),
    )
    b: { suspended: boolean; note: string },
  ) {
    return this.admin.suspendProfessional(u.id, id, b.suspended, b.note);
  }
  @Get('verifications') verifications(@Query('status') status?: string) {
    const ok = [
      'PENDING',
      'UNDER_REVIEW',
      'VERIFIED',
      'REJECTED',
      'EXPIRED',
      'SUSPENDED',
    ];
    return this.admin.verifications(
      status && ok.includes(status) ? status : undefined,
    );
  }
  @Post('verifications/:id/review')
  @Roles(...SENSITIVE)
  @HttpCode(HttpStatus.OK)
  verify(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zod(homeVerificationReviewSchema))
    b: z.infer<typeof homeVerificationReviewSchema>,
  ) {
    return this.providers.reviewVerification(u.id, id, b);
  }
  @Get('verifications/:id/file')
  @Roles(...SENSITIVE)
  async evidence(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    sendPrivate(
      res,
      await this.providers.evidence(id, { userId: u.id, admin: true }),
    );
  }
  @Get('bookings') bookingList(
    @Query(zod(bookingsQuery)) q: z.infer<typeof bookingsQuery>,
  ) {
    return this.admin.bookingList(q);
  }
  @Get('bookings/export')
  @Roles(...SENSITIVE)
  async exportBookings(
    @CurrentUser() u: AuthenticatedUser,
    @Res() res: Response,
    @Query(zod(bookingsQuery)) q: z.infer<typeof bookingsQuery>,
  ) {
    const cell = (v: unknown) => {
      const s =
        v == null ? '' : v instanceof Date ? v.toISOString() : String(v);
      // Neutralise spreadsheet formulas and quote everything.
      return `"${(/^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
    };
    const head = [
      'code',
      'status',
      'paymentStatus',
      'mode',
      'serviceStart',
      'totalPaise',
      'services',
      'provider',
      'kind',
      'professional',
      'area',
    ] as const;
    const lines = [head.join(',')];
    for (let p = 1; p <= 80; p += 1) {
      const r = await this.admin.bookingList({ ...q, page: p });
      lines.push(...r.items.map((i) => head.map((h) => cell(i[h])).join(',')));
      if (p * 25 >= r.total) break;
    }
    await this.prisma.homeAudit.create({
      data: {
        actorUserId: u.id,
        actorParty: 'ADMIN',
        action: 'EXPORT_BOOKINGS',
        entityType: 'EXPORT',
        entityId: 'bookings',
        metadata: { rows: lines.length - 1 },
      },
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="fastque-home-bookings.csv"',
    );
    res.send(lines.join('\r\n'));
  }
  @Get('bookings/:code')
  @Roles(...SENSITIVE)
  booking(@CurrentUser() u: AuthenticatedUser, @Param('code') c: string) {
    return this.bookings.view(code(c), { userId: u.id, admin: true });
  }
  @Get('bookings/:code/tracking')
  @Roles(...SENSITIVE)
  tracking(@CurrentUser() u: AuthenticatedUser, @Param('code') c: string) {
    return this.visits.tracking(code(c), { userId: u.id, admin: true });
  }
  @Post('bookings/:code/:action')
  @Roles(Role.PLATFORM_ADMIN)
  @HttpCode(HttpStatus.OK)
  async act(
    @CurrentUser() u: AuthenticatedUser,
    @Param('code') c: string,
    @Param('action') action: string,
    @Body() body: Record<string, unknown>,
  ): Promise<unknown> {
    const b = code(c);
    const viewer = { userId: u.id, admin: true };
    switch (action) {
      case 'invite': {
        const d = homeParse(
          z
            .object({
              professionalId: z.string().uuid(),
              note: z.string().trim().min(3).max(500),
            })
            .strict(),
          body,
        );
        const a = await this.bookings.access(b, viewer);
        return this.bookings.adminInvite(a.id, d.professionalId, u.id, d.note);
      }
      case 'replacement': {
        const d = homeParse(
          z
            .object({
              reason: z.string().trim().min(3).max(500),
              professionalId: z.string().uuid().optional(),
            })
            .strict(),
          body,
        );
        return this.bookings.requestReplacement(
          b,
          viewer,
          d.reason,
          d.professionalId,
        );
      }
      case 'cancel':
        return this.bookings.cancel(
          b,
          viewer,
          homeParse(homeReasonSchema, body).reason,
        );
      case 'force-check-in':
        return this.visits.adminForceCheckIn(
          b,
          u.id,
          homeParse(noteSchema, body).note,
        );
      case 'professional-no-show':
        return this.visits.professionalNoShow(
          b,
          viewer,
          homeParse(homeReasonSchema, body).reason,
        );
      case 'refund':
        return this.admin.refund(
          u.id,
          b,
          homeParse(
            z
              .object({
                kind: z.enum(['REFUND', 'SERVICE_CREDIT']),
                amountPaise: z.number().int().positive(),
                reason: z.string().trim().min(5).max(500),
              })
              .strict(),
            body,
          ),
        );
      case 'void-payment': {
        const d = homeParse(
          z
            .object({
              paymentId: z.string().uuid(),
              note: z.string().trim().min(5).max(500),
            })
            .strict(),
          body,
        );
        return this.visits.voidPayment(b, u.id, d.paymentId, d.note);
      }
      default:
        throw homeInvalid('Unknown action.');
    }
  }
  @Get('catalog') catalog() {
    return this.admin.catalog();
  }
  @Put('catalog/categories/:id')
  @Roles(Role.PLATFORM_ADMIN)
  category(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(
      zod(
        z
          .object({
            active: z.boolean().optional(),
            requiresQualification: z.boolean().optional(),
          })
          .strict(),
      ),
    )
    b: { active?: boolean; requiresQualification?: boolean },
  ) {
    return this.admin.updateCategory(u.id, id, b);
  }
  @Put('catalog/services')
  @Roles(Role.PLATFORM_ADMIN)
  service(
    @CurrentUser() u: AuthenticatedUser,
    @Body(zod(serviceSchema)) b: z.infer<typeof serviceSchema>,
  ) {
    return this.admin.saveService(u.id, b);
  }
  @Get('growth') growth() {
    return this.admin.lists();
  }
  @Post('promotions')
  @Roles(Role.PLATFORM_ADMIN)
  promotion(
    @CurrentUser() u: AuthenticatedUser,
    @Body(zod(homePromotionSchema)) b: z.infer<typeof homePromotionSchema>,
  ) {
    return this.admin.createPromotion(u.id, b);
  }
  @Post('societies')
  @Roles(Role.PLATFORM_ADMIN, Role.CO_FOUNDER, Role.SALES_ADMIN)
  society(@Body(zod(homeSocietySchema)) b: z.infer<typeof homeSocietySchema>) {
    return this.prisma.homeSociety.create({
      data: { ...b, lat: b.lat ?? null, lng: b.lng ?? null },
    });
  }
  @Post('campaigns')
  @Roles(Role.PLATFORM_ADMIN, Role.CO_FOUNDER)
  campaign(
    @CurrentUser() u: AuthenticatedUser,
    @Body(zod(homeCampaignSchema)) b: z.infer<typeof homeCampaignSchema>,
  ) {
    return this.admin.createCampaign(u.id, b);
  }
  @Post('campaigns/close-due')
  @Roles(Role.PLATFORM_ADMIN)
  async closeDue() {
    return { closed: await this.customers.closeCampaigns() };
  }
  @Post('membership-plans')
  @Roles(Role.PLATFORM_ADMIN)
  plan(
    @Body(
      zod(
        z
          .object({
            name: z.string().trim().min(2).max(120),
            pricePaise: z.number().int().min(0),
            periodMonths: z.number().int().min(1).max(24).default(1),
            benefits: z.record(z.unknown()).default({}),
            active: z.boolean().default(false),
          })
          .strict(),
      ),
    )
    b: {
      name: string;
      pricePaise: number;
      periodMonths: number;
      benefits: Record<string, unknown>;
      active: boolean;
    },
  ) {
    return this.admin.saveMembershipPlan(b);
  }
  @Get('quality') quality() {
    return this.admin.quality();
  }
  @Post('reviews/:id')
  @Roles(Role.PLATFORM_ADMIN)
  moderate(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(
      zod(
        z
          .object({
            status: z.enum(['PUBLISHED', 'HIDDEN']),
            note: z.string().trim().min(5).max(500),
          })
          .strict(),
      ),
    )
    b: { status: 'PUBLISHED' | 'HIDDEN'; note: string },
  ) {
    return this.admin.moderateReview(u.id, id, b.status, b.note);
  }
  @Get('incidents')
  @Roles(...SENSITIVE)
  incidents() {
    return this.admin.incidents();
  }
  @Post('incidents/:id')
  @Roles(...SENSITIVE)
  incident(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(
      zod(
        z
          .object({
            status: z.enum(['INVESTIGATING', 'ESCALATED', 'CLOSED']),
            resolution: z.string().trim().min(5).max(2000),
          })
          .strict(),
      ),
    )
    b: { status: 'INVESTIGATING' | 'ESCALATED' | 'CLOSED'; resolution: string },
  ) {
    return this.admin.handleIncident(u.id, id, b.status, b.resolution);
  }
  @Get('tickets') tickets(@Query('status') status?: string) {
    return this.admin.tickets(
      status && /^[A-Z_]{3,20}$/.test(status) ? status : undefined,
    );
  }
  @Post('tickets/:id')
  @Roles(...SENSITIVE)
  ticket(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(
      zod(
        z
          .object({
            reply: z.string().trim().min(1).max(2000).optional(),
            internal: z.boolean().optional(),
            status: z
              .enum(['OPEN', 'IN_PROGRESS', 'ESCALATED', 'RESOLVED', 'CLOSED'])
              .optional(),
            priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).optional(),
            assignToMe: z.boolean().optional(),
            resolution: z.string().trim().max(2000).optional(),
          })
          .strict(),
      ),
    )
    b: Parameters<HomeAdminService['workTicket']>[2],
  ) {
    return this.admin.workTicket(u.id, id, b);
  }
  @Get('money') money() {
    return this.admin.money();
  }
  @Post('fee-rules')
  @Roles(Role.PLATFORM_ADMIN)
  feeRule(
    @CurrentUser() u: AuthenticatedUser,
    @Body(zod(homeFeeRuleSchema)) b: z.infer<typeof homeFeeRuleSchema>,
  ) {
    return this.admin.saveFeeRule(u.id, b);
  }
  @Put('fee-rules/:id')
  @Roles(Role.PLATFORM_ADMIN)
  editFeeRule(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zod(homeFeeRuleSchema)) b: z.infer<typeof homeFeeRuleSchema>,
  ) {
    return this.admin.saveFeeRule(u.id, b, id);
  }
  @Post('settlements')
  @Roles(Role.PLATFORM_ADMIN)
  settlement(
    @CurrentUser() u: AuthenticatedUser,
    @Body(zod(z.object({ providerId: z.string().uuid() }).strict()))
    b: { providerId: string },
  ) {
    return this.admin.createSettlement(u.id, b.providerId);
  }
  @Post('settlements/:id/collect')
  @Roles(Role.PLATFORM_ADMIN)
  collect(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(
      zod(z.object({ reference: z.string().trim().min(3).max(80) }).strict()),
    )
    b: { reference: string },
  ) {
    return this.admin.collectSettlement(u.id, id, b.reference);
  }
  @Get('training') training() {
    return this.prisma.homeVerification.findMany({
      where: {
        scope: {
          in: ['HYGIENE_TRAINING', 'SKILL_ASSESSMENT', 'TRAINING_CERTIFICATE'],
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 200,
      select: {
        id: true,
        scope: true,
        status: true,
        submittedAt: true,
        verifiedAt: true,
        expiresAt: true,
        professional: {
          select: {
            displayName: true,
            provider: { select: { displayName: true } },
          },
        },
      },
    });
  }
  @Get('insights') insights() {
    return this.admin.riskSignals();
  }
  @Get('analytics') analytics(
    @Query(zod(z.object({ from: day, to: day })))
    q: {
      from: string;
      to: string;
    },
  ) {
    return this.admin.analytics(q.from, q.to);
  }
  @Get('audit') audit(
    @Query(
      zod(
        z.object({
          entityType: z.string().max(40).optional(),
          entityId: z.string().max(80).optional(),
        }),
      ),
    )
    q: {
      entityType?: string;
      entityId?: string;
    },
  ) {
    return this.admin.audit(q);
  }
  @Get('settings') settings() {
    return this.admin.settings();
  }
  @Put('settings')
  @Roles(Role.PLATFORM_ADMIN)
  saveSettings(
    @CurrentUser() u: AuthenticatedUser,
    @Body(zod(homeSettingsSchema.partial()))
    b: Partial<z.infer<typeof homeSettingsSchema>>,
  ) {
    return this.admin.saveSettings(u.id, b);
  }
  @Get('field') async field() {
    return {
      leads: await this.admin.fieldLeads(null),
      results: await this.admin.fieldResults(),
    };
  }
}

/** Field executives: their own FastQue Home leads, recorded with the person's consent. */
@Controller('employee/home')
@Roles(Role.FIELD_EXECUTIVE, Role.SALES_ADMIN, Role.PLATFORM_ADMIN)
export class HomeFieldController {
  constructor(
    private readonly admin: HomeAdminService,
    private readonly providers: HomeProviderService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('leads') leads(@CurrentUser() u: AuthenticatedUser) {
    return this.admin.fieldLeads(u.id);
  }
  @Post('leads') add(
    @CurrentUser() u: AuthenticatedUser,
    @Body(zod(homeFieldLeadSchema)) b: z.infer<typeof homeFieldLeadSchema>,
  ) {
    return this.admin.saveFieldLead(u.id, b);
  }
  @Put('leads/:id') edit(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zod(homeFieldLeadSchema)) b: z.infer<typeof homeFieldLeadSchema>,
  ) {
    return this.admin.saveFieldLead(u.id, b, id);
  }
  /** Drafts a profile for an EXISTING account that gave its phone; unlisted until that person consents and submits. */
  @Post('leads/:id/register')
  async register(
    @CurrentUser() u: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(zod(homeFreelancerRegisterSchema))
    b: z.infer<typeof homeFreelancerRegisterSchema>,
  ) {
    const lead = await this.prisma.homeFieldLead.findFirst({
      where: { id, employeeUserId: u.id, kind: 'PROFESSIONAL' },
    });
    if (!lead?.consentAt || !lead.phone)
      throw homeInvalid("Record the person's phone and consent first.");
    const user = await this.prisma.user.findUnique({
      where: { phone: lead.phone },
    });
    if (!user)
      throw homeInvalid(
        'Ask the person to sign in to FastQue once with this phone, then try again.',
      );
    const d = await this.providers.registerIndependent(user.id, b, u.id);
    // The executive cannot consent for them: the person confirms from their own account.
    await this.prisma.homeProfessional.updateMany({
      where: { providerId: d.id },
      data: { consentAt: null },
    });
    await this.prisma.homeFieldLead.update({
      where: { id },
      data: { providerId: d.id, stage: 'REGISTERED' },
    });
    return {
      providerId: d.id,
      next: 'The person must sign in, confirm consent and submit the profile themselves.',
    };
  }
}
