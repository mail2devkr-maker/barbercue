import { HttpStatus, Injectable } from '@nestjs/common';
import {
  Prisma,
  type ConnectQuotation,
  type ConnectQuotationVersion,
} from '@prisma/client';
import { formatPaise, type ConnectQuotationInput } from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { ConnectViewer } from './connect-access.service';
import {
  ConnectConfigService,
  connectError,
  connectFlag,
} from './connect-config';
import { bookingReference } from './connect-links.service';
import { ConnectMessagesService } from './connect-messages.service';
import { ConnectNotifyService } from './connect-notify.service';

const COMPLAINT_TICKET_CATEGORY: Record<
  string,
  'PRICING_DISPUTE' | 'PAYMENT_SUBSCRIPTION' | 'OTHER'
> = {
  PRICING: 'PRICING_DISPUTE',
  PAYMENT_REFUND: 'PAYMENT_SUBSCRIPTION',
};

/** Totals are always computed here from the lines; a client never sends a total. */
export function quoteTotals(
  input: Pick<ConnectQuotationInput, 'items' | 'discountPaise' | 'taxPercent'>,
) {
  const subtotal = input.items.reduce(
    (n, i) => n + i.unitPaise * i.quantity,
    0,
  );
  const discount = Math.min(input.discountPaise ?? 0, subtotal);
  const tax = Math.round(
    ((subtotal - discount) * (input.taxPercent ?? 0)) / 100,
  );
  const duration = input.items.reduce(
    (n, i) => n + i.durationMinutes * i.quantity,
    0,
  );
  return {
    subtotalPaise: subtotal,
    discountPaise: discount,
    taxPaise: tax,
    totalPaise: subtotal - discount + tax,
    durationMinutes: duration,
  };
}

