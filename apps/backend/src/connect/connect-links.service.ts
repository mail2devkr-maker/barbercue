import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Prisma, type ConnectConversation } from '@prisma/client';
import {
  HOME_STATUS_LABEL,
  type ConnectBookingCardDto,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import {
  ConnectConfigService,
  connectError,
  connectFlag,
} from './connect-config';

const paise = (d: Prisma.Decimal | number | null | undefined) =>
  d == null ? null : Math.round(Number(d) * 100);

const BOOKING_LABEL: Record<string, string> = {
  PENDING_PAYMENT: 'Waiting for payment',
  CONFIRMED: 'Confirmed',
  CANCELLED: 'Cancelled',
  COMPLETED: 'Completed',
  NO_SHOW: 'Missed',
  EXPIRED: 'Expired',
};
const QUEUE_LABEL: Record<string, string> = {
  WAITING: 'Waiting in queue',
  CALLED: 'Called: please come to the counter',
  IN_SERVICE: 'Service in progress',
  COMPLETED: 'Completed',
  NO_SHOW: 'Missed',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
};
const HOME_DONE = [
  'COMPLETED',
  'PAYMENT_PENDING',
  'PAYMENT_CONFIRMED',
  'CLOSED',
];
const HOME_CANCELLED = [
  'NO_PROFESSIONAL',
  'EXPIRED',
  'CANCELLED_BY_CUSTOMER',
  'CANCELLED_BY_PROFESSIONAL',
  'CANCELLED_BY_SALON',
  'CANCELLED_BY_PLATFORM',
  'CUSTOMER_NO_SHOW',
  'PROFESSIONAL_NO_SHOW',
];

export const bookingReference = (id: string) =>
  `BK-${id.slice(0, 8).toUpperCase()}`;

export interface LinkState {
  /** Visit finished (completed or missed): the post-visit window applies. */
  endedAt: Date | null;
  cancelled: boolean;
  active: boolean;
  /** Raw status of the underlying booking / queue entry / home booking. */
  status: string;
  startsAt: Date | null;
  serviceIds: string[];
  preferredStaffId: string | null;
  queueEntryId: string | null;
  queueStatus: string | null;
}

export interface Lifecycle {
  status: 'ACTIVE' | 'READ_ONLY';
  writableUntil: string | null;
  reason: string | null;
}

/**
 * Booking-linked conversations (spec section 2): creation per booking type, the live booking card
 * (always read from the booking record itself, so it can never drift), and the lifecycle rules of
 * section 21.
 */
@Injectable()
export class ConnectLinksService {
  private readonly logger = new Logger(ConnectLinksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConnectConfigService,
  ) {}

  // ---------- Creation ----------

  /** Idempotent: one conversation per booking, safe under concurrent calls. */
  async ensureForBooking(
    bookingId: string,
  ): Promise<ConnectConversation | null> {
    const existing = await this.prisma.connectConversation.findUnique({
      where: { bookingId },
    });
    if (existing) return existing;
    const b = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: {
        id: true,
        salonId: true,
        customerId: true,
        preferredStaff: { select: { userId: true } },
      },
    });
    // An in-shop guest booking has no FastQue account to talk to.
    if (!b?.customerId) return null;
    return this.create(
      {
        kind: 'SALON_BOOKING',
        salonId: b.salonId,
        customerId: b.customerId,
        bookingId: b.id,
      },
      { bookingId: b.id },
      'Conversation opened for your appointment.',
    );
  }

  async ensureForQueueEntry(
    queueEntryId: string,
  ): Promise<ConnectConversation | null> {
    const existing = await this.prisma.connectConversation.findUnique({
      where: { queueEntryId },
    });
    if (existing) return existing;
    const q = await this.prisma.queueEntry.findUnique({
      where: { id: queueEntryId },
      select: { id: true, salonId: true, customerId: true, bookingId: true },
    });
    if (!q?.customerId) return null;
    // An appointment check-in keeps talking in the booking's conversation.
    if (q.bookingId) return this.ensureForBooking(q.bookingId);
    return this.create(
      {
        kind: 'LIVE_QUEUE',
        salonId: q.salonId,
        customerId: q.customerId,
        queueEntryId: q.id,
      },
      { queueEntryId: q.id },
      'Conversation opened for your live queue visit.',
    );
  }

  async ensureForHomeBooking(
    homeBookingId: string,
  ): Promise<ConnectConversation | null> {
    const existing = await this.prisma.connectConversation.findUnique({
      where: { homeBookingId },
    });
    if (existing) return existing;
    const h = await this.prisma.homeBooking.findUnique({
      where: { id: homeBookingId },
      select: {
        id: true,
        customerId: true,
        groupKey: true,
        provider: { select: { id: true, salonId: true } },
      },
    });
    if (!h?.customerId) return null;
    // A group booking shares one conversation.
    if (h.groupKey) {
      const group = await this.prisma.connectConversation.findFirst({
        where: { groupKey: h.groupKey, customerId: h.customerId },
      });
      if (group) return group;
    }
    return this.create(
      {
        kind: 'HOME_SERVICE',
        salonId: h.provider.salonId,
        homeProviderId: h.provider.salonId ? null : h.provider.id,
        customerId: h.customerId,
        homeBookingId: h.id,
        groupKey: h.groupKey,
      },
      { homeBookingId: h.id },
      'Conversation opened for your home service booking.',
    );
  }

  private async create(
    data: Prisma.ConnectConversationUncheckedCreateInput,
    unique: Prisma.ConnectConversationWhereUniqueInput,
    opening: string,
  ): Promise<ConnectConversation> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const conv = await tx.connectConversation.create({
          data: { ...data, lastMessageSeq: 1, lastMessageAt: new Date() },
        });
        await tx.connectParticipant.create({
          data: {
            conversationId: conv.id,
            userId: conv.customerId,
            side: 'CUSTOMER',
          },
        });
        await tx.connectMessage.create({
          data: {
            conversationId: conv.id,
            seq: 1,
            senderKind: 'SYSTEM',
            kind: 'SYSTEM',
            body: opening,
            meta: { event: 'opened' },
          },
        });
        await tx.connectAnalyticsEvent.create({
          data: {
            salonId: conv.salonId,
            homeProviderId: conv.homeProviderId,
            conversationId: conv.id,
            type: 'CONVERSATION_CREATED',
          },
        });
        return conv;
      });
    } catch (err) {
      // Lost a creation race: the other call's conversation is the one.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const conv = await this.prisma.connectConversation.findUnique({
          where: unique,
        });
        if (conv) return conv;
      }
      throw err;
    }
  }

  /** Called after a booking commits. Never throws: a chat must never break a booking. */
  async onBookingCreated(bookingId: string): Promise<void> {
    if (!connectFlag('FASTQUE_CONNECT_ENABLED')) return;
    try {
      await this.ensureForBooking(bookingId);
    } catch (err) {
      this.logger.warn(
        `Conversation for booking ${bookingId} not created: ${err instanceof Error ? err.message : 'unknown'}`,
      );
    }
  }

  async onQueueJoined(queueEntryId: string): Promise<void> {
    if (!connectFlag('FASTQUE_CONNECT_ENABLED')) return;
    try {
      await this.ensureForQueueEntry(queueEntryId);
    } catch (err) {
      this.logger.warn(
        `Conversation for queue entry ${queueEntryId} not created: ${err instanceof Error ? err.message : 'unknown'}`,
      );
    }
  }

  /** Customer pressed "Chat with Salon": verify the booking is theirs, then ensure. */
  async ensureForCustomer(
    customerId: string,
    link: {
      bookingId?: string;
      queueEntryId?: string;
      homeBookingId?: string;
      homeBookingCode?: string;
    },
  ): Promise<ConnectConversation> {
    let conv: ConnectConversation | null = null;
    if (link.bookingId) {
      const b = await this.prisma.booking.findFirst({
        where: { id: link.bookingId, customerId },
        select: { id: true },
      });
      if (b) conv = await this.ensureForBooking(b.id);
    } else if (link.queueEntryId) {
      const q = await this.prisma.queueEntry.findFirst({
        where: { id: link.queueEntryId, customerId },
        select: { id: true },
      });
      if (q) conv = await this.ensureForQueueEntry(q.id);
    } else if (link.homeBookingId || link.homeBookingCode) {
      const h = await this.prisma.homeBooking.findFirst({
        where: link.homeBookingId
          ? { id: link.homeBookingId, customerId }
          : { code: link.homeBookingCode, customerId },
        select: { id: true },
      });
      if (h) conv = await this.ensureForHomeBooking(h.id);
    }
    if (!conv || conv.customerId !== customerId)
      throw connectError(
        'CONNECT_NOT_FOUND',
        'Not found.',
        HttpStatus.NOT_FOUND,
      );
    const life = await this.lifecycle(conv);
    const cfg = await this.config.get();
    const state = await this.linkState(conv);
    if (
      state.endedAt &&
      !cfg.lifecycle.completedChatAllowed &&
      life.status === 'READ_ONLY'
    )
      throw connectError(
        'CONNECT_NOT_ELIGIBLE',
        'Chat is not available for this booking.',
        HttpStatus.CONFLICT,
      );
    return conv;
  }

  // ---------- State and lifecycle ----------

  async linkState(
    conv: Pick<
      ConnectConversation,
      'bookingId' | 'queueEntryId' | 'homeBookingId'
    >,
  ): Promise<LinkState> {
    if (conv.bookingId) {
      const b = await this.prisma.booking.findUnique({
        where: { id: conv.bookingId },
        select: {
          status: true,
          slotStart: true,
          slotEnd: true,
          cancelledAt: true,
          updatedAt: true,
          preferredStaffId: true,
          services: {
            select: { serviceId: true },
            orderBy: { sortOrder: 'asc' },
          },
          queueEntries: {
            select: { id: true, status: true, serviceCompletedAt: true },
            take: 1,
          },
        },
      });
      if (!b) return deadState();
      const q = b.queueEntries[0] ?? null;
      const cancelled = b.status === 'CANCELLED' || b.status === 'EXPIRED';
      const ended =
        b.status === 'COMPLETED' ||
        b.status === 'NO_SHOW' ||
        q?.status === 'COMPLETED';
      return {
        cancelled,
        endedAt: cancelled
          ? (b.cancelledAt ?? b.updatedAt)
          : ended
            ? (q?.serviceCompletedAt ?? b.slotEnd)
            : null,
        active: !cancelled && !ended,
        status: b.status,
        startsAt: b.slotStart,
        serviceIds: b.services.map((s) => s.serviceId),
        preferredStaffId: b.preferredStaffId,
        queueEntryId: q?.id ?? null,
        queueStatus: q?.status ?? null,
      };
    }
    if (conv.queueEntryId) {
      const q = await this.prisma.queueEntry.findUnique({
        where: { id: conv.queueEntryId },
        select: {
          status: true,
          serviceCompletedAt: true,
          updatedAt: true,
          joinedAt: true,
          serviceId: true,
          preferredStaffId: true,
        },
      });
      if (!q) return deadState();
      const cancelled = ['CANCELLED', 'NO_SHOW', 'EXPIRED'].includes(q.status);
      const ended = q.status === 'COMPLETED';
      return {
        cancelled,
        endedAt: cancelled
          ? q.updatedAt
          : ended
            ? (q.serviceCompletedAt ?? q.updatedAt)
            : null,
        active: !cancelled && !ended,
        status: q.status,
        startsAt: q.joinedAt,
        serviceIds: q.serviceId ? [q.serviceId] : [],
        preferredStaffId: q.preferredStaffId,
        queueEntryId: conv.queueEntryId,
        queueStatus: q.status,
      };
    }
    if (conv.homeBookingId) {
      const h = await this.prisma.homeBooking.findUnique({
        where: { id: conv.homeBookingId },
        select: {
          status: true,
          serviceStart: true,
          completedAt: true,
          cancelledAt: true,
          updatedAt: true,
        },
      });
      if (!h) return deadState();
      const cancelled = HOME_CANCELLED.includes(h.status);
      const ended = HOME_DONE.includes(h.status);
      return {
        cancelled,
        endedAt: cancelled
          ? (h.cancelledAt ?? h.updatedAt)
          : ended
            ? (h.completedAt ?? h.updatedAt)
            : null,
        active: !cancelled && !ended,
        status: h.status,
        startsAt: h.serviceStart,
        serviceIds: [],
        preferredStaffId: null,
        queueEntryId: null,
        queueStatus: null,
      };
    }
    return deadState();
  }

  /**
   * Section 21 defaults: active before and during the visit, then for N days after completion
   * (a shorter window after a cancellation), then read-only. A support/owner reopen or an open
   * complaint keeps it writable.
   */
  async lifecycle(
    conv: ConnectConversation,
    now = new Date(),
  ): Promise<Lifecycle> {
    if (conv.status === 'CLOSED')
      return {
        status: 'READ_ONLY',
        writableUntil: null,
        reason: 'Closed by FastQue support.',
      };
    if (conv.hasOpenComplaint)
      return { status: 'ACTIVE', writableUntil: null, reason: null };
    if (conv.reopenedUntil && conv.reopenedUntil > now)
      return {
        status: 'ACTIVE',
        writableUntil: conv.reopenedUntil.toISOString(),
        reason: null,
      };
    const cfg = await this.config.get();
    const state = await this.linkState(conv);
    if (!state.endedAt)
      return { status: 'ACTIVE', writableUntil: null, reason: null };
    const days = state.cancelled
      ? cfg.lifecycle.cancelledWindowDays
      : cfg.lifecycle.activeDaysAfterCompletion;
    const until = new Date(state.endedAt.getTime() + days * 86_400_000);
    if (until > now)
      return {
        status: 'ACTIVE',
        writableUntil: until.toISOString(),
        reason: null,
      };
    if (conv.status !== 'READ_ONLY') {
      await this.prisma.connectConversation.update({
        where: { id: conv.id },
        data: { status: 'READ_ONLY', readOnlyAt: now },
      });
    }
    return {
      status: 'READ_ONLY',
      writableUntil: until.toISOString(),
      reason: state.cancelled
        ? 'This booking was cancelled, so the chat is now read-only.'
        : 'This visit ended a while ago, so the chat is now read-only. Report a problem if you need help.',
    };
  }

  // ---------- Live booking card ----------

  async card(conv: ConnectConversation): Promise<ConnectBookingCardDto | null> {
    if (conv.bookingId) return this.bookingCard(conv.bookingId);
    if (conv.queueEntryId) return this.queueCard(conv.queueEntryId);
    if (conv.homeBookingId) return this.homeCard(conv.homeBookingId);
    return null;
  }

  private async position(salonId: string, joinedAt: Date): Promise<number> {
    const ahead = await this.prisma.queueEntry.count({
      where: { salonId, status: 'WAITING', joinedAt: { lt: joinedAt } },
    });
    return ahead + 1;
  }

  private async bookingCard(id: string): Promise<ConnectBookingCardDto | null> {
    const b = await this.prisma.booking.findUnique({
      where: { id },
      include: {
        salon: { select: { name: true } },
        services: { orderBy: { sortOrder: 'asc' } },
        preferredStaff: { select: { displayName: true } },
        queueEntries: {
          select: {
            status: true,
            joinedAt: true,
            estimatedWaitMinutes: true,
            salonId: true,
            assignedStaff: { select: { displayName: true } },
          },
          take: 1,
        },
        payments: {
          select: { status: true },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });
    if (!b) return null;
    const q = b.queueEntries[0] ?? null;
    const duration = b.services.reduce((n, s) => n + s.durationMinutes, 0);
    const total = b.services.reduce((n, s) => n + (paise(s.price) ?? 0), 0);
    const liveStatus = q && b.status === 'CONFIRMED' ? q.status : b.status;
    return {
      kind: 'SALON_BOOKING',
      reference: bookingReference(b.id),
      salonName: b.salon.name,
      stylist:
        q?.assignedStaff?.displayName ?? b.preferredStaff?.displayName ?? null,
      services: b.services.map((s) => ({
        name: s.serviceName,
        durationMinutes: s.durationMinutes,
        pricePaise: paise(s.price),
      })),
      startsAt: b.slotStart.toISOString(),
      status: liveStatus,
      statusLabel:
        (q && b.status === 'CONFIRMED'
          ? QUEUE_LABEL[q.status]
          : BOOKING_LABEL[b.status]) ?? b.status,
      queuePosition:
        q?.status === 'WAITING'
          ? await this.position(q.salonId, q.joinedAt)
          : null,
      estimatedWaitMinutes:
        q?.status === 'WAITING' ? (q.estimatedWaitMinutes ?? null) : null,
      durationMinutes: duration || null,
      totalPaise: total,
      paymentStatus:
        b.payments[0]?.status ??
        (b.status === 'PENDING_PAYMENT' ? 'PENDING' : 'PAY_AT_SALON'),
      updatedAt: b.updatedAt.toISOString(),
    };
  }

  private async queueCard(id: string): Promise<ConnectBookingCardDto | null> {
    const q = await this.prisma.queueEntry.findUnique({
      where: { id },
      include: {
        salon: { select: { name: true } },
        service: { select: { name: true, durationMinutes: true, price: true } },
        assignedStaff: { select: { displayName: true } },
        addOns: { select: { name: true, durationMinutes: true, price: true } },
      },
    });
    if (!q) return null;
    const services = [
      ...(q.service
        ? [
            {
              name: q.service.name,
              durationMinutes: q.service.durationMinutes,
              pricePaise: paise(q.service.price),
            },
          ]
        : []),
      ...q.addOns.map((a) => ({
        name: a.name,
        durationMinutes: a.durationMinutes,
        pricePaise: paise(a.price),
      })),
    ];
    const duration = services.reduce((n, s) => n + (s.durationMinutes ?? 0), 0);
    return {
      kind: 'LIVE_QUEUE',
      reference: `Token #${q.tokenNumber}`,
      salonName: q.salon.name,
      stylist: q.assignedStaff?.displayName ?? null,
      services,
      startsAt: q.joinedAt.toISOString(),
      status: q.status,
      statusLabel: QUEUE_LABEL[q.status] ?? q.status,
      queuePosition:
        q.status === 'WAITING'
          ? await this.position(q.salonId, q.joinedAt)
          : null,
      estimatedWaitMinutes:
        q.status === 'WAITING' ? (q.estimatedWaitMinutes ?? null) : null,
      durationMinutes: duration || null,
      totalPaise: services.length
        ? services.reduce((n, s) => n + (s.pricePaise ?? 0), 0)
        : null,
      paymentStatus: 'PAY_AT_SALON',
      updatedAt: q.updatedAt.toISOString(),
    };
  }

  private async homeCard(id: string): Promise<ConnectBookingCardDto | null> {
    const h = await this.prisma.homeBooking.findUnique({
      where: { id },
      include: {
        provider: { select: { displayName: true } },
        items: {
          select: {
            serviceName: true,
            durationMinutes: true,
            lineTotalPaise: true,
            quantity: true,
          },
        },
        assignments: {
          where: { status: 'ACTIVE' },
          select: { professional: { select: { displayName: true } } },
          take: 1,
        },
      },
    });
    if (!h) return null;
    const label = HOME_STATUS_LABEL[h.status]?.en ?? h.status;
    return {
      kind: 'HOME_SERVICE',
      reference: h.code,
      salonName: h.provider.displayName,
      stylist: h.assignments[0]?.professional.displayName ?? null,
      services: h.items.map((i) => ({
        name:
          i.quantity > 1 ? `${i.serviceName} × ${i.quantity}` : i.serviceName,
        durationMinutes: i.durationMinutes,
        pricePaise: i.lineTotalPaise,
      })),
      startsAt: h.serviceStart.toISOString(),
      status: h.status,
      statusLabel: label,
      queuePosition: null,
      estimatedWaitMinutes:
        h.etaFrom && ['ON_THE_WAY', 'PREPARING', 'CONFIRMED'].includes(h.status)
          ? Math.max(0, Math.round((h.etaFrom.getTime() - Date.now()) / 60_000))
          : null,
      durationMinutes:
        h.items.reduce((n, i) => n + i.durationMinutes, 0) || null,
      totalPaise: h.totalPaise,
      paymentStatus: h.paymentStatus,
      updatedAt: h.updatedAt.toISOString(),
    };
  }
}

function deadState(): LinkState {
  return {
    cancelled: true,
    endedAt: new Date(0),
    active: false,
    status: 'UNKNOWN',
    startsAt: null,
    serviceIds: [],
    preferredStaffId: null,
    queueEntryId: null,
    queueStatus: null,
  };
}
