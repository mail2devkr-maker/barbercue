import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import {
  istDateKey,
  resolveViRange,
  type AuthenticatedUser,
  type ViFilters,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { ViActor } from './vi-access.service';
import { ViAnalyticsService } from './vi-analytics.service';
import { ViCampaignsService } from './vi-campaigns.service';
import { ViConfigService } from './vi-config.service';
import { num, pct, viNotFound, type ViQuery } from './vi-common';
import { VI_LLM_GUARD, viLlm } from './vi-ai';

const PLATFORM: ViActor = {
  userId: 'system',
  roles: [],
  staffRoles: [],
  capabilities: new Set(),
  scope: { kind: 'platform' },
};

export interface ViInsightDraft {
  kind: string;
  key: string;
  title: string;
  summary: string;
  supportingData: Record<string, unknown>;
  impact: string;
  confidencePct: number;
  priority: 'LOW' | 'MEDIUM' | 'HIGH';
  action: string;
  department:
    'MARKETING' | 'SALES' | 'OPERATIONS' | 'PRODUCT' | 'SEO' | 'LEADERSHIP';
  source?: 'RULE' | 'LLM_SUMMARY';
}

const q = (period: ViFilters['period'], now = new Date()): ViQuery => ({
  filters: { period },
  range: resolveViRange(period, now),
});

/**
 * FastQue Intelligence Agent (docs/visitor-intelligence/README.md (AI)). Statistics and explicit rules produce every
 * recommendation; an LLM (if enabled) only rewrites the daily/weekly summary from the aggregate numbers.
 * Recommendations never act on their own: accepting one records the decision, and a CRM task is created
 * only when a person asks for it. Ad spend and campaign launches always stay with humans.
 */
@Injectable()
export class ViInsightsService {
  private readonly logger = new Logger(ViInsightsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: ViAnalyticsService,
    private readonly campaigns: ViCampaignsService,
    private readonly config: ViConfigService,
  ) {}

  @Cron('30 1 * * *') // 07:00 IST
  async daily(): Promise<void> {
    if (!ViConfigService.envEnabled()) return;
    await this.generate().catch((e) =>
      this.logger.warn(
        `insight generation failed: ${e instanceof Error ? e.message : e}`,
      ),
    );
  }

  /** Runs every rule over the last 7 days (vs the 7 before) and stores new recommendations. */
  async generate(
    now = new Date(),
  ): Promise<{ created: number; total: number }> {
    const week = q('7d', now);
    const drafts: ViInsightDraft[] = [];
    const [ov, opps, search, sources, funnel, camps] = await Promise.all([
      this.analytics.overview(week, PLATFORM),
      this.analytics.opportunities(week, PLATFORM),
      this.analytics.search(week, PLATFORM),
      this.analytics.sources(week, PLATFORM),
      this.analytics.funnel(week, PLATFORM, 'SALON_BOOKING'),
      this.campaigns.list(week),
    ]);
    const k = ov.kpis;
    const visitors = k.uniqueVisitors.current ?? 0;

    // 1. Traffic trend.
    if (
      visitors >= 50 &&
      k.uniqueVisitors.changePct != null &&
      Math.abs(k.uniqueVisitors.changePct) >= 25
    ) {
      const up = k.uniqueVisitors.changePct > 0;
      drafts.push({
        kind: up ? 'TRAFFIC_GROWTH' : 'TRAFFIC_DECLINE',
        key: 'all',
        title: `Visitors ${up ? 'up' : 'down'} ${Math.abs(k.uniqueVisitors.changePct)}% week on week`,
        summary: `${visitors} unique visitors in the last 7 days vs ${k.uniqueVisitors.previous} the week before.`,
        supportingData: {
          current: visitors,
          previous: k.uniqueVisitors.previous,
          byChannel: ov.byChannel.slice(0, 5),
        },
        impact: up ? 'More demand to convert.' : 'Fewer potential bookings.',
        confidencePct: 80,
        priority: up ? 'LOW' : 'HIGH',
        action: up
          ? 'Check which channel drove the growth and keep it funded (needs approval).'
          : 'Review channel mix and recent site changes; compare by channel in Traffic Sources.',
        department: 'MARKETING',
      });
    }

    // 2. High demand / low coverage + emerging markets.
    for (const o of opps.rows.filter((r) => r.level === 'HIGH').slice(0, 5)) {
      drafts.push({
        kind: 'HIGH_DEMAND_AREA',
        key: o.city.toLowerCase(),
        title: `High demand, low coverage in ${o.city}`,
        summary: `${o.searches} searches and ${o.visitors} visitors against ${o.activeSalons} active salons (score ${o.score}/100).`,
        supportingData: { ...o, lastAssignment: undefined },
        impact: `Unserved demand of about ${o.demand} search-equivalents per week.`,
        confidencePct: o.searches >= 100 ? 80 : 60,
        priority: 'HIGH',
        action: o.recommendedAction,
        department: 'SALES',
      });
    }
    const prevGeo = await this.analytics.geo(
      {
        ...week,
        range: {
          ...week.range,
          from: week.range.previousFrom,
          to: week.range.previousTo,
        },
      },
      PLATFORM,
      'city',
    );
    for (const r of opps.rows) {
      const prev = prevGeo.rows.find((p) => p.key === r.city)?.visitors ?? 0;
      if (
        r.visitors >= 20 &&
        r.visitors >= 2 * Math.max(prev, 1) &&
        r.activeSalons <= 2
      ) {
        drafts.push({
          kind: 'EMERGING_MARKET',
          key: r.city.toLowerCase(),
          title: `Emerging market: ${r.city}`,
          summary: `Visitors from ${r.city} rose from ${prev} to ${r.visitors} week on week, with ${r.activeSalons} active salons.`,
          supportingData: {
            city: r.city,
            visitors: r.visitors,
            previousVisitors: prev,
            searches: r.searches,
            activeSalons: r.activeSalons,
          },
          impact: 'Early-mover advantage for onboarding.',
          confidencePct: 55,
          priority: 'MEDIUM',
          action: `Validate with a small field visit in ${r.city} before investing.`,
          department: 'SALES',
        });
      }
    }

    // 3. Missing service categories (frequent zero-result searches).
    for (const c of search.highDemand
      .filter((c) => c.count >= 10 && c.zeroResult / c.count >= 0.5)
      .slice(0, 5)) {
      drafts.push({
        kind: 'MISSING_CATEGORY',
        key: c.category,
        title: `"${c.category}" searches often find nothing`,
        summary: `${c.zeroResult} of ${c.count} searches for ${c.category} returned no salons.`,
        supportingData: c,
        impact: `${c.zeroResult} lost searches per week.`,
        confidencePct: 75,
        priority: c.zeroResult >= 30 ? 'HIGH' : 'MEDIUM',
        action: `Recruit salons that offer ${c.category} and ask listed salons to add it to their menu.`,
        department: 'OPERATIONS',
      });
    }

    // 4. Weak landing pages.
    const avgConv = pct(k.bookings.current ?? 0, k.visits.current ?? 0) ?? 0;
    for (const l of sources.landingPages
      .filter(
        (l) =>
          l.sessions >= 30 &&
          (l.conversionPct ?? 0) < avgConv / 3 &&
          (l.avgEngagedSeconds ?? 0) < 15,
      )
      .slice(0, 5)) {
      drafts.push({
        kind: 'WEAK_LANDING_PAGE',
        key: l.key,
        title: `Weak landing page: ${l.key}`,
        summary: `${l.sessions} sessions landed here with ${l.conversionPct ?? 0}% booking conversion and ${l.avgEngagedSeconds ?? 0}s average engagement (site average ${avgConv}%).`,
        supportingData: { ...l },
        impact: 'Visitors leave before reaching salons.',
        confidencePct: 60,
        priority: 'MEDIUM',
        action:
          'Add a clear salon search and local salon list above the fold; check page speed on mobile.',
        department: 'PRODUCT',
      });
    }

    // 5. Conversion fix: biggest required-step drop-off.
    const worst = funnel.stages
      .filter((s) => !s.optional && s.dropOffPct != null)
      .sort((a, b) => (b.dropOffPct ?? 0) - (a.dropOffPct ?? 0))[0];
    if (
      worst &&
      (worst.dropOffPct ?? 0) >= 60 &&
      funnel.stages[0].sessions >= 30
    ) {
      drafts.push({
        kind: 'CONVERSION_FIX',
        key: worst.key,
        title: `Biggest booking drop-off: before "${worst.label}"`,
        summary: `${worst.dropOffPct}% of sessions are lost at this step.`,
        supportingData: {
          stages: funnel.stages,
          observedReasons: funnel.abandonment.observed.slice(0, 5),
        },
        impact:
          'Fixing the largest drop-off moves overall conversion the most.',
        confidencePct: 70,
        priority: 'HIGH',
        action: `Review the step before "${worst.label}" on mobile; see Conversion Analytics for observed reasons.`,
        department: 'PRODUCT',
      });
    }

    // 6. SEO keywords (Search Console if connected, else internal demand).
    const seo = sources.externalKeywords
      .filter(
        (kw) =>
          kw.impressions >= 100 &&
          kw.position != null &&
          kw.position >= 8 &&
          kw.position <= 20,
      )
      .slice(0, 10);
    if (seo.length) {
      drafts.push({
        kind: 'SEO_KEYWORDS',
        key: 'search-console',
        title: `${seo.length} Google queries are close to page one`,
        summary: `Queries ranking 8–20 with real impressions: ${seo
          .map((s) => s.query)
          .slice(0, 5)
          .join(', ')}.`,
        supportingData: { keywords: seo },
        impact: 'Moving to page one typically multiplies clicks.',
        confidencePct: 65,
        priority: 'MEDIUM',
        action:
          'Improve the matching landing pages (titles, local salon lists, FAQs).',
        department: 'SEO',
      });
    } else if (search.byCity.length) {
      const pairs = search.byCity
        .filter((c) => c.city !== 'Unknown')
        .slice(0, 5)
        .map((c) => `${c.queries[0]?.query} in ${c.city}`);
      if (pairs.length)
        drafts.push({
          kind: 'SEO_KEYWORDS',
          key: 'internal',
          title: 'SEO page ideas from on-site searches',
          summary: `Most searched combinations: ${pairs.join('; ')}.`,
          supportingData: { byCity: search.byCity.slice(0, 5) },
          impact: 'Pages that match real demand attract organic visitors.',
          confidencePct: 45,
          priority: 'LOW',
          action:
            'Create or improve city + service pages for these combinations. (Connect Search Console for Google query data.)',
          department: 'SEO',
        });
    }

    // 7. Ads: campaigns losing money, channels converting well (recommendations only).
    for (const c of camps.items
      .filter((c) => c.stats.spendInr > 0 && (c.stats.roiPct ?? 0) < 0)
      .slice(0, 5)) {
      drafts.push({
        kind: 'AD_RECOMMENDATION',
        key: c.id,
        title: `Campaign "${c.name}" is below break-even`,
        summary: `Spend ₹${c.stats.spendInr} vs attributed value ₹${c.stats.revenueInr} (ROI ${c.stats.roiPct}%).`,
        supportingData: { ...c.stats },
        impact: 'Budget may work harder elsewhere.',
        confidencePct: 60,
        priority: 'MEDIUM',
        action:
          'Review targeting and creative, or pause it. FastQue never changes ad budgets automatically.',
        department: 'MARKETING',
      });
    }

    // 8. Product demand forecast (simple linear trend of product searches without results).
    const product = search.kinds.find((x) => x.kind === 'PRODUCT');
    if (product && product.count >= 10) {
      drafts.push({
        kind: 'PRODUCT_DEMAND',
        key: 'products',
        title: `${product.count} product searches this week`,
        summary: `${product.zeroResult} found nothing. Daily trend suggests continued demand.`,
        supportingData: product,
        impact: 'Stocking what people search for drives marketplace sales.',
        confidencePct: 50,
        priority: product.zeroResult >= 10 ? 'HIGH' : 'LOW',
        action:
          'Review top product searches with no results in Search Intelligence and source those products.',
        department: 'OPERATIONS',
      });
    }

    // 9. Retention.
    const ret = k.returningVisitors;
    if (
      (ret.previous ?? 0) >= 30 &&
      ret.changePct != null &&
      ret.changePct <= -20
    ) {
      drafts.push({
        kind: 'RETENTION',
        key: 'returning',
        title: `Returning visitors down ${Math.abs(ret.changePct)}%`,
        summary: `${ret.current} returning visitors vs ${ret.previous} the previous week.`,
        supportingData: ret as unknown as Record<string, unknown>,
        impact: 'Lower repeat usage reduces lifetime value.',
        confidencePct: 60,
        priority: 'MEDIUM',
        action:
          'Consider a reminder or loyalty message to consented past customers (needs approval).',
        department: 'MARKETING',
      });
    }

    // 10. Anomaly: yesterday vs the last 28 days (z-score).
    const month = await this.analytics.series(q('30d', now), PLATFORM.scope);
    const hist = month.slice(0, -2).map((d) => d.visitors);
    const y = month[month.length - 2];
    if (hist.length >= 14 && y) {
      const mean = hist.reduce((a, b) => a + b, 0) / hist.length;
      const sd = Math.sqrt(
        hist.reduce((a, b) => a + (b - mean) ** 2, 0) / hist.length,
      );
      if (sd > 0 && mean >= 10 && Math.abs((y.visitors - mean) / sd) >= 3) {
        drafts.push({
          kind: 'ANOMALY',
          key: y.date,
          title: `Unusual traffic on ${y.date}`,
          summary: `${y.visitors} visitors vs a typical ${Math.round(mean)} (±${Math.round(sd)}).`,
          supportingData: { day: y, mean, sd },
          impact: 'Could be a campaign success, a bot wave or an outage.',
          confidencePct: 70,
          priority: 'HIGH',
          action:
            'Check Traffic Sources and Live Visitors for that day; confirm bot filtering.',
          department: 'LEADERSHIP',
        });
      }
    }

    // Daily/weekly summary (template; LLM rephrases aggregates only if enabled).
    drafts.push(
      await this.summary(
        ov,
        opps.rows.slice(0, 3),
        search.top.slice(0, 5),
        funnel.overallPct,
      ),
    );

    let created = 0;
    const day = istDateKey(now);
    for (const d of drafts) {
      const dedupeKey = `${d.kind}:${d.key}:${day}`.slice(0, 160);
      const exists = await this.prisma.viInsight.findUnique({
        where: { dedupeKey },
        select: { id: true },
      });
      if (exists) continue;
      await this.prisma.viInsight.create({
        data: {
          dedupeKey,
          kind: d.kind,
          title: d.title.slice(0, 200),
          summary: d.summary.slice(0, 2000),
          supportingData: JSON.parse(
            JSON.stringify(d.supportingData, (_k, v: unknown) =>
              typeof v === 'bigint' ? Number(v) : v,
            ),
          ) as Prisma.InputJsonValue,
          periodFrom: week.range.from,
          periodTo: week.range.to,
          impact: d.impact.slice(0, 300),
          confidencePct: d.confidencePct,
          priority: d.priority,
          action: d.action.slice(0, 500),
          department: d.department,
          source: d.source ?? 'RULE',
        },
      });
      created++;
    }
    return { created, total: drafts.length };
  }

  private async summary(
    ov: Awaited<ReturnType<ViAnalyticsService['overview']>>,
    topCities: Array<{ city: string; level: string; score: number }>,
    topSearches: Array<{ query: string; count: number }>,
    bookingFunnelPct: number | null,
  ): Promise<ViInsightDraft> {
    const k = ov.kpis;
    const facts = {
      visitors: k.uniqueVisitors.current,
      visitorsChangePct: k.uniqueVisitors.changePct,
      bookings: k.bookings.current,
      bookingsChangePct: k.bookings.changePct,
      visitorToBookingPct: k.visitorToBookingPct.current,
      revenueInr: (k.revenuePaise.current ?? 0) / 100,
      topChannels: ov.byChannel
        .slice(0, 3)
        .map((c) => ({ channel: c.label, visitors: c.visitors })),
      topOpportunityCities: topCities,
      topSearches,
      bookingFunnelPct,
    };
    let text = `Last 7 days: ${facts.visitors ?? 0} visitors (${fmtChange(facts.visitorsChangePct)}), ${facts.bookings ?? 0} tracked bookings (${fmtChange(facts.bookingsChangePct)}), visitor→booking ${facts.visitorToBookingPct ?? 0}%, attributed value ₹${facts.revenueInr}. Top channel: ${facts.topChannels[0]?.channel ?? '—'}. Top search: ${topSearches[0]?.query ?? '—'}. Top opportunity: ${topCities[0]?.city ?? '—'}.`;
    let source: 'RULE' | 'LLM_SUMMARY' = 'RULE';
    const settings = await this.config.get();
    const llm = viLlm(settings.aiProvider, settings.aiSummariesEnabled);
    if (llm) {
      try {
        const out = await llm.complete(
          VI_LLM_GUARD,
          `Write a 3-4 sentence weekly briefing for FastQue leadership from these aggregate numbers only:\n${JSON.stringify(facts)}`,
          false,
        );
        if (out.trim()) {
          text = out.trim().slice(0, 1800);
          source = 'LLM_SUMMARY';
        }
      } catch (e) {
        this.logger.warn(
          `LLM summary skipped: ${e instanceof Error ? e.message : e}`,
        );
      }
    }
    return {
      kind: 'WEEKLY_SUMMARY',
      key: 'summary',
      title: 'Weekly briefing',
      summary: text,
      supportingData: facts,
      impact: 'Overview of the week.',
      confidencePct: 90,
      priority: 'LOW',
      action: 'Review the recommendations below.',
      department: 'LEADERSHIP',
      source,
    };
  }

  async list(
    status: string | undefined,
    department: string | undefined,
    page: number,
    pageSize: number,
  ) {
    const where: Prisma.ViInsightWhereInput = {
      ...(status && status !== 'ALL' ? { status: status as 'NEW' } : {}),
      ...(department ? { department } : {}),
    };
    const [total, items] = await Promise.all([
      this.prisma.viInsight.count({ where }),
      this.prisma.viInsight.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);
    return { total, page, pageSize, items };
  }

  async decide(
    id: string,
    status: 'ACCEPTED' | 'REJECTED' | 'DISMISSED',
    note: string | null | undefined,
    userId: string,
  ) {
    const row = await this.prisma.viInsight.findUnique({ where: { id } });
    if (!row) throw viNotFound('Recommendation');
    const updated = await this.prisma.viInsight.update({
      where: { id },
      data: {
        status,
        decisionNote: note ?? null,
        decidedByUserId: userId,
        decidedAt: new Date(),
      },
    });
    await this.campaigns.audit(userId, `VI_INSIGHT_${status}`, id, {
      kind: row.kind,
    });
    return updated;
  }

  async createTask(
    id: string,
    assigneeEmployeeId: string,
    dueAt: string | null | undefined,
    user: AuthenticatedUser,
  ) {
    const row = await this.prisma.viInsight.findUnique({ where: { id } });
    if (!row) throw viNotFound('Recommendation');
    const task = await this.campaigns.createCrmTask(user, {
      subject: row.title,
      description: `${row.summary}\n\nRecommended action: ${row.action}\nImpact: ${row.impact}\nConfidence: ${row.confidencePct}% · Department: ${row.department}\nPeriod: ${row.periodFrom.toISOString().slice(0, 10)} to ${row.periodTo.toISOString().slice(0, 10)}\n(From FastQue Visitor Intelligence)`,
      priority:
        row.priority === 'HIGH'
          ? 'HIGH'
          : row.priority === 'LOW'
            ? 'LOW'
            : 'NORMAL',
      assigneeEmployeeId,
      dueAt,
    });
    await this.prisma.viInsight.update({
      where: { id },
      data: {
        crmTaskId: task.id,
        status: row.status === 'NEW' ? 'ACCEPTED' : row.status,
        decidedByUserId: user.id,
        decidedAt: new Date(),
      },
    });
    return { taskId: task.id, taskCode: task.code };
  }

  /** Counts per status for the badge on the AI Insights tab. */
  async counts() {
    const rows = await this.prisma.viInsight.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    return Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
  }
}

function fmtChange(p: number | null | undefined): string {
  return p == null
    ? 'no comparison'
    : `${p > 0 ? '+' : ''}${p}% vs previous week`;
}

export { num };
