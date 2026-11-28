import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { CONNECT_INTENT_LABEL, type ConnectIntent } from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { ConnectTenant } from './connect-access.service';
import {
  ConnectConfigService,
  connectError,
  connectFlags,
} from './connect-config';
import { ConnectModelService } from './ai/connect-model.service';

export interface Range {
  from: Date;
  to: Date;
}

export function parseRange(q: {
  period?: string;
  from?: string;
  to?: string;
}): Range {
  const to = q.to ? new Date(`${q.to}T23:59:59.999+05:30`) : new Date();
  if (q.from) return { from: new Date(`${q.from}T00:00:00+05:30`), to };
  const days = q.period === 'day' ? 1 : q.period === 'month' ? 30 : 7;
  return { from: new Date(to.getTime() - days * 86_400_000), to };
}

const pct = (a: number, b: number) =>
  b > 0 ? Math.round((a / b) * 1000) / 10 : null;
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
};
const avg = (xs: number[]) =>
  xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;

/**
 * Salon analytics (section 18) and the admin control center (section 19). Every figure is
 * counted from recorded rows; a metric with no data returns null and the UI shows "No data yet".
 * Definitions are returned with the numbers so nothing is a black box.
 */
@Injectable()
export class ConnectInsightsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConnectConfigService,
    private readonly model: ConnectModelService,
  ) {}

  private tenantWhere(t: ConnectTenant) {
    return t.salonId
      ? { salonId: t.salonId }
      : { homeProviderId: t.homeProviderId };
  }

  async salonAnalytics(t: ConnectTenant, r: Range) {
    const tw = this.tenantWhere(t);
    const inRange = { gte: r.from, lte: r.to };
    const ev = (type: string) =>
      this.prisma.connectAnalyticsEvent.count({
        where: { ...tw, type, createdAt: inRange },
      });
    const [
      total,
      active,
      awaitingSalon,
      customerMsgs,
      firstResp,
      resolved,
      autoReplies,
      escalations,
      actionsReq,
      cancelIntent,
      prevented,
      quotesSent,
      quotesAccepted,
      addedRevenue,
      quoteRevenue,
    ] = await Promise.all([
      this.prisma.connectConversation.count({
        where: { ...tw, createdAt: inRange },
      }),
      this.prisma.connectConversation.count({
        where: { ...tw, status: 'ACTIVE', lastMessageAt: inRange },
      }),
      this.prisma.connectConversation.count({
        where: { ...tw, awaiting: 'SALON', status: 'ACTIVE' },
      }),
      this.prisma.connectMessage.count({
        where: { conversation: tw, senderKind: 'CUSTOMER', createdAt: inRange },
      }),
      this.prisma.connectAnalyticsEvent.findMany({
        where: { ...tw, type: 'FIRST_RESPONSE', createdAt: inRange },
        select: { seconds: true, actorUserId: true },
      }),
      this.prisma.connectAnalyticsEvent.findMany({
        where: { ...tw, type: 'RESOLVED', createdAt: inRange },
        select: { seconds: true },
      }),
      ev('AI_AUTO_REPLY'),
      ev('ESCALATION'),
      ev('ACTION_REQUESTED'),
      ev('CANCEL_INTENT'),
      ev('CANCELLATION_PREVENTED'),
      ev('QUOTE_SENT'),
      ev('QUOTE_ACCEPTED'),
      this.prisma.connectAnalyticsEvent.aggregate({
        _sum: { valuePaise: true },
        where: { ...tw, type: 'SERVICE_ADDED', createdAt: inRange },
      }),
      this.prisma.connectAnalyticsEvent.aggregate({
        _sum: { valuePaise: true },
        where: { ...tw, type: 'QUOTE_ACCEPTED', createdAt: inRange },
      }),
    ]);
    const unanswered = await this.prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`
      SELECT COUNT(*)::bigint AS n FROM connect_messages m JOIN connect_conversations c ON c.id = m."conversationId"
      WHERE ${t.salonId ? Prisma.sql`c."salonId" = ${t.salonId}` : Prisma.sql`c."homeProviderId" = ${t.homeProviderId}`}
        AND m."senderKind" = 'CUSTOMER' AND m.seq > c."lastSalonReplySeq" AND c.status = 'ACTIVE' AND m."deletedAt" IS NULL`);
    const convIds = (
      await this.prisma.connectConversation.findMany({
        where: { ...tw, createdAt: inRange, bookingId: { not: null } },
        select: { bookingId: true },
      })
    ).map((c) => c.bookingId!);
    const rating = convIds.length
      ? await this.prisma.review.aggregate({
          _avg: { rating: true },
          _count: true,
          where: { bookingId: { in: convIds } },
        })
      : null;
    const rebook = await this.prisma.$queryRaw<{ n: bigint }[]>(Prisma.sql`
      SELECT COUNT(DISTINCT f.id)::bigint AS n FROM connect_follow_ups f
      JOIN connect_conversations c ON c.id = f."conversationId"
      WHERE f.kind = 'REBOOK' AND f."sentAt" BETWEEN ${r.from} AND ${r.to}
        AND ${t.salonId ? Prisma.sql`c."salonId" = ${t.salonId}` : Prisma.sql`c."homeProviderId" = ${t.homeProviderId}`}
        AND EXISTS (SELECT 1 FROM bookings b WHERE b."customerId" = c."customerId" AND b."salonId" = c."salonId" AND b."createdAt" BETWEEN f."sentAt" AND f."sentAt" + INTERVAL '14 days')`);
    const intents = await this.prisma.connectMessage.groupBy({
      by: ['intent'],
      where: {
        conversation: tw,
        senderKind: 'CUSTOMER',
        createdAt: inRange,
        intent: { not: null },
      },
      _count: true,
      orderBy: { _count: { intent: 'desc' } },
      take: 8,
    });
    const sentiment = await this.prisma.connectConversation.groupBy({
      by: ['sentiment'],
      where: { ...tw, lastMessageAt: inRange },
      _count: true,
    });
    const hours = await this.prisma.$queryRaw<
      { h: number; n: bigint }[]
    >(Prisma.sql`
      SELECT EXTRACT(HOUR FROM (m."createdAt" AT TIME ZONE 'Asia/Kolkata'))::int AS h, COUNT(*)::bigint AS n
      FROM connect_messages m JOIN connect_conversations c ON c.id = m."conversationId"
      WHERE ${t.salonId ? Prisma.sql`c."salonId" = ${t.salonId}` : Prisma.sql`c."homeProviderId" = ${t.homeProviderId}`}
        AND m."senderKind" = 'CUSTOMER' AND m."createdAt" BETWEEN ${r.from} AND ${r.to}
      GROUP BY 1 ORDER BY 1`);
    const daily = await this.prisma.$queryRaw<
      { d: string; n: bigint }[]
    >(Prisma.sql`
      SELECT to_char(("createdAt" AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD') AS d, COUNT(*)::bigint AS n
      FROM connect_conversations
      WHERE ${t.salonId ? Prisma.sql`"salonId" = ${t.salonId}` : Prisma.sql`"homeProviderId" = ${t.homeProviderId}`} AND "createdAt" BETWEEN ${r.from} AND ${r.to}
      GROUP BY 1 ORDER BY 1`);
    const replies = await this.prisma.connectAnalyticsEvent.groupBy({
      by: ['actorUserId'],
      where: {
        ...tw,
        type: { in: ['STAFF_REPLY', 'STAFF_REPLY_FROM_AI'] },
        createdAt: inRange,
      },
      _count: true,
    });
    const names = t.salonId
      ? await this.prisma.salonStaff.findMany({
          where: { salonId: t.salonId },
          select: { userId: true, displayName: true },
        })
      : [];
    const frSecs = firstResp.map((x) => x.seconds ?? 0);
    const conversationsWithCustomer =
      await this.prisma.connectConversation.count({
        where: { ...tw, firstCustomerMsgAt: inRange },
      });
    return {
      range: { from: r.from.toISOString(), to: r.to.toISOString() },
      totals: {
        conversations: total,
        active,
        awaitingSalon,
        unansweredMessages: Number(unanswered[0]?.n ?? 0),
        customerMessages: customerMsgs,
      },
      responsiveness: {
        firstResponseAvgSeconds: avg(frSecs),
        firstResponseMedianSeconds: median(frSecs),
        resolutionAvgSeconds: avg(resolved.map((x) => x.seconds ?? 0)),
      },
      ai: {
        autoReplies,
        autoReplyRatePct: pct(autoReplies, customerMsgs),
        escalations,
        escalationRatePct: pct(escalations, conversationsWithCustomer),
      },
      bookings: {
        modificationRequests: actionsReq,
        cancellationIntents: cancelIntent,
        cancellationsPrevented: prevented,
        cancellationPreventionRatePct: pct(prevented, cancelIntent),
        rebookingsFromChat: Number(rebook[0]?.n ?? 0),
      },
      revenue: {
        quotationsSent: quotesSent,
        quotationsAccepted: quotesAccepted,
        quotationAcceptanceRatePct: pct(quotesAccepted, quotesSent),
        additionalServicePaise: Number(addedRevenue._sum.valuePaise ?? 0),
        acceptedQuotationPaise: Number(quoteRevenue._sum.valuePaise ?? 0),
      },
      satisfaction: {
        averageRating: rating?._avg.rating
          ? Math.round(rating._avg.rating * 10) / 10
          : null,
        ratings: rating?._count ?? 0,
      },
      topQuestions: intents.map((i) => ({
        intent: i.intent,
        label: CONNECT_INTENT_LABEL[i.intent as ConnectIntent] ?? i.intent,
        count: i._count,
      })),
      sentiment: sentiment.map((s) => ({
        sentiment: s.sentiment ?? 'UNSCORED',
        count: s._count,
      })),
      peakHours: hours.map((h) => ({ hour: h.h, messages: Number(h.n) })),
      daily: daily.map((d) => ({ date: d.d, conversations: Number(d.n) })),
      staff: replies.map((x) => ({
        userId: x.actorUserId,
        name:
          names.find((n) => n.userId === x.actorUserId)?.displayName ?? 'Owner',
        replies: x._count,
        firstResponseMedianSeconds: median(
          firstResp
            .filter((f) => f.actorUserId === x.actorUserId)
            .map((f) => f.seconds ?? 0),
        ),
      })),
      definitions: {
        cancellationPreventionRatePct:
          'Conversations where the customer started a cancellation in chat and the booking was instead moved to a new time through chat, divided by conversations with a chat cancellation request, in the period.',
        autoReplyRatePct:
          'Automatic AI replies divided by customer messages in the period.',
        escalationRatePct:
          'Hand-offs to a person (complaints, refunds, safety, "talk to a person", or no verified answer) divided by conversations whose first customer message falls in the period.',
        rebookingsFromChat:
          'Rebooking follow-ups sent in the period after which the customer booked again at the salon within 14 days.',
        averageRating:
          'Average review rating of bookings whose conversation started in the period.',
        firstResponse:
          "Time from the customer's first message to the first reply by a person.",
      },
    };
  }

  toCsv(
    a: Awaited<ReturnType<ConnectInsightsService['salonAnalytics']>>,
  ): string {
    const rows: [string, string | number | null][] = [
      ['from', a.range.from],
      ['to', a.range.to],
      ...Object.entries(a.totals).map(
        ([k, v]) => [`totals.${k}`, v] as [string, number],
      ),
      ...Object.entries(a.responsiveness).map(
        ([k, v]) => [`responsiveness.${k}`, v] as [string, number | null],
      ),
      ...Object.entries(a.ai).map(
        ([k, v]) => [`ai.${k}`, v] as [string, number | null],
      ),
      ...Object.entries(a.bookings).map(
        ([k, v]) => [`bookings.${k}`, v] as [string, number | null],
      ),
      ...Object.entries(a.revenue).map(
        ([k, v]) => [`revenue.${k}`, v] as [string, number | null],
      ),
      ['satisfaction.averageRating', a.satisfaction.averageRating],
      ['satisfaction.ratings', a.satisfaction.ratings],
      ...a.topQuestions.map(
        (q) => [`topQuestion.${q.intent}`, q.count] as [string, number],
      ),
      ...a.peakHours.map(
        (h) =>
          [`peakHour.${String(h.hour).padStart(2, '0')}`, h.messages] as [
            string,
            number,
          ],
      ),
      ...a.daily.map(
        (d) => [`daily.${d.date}`, d.conversations] as [string, number],
      ),
      ...a.staff.map(
        (s) => [`staffReplies.${s.name}`, s.replies] as [string, number],
      ),
    ];
    // Formula-injection safe: a cell never starts with = + - @.
    const cell = (v: string | number | null) => {
      const s = v == null ? '' : String(v);
      const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
      return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
    };
    return [
      'metric,value',
      ...rows.map(([k, v]) => `${cell(k)},${cell(v)}`),
    ].join('\n');
  }

  // ---------- Admin (aggregates only) ----------

  async adminOverview(r: Range) {
    const inRange = { gte: r.from, lte: r.to };
    const [
      total,
      activeSalons,
      messages,
      aiMsgs,
      unanswered,
      complaints,
      reportsOpen,
      attachments,
      translations,
      deliveries,
    ] = await Promise.all([
      this.prisma.connectConversation.count(),
      this.prisma.connectConversation.groupBy({
        by: ['salonId'],
        where: { lastMessageAt: inRange, salonId: { not: null } },
      }),
      this.prisma.connectMessage.count({ where: { createdAt: inRange } }),
      this.prisma.connectMessage.count({
        where: { createdAt: inRange, aiGenerated: true },
      }),
      this.prisma.connectConversation.count({
        where: { awaiting: 'SALON', status: 'ACTIVE' },
      }),
      this.prisma.connectComplaint.groupBy({
        by: ['category'],
        where: { createdAt: inRange },
        _count: true,
      }),
      this.prisma.connectReport.count({ where: { status: 'OPEN' } }),
      this.prisma.connectAttachment.aggregate({
        _sum: { sizeBytes: true },
        _count: true,
      }),
      this.prisma.connectAiInteraction.count({
        where: { feature: 'TRANSLATE', createdAt: inRange },
      }),
      this.prisma
        .$queryRaw<{ status: string; n: bigint }[]>(
          Prisma.sql`SELECT (channel::text || ':' || status::text) AS status, COUNT(*)::bigint AS n FROM notification_deliveries WHERE "type" LIKE 'connect.%' AND "createdAt" BETWEEN ${r.from} AND ${r.to} GROUP BY 1`,
        )
        .catch((): { status: string; n: bigint }[] => []),
    ]);
    const ai = await this.prisma.connectAiInteraction.groupBy({
      by: ['engine'],
      where: { createdAt: inRange },
      _count: true,
      _sum: { inputTokens: true, outputTokens: true, costMicroUsd: true },
    });
    const aiSalon = await this.prisma.connectAiInteraction.groupBy({
      by: ['salonId'],
      where: { createdAt: inRange, costMicroUsd: { gt: 0 } },
      _sum: { costMicroUsd: true },
      orderBy: { _sum: { costMicroUsd: 'desc' } },
      take: 10,
    });
    const aiConvs = await this.prisma.connectAiInteraction.groupBy({
      by: ['conversationId'],
      where: { createdAt: inRange, costMicroUsd: { gt: 0 } },
    });
    const totalCost = ai.reduce(
      (n, x) => n + Number(x._sum.costMicroUsd ?? 0),
      0,
    );
    const daily = await this.prisma.$queryRaw<
      { d: string; n: bigint }[]
    >(Prisma.sql`
      SELECT to_char(("createdAt" AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD') AS d, COUNT(*)::bigint AS n FROM connect_messages
      WHERE "createdAt" BETWEEN ${r.from} AND ${r.to} GROUP BY 1 ORDER BY 1`);
    const salonNames = await this.prisma.salon.findMany({
      where: {
        id: {
          in: aiSalon.map((s) => s.salonId).filter((x): x is string => !!x),
        },
      },
      select: { id: true, name: true },
    });
    const resp = await this.prisma.connectAnalyticsEvent.groupBy({
      by: ['salonId'],
      where: {
        type: 'FIRST_RESPONSE',
        createdAt: inRange,
        salonId: { not: null },
      },
      _avg: { seconds: true },
      _count: true,
      orderBy: { _avg: { seconds: 'desc' } },
      take: 10,
    });
    const respNames = await this.prisma.salon.findMany({
      where: { id: { in: resp.map((x) => x.salonId!).filter(Boolean) } },
      select: { id: true, name: true },
    });
    const revenue = await this.prisma.connectAnalyticsEvent.aggregate({
      _sum: { valuePaise: true },
      where: {
        type: { in: ['SERVICE_ADDED', 'QUOTE_ACCEPTED'] },
        createdAt: inRange,
      },
    });
    const ratings = await this.prisma
      .$queryRaw<{ avg: number | null; n: bigint }[]>(
        Prisma.sql`
      SELECT AVG(r.rating)::float AS avg, COUNT(*)::bigint AS n FROM reviews r JOIN connect_conversations c ON c."bookingId" = r."bookingId"
      WHERE r."createdAt" BETWEEN ${r.from} AND ${r.to}`,
      )
      .catch(() => [{ avg: null, n: BigInt(0) }]);
    return {
      range: { from: r.from.toISOString(), to: r.to.toISOString() },
      flags: connectFlags(),
      model: this.model.status(),
      totals: {
        conversations: total,
        activeSalons: activeSalons.length,
        messages,
        aiMessages: aiMsgs,
        unansweredConversations: unanswered,
        openAbuseReports: reportsOpen,
        mediaBytes: Number(attachments._sum.sizeBytes ?? 0),
        mediaFiles: attachments._count,
        translations,
        revenueFromWorkflowsPaise: Number(revenue._sum.valuePaise ?? 0),
        satisfactionAverage: ratings[0]?.avg
          ? Math.round(ratings[0].avg * 10) / 10
          : null,
        satisfactionRatings: Number(ratings[0]?.n ?? 0),
      },
      dailyMessages: daily.map((d) => ({ date: d.d, messages: Number(d.n) })),
      complaints: complaints.map((c) => ({
        category: c.category,
        count: c._count,
      })),
      ai: {
        byEngine: ai.map((x) => ({
          engine: x.engine,
          calls: x._count,
          inputTokens: Number(x._sum.inputTokens ?? 0),
          outputTokens: Number(x._sum.outputTokens ?? 0),
          costMicroUsd: Number(x._sum.costMicroUsd ?? 0),
        })),
        totalCostMicroUsd: totalCost,
        costPerConversationMicroUsd: aiConvs.length
          ? Math.round(totalCost / aiConvs.length)
          : null,
        topSalons: aiSalon.map((s) => ({
          salonId: s.salonId,
          name: salonNames.find((n) => n.id === s.salonId)?.name ?? null,
          costMicroUsd: Number(s._sum.costMicroUsd ?? 0),
        })),
      },
      slowestSalons: resp.map((x) => ({
        salonId: x.salonId,
        name: respNames.find((n) => n.id === x.salonId)?.name ?? null,
        avgFirstResponseSeconds: Math.round(x._avg.seconds ?? 0),
        samples: x._count,
      })),
      notifications: deliveries.map((d) => ({
        status: d.status,
        count: Number(d.n),
      })),
    };
  }

  async reports(status: string | undefined) {
    const rows = await this.prisma.connectReport.findMany({
      where: status ? { status: status as never } : {},
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
    // Metadata only: the reported text is shown only through purpose-limited access.
    return rows.map((r) => ({
      id: r.id,
      conversationId: r.conversationId,
      messageId: r.messageId,
      reason: r.reason,
      details: r.details,
      status: r.status,
      createdAt: r.createdAt.toISOString(),
      reviewedAt: r.reviewedAt?.toISOString() ?? null,
    }));
  }

  async reviewReport(
    id: string,
    adminId: string,
    status: 'REVIEWED' | 'ACTIONED' | 'DISMISSED',
    hideMessage: boolean,
  ) {
    const r = await this.prisma.connectReport.findUnique({ where: { id } });
    if (!r)
      throw connectError(
        'CONNECT_NOT_FOUND',
        'Not found.',
        HttpStatus.NOT_FOUND,
      );
    await this.prisma.connectReport.update({
      where: { id },
      data: { status, reviewedById: adminId, reviewedAt: new Date() },
    });
    if (hideMessage && r.messageId) {
      const m = await this.prisma.connectMessage.findUnique({
        where: { id: r.messageId },
      });
      if (m && !m.deletedAt) {
        await this.prisma.$transaction([
          this.prisma.connectMessageEdit.create({
            data: {
              messageId: m.id,
              previousBody: m.body,
              editedByUserId: adminId,
              action: 'DELETE',
            },
          }),
          this.prisma.connectMessage.update({
            where: { id: m.id },
            data: { deletedAt: new Date(), body: null },
          }),
        ]);
      }
    }
    await this.prisma.connectAuditEvent.create({
      data: {
        conversationId: r.conversationId,
        actorUserId: adminId,
        action: 'ADMIN_REPORT_REVIEWED',
        meta: { reportId: id, status, hideMessage },
      },
    });
    return { ok: true };
  }

  /**
   * Purpose-limited access (section 19/17): an administrator reads one conversation only with a
   * stated purpose and reference, the read is written to the audit log first, and the result is
   * the transcript at that moment (no browsing, no list of private conversations).
   */
  async adminAccess(
    conversationId: string,
    adminId: string,
    p: { purpose: string; reference: string; justification: string },
  ) {
    if (!/^[0-9a-f-]{36}$/i.test(conversationId))
      throw connectError(
        'CONNECT_NOT_FOUND',
        'Not found.',
        HttpStatus.NOT_FOUND,
      );
    const conv = await this.prisma.connectConversation.findUnique({
      where: { id: conversationId },
    });
    if (!conv)
      throw connectError(
        'CONNECT_NOT_FOUND',
        'Not found.',
        HttpStatus.NOT_FOUND,
      );
    if (p.purpose === 'SUPPORT_TICKET') {
      const linked = await this.prisma.connectComplaint.findFirst({
        where: { conversationId },
      });
      if (!linked)
        throw connectError(
          'CONNECT_PURPOSE_INVALID',
          'This conversation has no linked support ticket.',
          HttpStatus.FORBIDDEN,
        );
    }
    if (
      p.purpose === 'ABUSE_REPORT' &&
      !(await this.prisma.connectReport.findFirst({
        where: { conversationId },
      }))
    )
      throw connectError(
        'CONNECT_PURPOSE_INVALID',
        'This conversation has no abuse report.',
        HttpStatus.FORBIDDEN,
      );
    await this.prisma.connectAuditEvent.create({
      data: {
        salonId: conv.salonId,
        conversationId,
        actorUserId: adminId,
        action: 'ADMIN_CONVERSATION_ACCESS',
        purpose: `${p.purpose}: ${p.reference} — ${p.justification}`.slice(
          0,
          300,
        ),
      },
    });
    const messages = await this.prisma.connectMessage.findMany({
      where: { conversationId },
      orderBy: { seq: 'asc' },
      take: 500,
      select: {
        seq: true,
        senderKind: true,
        body: true,
        kind: true,
        aiGenerated: true,
        deletedAt: true,
        createdAt: true,
      },
    });
    return {
      conversationId,
      kind: conv.kind,
      accessLogged: true,
      messages: messages.map((m) => ({
        ...m,
        body: m.deletedAt ? '(deleted by sender)' : m.body,
      })),
    };
  }

  async reopen(
    conversationId: string,
    adminId: string,
    days: number,
    reason: string,
  ) {
    const conv = await this.prisma.connectConversation.findUnique({
      where: { id: conversationId },
    });
    if (!conv)
      throw connectError(
        'CONNECT_NOT_FOUND',
        'Not found.',
        HttpStatus.NOT_FOUND,
      );
    await this.prisma.connectConversation.update({
      where: { id: conversationId },
      data: {
        status: 'ACTIVE',
        reopenedUntil: new Date(Date.now() + days * 86_400_000),
      },
    });
    await this.prisma.connectAuditEvent.create({
      data: {
        salonId: conv.salonId,
        conversationId,
        actorUserId: adminId,
        action: 'CONVERSATION_REOPENED',
        purpose: reason.slice(0, 300),
        meta: { days },
      },
    });
    return { ok: true };
  }

  audit(limit = 100) {
    return this.prisma.connectAuditEvent.findMany({
      where: { action: { startsWith: 'ADMIN_' } },
      orderBy: { createdAt: 'desc' },
      take: Math.min(limit, 500),
    });
  }

  async config_() {
    return this.config.get();
  }
}
