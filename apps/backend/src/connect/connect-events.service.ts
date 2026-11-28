import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { Prisma, type ConnectConversation } from '@prisma/client';
import { DbDeadlineSchedulerService } from '../common/db-deadline-scheduler/db-deadline-scheduler.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  RealtimeGateway,
  type RealtimeDomainEvent,
} from '../realtime/realtime.gateway';
import { ConnectConfigService, connectFlag } from './connect-config';
import { ConnectLinksService } from './connect-links.service';
import { ConnectMessagesService } from './connect-messages.service';
import { ConnectNotifyService } from './connect-notify.service';

interface QueueState {
  status: string;
  position: number | null;
  eta: number | null;
}

const ACTIVE = ['WAITING', 'CALLED', 'IN_SERVICE'];

/**
 * Event-driven Connect (spec sections 8 and 15). Reacts to the booking/queue events the realtime
 * gateway already publishes after commit; nothing polls and no model is called. Queue messages
 * are posted into the chat only on meaningful changes (status change, crossing "turn approaching",
 * a position step, or a wait increase over the configured threshold). They do not send their own
 * push: the existing queue notifications already do, so the customer is never told twice.
 */
@Injectable()
export class ConnectEventsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ConnectEventsService.name);
  private unsubscribe: (() => void) | null = null;
  private unregisterJob: (() => void) | null = null;
  private readonly pending = new Map<string, NodeJS.Timeout>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly links: ConnectLinksService,
    private readonly messages: ConnectMessagesService,
    private readonly notify: ConnectNotifyService,
    private readonly config: ConnectConfigService,
    @Optional() private readonly deadlines?: DbDeadlineSchedulerService,
  ) {}

  onModuleInit() {
    this.unsubscribe = this.realtime.onDomainEvent((e) => this.handle(e));
    this.messages.onCustomerMessage((conv, msg) => this.optOut(conv, msg.body));
    this.unregisterJob =
      this.deadlines?.register({
        name: 'connect-follow-ups',
        domain: 'booking',
        nextDueAt: async () => {
          if (!connectFlag('CONNECT_FOLLOWUPS_ENABLED')) return null;
          const f = await this.prisma.connectFollowUp.findFirst({
            where: { sentAt: null, skippedReason: null },
            orderBy: { dueAt: 'asc' },
            select: { dueAt: true },
          });
          return f?.dueAt ?? null;
        },
        runDue: async () => {
          await this.runFollowUps();
        },
      }) ?? null;
  }

  onModuleDestroy() {
    this.unsubscribe?.();
    this.unregisterJob?.();
    for (const t of this.pending.values()) clearTimeout(t);
  }

  /** Synchronous and cheap: real work is deferred so the emitting request is never slowed. */
  handle(e: RealtimeDomainEvent): void {
    if (!connectFlag('FASTQUE_CONNECT_ENABLED')) return;
    const run = (fn: () => Promise<unknown>) =>
      setImmediate(
        () =>
          void fn().catch((err) =>
            this.logger.warn(
              `Connect event ${e.type} failed: ${err instanceof Error ? err.message : 'unknown'}`,
            ),
          ),
      );
    switch (e.type) {
      case 'booking.created':
        if (e.bookingId) run(() => this.links.onBookingCreated(e.bookingId!));
        break;
      case 'queue.entry.joined':
        if (e.queueEntryId)
          run(() => this.links.onQueueJoined(e.queueEntryId!));
        this.debounceQueue(e.salonId);
        break;
      case 'booking.cancelled':
      case 'booking.rescheduled':
      case 'booking.no_show':
      case 'booking.expired':
      case 'booking.corrected':
        if (e.bookingId) run(() => this.bookingChanged(e.bookingId!, e.type));
        break;
      case 'queue.updated':
      case 'queue.entry.called':
      case 'queue.entry.no_show':
      case 'queue.entry.expired':
        this.debounceQueue(e.salonId);
        break;
      default:
    }
  }

  private debounceQueue(salonId: string) {
    if (this.pending.has(salonId)) return;
    const t = setTimeout(() => {
      this.pending.delete(salonId);
      void this.queueChanged(salonId).catch((err) =>
        this.logger.warn(
          `Connect queue sync failed: ${err instanceof Error ? err.message : 'unknown'}`,
        ),
      );
    }, 1500);
    t.unref?.();
    this.pending.set(salonId, t);
  }

  private async bookingChanged(bookingId: string, type: string) {
    const conv = await this.prisma.connectConversation.findUnique({
      where: { bookingId },
    });
    if (!conv) return;
    const text: Record<string, string> = {
      'booking.cancelled': 'This booking was cancelled.',
      'booking.rescheduled':
        'This booking was moved to a new time. The card above shows the new time.',
      'booking.no_show': 'This booking was marked as missed.',
      'booking.expired': 'This booking expired.',
      'booking.corrected': "The salon corrected this booking's status.",
    };
    // A reschedule done from this chat already posted its own confirmation.
    if (type === 'booking.rescheduled') {
      const recent = await this.prisma.connectBookingAction.findFirst({
        where: {
          conversationId: conv.id,
          kind: 'RESCHEDULE',
          status: 'APPLIED',
          appliedAt: { gte: new Date(Date.now() - 60_000) },
        },
      });
      if (recent) return;
    }
    await this.messages.post(conv.id, {
      senderKind: 'SYSTEM',
      body: text[type] ?? 'This booking was updated.',
      meta: { event: type },
      notify: 'NONE',
    });
  }

  async queueChanged(salonId: string): Promise<void> {
    const since = new Date(Date.now() - 15 * 60_000);
    const convs = await this.prisma.connectConversation.findMany({
      where: {
        salonId,
        OR: [
          {
            queueEntry: {
              OR: [
                { status: { in: ['WAITING', 'CALLED', 'IN_SERVICE'] } },
                { status: 'COMPLETED', serviceCompletedAt: { gte: since } },
              ],
            },
          },
          {
            booking: {
              queueEntries: {
                some: {
                  OR: [
                    { status: { in: ['WAITING', 'CALLED', 'IN_SERVICE'] } },
                    { status: 'COMPLETED', serviceCompletedAt: { gte: since } },
                  ],
                },
              },
            },
          },
        ],
      },
      take: 300,
    });
    if (!convs.length) return;
    const cfg = await this.config.get();
    for (const conv of convs) {
      const card = await this.links.card(conv);
      if (!card) continue;
      const next: QueueState = {
        status: card.status,
        position: card.queuePosition,
        eta: card.estimatedWaitMinutes,
      };
      const prev = (conv.queueState as QueueState | null) ?? null;
      const msg = queueMessage(
        prev,
        next,
        cfg.notifications.queuePositionStep,
        cfg.notifications.queueWaitIncreaseMinutes,
      );
      // Always pulse so an open chat refreshes its card; only meaningful changes become messages.
      const all = await this.notify.recipients(conv, null);
      this.notify.pulse(
        all.map((r) => r.userId),
        'connect.updated',
        { conversationId: conv.id },
      );
      if (!msg.announce) continue;
      await this.prisma.connectConversation.update({
        where: { id: conv.id },
        data: { queueState: next as unknown as Prisma.InputJsonValue },
      });
      if (msg.text && connectFlag('CONNECT_QUEUE_MESSAGES_ENABLED')) {
        await this.messages.post(conv.id, {
          senderKind: 'SYSTEM',
          body: msg.text,
          meta: { event: 'queue', ...next },
          notify: 'NONE',
        });
      }
      if (next.status === 'COMPLETED' && prev?.status !== 'COMPLETED')
        await this.scheduleFollowUps(conv);
    }
  }

  // ---------- Follow-ups (section 15) ----------

  async scheduleFollowUps(conv: ConnectConversation) {
    if (!connectFlag('CONNECT_FOLLOWUPS_ENABLED')) return;
    const s = await this.prisma.connectSalonSettings.findFirst({
      where: conv.salonId
        ? { salonId: conv.salonId }
        : { homeProviderId: conv.homeProviderId },
    });
    if (!s?.followUpsEnabled) return;
    const now = Date.now();
    const plan: { kind: string; at: number; promotional: boolean }[] = [
      { kind: 'THANKS', at: now + 5 * 60_000, promotional: false },
      { kind: 'FEEDBACK', at: now + 3 * 3_600_000, promotional: false },
      ...(s.aftercare
        ? [{ kind: 'AFTERCARE', at: now + 60 * 60_000, promotional: false }]
        : []),
      { kind: 'REBOOK', at: now + 21 * 86_400_000, promotional: true },
    ];
    for (const p of plan) {
      await this.prisma.connectFollowUp.upsert({
        where: {
          conversationId_kind: { conversationId: conv.id, kind: p.kind },
        },
        create: {
          conversationId: conv.id,
          kind: p.kind,
          promotional: p.promotional,
          dueAt: new Date(p.at),
        },
        update: {},
      });
    }
    this.deadlines?.signal('booking');
  }

  async runFollowUps(now = new Date()): Promise<number> {
    if (!connectFlag('CONNECT_FOLLOWUPS_ENABLED')) return 0;
    const due = await this.prisma.connectFollowUp.findMany({
      where: { sentAt: null, skippedReason: null, dueAt: { lte: now } },
      take: 50,
      include: { conversation: true },
    });
    let sent = 0;
    for (const f of due) {
      const conv = f.conversation;
      const s = await this.prisma.connectSalonSettings.findFirst({
        where: conv.salonId
          ? { salonId: conv.salonId }
          : { homeProviderId: conv.homeProviderId },
      });
      let skip: string | null = null;
      if (!s?.followUpsEnabled) skip = 'SALON_DISABLED';
      else if (conv.customerBlockedAt) skip = 'BLOCKED';
      else if (
        f.promotional &&
        !(await this.promoConsent(conv.customerId, conv.salonId))
      )
        skip = 'NO_CONSENT';
      else if (
        (await this.links.lifecycle(conv)).status === 'READ_ONLY' &&
        !f.promotional
      )
        skip = 'READ_ONLY';
      if (skip) {
        await this.prisma.connectFollowUp.update({
          where: { id: f.id },
          data: { skippedReason: skip },
        });
        continue;
      }
      const salonName = conv.salonId
        ? ((
            await this.prisma.salon.findUnique({
              where: { id: conv.salonId },
              select: { name: true, slug: true },
            })
          )?.name ?? 'the salon')
        : 'your professional';
      const body: Record<string, string> = {
        THANKS: `Thank you for visiting ${salonName}! We hope you enjoyed your service.`,
        FEEDBACK:
          'How was your visit? You can leave a rating from your bookings page. Your feedback helps the salon improve.',
        AFTERCARE: `Aftercare from ${salonName}: ${s?.aftercare ?? ''}`,
        REBOOK: `It has been a few weeks since your visit to ${salonName}. Would you like to book again? (Promotional message. Reply STOP to stop these.)`,
      };
      // Claim first so a crash never sends twice.
      const claimed = await this.prisma.connectFollowUp.updateMany({
        where: { id: f.id, sentAt: null },
        data: { sentAt: new Date() },
      });
      if (!claimed.count) continue;
      await this.messages.post(conv.id, {
        senderKind: 'SYSTEM',
        body: body[f.kind] ?? '',
        meta: { followUp: f.kind, promotional: f.promotional },
        notify: f.kind === 'THANKS' ? 'NONE' : 'CUSTOMER',
      });
      await this.prisma.connectAnalyticsEvent.create({
        data: {
          salonId: conv.salonId,
          homeProviderId: conv.homeProviderId,
          conversationId: conv.id,
          type: f.promotional ? 'PROMO_SENT' : 'FOLLOW_UP_SENT',
          meta: { kind: f.kind },
        },
      });
      sent += 1;
    }
    return sent;
  }

  private async promoConsent(
    userId: string,
    salonId: string | null,
  ): Promise<boolean> {
    const latest = await this.prisma.connectConsentRecord.findFirst({
      where: {
        userId,
        purpose: 'PROMOTIONAL_MESSAGES',
        OR: [{ salonId: null }, ...(salonId ? [{ salonId }] : [])],
      },
      orderBy: { createdAt: 'desc' },
    });
    return latest?.granted === true;
  }

  /** "STOP" opts the customer out of promotional messages at once (transactional ones continue). */
  private async optOut(conv: ConnectConversation, body: string | null) {
    if (
      !body ||
      !/^\s*(stop|unsubscribe|band karo|बंद करो)\s*[.!]?\s*$/i.test(body)
    )
      return;
    await this.prisma.connectConsentRecord.create({
      data: {
        userId: conv.customerId,
        salonId: null,
        purpose: 'PROMOTIONAL_MESSAGES',
        granted: false,
        source: 'CHAT_STOP',
      },
    });
    await this.prisma.connectFollowUp.updateMany({
      where: {
        conversation: { customerId: conv.customerId },
        promotional: true,
        sentAt: null,
      },
      data: { skippedReason: 'OPTED_OUT' },
    });
    await this.messages.post(conv.id, {
      senderKind: 'SYSTEM',
      body: 'You will not receive promotional messages any more. Booking updates will still reach you.',
      meta: { event: 'opt_out' },
      notify: 'NONE',
    });
  }
}

