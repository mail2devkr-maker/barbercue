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
  type AssistantCapabilitiesDto,
  type AssistantConfirmationInput,
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

export { ASSISTANT_ACTIONS };

class AccessDenied extends Error {}

export const ASSISTANT_HANDLERS: HandlerMap = {
  ...SHOP_CATALOG_HANDLERS,
  ...SHOP_OPS_HANDLERS,
  ...CUSTOMER_HANDLERS,
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
    @Inject(ASSISTANT_INTERPRETER)
    private readonly interpreter: IntentInterpreter,
    @Inject(ASSISTANT_TRANSCRIBER) private readonly transcriber: Transcriber,
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
            state: !ASSISTANT_HANDLERS[id]
              ? 'UNAVAILABLE'
              : def.roles.some((r) => user.roles.includes(r))
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
    const requestId = randomUUID();
    const parsed = await this.interpreter.interpret(input.text, input.surface);
    if (!parsed) {
      return this.finish(requestId, null, {
        status: 'UNSUPPORTED',
        message:
          "I didn't understand that as a FastQue action. Try one of these.",
        options: this.capabilities(user)
          .actions.filter((c) => c.state === 'SUPPORTED')
          .slice(0, 6)
          .map((c) => ({ label: c.examples[0], text: c.examples[0] })),
      });
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
      await this.authorize(user, actionId, salonId);
      const turn = await handler.plan(
        this.planCtx(user, actionId, salonId, input.text),
        parsed,
      );
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
        message: 'Cancelled. Nothing was changed.',
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

  private planCtx(
    user: AuthenticatedUser,
    actionId: AssistantActionId,
    salonId: string | null,
    text: string,
  ) {
    return {
      user,
      salonId: salonId ?? '',
      text,
      deps: this.deps,
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
          message: 'Please check and confirm. Nothing has changed yet.',
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
    if (!def.roles.some((r) => user.roles.includes(r)))
      throw new ForbiddenException('role');
    if (def.access === 'ANY_SIGNED_IN' || def.access === 'SELF') return;
    if (!salonId) {
      throw new Reply({
        status: 'NEEDS_INPUT',
        message: 'Open the shop you want to work on first, then ask again.',
      });
    }
    if (def.access === 'OWNER_OR_ADMIN')
      await this.access.assertOwnerOrAdminAccess(user.id, salonId);
    else await this.access.assertAccessOrAdminAccess(user.id, salonId);
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
