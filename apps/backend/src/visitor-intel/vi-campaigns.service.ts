import { Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import {
  VI_CAMPAIGN_KIND_LABELS,
  classifyViChannel,
  viKpi,
  type AuthenticatedUser,
  type ViCampaignInput,
  type ViCampaignKind,
  type ViOpportunityAssignInput,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CrmAccessService } from '../crm/crm-access.service';
import { CrmActivityService } from '../crm/crm-activity.service';
import type { ViActor } from './vi-access.service';
import { num, pct, viBadRequest, viNotFound, type ViQuery } from './vi-common';
import { ViAnalyticsService } from './vi-analytics.service';

export interface ViCampaignStats {
  visits: number;
  uniqueVisitors: number;
  registrations: number;
  searches: number;
  bookings: number;
  purchases: number;
  revenueInr: number;
  firstTouchConversions: number;
  firstTouchValueInr: number;
  spendInr: number;
  cacInr: number | null;
  roiPct: number | null;
  conversionPct: number | null;
}

const COUNTED_EXPENSE = [
  'SUBMITTED',
  'UNDER_REVIEW',
  'APPROVED',
  'PARTIALLY_PAID',
  'PAID',
] as const;

export function siteUrl(): string {
  return (process.env.WEB_PUBLIC_URL ?? 'https://fastque.com').replace(
    /\/+$/,
    '',
  );
}

/** Campaign links, QR codes, ROI, and one-click CRM tasks (docs/visitor-intelligence/CAMPAIGNS.md). */
@Injectable()
export class ViCampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly crmAccess: CrmAccessService,
    private readonly crmActivity: CrmActivityService,
    private readonly analytics: ViAnalyticsService,
  ) {}

  private async uniqueCode(name: string): Promise<string> {
    const slug =
      name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 24) || 'c';
    for (let i = 0; i < 5; i++) {
      const code = `${slug}-${randomBytes(3).toString('hex')}`;
      if (!(await this.prisma.viCampaign.findUnique({ where: { code } })))
        return code;
    }
    return randomBytes(8).toString('hex');
  }

  links(c: {
    code: string;
    landingPath: string;
    utmSource: string | null;
    utmMedium: string | null;
    utmCampaign: string | null;
    utmContent: string | null;
    utmTerm: string | null;
  }) {
    const params = new URLSearchParams();
    if (c.utmSource) params.set('utm_source', c.utmSource);
    if (c.utmMedium) params.set('utm_medium', c.utmMedium);
    if (c.utmCampaign) params.set('utm_campaign', c.utmCampaign);
    if (c.utmContent) params.set('utm_content', c.utmContent);
    if (c.utmTerm) params.set('utm_term', c.utmTerm);
    params.set('fq_c', c.code);
    return {
      shortUrl: `${siteUrl()}/c/${c.code}`,
      fullUrl: `${siteUrl()}${c.landingPath}?${params}`,
    };
  }

  private defaults(kind: ViCampaignKind, input: ViCampaignInput) {
    const qr = kind.endsWith('_QR') || kind === 'EMPLOYEE_QR';
    return {
      utmSource:
        input.utmSource ??
        (qr
          ? 'qr'
          : kind === 'INFLUENCER'
            ? 'influencer'
            : kind === 'REFERRAL'
              ? 'referral'
              : null),
      utmMedium:
        input.utmMedium ??
        (qr
          ? 'qr'
          : kind === 'INFLUENCER'
            ? 'influencer'
            : kind === 'REFERRAL'
              ? 'referral_link'
              : null),
    };
  }

  async create(input: ViCampaignInput, userId: string) {
    if (
      input.salonId &&
      !(await this.prisma.salon.findUnique({
        where: { id: input.salonId },
        select: { id: true },
      }))
    )
      throw viBadRequest('Unknown salon.');
    if (
      input.employeeProfileId &&
      !(await this.prisma.employeeProfile.findUnique({
        where: { id: input.employeeProfileId },
        select: { id: true },
      }))
    )
      throw viBadRequest('Unknown employee.');
    if (input.kind === 'SALON_QR' && !input.salonId)
      throw viBadRequest('A salon QR needs a salon.');
    if (input.kind === 'EMPLOYEE_QR' && !input.employeeProfileId)
      throw viBadRequest('A sales-employee QR needs an employee.');
    const code = await this.uniqueCode(input.name);
    const d = this.defaults(input.kind, input);
    const row = await this.prisma.viCampaign.create({
      data: {
        code,
        name: input.name,
        kind: input.kind,
        landingPath: input.landingPath || '/',
        utmSource: d.utmSource,
        utmMedium: d.utmMedium,
        utmCampaign: input.utmCampaign ?? code,
        utmContent: input.utmContent ?? null,
        utmTerm: input.utmTerm ?? null,
        salonId: input.salonId ?? null,
        employeeProfileId: input.employeeProfileId ?? null,
        city: input.city ?? null,
        budgetPaise:
          input.budgetInr != null
            ? BigInt(Math.round(input.budgetInr * 100))
            : null,
        startsAt: input.startsAt ? new Date(input.startsAt) : null,
        endsAt: input.endsAt ? new Date(input.endsAt) : null,
        googleAdsCampaignId: input.googleAdsCampaignId ?? null,
        metaCampaignId: input.metaCampaignId ?? null,
        notes: input.notes ?? null,
        createdByUserId: userId,
      },
    });
    await this.audit(userId, 'VI_CAMPAIGN_CREATED', row.id, {
      name: row.name,
      kind: row.kind,
    });
    return this.toDto(row);
  }

  async update(
    id: string,
    input: Partial<ViCampaignInput> & {
      status?: 'ACTIVE' | 'PAUSED' | 'ARCHIVED';
    },
    userId: string,
  ) {
    const existing = await this.prisma.viCampaign.findUnique({ where: { id } });
    if (!existing) throw viNotFound('Campaign');
    const row = await this.prisma.viCampaign.update({
      where: { id },
      data: {
        ...(input.name ? { name: input.name } : {}),
        ...(input.status ? { status: input.status } : {}),
        ...(input.landingPath ? { landingPath: input.landingPath } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
        ...(input.city !== undefined ? { city: input.city } : {}),
        ...(input.budgetInr !== undefined
          ? {
              budgetPaise:
                input.budgetInr == null
                  ? null
                  : BigInt(Math.round(input.budgetInr * 100)),
            }
          : {}),
        ...(input.endsAt !== undefined
          ? { endsAt: input.endsAt ? new Date(input.endsAt) : null }
          : {}),
        ...(input.googleAdsCampaignId !== undefined
          ? { googleAdsCampaignId: input.googleAdsCampaignId }
          : {}),
        ...(input.metaCampaignId !== undefined
          ? { metaCampaignId: input.metaCampaignId }
          : {}),
      },
    });
    await this.audit(userId, 'VI_CAMPAIGN_UPDATED', id, {
      status: input.status ?? null,
    });
    return this.toDto(row);
  }

  private toDto(c: Prisma.ViCampaignGetPayload<object>) {
    return {
      id: c.id,
      code: c.code,
      name: c.name,
      kind: c.kind,
      kindLabel: VI_CAMPAIGN_KIND_LABELS[c.kind as ViCampaignKind] ?? c.kind,
      status: c.status,
      landingPath: c.landingPath,
      utmSource: c.utmSource,
      utmMedium: c.utmMedium,
      utmCampaign: c.utmCampaign,
      utmContent: c.utmContent,
      utmTerm: c.utmTerm,
      salonId: c.salonId,
      employeeProfileId: c.employeeProfileId,
      city: c.city,
      budgetInr: c.budgetPaise == null ? null : Number(c.budgetPaise) / 100,
      startsAt: c.startsAt,
      endsAt: c.endsAt,
      googleAdsCampaignId: c.googleAdsCampaignId,
      metaCampaignId: c.metaCampaignId,
      notes: c.notes,
      channel: classifyViChannel({
        utmSource: c.utmSource,
        utmMedium: c.utmMedium,
        campaignKind: c.kind as ViCampaignKind,
      }),
      createdAt: c.createdAt,
      ...this.links(c),
    };
  }

  /** Public: where a short link / QR should land. Archived or unknown codes go to the home page. */
  async resolve(code: string): Promise<{ url: string }> {
    const c = await this.prisma.viCampaign.findUnique({
      where: { code: code.toLowerCase().slice(0, 40) },
    });
    if (!c || c.status === 'ARCHIVED') return { url: '/' };
    const { fullUrl } = this.links(c);
    return { url: fullUrl.replace(siteUrl(), '') };
  }

  async list(q: ViQuery): Promise<{
    items: Array<
      ReturnType<ViCampaignsService['toDto']> & {
        linkedExpenses: number;
        stats: ViCampaignStats;
      }
    >;
    channels: Array<{
      channel: string;
      campaigns: number;
      visits: number;
      bookings: number;
      revenueInr: number;
      spendInr: number;
      roiPct: number | null;
      conversionPct: number | null;
    }>;
    note?: string;
  }> {
    const rows = await this.prisma.viCampaign.findMany({
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: { expenseLinks: true },
    });
    const ids = rows.map((r) => r.id);
    if (!ids.length) return { items: [], channels: [] };
    const { from, to } = q.range;
    const stats = await this.prisma.$queryRaw<
      Array<{
        id: string;
        v: bigint;
        s: bigint;
        reg: bigint;
        se: bigint;
        b: bigint;
        p: bigint;
        rev: bigint;
      }>
    >`
      SELECT s."campaignId"::text AS id, COUNT(DISTINCT s."visitorId") AS v, COUNT(*) AS s, COUNT(*) FILTER (WHERE s.registered) AS reg,
        COALESCE(SUM(cardinality(s."searchTerms")),0) AS se, COUNT(*) FILTER (WHERE s."bookingConfirmed") AS b,
        COUNT(*) FILTER (WHERE s.purchased) AS p, COALESCE(SUM(s."revenuePaise"),0) AS rev
      FROM vi_sessions s WHERE s."campaignId" IN (${Prisma.join(ids.map((i) => Prisma.sql`${i}::uuid`))}) AND s."startedAt" >= ${from} AND s."startedAt" < ${to} AND s."isBot" = false
      GROUP BY 1`;
    const firstTouch = await this.prisma.$queryRaw<
      Array<{ id: string; n: bigint; v: bigint }>
    >`
      SELECT c."firstCampaignId"::text AS id, COUNT(*) AS n, COALESCE(SUM(c."valuePaise"),0) AS v FROM vi_conversions c
      WHERE c."firstCampaignId" IN (${Prisma.join(ids.map((i) => Prisma.sql`${i}::uuid`))}) AND c.type IN ('BOOKING','PURCHASE') AND c."occurredAt" >= ${from} AND c."occurredAt" < ${to} GROUP BY 1`;
    const expenseIds = rows.flatMap((r) =>
      r.expenseLinks.map((l) => l.financeExpenseId),
    );
    const expenses = expenseIds.length
      ? await this.prisma.financeExpense.findMany({
          where: {
            id: { in: expenseIds },
            status: { in: [...COUNTED_EXPENSE] },
          },
          select: { id: true, amount: true },
        })
      : [];
    const expenseMap = new Map(expenses.map((e) => [e.id, Number(e.amount)]));
    const items = rows.map((r) => {
      const st = stats.find((s) => s.id === r.id);
      const ft = firstTouch.find((s) => s.id === r.id);
      const spendInr = r.expenseLinks.reduce(
        (s, l) => s + (expenseMap.get(l.financeExpenseId) ?? 0),
        0,
      );
      const revenueInr = num(st?.rev) / 100;
      const registrations = num(st?.reg);
      const bookings = num(st?.b);
      return {
        ...this.toDto(r),
        linkedExpenses: r.expenseLinks.length,
        stats: {
          visits: num(st?.s),
          uniqueVisitors: num(st?.v),
          registrations,
          searches: num(st?.se),
          bookings,
          purchases: num(st?.p),
          revenueInr,
          firstTouchConversions: num(ft?.n),
          firstTouchValueInr: num(ft?.v) / 100,
          spendInr,
          // Cost per acquired customer: spend ÷ (registrations, else bookings). Null when nothing was acquired.
          cacInr:
            spendInr > 0 && (registrations || bookings)
              ? Math.round(spendInr / (registrations || bookings))
              : null,
          roiPct:
            spendInr > 0
              ? Math.round(((revenueInr - spendInr) / spendInr) * 1000) / 10
              : null,
          conversionPct: pct(bookings, num(st?.s)),
        },
      };
    });
    const channels = new Map<
      string,
      {
        channel: string;
        campaigns: number;
        visits: number;
        bookings: number;
        revenueInr: number;
        spendInr: number;
      }
    >();
    for (const i of items) {
      const c = channels.get(i.channel) ?? {
        channel: i.channel,
        campaigns: 0,
        visits: 0,
        bookings: 0,
        revenueInr: 0,
        spendInr: 0,
      };
      c.campaigns++;
      c.visits += i.stats.visits;
      c.bookings += i.stats.bookings;
      c.revenueInr += i.stats.revenueInr;
      c.spendInr += i.stats.spendInr;
      channels.set(i.channel, c);
    }
    return {
      items,
      channels: [...channels.values()]
        .map((c) => ({
          ...c,
          roiPct:
            c.spendInr > 0
              ? Math.round(((c.revenueInr - c.spendInr) / c.spendInr) * 1000) /
                10
              : null,
          conversionPct: pct(c.bookings, c.visits),
        }))
        .sort((a, b) => b.bookings - a.bookings || b.visits - a.visits),
      note: 'Revenue = booking/order value attributed to the campaign (last touch). Spend comes only from Finance expenses linked to the campaign.',
    };
  }

  async detail(id: string, q: ViQuery, actor: ViActor) {
    const c = await this.prisma.viCampaign.findUnique({
      where: { id },
      include: { expenseLinks: true },
    });
    if (!c) throw viNotFound('Campaign');
    const scoped: ViQuery = { ...q, filters: { ...q.filters, campaignId: id } };
    const [series, devices, cities, landing] = await Promise.all([
      this.analytics.series(scoped, actor.scope),
      this.analytics.breakdown(scoped, actor.scope, 'device', 6),
      this.analytics.breakdown(scoped, actor.scope, 'city', 10),
      this.analytics.breakdown(scoped, actor.scope, 'landing', 10),
    ]);
    const expenses = c.expenseLinks.length
      ? await this.prisma.financeExpense.findMany({
          where: { id: { in: c.expenseLinks.map((l) => l.financeExpenseId) } },
          select: {
            id: true,
            number: true,
            expenseDate: true,
            description: true,
            amount: true,
            status: true,
          },
        })
      : [];
    return {
      campaign: this.toDto(c),
      series,
      devices,
      cities,
      landing,
      expenses: expenses.map((e) => ({
        ...e,
        amount: Number(e.amount),
        counted: (COUNTED_EXPENSE as readonly string[]).includes(e.status),
      })),
    };
  }

  async compare(ids: string[], q: ViQuery) {
    const all = await this.list(q);
    return all.items
      .filter((i) => ids.includes(i.id))
      .map((i) => ({
        id: i.id,
        name: i.name,
        ...i.stats,
        kpi: viKpi(i.stats.bookings, null),
      }));
  }

  /** Finance expenses that could be linked (recent, not cancelled). Read through the Finance tables, never copied. */
  async expenseCandidates(search?: string) {
    const rows = await this.prisma.financeExpense.findMany({
      where: {
        status: { notIn: ['CANCELLED', 'REJECTED'] },
        ...(search
          ? {
              OR: [
                { description: { contains: search, mode: 'insensitive' } },
                { number: { contains: search, mode: 'insensitive' } },
                { project: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { expenseDate: 'desc' },
      take: 50,
      select: {
        id: true,
        number: true,
        expenseDate: true,
        description: true,
        amount: true,
        status: true,
        city: true,
        project: true,
      },
    });
    return rows.map((r) => ({ ...r, amount: Number(r.amount) }));
  }

  async linkExpense(
    campaignId: string,
    financeExpenseId: string,
    userId: string,
  ) {
    if (
      !(await this.prisma.viCampaign.findUnique({
        where: { id: campaignId },
        select: { id: true },
      }))
    )
      throw viNotFound('Campaign');
    const e = await this.prisma.financeExpense.findUnique({
      where: { id: financeExpenseId },
      select: { id: true, status: true },
    });
    if (!e) throw viNotFound('Finance expense');
    await this.prisma.viCampaignExpenseLink.upsert({
      where: { campaignId_financeExpenseId: { campaignId, financeExpenseId } },
      create: { campaignId, financeExpenseId, linkedByUserId: userId },
      update: {},
    });
    await this.audit(userId, 'VI_CAMPAIGN_EXPENSE_LINKED', campaignId, {
      financeExpenseId,
    });
    return { ok: true };
  }

  async unlinkExpense(
    campaignId: string,
    financeExpenseId: string,
    userId: string,
  ) {
    await this.prisma.viCampaignExpenseLink.deleteMany({
      where: { campaignId, financeExpenseId },
    });
    await this.audit(userId, 'VI_CAMPAIGN_EXPENSE_UNLINKED', campaignId, {
      financeExpenseId,
    });
    return { ok: true };
  }

  // ---------- CRM ----------

  /** Field staff a task may go to, through the CRM's own access rules. */
  async assignees() {
    const rows = await this.prisma.employeeProfile.findMany({
      orderBy: { fullName: 'asc' },
      take: 500,
      select: { id: true, fullName: true, territory: true, employeeCode: true },
    });
    return rows;
  }

  async createCrmTask(
    user: AuthenticatedUser,
    t: {
      subject: string;
      description: string;
      priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
      assigneeEmployeeId: string;
      dueAt?: string | null;
    },
  ) {
    // Reuses the Field CRM's own permission model: only CRM writers can create tasks, and
    // non-managers can only assign to themselves.
    const crmActor = await this.crmAccess.actor(user);
    return this.crmActivity.createTask(crmActor, {
      subject: t.subject.slice(0, 200),
      description: t.description.slice(0, 2000),
      type: 'OTHER',
      priority: t.priority,
      assigneeEmployeeId: t.assigneeEmployeeId,
      dueAt: t.dueAt ?? undefined,
    });
  }

  async assignOpportunity(
    input: ViOpportunityAssignInput,
    q: ViQuery,
    actor: ViActor,
    user: AuthenticatedUser,
  ) {
    const opps = await this.analytics.opportunities(q, actor);
    const o = opps.rows.find(
      (r) => r.city.toLowerCase() === input.city.toLowerCase(),
    );
    if (!o)
      throw viBadRequest('No measured demand for that city in this period.');
    const due =
      input.dueAt ??
      new Date(
        Date.now() + (o.level === 'HIGH' ? 7 : 14) * 86_400_000,
      ).toISOString();
    const description = [
      `Market opportunity from Visitor Intelligence (${q.range.from.toISOString().slice(0, 10)} to ${new Date(q.range.to.getTime() - 1).toISOString().slice(0, 10)}).`,
      `Location: ${o.city}${o.state ? `, ${o.state}` : ''} (approximate visitor locations).`,
      `Metrics: ${o.visitors} visitors, ${o.searches} searches (${o.zeroResultSearches} with no results), ${o.activeSalons} active FastQue salons, ${o.bookings} bookings.`,
      `Opportunity: ${o.level} (score ${o.score}/100, demand ${o.demand}, demand per salon ${o.pressure}).`,
      o.topServices.length ? `Most searched: ${o.topServices.join(', ')}.` : '',
      `Recommended action: ${o.recommendedAction}`,
      input.note ? `Note: ${input.note}` : '',
    ]
      .filter(Boolean)
      .join('\n');
    const task = await this.createCrmTask(user, {
      subject: `Onboard salons in ${o.city} (${o.level} demand)`,
      description,
      priority: input.priority,
      assigneeEmployeeId: input.assigneeEmployeeId,
      dueAt: due,
    });
    await this.prisma.viOpportunityAssignment.create({
      data: {
        city: o.city,
        state: o.state ?? null,
        level: o.level,
        score: o.score,
        metrics: {
          visitors: o.visitors,
          searches: o.searches,
          activeSalons: o.activeSalons,
          zeroResultSearches: o.zeroResultSearches,
          demand: o.demand,
          pressure: o.pressure,
        },
        crmTaskId: task.id,
        assigneeEmployeeId: input.assigneeEmployeeId,
        createdByUserId: user.id,
      },
    });
    await this.audit(user.id, 'VI_OPPORTUNITY_ASSIGNED', task.id, {
      city: o.city,
      level: o.level,
    });
    return {
      taskId: task.id,
      taskCode: task.code,
      city: o.city,
      level: o.level,
    };
  }

  async audit(
    actorUserId: string,
    action: string,
    entityId: string,
    metadata: Record<string, unknown>,
  ) {
    await this.prisma.auditLog
      .create({
        data: {
          actorUserId,
          action,
          entityType: 'VISITOR_INTELLIGENCE',
          entityId,
          metadata: metadata as Prisma.InputJsonValue,
        },
      })
      .catch(() => undefined);
  }
}