/** Pure decision: should this queue change be announced, and with what words? */
export function queueMessage(
  prev: QueueState | null,
  next: QueueState,
  step: number,
  waitIncrease: number,
): { announce: boolean; text: string | null } {
  if (!prev)
    return {
      announce: true,
      text:
        next.status === 'WAITING' && next.position != null
          ? `You are in the queue at number ${next.position}${next.eta != null ? `, about ${next.eta} minutes` : ''}.`
          : null,
    };
  if (prev.status !== next.status) {
    const t: Record<string, string> = {
      CALLED: 'Your stylist is ready. Please come to the counter now.',
      IN_SERVICE: 'Your service has started.',
      COMPLETED: 'Your service has been completed. Thank you for visiting!',
      CANCELLED: 'Your queue visit was cancelled.',
      NO_SHOW:
        'Your turn was missed. Talk to the salon if you are still nearby.',
      EXPIRED: 'Your queue visit expired.',
    };
    return { announce: true, text: t[next.status] ?? null };
  }
  if (next.status !== 'WAITING' || next.position == null)
    return { announce: false, text: null };
  if (next.position <= 2 && (prev.position == null || prev.position > 2))
    return {
      announce: true,
      text: `Your turn is approaching: you are number ${next.position}. Please make sure you are at the salon.`,
    };
  if (
    prev.eta != null &&
    next.eta != null &&
    next.eta - prev.eta >= waitIncrease
  )
    return {
      announce: true,
      text: `The salon is running behind. Your estimated wait is now about ${next.eta} minutes.`,
    };
  if (
    prev.position != null &&
    prev.position - next.position >= Math.max(1, step)
  )
    return {
      announce: true,
      text: `Your queue position is now ${next.position}${next.eta != null ? ` (about ${next.eta} minutes)` : ''}.`,
    };
  return { announce: false, text: null };
}

export const ACTIVE_QUEUE = ACTIVE;
