import {
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  AssistantActionId,
  Role,
  SessionAudience,
  type AssistantCapabilitiesDto,
  type AssistantConfirmationInput,
  type AssistantInterpretationDto,
  type AssistantInterpretationInput,
  type AssistantPreviewRow,
  type AssistantResource,
  type AssistantTurnDto,
  type AssistantTurnInput,
  type AuthenticatedUser,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { SalonAccessService } from '../common/salon-access/salon-access.service';
import { SalonServicesService } from '../salon-setup/salon-services.service';
import { SalonStaffService } from '../salon-setup/salon-staff.service';
import { SalonOperatingHoursService } from '../salon-setup/salon-operating-hours.service';
import { QueueService } from '../queue/queue.service';
import { OwnerAssistantService } from '../owner-ops/owner-assistant.service';
import { ShopBookingActionsService } from '../owner-ops/shop-booking-actions.service';
import { CustomerAssistantSearchService } from '../salons/customer-assistant-search.service';
import { BookingsService } from '../bookings/bookings.service';
import { AvailabilityService } from '../bookings/availability.service';
import { DashboardBookingsService } from '../dashboard-bookings/dashboard-bookings.service';
import { DashboardCustomersService } from '../dashboard-customers/dashboard-customers.service';
import { SalonChairsService } from '../salon-setup/salon-chairs.service';
import { StaffWorkingHoursService } from '../salon-setup/staff-working-hours.service';
import { BookingNoShowService } from '../bookings/booking-no-show.service';
import { OffersService } from '../offers/offers.service';
import { DashboardReviewsService } from '../dashboard-reviews/dashboard-reviews.service';
import { InvoicesService } from '../owner-ops/invoices.service';
import { RevenueReportService } from '../owner-ops/revenue-report.service';
import { NotificationsService } from '../notifications/notifications.service';
import { FavoritesService } from '../salons/favorites.service';
import { AdminExecutiveOverviewService } from '../admin/analytics/admin-executive-overview.service';
import { AdminShopStatusService } from '../admin/analytics/admin-shop-status.service';
import {
  ConfirmationLedger,
  fingerprint,
  type SealedWrite,
} from './assistant-confirmation';
import {
  ASSISTANT_INTERPRETER,
  type IntentInterpreter,
} from './assistant-interpreter.token';
import {
  ASSISTANT_TRANSCRIBER,
  type Transcriber,
} from './assistant-transcriber';
import { ASSISTANT_ACTIONS } from './actions/catalog';
import {
  Reply,
  staleReply,
  type Deps,
  type Handler,
  type HandlerMap,
  type Planned,
} from './actions/kit';
import { SHOP_CATALOG_HANDLERS } from './actions/shop-catalog.actions';
import { SHOP_OPS_HANDLERS } from './actions/shop-ops.actions';
import { CUSTOMER_HANDLERS } from './actions/customer.actions';
import { BATCH3_HANDLERS } from './actions/batch3.actions';
import { BATCH4_HANDLERS } from './actions/batch4.actions';
import { BATCH5_HANDLERS } from './actions/batch5.actions';
import { BATCH6_HANDLERS } from './actions/batch6.actions';
import { BATCH7_HANDLERS } from './actions/batch7.actions';
import { BATCH8_HANDLERS } from './actions/batch8.actions';
import { BATCH9_HANDLERS } from './actions/batch9.actions';
import { BATCH11_HANDLERS } from './actions/batch11.actions';
import { BATCH12_HANDLERS } from './actions/batch12.actions';
import { StaffWorkService } from '../owner-ops/staff-work.service';
import { CancellationAnalyticsService } from '../owner-ops/cancellation-analytics.service';
import { CustomerCreditsService } from '../credits/customer-credits.service';
import { BATCH13_HANDLERS } from './actions/batch13.actions';
import { BookingAttributionService } from '../owner-ops/booking-attribution.service';
import { QueueAutoAssignService } from '../owner-ops/queue-auto-assign.service';
import { SalonShareLinksService } from '../owner-ops/salon-share-links.service';
import { BATCH14_HANDLERS } from './actions/batch14.actions';
import { BATCH15_HANDLERS } from './actions/batch15.actions';
import { REPORT_HANDLERS } from './actions/reports.actions';
import { helpTurn, notUnderstoodTurn } from './assistant-help';
import {
  ACK_REQUIRED_MESSAGE,
  CANCELLED_MESSAGE,
  EDIT_DISABLED_MESSAGE,
  PREVIEW_FOOTER,
  PreviewMutationError,
  VOICE_YES_MESSAGE,
  confirmationQuestion,
  consequenceFor,
  isBareYes,
  isHighRisk,
  readOnly,
} from './assistant-write-policy';
import { chooseReading } from './assistant-hearing';
import { ASSISTANT_ROLLOUT, AssistantRollout } from './assistant-rollout';
import { AdminCustomerAnalyticsService } from '../admin/analytics/admin-customer-analytics.service';
import { AdminStaffAnalyticsService } from '../admin/analytics/admin-staff-analytics.service';
import { AdminShopActivityService } from '../admin/admin-shop-activity.service';
import { AdminVerificationService } from '../admin/admin-verification.service';
import { AdminCrmService } from '../admin/admin-crm.service';
import { EmployeeService } from '../employee/employee.service';
import { SalonProfileService } from '../salon-setup/salon-profile.service';
import { ReviewsService } from '../reviews/reviews.service';
import { AuthService } from '../auth/auth.service';
import { normalizeText, type ParsedIntent } from './assistant-parser';
import { romanize } from './assistant-transliterate';
import { parseReportFollowUp, type ReportIntent } from './assistant-parser-report';

export { ASSISTANT_ACTIONS };

class AccessDenied extends Error {}

export const ASSISTANT_HANDLERS: HandlerMap = {
  ...SHOP_CATALOG_HANDLERS,
  ...SHOP_OPS_HANDLERS,
  ...CUSTOMER_HANDLERS,
  ...BATCH3_HANDLERS,
  ...BATCH4_HANDLERS,
  ...BATCH5_HANDLERS,
  ...BATCH6_HANDLERS,
  ...BATCH7_HANDLERS,
  ...BATCH8_HANDLERS,
  ...BATCH9_HANDLERS,
  ...BATCH11_HANDLERS,
  ...BATCH12_HANDLERS,
  ...BATCH13_HANDLERS,
  ...BATCH14_HANDLERS,
  ...BATCH15_HANDLERS,
  ...REPORT_HANDLERS,
};

const UNRELEASED: Record<'inventory' | 'onboarding', string> = {
  inventory:
    'Inventory actions will be available after the Inventory release is live. Nothing was changed.',
  onboarding:
    'Salon onboarding actions will be available after the Onboarding release is live. Nothing was changed.',
};

/**
 * Orchestrates one assistant turn: interpret → authorize → handler.plan (a read is answered, a write is
 * previewed and sealed) and, on confirmation: verify seal → re-authorize → handler.execute → audit.
 * Handlers (actions/*.ts) only call existing FastQue services as the session user.
 */
const WRITES_OFF = EDIT_DISABLED_MESSAGE;

// Where an owner can make a refused change by hand (issue #372): a chip that opens the page.
const PAGE_FOR_PREFIX: Record<string, string> = {
  chairs: 'Chairs page kholo',
  staff: 'Staff page kholo',
  services: 'Services page kholo',
  hours: 'Settings kholo',
  queue: 'Live queue kholo',
  bookings: 'Bookings kholo',
  schedule: 'Bookings kholo',
  offers: 'Offers kholo',
  reviews: 'Reviews kholo',
};
function pageOption(actionId: string, surface: string) {
  const text =
    surface === 'shop' ? PAGE_FOR_PREFIX[actionId.split('.')[0]] : undefined;
  return text ? [{ label: text.replace(' kholo', ''), text }] : undefined;
}

@Injectable()
export class AssistantService {
  private readonly logger = new Logger(AssistantService.name);
  readonly ledger = new ConfirmationLedger();
  private readonly deps: Deps;

  constructor(
    private readonly prisma: PrismaService,
    private readonly access: SalonAccessService,
    services: SalonServicesService,
    staff: SalonStaffService,
    hours: SalonOperatingHoursService,
    queue: QueueService,
    insights: OwnerAssistantService,
    search: CustomerAssistantSearchService,
    bookings: BookingsService,
    availability: AvailabilityService,
    shopBookings: ShopBookingActionsService,
    dashboardBookings: DashboardBookingsService,
    dashboardCustomers: DashboardCustomersService,
    chairs: SalonChairsService,
    staffHours: StaffWorkingHoursService,
    noShow: BookingNoShowService,
    offers: OffersService,
    reviews: DashboardReviewsService,
    invoices: InvoicesService,
    revenue: RevenueReportService,
    notifications: NotificationsService,
    favorites: FavoritesService,
    executive: AdminExecutiveOverviewService,
    shopStatus: AdminShopStatusService,
    salonProfile: SalonProfileService,
    customerReviews: ReviewsService,
    auth: AuthService,
    employee: EmployeeService,
    verification: AdminVerificationService,
    crm: AdminCrmService,
    shopActivity: AdminShopActivityService,
    customerAnalytics: AdminCustomerAnalyticsService,
    staffAnalytics: AdminStaffAnalyticsService,
    staffWork: StaffWorkService,
    cancellations: CancellationAnalyticsService,
    credits: CustomerCreditsService,
    attribution: BookingAttributionService,
    autoAssign: QueueAutoAssignService,
    shareLinks: SalonShareLinksService,
    @Inject(ASSISTANT_INTERPRETER)
    private readonly interpreter: IntentInterpreter,
    @Inject(ASSISTANT_TRANSCRIBER) private readonly transcriber: Transcriber,
    @Inject(ASSISTANT_ROLLOUT) private readonly rollout: AssistantRollout,
  ) {
    this.deps = {
      prisma,
      staff,
      services,
      hours,
      queue,
      insights,
      search,
      bookings,
      availability,
      shopBookings,
      dashboardBookings,
      dashboardCustomers,
      chairs,
      staffHours,
      noShow,
      offers,
      reviews,
      invoices,
      revenue,
      notifications,
      favorites,
      executive,
      shopStatus,
      salonProfile,
      customerReviews,
      auth,
      employee,
      verification,
      crm,
      shopActivity,
      customerAnalytics,
      staffAnalytics,
      staffWork,
      cancellations,
      credits,
      attribution,
      autoAssign,
      shareLinks,
    };
  }

  capabilities(user: AuthenticatedUser): AssistantCapabilitiesDto {
    return {
      interpreter: this.interpreter.name,
      voice: { browser: true, local: this.transcriber.available },
      actions: (Object.keys(ASSISTANT_ACTIONS) as AssistantActionId[]).map(
        (id) => {
          const def = ASSISTANT_ACTIONS[id];
          return {
            id,
            title: def.title,
            kind: def.kind,
            confirmation: def.confirm,
            state:
              !ASSISTANT_HANDLERS[id] ||
              (def.kind === 'WRITE' && !this.rollout.writesFor(user))
                ? 'UNAVAILABLE'
                : def.roles.some((r) => effectiveRoles(user).includes(r))
                  ? 'SUPPORTED'
                  : 'DENIED',
            examples: def.examples,
          };
        },
      ),
    };
  }

  async turn(
    user: AuthenticatedUser,
    input: AssistantTurnInput,
  ): Promise<AssistantTurnDto> {
    const reading = await this.read(
      input.text,
      input.alternatives,
      input.surface,
    );
    const out = await this.turnFor(
      user,
      reading.usedAlternative ? { ...input, text: reading.text } : input,
      followUpReport(input, reading.parsed) ?? reading.parsed,
    );
    if (reading.usedAlternative) return { ...out, understoodAs: reading.text };
    // A change heard only in an alternative is never run: it is offered as a choice to tap.
    if (out.status === 'UNSUPPORTED' && reading.writeSuggestions.length)
      return {
        ...out,
        options: [
          ...reading.writeSuggestions.map((t) => ({
            label: `Did you mean: ${t}`,
            text: t,
          })),
          ...(out.options ?? []),
        ].slice(0, 6),
      };
    return out;
  }

  /**
   * Issue #371: which reading of a spoken sentence to act on. The top transcript wins whenever it
   * is understood (including a change, which still needs its preview and on-screen confirmation).
   * Otherwise the first ALTERNATIVE that maps to a READ or navigation is used. An alternative that
   * maps to a change is never used; it is only returned as a suggestion the user must tap.
   */
  private read(
    text: string,
    alternatives: string[] | undefined,
    surface: AssistantTurnInput['surface'],
  ) {
    return chooseReading(
      (t) => this.interpreter.interpret(t, surface),
      text,
      alternatives,
    );
  }

  /** Dry run for the voice accuracy check: what a sentence maps to. Reads no data, runs nothing. */
  async interpretOnly(
    input: AssistantInterpretationInput,
  ): Promise<AssistantInterpretationDto> {
    const r = await this.read(input.text, input.alternatives, input.surface);
    const id = (p: typeof r.parsed) =>
      p && p.action !== 'unreleased' ? (p.action as AssistantActionId) : null;
    const action = id(r.parsed);
    return {
      action,
      kind: action ? ASSISTANT_ACTIONS[action].kind : null,
      usedText: action ? r.text : null,
      usedAlternative: r.usedAlternative,
      topAction: id(r.top),
    };
  }

  private async turnFor(
    user: AuthenticatedUser,
    input: AssistantTurnInput,
    parsed: Awaited<ReturnType<IntentInterpreter['interpret']>>,
  ): Promise<AssistantTurnDto> {
    const requestId = randomUUID();
    // Issue #372: "haan / yes / ok" is never a confirmation of anything.
    if (isBareYes(input.text))
      return this.finish(requestId, null, {
        status: 'UNSUPPORTED',
        message: VOICE_YES_MESSAGE,
      });
    if (!parsed) {
      return this.finish(
        requestId,
        null,
        notUnderstoodTurn(
          this.capabilities(user).actions,
          input.surface,
          input.text,
        ),
      );
    }
    // "What can you do?": answered from what THIS user may do on THIS screen right now.
    if (parsed.action === AssistantActionId.HELP) {
      const turn = helpTurn(
        this.capabilities(user).actions,
        input.surface,
        this.rollout.writesFor(user),
        parsed.greeting,
      );
      await this.audit(
        user.id,
        // No shop is authorized for a help answer, so none is recorded.
        null,
        requestId,
        parsed.action,
        'READ',
        'DONE',
        {
          inputMode: input.inputMode,
          surface: input.surface,
          interpreter: this.interpreter.name,
        },
      );
      return this.finish(requestId, parsed.action, turn);
    }
    if (parsed.action === 'unreleased') {
      return this.finish(requestId, null, {
        status: 'UNAVAILABLE',
        message: UNRELEASED[parsed.feature],
      });
    }
    const actionId = parsed.action;
    const def = ASSISTANT_ACTIONS[actionId];
    const handler = ASSISTANT_HANDLERS[actionId];
    const salonId = input.salonId ?? null;
    try {
      if (!handler)
        throw new Reply({
          status: 'UNAVAILABLE',
          message:
            'That action is not available in the assistant yet. Nothing was changed.',
        });
      // Release gate (#362) and shop + action allowlist (#372): no write preview unless THIS action
      // may be edited in THIS shop by this user. Checked before any lookup; default deny.
      if (
        def.kind === 'WRITE' &&
        !this.rollout.writeAllowed(user, actionId, salonId)
      )
        throw new Reply({
          status: 'UNAVAILABLE',
          message: WRITES_OFF,
          options: pageOption(actionId, input.surface),
        });
      await this.authorize(user, actionId, salonId);
      const planned = await handler.plan(
        this.planCtx(user, actionId, salonId, input.text, def.kind === 'WRITE'),
        parsed,
      );
      const turn =
        def.kind === 'WRITE'
          ? this.asConfirmation(actionId, def.title, planned)
          : planned;
      await this.audit(
        user.id,
        salonId,
        requestId,
        actionId,
        def.kind === 'READ' ? 'READ' : 'PREVIEW',
        turn.status ?? 'DONE',
        {
          inputMode: input.inputMode,
          surface: input.surface,
          interpreter: this.interpreter.name,
        },
      );
      return this.finish(requestId, actionId, turn);
    } catch (err) {
      return this.failure(user.id, salonId, requestId, actionId, err);
    }
  }

  async confirm(
    user: AuthenticatedUser,
    input: AssistantConfirmationInput,
  ): Promise<AssistantTurnDto> {
    const requestId = randomUUID();
    const sealed = this.ledger.open(input.token, user.id);
    if (typeof sealed === 'string') {
      const why =
        sealed === 'EXPIRED'
          ? 'That confirmation expired. Ask again to see a fresh preview.'
          : sealed === 'USED'
            ? 'That confirmation was already used. Nothing was changed again.'
            : 'That confirmation is not valid for your account. Nothing was changed.';
      await this.audit(
        user.id,
        null,
        requestId,
        null,
        'CONFIRM',
        `REFUSED_${sealed}`,
        {},
      );
      return this.finish(requestId, null, { status: 'FAILED', message: why });
    }
    const actionId = sealed.actionId as AssistantActionId;
    const handler = ASSISTANT_HANDLERS[actionId];
    if (
      !(actionId in ASSISTANT_ACTIONS) ||
      ASSISTANT_ACTIONS[actionId].kind !== 'WRITE' ||
      !handler?.execute
    ) {
      return this.finish(requestId, null, {
        status: 'FAILED',
        message: 'That confirmation is not valid. Nothing was changed.',
      });
    }
    const salonId = sealed.salonId || null;
    // Issue #372: a high-risk change needs the on-screen acknowledgement. Checked WITHOUT using up
    // the token, so the same preview can be confirmed after ticking the box.
    if (
      input.decision === 'confirm' &&
      isHighRisk(actionId) &&
      input.acknowledged !== true
    ) {
      this.ledger.release(sealed.nonce);
      await this.audit(
        user.id,
        sealed.salonId || null,
        requestId,
        actionId,
        'CONFIRM',
        'REFUSED_NOT_ACKNOWLEDGED',
        {},
      );
      return this.finish(requestId, actionId, {
        status: 'NEEDS_CONFIRMATION',
        message: ACK_REQUIRED_MESSAGE,
      });
    }
    if (input.decision === 'cancel') {
      await this.audit(
        user.id,
        salonId,
        requestId,
        actionId,
        'CANCEL',
        'CANCELLED',
        {},
      );
      return this.finish(requestId, actionId, {
        status: 'CANCELLED',
        message: CANCELLED_MESSAGE,
      });
    }
    if (!this.rollout.writeAllowed(user, actionId, salonId)) {
      // Writes were switched off after the preview: refuse, change nothing.
      await this.audit(
        user.id,
        salonId,
        requestId,
        actionId,
        'CONFIRM',
        'REFUSED_WRITES_OFF',
        {},
      );
      return this.finish(requestId, actionId, {
        status: 'UNAVAILABLE',
        message: WRITES_OFF,
      });
    }
    try {
      // Re-check now, for this session: roles or shop membership may have changed since the preview.
      await this.authorize(user, actionId, salonId);
      const turn = await this.run(handler, user, sealed);
      await this.audit(
        user.id,
        salonId,
        requestId,
        actionId,
        'EXECUTE',
        'APPLIED',
        {
          changed: turn.result?.changed,
          rows: turn.preview?.rows,
        },
      );
      return this.finish(requestId, actionId, turn);
    } catch (err) {
      return this.failure(user.id, salonId, requestId, actionId, err);
    }
  }

  transcribe(audio: Buffer, mimeType: string, language: string) {
    return this.transcriber.transcribe(audio, mimeType, language);
  }

  // ---------------------------------------------------------------- contexts

  /**
   * Issue #372: a WRITE's first command may only produce a sealed preview (or ask for a detail, or
   * refuse). Anything else - a handler reporting DONE or changes without a confirmation - is refused,
   * and the preview gets the plain question, the consequence warning and the risk tier.
   */
  private asConfirmation(
    actionId: string,
    title: string,
    turn: Planned,
  ): Planned {
    if (
      turn.status === 'NEEDS_CONFIRMATION' &&
      turn.confirmation &&
      turn.preview
    ) {
      const question = confirmationQuestion(actionId, title, turn.preview.rows);
      const consequence = consequenceFor(actionId);
      const warning = [turn.preview.warning, consequence]
        .filter(Boolean)
        .join(' ');
      return {
        ...turn,
        message: `${question} ${PREVIEW_FOOTER}`,
        preview: {
          ...turn.preview,
          question,
          ...(warning ? { warning } : {}),
          ...(isHighRisk(actionId) ? { risk: 'high' as const } : {}),
        },
      };
    }
    // A preview cannot write (read-only services), so an answer like "already in the queue" is
    // fine. Only a preview that claims a change, or asks to confirm without a sealed token, is refused.
    if (turn.status === 'NEEDS_CONFIRMATION' || turn.result?.changed?.length)
      return {
        status: 'FAILED',
        message:
          'This change could not be prepared for confirmation, so nothing was changed.',
      };
    return turn;
  }

  private planCtx(
    user: AuthenticatedUser,
    actionId: AssistantActionId,
    salonId: string | null,
    text: string,
    preview = false,
  ) {
    return {
      user,
      salonId: salonId ?? '',
      text,
      // A write PREVIEW gets read-only services: a data-changing call throws (#372).
      deps: preview
        ? (readOnly(
            this.deps as unknown as Record<string, unknown>,
          ) as unknown as typeof this.deps)
        : this.deps,
      seal: (
        payload: Record<string, unknown>,
        before: unknown,
        rows: AssistantPreviewRow[],
        warning?: string,
      ): Planned => {
        const confirmation = this.ledger.seal({
          userId: user.id,
          salonId: salonId ?? '',
          actionId,
          payload,
          beforeFingerprint: fingerprint(before),
        });
        return {
          status: 'NEEDS_CONFIRMATION',
          message: `Please check and confirm. ${PREVIEW_FOOTER}`,
          preview: { rows, ...(warning ? { warning } : {}) },
          confirmation,
        };
      },
    };
  }

  private run(
    handler: Handler,
    user: AuthenticatedUser,
    sealed: SealedWrite,
  ): Promise<Planned> {
    return handler.execute!({
      user,
      salonId: sealed.salonId,
      deps: this.deps,
      payload: sealed.payload,
      sealed,
      assertUnchanged: (before: unknown) => {
        if (fingerprint(before) !== sealed.beforeFingerprint)
          throw staleReply();
      },
      done: (
        message: string,
        resource: AssistantResource,
        id: string,
        rows: AssistantPreviewRow[],
        navigateTo?: string,
      ): Planned => ({
        status: 'DONE',
        message,
        preview: { rows },
        result: { summary: message, changed: [{ resource, id }] },
        refresh:
          resource === 'myBookings' || resource === 'myQueue'
            ? [resource]
            : [resource, 'overview'],
        ...((navigateTo ??
        (sealed.salonId
          ? `/dashboard/salons/${sealed.salonId}/${resource}`
          : undefined))
          ? {
              navigateTo:
                navigateTo ?? `/dashboard/salons/${sealed.salonId}/${resource}`,
            }
          : {}),
      }),
    });
  }

  // ---------------------------------------------------------------- authorization

  /** Any refusal while checking who may act here is reported as DENIED (never as "not found"). */
  private async authorize(
    user: AuthenticatedUser,
    actionId: AssistantActionId,
    salonId: string | null,
  ) {
    try {
      await this.checkAccess(user, actionId, salonId);
    } catch (err) {
      if (err instanceof Reply) throw err;
      throw new AccessDenied();
    }
  }

  private async checkAccess(
    user: AuthenticatedUser,
    actionId: AssistantActionId,
    salonId: string | null,
  ) {
    const def = ASSISTANT_ACTIONS[actionId];
    if (!def.roles.some((r) => effectiveRoles(user).includes(r)))
      throw new ForbiddenException('role');
    if (def.access === 'ANY_SIGNED_IN' || def.access === 'SELF') return;
    // Platform figures: a platform role is not enough on its own - it must come from an
    // ADMIN-audience (TOTP) session, exactly as RolesGuard requires for the admin routes.
    if (def.access === 'PLATFORM') {
      if (user.audience !== SessionAudience.ADMIN)
        throw new ForbiddenException('audience');
      return;
    }
    // A field employee's own CRM: the role must come from an EMPLOYEE-audience session.
    if (def.access === 'EMPLOYEE') {
      if (user.audience !== SessionAudience.EMPLOYEE)
        throw new ForbiddenException('audience');
      return;
    }
    if (!salonId) {
      throw new Reply({
        status: 'NEEDS_INPUT',
        message: 'Open the shop you want to work on first, then ask again.',
      });
    }
    if (def.access === 'OWNER_ONLY') {
      await this.access.assertOwnerAccess(user.id, salonId);
      return;
    }
    const via =
      def.access === 'OWNER_OR_ADMIN'
        ? await this.access.assertOwnerOrAdminAccess(user.id, salonId)
        : await this.access.assertAccessOrAdminAccess(user.id, salonId);
    // Access to a shop the caller does not own or work at comes only from a platform role, which
    // counts only in an ADMIN-audience (TOTP) session - the same rule RolesGuard applies to the
    // dashboard routes. Without it, a Super Admin / Co-Founder who also owns another shop could
    // reach this shop from an ordinary staff session.
    if (
      (via === 'PLATFORM_ADMIN' || via === 'CO_FOUNDER') &&
      user.audience !== SessionAudience.ADMIN
    )
      throw new ForbiddenException('audience');
  }

  // ---------------------------------------------------------------- results, failures, audit

  private async failure(
    userId: string,
    salonId: string | null,
    requestId: string,
    actionId: AssistantActionId,
    err: unknown,
  ): Promise<AssistantTurnDto> {
    if (err instanceof Reply) {
      await this.audit(
        userId,
        salonId,
        requestId,
        actionId,
        'PREVIEW',
        err.turn.status ?? 'NEEDS_INPUT',
        {},
      );
      return this.finish(requestId, actionId, err.turn);
    }
    // Issue #372: a preview tried to change data. It was blocked before reaching the database.
    if (err instanceof PreviewMutationError) {
      this.logger.error(
        `assistant ${actionId} preview attempted ${err.method}; blocked`,
      );
      await this.audit(
        userId,
        salonId,
        requestId,
        actionId,
        'PREVIEW',
        'REFUSED_PREVIEW_MUTATION',
        {},
      );
      return this.finish(requestId, actionId, {
        status: 'FAILED',
        message:
          'This change could not be prepared safely, so nothing was changed.',
      });
    }
    // Authorization refusals, and 401/403 from a service, are DENIED. A service's other refusals
    // (e.g. "This shop is closed for today") keep their real reason below.
    const denied =
      err instanceof AccessDenied ||
      err instanceof ForbiddenException ||
      err instanceof UnauthorizedException ||
      (err instanceof HttpException && [401, 403].includes(err.getStatus()));
    if (denied) {
      await this.audit(
        userId,
        salonId,
        requestId,
        actionId,
        'DENIED',
        'DENIED',
        {},
      );
      return this.finish(requestId, actionId, {
        status: 'DENIED',
        message:
          'Your account is not allowed to do that here. Nothing was changed.',
      });
    }
    const message =
      err instanceof HttpException && err.getStatus() < 500
        ? `FastQue refused this: ${(err.getResponse() as { message?: string })?.message ?? err.message}. Nothing was changed.`
        : 'Something went wrong on the server. Nothing was changed by the assistant.';
    if (!(err instanceof HttpException))
      this.logger.error(
        `assistant ${actionId} failed: ${err instanceof Error ? err.message : 'unknown'}`,
      );
    await this.audit(
      userId,
      salonId,
      requestId,
      actionId,
      'FAILED',
      'FAILED',
      {},
    );
    return this.finish(requestId, actionId, { status: 'FAILED', message });
  }

  private finish(
    requestId: string,
    actionId: AssistantActionId | null,
    turn: Planned,
  ): AssistantTurnDto {
    const def = actionId ? ASSISTANT_ACTIONS[actionId] : null;
    return {
      requestId,
      status: turn.status ?? 'DONE',
      action:
        actionId && def
          ? { id: actionId, title: def.title, kind: def.kind }
          : null,
      message: turn.message ?? '',
      ...(turn.preview ? { preview: turn.preview } : {}),
      ...(turn.confirmation ? { confirmation: turn.confirmation } : {}),
      ...(turn.options ? { options: turn.options } : {}),
      ...(turn.result ? { result: turn.result } : {}),
      ...(turn.refresh ? { refresh: turn.refresh } : {}),
      ...(turn.navigateTo ? { navigateTo: turn.navigateTo } : {}),
      ...(turn.reportContext ? { reportContext: turn.reportContext } : {}),
      completedAt: new Date().toISOString(),
    };
  }

  /** Append-only record of every assistant step. No transcript text, no full phone numbers. */
  private async audit(
    userId: string,
    salonId: string | null,
    requestId: string,
    actionId: AssistantActionId | null,
    stage:
      | 'READ'
      | 'PREVIEW'
      | 'CONFIRM'
      | 'EXECUTE'
      | 'CANCEL'
      | 'DENIED'
      | 'FAILED',
    outcome: string,
    extra: Record<string, unknown>,
  ) {
    try {
      await this.prisma.auditLog.create({
        data: {
          actorUserId: userId,
          action: 'ASSISTANT_ACTION',
          entityType: salonId ? 'Salon' : 'Assistant',
          entityId: salonId ?? requestId,
          metadata: { requestId, actionId, stage, outcome, ...extra } as never,
        },
      });
    } catch (e) {
      this.logger.warn(
        `assistant audit write failed: ${e instanceof Error ? e.message : 'unknown'}`,
      );
    }
  }
}

const PLATFORM_ROLES: ReadonlySet<Role> = new Set([
  Role.PLATFORM_ADMIN,
  Role.CO_FOUNDER,
  Role.HR_ADMIN,
  Role.SALES_ADMIN,
  Role.PLATFORM_VIEWER,
]);

/**
 * The roles that actually count for this session, exactly as RolesGuard counts them: platform roles
 * only in an ADMIN-audience (TOTP) session, FIELD_EXECUTIVE only in an EMPLOYEE-audience session.
 */
export function effectiveRoles(user: Pick<AuthenticatedUser, 'roles' | 'audience'>): Role[] {
  return user.roles.filter((r) =>
    PLATFORM_ROLES.has(r)
      ? user.audience === SessionAudience.ADMIN
      : r === Role.FIELD_EXECUTIVE
        ? user.audience === SessionAudience.EMPLOYEE
        : true,
  );
}

/**
 * "aur last month?" / "pichhle hafte ka?" / "aur dikhao" right after a period report: the same report
 * with only the period or page changed. Applies only when the sentence was not understood on its own
 * (or was read as today's schedule, which is how a bare period used to be read), and only to the two
 * READ report actions accepted by the request schema.
 */
function followUpReport(
  input: AssistantTurnInput,
  parsed: ParsedIntent | null,
): ParsedIntent | null {
  const ctx = input.context;
  if (!ctx || (input.surface ?? 'shop') !== 'shop') return null;
  if (parsed && parsed.action !== AssistantActionId.SCHEDULE_VIEW) return null;
  const previous = {
    action: ctx.action,
    period: ctx.period,
    status: ctx.status ?? null,
    page: ctx.page,
  } as ReportIntent;
  const year = new Date().getUTCFullYear();
  const text = normalizeText(input.text);
  return (
    parseReportFollowUp(text, previous, ctx.page, year) ??
    parseReportFollowUp(romanize(text), previous, ctx.page, year)
  );
}