@Injectable()
export class ConnectBusinessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly messages: ConnectMessagesService,
    private readonly notify: ConnectNotifyService,
    private readonly config: ConnectConfigService,
  ) {}

  // ---------- Quotations (section 11) ----------

  private quotesOn() {
    if (!connectFlag('CONNECT_QUOTATIONS_ENABLED'))
      throw connectError(
        'CONNECT_QUOTES_OFF',
        'Quotations are not switched on.',
        HttpStatus.NOT_FOUND,
      );
  }

  async quotations(v: ConnectViewer) {
    const qs = await this.prisma.connectQuotation.findMany({
      where: { conversationId: v.conv.id },
      include: { versions: { orderBy: { version: 'desc' } } },
      orderBy: { createdAt: 'desc' },
    });
    return qs.map((q) => this.quoteDto(q, q.versions));
  }

  quoteDto(q: ConnectQuotation, versions: ConnectQuotationVersion[]) {
    const now = new Date();
    const current =
      versions.find((x) => x.version === q.currentVersion) ?? versions[0];
    const expired = q.status === 'SENT' && current && current.validUntil < now;
    return {
      id: q.id,
      title: q.title,
      status: expired ? 'EXPIRED' : q.status,
      currentVersion: q.currentVersion,
      acceptedVersion: q.acceptedVersion,
      customerNote: q.customerNote,
      versions: versions.map((x) => ({
        version: x.version,
        items: x.items,
        subtotalPaise: x.subtotalPaise,
        discountPaise: x.discountPaise,
        taxPaise: x.taxPaise,
        totalPaise: x.totalPaise,
        durationMinutes: x.durationMinutes,
        validUntil: x.validUntil.toISOString(),
        terms: x.terms,
        createdAt: x.createdAt.toISOString(),
      })),
    };
  }

  async createQuotation(v: ConnectViewer, input: ConnectQuotationInput) {
    this.quotesOn();
    if (v.side !== 'SALON' || v.role === 'STYLIST' || v.role === 'RECEPTIONIST')
      throw connectError(
        'CONNECT_FORBIDDEN',
        'Only the owner or a manager can send a quotation.',
        HttpStatus.FORBIDDEN,
      );
    if (!(await this.config.hasFeature('QUOTATIONS')))
      throw connectError(
        'CONNECT_NOT_ENTITLED',
        "Quotations are not part of this salon's plan.",
        HttpStatus.FORBIDDEN,
      );
    const t = quoteTotals(input);
    const q = await this.prisma.connectQuotation.create({
      data: {
        conversationId: v.conv.id,
        salonId: v.conv.salonId,
        title: input.title,
        createdById: v.userId,
        versions: {
          create: {
            version: 1,
            items: input.items,
            ...t,
            validUntil: new Date(Date.now() + input.validDays * 86_400_000),
            terms: input.terms ?? null,
            createdById: v.userId,
          },
        },
      },
      include: { versions: true },
    });
    await this.audit(v, 'QUOTATION_SENT', {
      quotationId: q.id,
      version: 1,
      totalPaise: t.totalPaise,
    });
    await this.messages.post(v.conv.id, {
      senderKind: 'SYSTEM',
      kind: 'QUOTATION',
      body: `Quotation: ${q.title} · ${formatPaise(t.totalPaise)}`,
      meta: { quotationId: q.id, version: 1 },
      notify: 'CUSTOMER',
    });
    await this.event(v, 'QUOTE_SENT', t.totalPaise);
    return this.quoteDto(q, q.versions);
  }

  /** A changed price is always a NEW version; earlier versions are never edited. */
  async reviseQuotation(
    v: ConnectViewer,
    id: string,
    input: ConnectQuotationInput,
  ) {
    this.quotesOn();
    if (v.side !== 'SALON' || v.role === 'STYLIST' || v.role === 'RECEPTIONIST')
      throw connectError(
        'CONNECT_FORBIDDEN',
        'Only the owner or a manager can change a quotation.',
        HttpStatus.FORBIDDEN,
      );
    const q = await this.prisma.connectQuotation.findFirst({
      where: { id, conversationId: v.conv.id },
    });
    if (!q)
      throw connectError(
        'CONNECT_NOT_FOUND',
        'Not found.',
        HttpStatus.NOT_FOUND,
      );
    if (q.status === 'ACCEPTED' || q.status === 'WITHDRAWN')
      throw connectError(
        'CONNECT_QUOTE_CLOSED',
        'This quotation is closed. Send a new one.',
        HttpStatus.CONFLICT,
      );
    const t = quoteTotals(input);
    const version = q.currentVersion + 1;
    await this.prisma.$transaction([
      this.prisma.connectQuotationVersion.create({
        data: {
          quotationId: q.id,
          version,
          items: input.items,
          ...t,
          validUntil: new Date(Date.now() + input.validDays * 86_400_000),
          terms: input.terms ?? null,
          createdById: v.userId,
        },
      }),
      this.prisma.connectQuotation.update({
        where: { id: q.id },
        data: {
          currentVersion: version,
          status: 'SENT',
          title: input.title,
          customerNote: null,
        },
      }),
    ]);
    await this.audit(v, 'QUOTATION_REVISED', {
      quotationId: q.id,
      version,
      totalPaise: t.totalPaise,
    });
    await this.messages.post(v.conv.id, {
      senderKind: 'SYSTEM',
      kind: 'QUOTATION',
      body: `Updated quotation (version ${version}): ${input.title} · ${formatPaise(t.totalPaise)}`,
      meta: { quotationId: q.id, version },
      notify: 'CUSTOMER',
    });
    const full = await this.prisma.connectQuotation.findUniqueOrThrow({
      where: { id: q.id },
      include: { versions: { orderBy: { version: 'desc' } } },
    });
    return this.quoteDto(full, full.versions);
  }

  async decideQuotation(
    v: ConnectViewer,
    id: string,
    d: {
      decision: 'ACCEPT' | 'DECLINE' | 'REQUEST_CHANGES' | 'WITHDRAW';
      version: number;
      note?: string;
    },
  ) {
    this.quotesOn();
    const q = await this.prisma.connectQuotation.findFirst({
      where: { id, conversationId: v.conv.id },
      include: { versions: { orderBy: { version: 'desc' } } },
    });
    if (!q)
      throw connectError(
        'CONNECT_NOT_FOUND',
        'Not found.',
        HttpStatus.NOT_FOUND,
      );
    if (d.decision === 'WITHDRAW') {
      if (v.side !== 'SALON' || !v.canAssign)
        throw connectError(
          'CONNECT_FORBIDDEN',
          'Only the owner or a manager can withdraw a quotation.',
          HttpStatus.FORBIDDEN,
        );
      await this.prisma.connectQuotation.update({
        where: { id },
        data: { status: 'WITHDRAWN', decidedAt: new Date() },
      });
      await this.audit(v, 'QUOTATION_WITHDRAWN', { quotationId: id });
      await this.messages.post(v.conv.id, {
        senderKind: 'SYSTEM',
        kind: 'QUOTATION',
        body: `Quotation withdrawn: ${q.title}`,
        meta: { quotationId: id },
        notify: 'CUSTOMER',
      });
    } else {
      if (v.side !== 'CUSTOMER')
        throw connectError(
          'CONNECT_FORBIDDEN',
          'Only the customer can answer a quotation.',
          HttpStatus.FORBIDDEN,
        );
      if (q.status !== 'SENT')
        throw connectError(
          'CONNECT_QUOTE_CLOSED',
          'This quotation was already answered.',
          HttpStatus.CONFLICT,
        );
      // Accepting an old version, or one changed after the customer looked, is refused.
      if (d.version !== q.currentVersion)
        throw connectError(
          'CONNECT_QUOTE_STALE',
          'This quotation was updated. Please review the latest version.',
          HttpStatus.CONFLICT,
          { currentVersion: q.currentVersion },
        );
      const cur = q.versions.find((x) => x.version === q.currentVersion)!;
      if (cur.validUntil < new Date())
        throw connectError(
          'CONNECT_QUOTE_EXPIRED',
          'This quotation has expired. Ask the salon for a new one.',
          HttpStatus.CONFLICT,
        );
      const status =
        d.decision === 'ACCEPT'
          ? 'ACCEPTED'
          : d.decision === 'DECLINE'
            ? 'DECLINED'
            : 'CHANGES_REQUESTED';
      await this.prisma.connectQuotation.update({
        where: { id },
        data: {
          status,
          decidedAt: new Date(),
          acceptedVersion: d.decision === 'ACCEPT' ? q.currentVersion : null,
          customerNote: d.note ?? null,
        },
      });
      await this.audit(v, `QUOTATION_${status}`, {
        quotationId: id,
        version: q.currentVersion,
        totalPaise: cur.totalPaise,
      });
      await this.messages.post(v.conv.id, {
        senderKind: 'SYSTEM',
        kind: 'QUOTATION',
        body:
          d.decision === 'ACCEPT'
            ? `The customer accepted "${q.title}" (version ${q.currentVersion}, ${formatPaise(cur.totalPaise)}). The salon will add it to the booking; payment follows the salon's usual payment flow.`
            : d.decision === 'DECLINE'
              ? `The customer declined "${q.title}".`
              : `The customer asked for changes to "${q.title}"${d.note ? `: ${d.note}` : '.'}`,
        meta: { quotationId: id, version: q.currentVersion },
        notify: 'SALON',
      });
      await this.event(
        v,
        d.decision === 'ACCEPT'
          ? 'QUOTE_ACCEPTED'
          : d.decision === 'DECLINE'
            ? 'QUOTE_DECLINED'
            : 'QUOTE_CHANGES',
        d.decision === 'ACCEPT' ? cur.totalPaise : null,
      );
    }
    const full = await this.prisma.connectQuotation.findUniqueOrThrow({
      where: { id },
      include: { versions: { orderBy: { version: 'desc' } } },
    });
    return this.quoteDto(full, full.versions);
  }

  // ---------- Complaints → existing support tickets (section 17) ----------

  async complain(v: ConnectViewer, c: { category: string; details: string }) {
    if (v.side !== 'CUSTOMER')
      throw connectError(
        'CONNECT_FORBIDDEN',
        'Only the customer can report a problem here.',
        HttpStatus.FORBIDDEN,
      );
    const open = await this.prisma.connectComplaint.findFirst({
      where: { conversationId: v.conv.id },
      orderBy: { createdAt: 'desc' },
    });
    if (open) {
      const t = await this.prisma.supportTicket.findUnique({
        where: { id: open.supportTicketId },
        select: { status: true },
      });
      if (t && !['RESOLVED', 'CLOSED'].includes(t.status))
        throw connectError(
          'CONNECT_COMPLAINT_OPEN',
          'You already have an open ticket for this conversation.',
          HttpStatus.CONFLICT,
        );
    }
    const cfg = await this.config.get();
    const ref = v.conv.bookingId
      ? bookingReference(v.conv.bookingId)
      : v.conv.homeBookingId
        ? 'Home booking'
        : 'Queue visit';
    const salonName = v.conv.salonId
      ? (
          await this.prisma.salon.findUnique({
            where: { id: v.conv.salonId },
            select: { name: true },
          })
        )?.name
      : null;
    const urgent = c.category === 'SAFETY';
    // Authorised context only: the last few customer/salon messages, no internal notes.
    const ctx = await this.prisma.connectMessage.findMany({
      where: {
        conversationId: v.conv.id,
        deletedAt: null,
        senderKind: { in: ['CUSTOMER', 'SALON', 'AI'] },
      },
      orderBy: { seq: 'desc' },
      take: 8,
      select: { senderKind: true, body: true, createdAt: true },
    });
    const description = [
      `Reported from FastQue Connect. Booking: ${ref}. Salon: ${salonName ?? 'home professional'}. Category: ${c.category}.`,
      '',
      c.details,
      '',
      'Recent conversation (shared with the report):',
      ...ctx
        .reverse()
        .map(
          (m) =>
            `[${m.createdAt.toISOString().slice(0, 16)}] ${m.senderKind}: ${(m.body ?? '(attachment)').slice(0, 300)}`,
        ),
    ]
      .join('\n')
      .slice(0, 5000);
    const ticket = await this.prisma.supportTicket.create({
      data: {
        createdByUserId: v.userId,
        salonId: v.conv.salonId,
        category: COMPLAINT_TICKET_CATEGORY[c.category] ?? 'OTHER',
        subject:
          `[Connect] ${c.category.replace('_', ' ').toLowerCase()} · ${ref}`.slice(
            0,
            200,
          ),
        description,
        priority: urgent ? 'URGENT' : 'HIGH',
        slaDueAt: new Date(
          Date.now() +
            (urgent ? 4 : cfg.escalation.complaintSlaHours) * 3_600_000,
        ),
      },
    });
    await this.prisma.$transaction([
      this.prisma.connectComplaint.create({
        data: {
          conversationId: v.conv.id,
          supportTicketId: ticket.id,
          category: c.category,
          reportedById: v.userId,
        },
      }),
      this.prisma.connectConversation.update({
        where: { id: v.conv.id },
        data: { hasOpenComplaint: true, priority: 'URGENT', awaiting: 'SALON' },
      }),
    ]);
    await this.audit(v, 'COMPLAINT_CREATED', {
      ticketId: ticket.id,
      number: ticket.number,
      category: c.category,
    });
    await this.event(v, 'COMPLAINT', null);
    await this.messages.post(v.conv.id, {
      senderKind: 'SYSTEM',
      body: `Support ticket #${ticket.number} created. FastQue support and the salon will look into it. You can follow its status here.`,
      meta: { ticketId: ticket.id },
      notify: 'SALON',
      urgent: true,
    });
    return this.complaints(v);
  }

  /** Ticket status the customer (and salon) can track from the chat. */
  async complaints(v: ConnectViewer) {
    const rows = await this.prisma.connectComplaint.findMany({
      where: { conversationId: v.conv.id },
      orderBy: { createdAt: 'desc' },
    });
    if (!rows.length) return [];
    const tickets = await this.prisma.supportTicket.findMany({
      where: { id: { in: rows.map((r) => r.supportTicketId) } },
      select: {
        id: true,
        number: true,
        status: true,
        priority: true,
        slaDueAt: true,
        resolvedAt: true,
        resolutionNotes: true,
        assignedToUserId: true,
        createdAt: true,
      },
    });
    // Keep the conversation's complaint flag in step with the ticket's real status.
    const anyOpen = tickets.some(
      (t) => !['RESOLVED', 'CLOSED'].includes(t.status),
    );
    if (anyOpen !== v.conv.hasOpenComplaint)
      await this.prisma.connectConversation.update({
        where: { id: v.conv.id },
        data: { hasOpenComplaint: anyOpen },
      });
    return rows.map((r) => {
      const t = tickets.find((x) => x.id === r.supportTicketId);
      return {
        id: r.id,
        category: r.category,
        ticketNumber: t?.number ?? null,
        status: t?.status ?? 'UNKNOWN',
        priority: t?.priority ?? null,
        resolutionDueAt: t?.slaDueAt.toISOString() ?? null,
        assigned: !!t?.assignedToUserId,
        resolvedAt: t?.resolvedAt?.toISOString() ?? null,
        resolution: t?.resolutionNotes ?? null,
        createdAt: r.createdAt.toISOString(),
      };
    });
  }

  // ---------- Abuse reports (section 20) ----------

  async report(
    v: ConnectViewer,
    r: { messageId?: string; reason: string; details?: string },
  ) {
    if (r.messageId) {
      const m = await this.prisma.connectMessage.findFirst({
        where: { id: r.messageId, conversationId: v.conv.id },
        select: { id: true },
      });
      if (!m)
        throw connectError(
          'CONNECT_NOT_FOUND',
          'Not found.',
          HttpStatus.NOT_FOUND,
        );
    }
    const recent = await this.prisma.connectReport.count({
      where: {
        reporterUserId: v.userId,
        createdAt: { gte: new Date(Date.now() - 3_600_000) },
      },
    });
    if (recent >= 10)
      throw connectError(
        'CONNECT_RATE_LIMITED',
        'Too many reports. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    const rep = await this.prisma.connectReport.create({
      data: {
        conversationId: v.conv.id,
        messageId: r.messageId ?? null,
        reporterUserId: v.userId,
        reason: r.reason,
        details: r.details ?? null,
      },
    });
    await this.audit(v, 'REPORTED', { reportId: rep.id, reason: r.reason });
    await this.event(v, 'ABUSE_REPORT', null);
    return { id: rep.id, status: rep.status };
  }

  // ---------- Location sharing (section 13): consent, time-limited, participants only ----------

  private locOn() {
    if (!connectFlag('CONNECT_LOCATION_SHARING_ENABLED'))
      throw connectError(
        'CONNECT_LOCATION_OFF',
        'Location sharing is not switched on.',
        HttpStatus.NOT_FOUND,
      );
  }

  async shareLocation(
    v: ConnectViewer,
    l: {
      lat: number;
      lng: number;
      accuracyM?: number;
      minutes: number;
      consent: true;
    },
  ) {
    this.locOn();
    if (!l.consent)
      throw connectError(
        'CONNECT_CONSENT_REQUIRED',
        'Please confirm you want to share your location.',
      );
    const now = new Date();
    await this.prisma.connectLocationShare.updateMany({
      where: {
        conversationId: v.conv.id,
        userId: v.userId,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      data: { revokedAt: now },
    });
    const share = await this.prisma.connectLocationShare.create({
      data: {
        conversationId: v.conv.id,
        userId: v.userId,
        lat: l.lat,
        lng: l.lng,
        accuracyM: l.accuracyM ?? null,
        expiresAt: new Date(now.getTime() + l.minutes * 60_000),
      },
    });
    await this.prisma.connectConsentRecord.create({
      data: {
        userId: v.userId,
        salonId: v.conv.salonId,
        purpose: 'LOCATION_SHARING',
        granted: true,
        source: `conversation:${v.conv.id}`,
      },
    });
    await this.audit(v, 'LOCATION_SHARED', { minutes: l.minutes });
    await this.messages.post(v.conv.id, {
      senderKind: 'SYSTEM',
      kind: 'LOCATION',
      body: `${v.side === 'CUSTOMER' ? 'The customer' : 'The salon'} shared a live location for ${l.minutes} minutes.`,
      meta: { locationShareId: share.id },
      notify: v.side === 'CUSTOMER' ? 'SALON' : 'CUSTOMER',
    });
    return { id: share.id, expiresAt: share.expiresAt.toISOString() };
  }

  async stopLocation(v: ConnectViewer) {
    this.locOn();
    const n = await this.prisma.connectLocationShare.updateMany({
      where: { conversationId: v.conv.id, userId: v.userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (n.count) {
      await this.prisma.connectConsentRecord.create({
        data: {
          userId: v.userId,
          salonId: v.conv.salonId,
          purpose: 'LOCATION_SHARING',
          granted: false,
          source: `conversation:${v.conv.id}`,
        },
      });
      await this.messages.post(v.conv.id, {
        senderKind: 'SYSTEM',
        kind: 'LOCATION',
        body: 'Location sharing stopped.',
        notify: 'NONE',
      });
    }
    return { stopped: n.count };
  }

  /** Only unexpired, unrevoked shares, and only to the conversation's participants. */
  async locations(v: ConnectViewer) {
    this.locOn();
    const rows = await this.prisma.connectLocationShare.findMany({
      where: {
        conversationId: v.conv.id,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
      take: 4,
    });
    return rows.map((r) => ({
      id: r.id,
      from: r.userId === v.conv.customerId ? 'CUSTOMER' : 'SALON',
      mine: r.userId === v.userId,
      lat: r.lat,
      lng: r.lng,
      accuracyM: r.accuracyM,
      expiresAt: r.expiresAt.toISOString(),
      sharedAt: r.createdAt.toISOString(),
    }));
  }

  private audit(
    v: ConnectViewer,
    action: string,
    meta: Record<string, unknown>,
  ) {
    return this.prisma.connectAuditEvent.create({
      data: {
        salonId: v.conv.salonId,
        conversationId: v.conv.id,
        actorUserId: v.userId,
        action,
        meta: meta as Prisma.InputJsonValue,
      },
    });
  }

  private event(v: ConnectViewer, type: string, valuePaise: number | null) {
    return this.prisma.connectAnalyticsEvent.create({
      data: {
        salonId: v.conv.salonId,
        homeProviderId: v.conv.homeProviderId,
        conversationId: v.conv.id,
        type,
        actorUserId: v.userId,
        valuePaise,
      },
    });
  }
}
