import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  VI_PERIOD_LABELS,
  resolveViRange,
  type ViCapability,
  type ViPeriod,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { ViActor } from './vi-access.service';
import { ViAnalyticsService } from './vi-analytics.service';
import { ViConfigService } from './vi-config.service';
import { VI_LLM_GUARD, viLlm } from './vi-ai';
import type { ViQuery } from './vi-common';

/**
 * Ask FastQue AI (docs/visitor-intelligence/AI.md §Ask). A question is mapped to ONE whitelisted, read-only
 * tool (by rules first, by the optional LLM only if rules fail). The tool runs with the caller's own role
 * and scope through the same services the dashboards use. No model ever writes or runs SQL.
 */
export const VI_ASK_TOOLS = [
  'visitors',
  'live_now',
  'top_demand_cities',
  'onboarding_targets',
  'abandonment',
  'compare_cities',
  'top_searches',
  'channels',
  'conversion',
  'revenue',
] as const;
type Tool = (typeof VI_ASK_TOOLS)[number];

const TOOL_CAPS: Record<Tool, ViCapability> = {
  visitors: 'overview',
  live_now: 'live',
  top_demand_cities: 'geo',
  onboarding_targets: 'geo',
  abandonment: 'journey',
  compare_cities: 'geo',
  top_searches: 'search',
  channels: 'sources',
  conversion: 'conversions',
  revenue: 'conversions',
};

const routeSchema = z.object({
  tool: z.enum(VI_ASK_TOOLS),
  period: z
    .enum([
      'today',
      'yesterday',
      '7d',
      '30d',
      '90d',
      'month',
      'quarter',
      'year',
    ])
    .optional(),
  cities: z.array(z.string().max(60)).max(2).optional(),
  limit: z.number().int().min(1).max(200).optional(),
});
type Route = z.infer<typeof routeSchema>;

/** City groups people use in questions. */
const CITY_GROUPS: Record<string, string[]> = {
  'delhi ncr': [
    'Delhi',
    'New Delhi',
    'Gurugram',
    'Gurgaon',
    'Noida',
    'Greater Noida',
    'Ghaziabad',
    'Faridabad',
  ],
  'delhi-ncr': [
    'Delhi',
    'New Delhi',
    'Gurugram',
    'Gurgaon',
    'Noida',
    'Greater Noida',
    'Ghaziabad',
    'Faridabad',
  ],
  ncr: [
    'Delhi',
    'New Delhi',
    'Gurugram',
    'Gurgaon',
    'Noida',
    'Greater Noida',
    'Ghaziabad',
    'Faridabad',
  ],
  mumbai: ['Mumbai', 'Navi Mumbai', 'Thane'],
  bangalore: ['Bengaluru', 'Bangalore'],
  bengaluru: ['Bengaluru', 'Bangalore'],
};

export function parsePeriod(
  text: string,
): Exclude<ViPeriod, 'custom'> | undefined {
  const t = text.toLowerCase();
  if (/\btoday\b|right now|so far today/.test(t)) return 'today';
  if (/\byesterday\b/.test(t)) return 'yesterday';
  if (/last\s*7\s*days|this week|past week|last week/.test(t)) return '7d';
  if (/last\s*30\s*days|past month|last month/.test(t)) return '30d';
  if (/last\s*90\s*days|last\s*3\s*months/.test(t)) return '90d';
  if (/this month/.test(t)) return 'month';
  if (/this quarter|quarter/.test(t)) return 'quarter';
  if (/this year|year to date|ytd/.test(t)) return 'year';
  return undefined;
}

export function routeByRules(question: string): Route | null {
  const t = question.toLowerCase();
  const period = parsePeriod(t);
  const compare = t.match(
    /compare\s+(.+?)\s+(?:vs\.?|versus|and|with)\s+(.+?)(?:\?|$| for | in the | over )/,
  );
  if (compare)
    return {
      tool: 'compare_cities',
      period,
      cities: [compare[1].trim(), compare[2].trim()],
    };
  if (
    /onboard|next\s+\d+\s+salons|where should we (expand|open|launch)|expand/.test(
      t,
    )
  ) {
    const n = t.match(/next\s+(\d+)/);
    return {
      tool: 'onboarding_targets',
      period,
      limit: n ? Math.min(200, Number(n[1])) : 10,
    };
  }
  if (/abandon|drop.?off|why .*(not|n't) (book|convert)|leave without/.test(t))
    return { tool: 'abandonment', period };
  if (/(most|highest|top).*(demand)|demand.*(city|cities|where)/.test(t))
    return { tool: 'top_demand_cities', period };
  if (/search(ed|es|ing)?|looking for|keywords?/.test(t))
    return { tool: 'top_searches', period };
  if (/channel|source|campaign|where .* come from|traffic from|referr/.test(t))
    return { tool: 'channels', period };
  if (/conversion|convert/.test(t)) return { tool: 'conversion', period };
  if (/revenue|sales value|earn|money/.test(t))
    return { tool: 'revenue', period };
  if (/right now|online now|live|active now/.test(t))
    return { tool: 'live_now' };
  if (/visitor|traffic|users|people (came|visited)|visits/.test(t))
    return { tool: 'visitors', period };
  return null;
}

@Injectable()
export class ViAskService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly analytics: ViAnalyticsService,
    private readonly config: ViConfigService,
  ) {}

  async ask(question: string, actor: ViActor, periodOverride?: ViPeriod) {
    let route = routeByRules(question);
    let routedBy: 'rules' | 'ai' = 'rules';
    const settings = await this.config.get();
    const llm = viLlm(settings.aiProvider, settings.aiSummariesEnabled);
    if (!route && llm) {
      try {
        // Only the question text goes to the model; it returns a tool name, never a query.
        const out = await llm.complete(
          `${VI_LLM_GUARD}\nPick one tool for the user's analytics question. Tools: ${VI_ASK_TOOLS.join(', ')}. Periods: today, yesterday, 7d, 30d, 90d, month, quarter, year. Reply with JSON {"tool": string, "period"?: string, "cities"?: string[], "limit"?: number}.`,
          question,
          true,
        );
        const parsed = routeSchema.safeParse(JSON.parse(out));
        if (parsed.success) {
          route = parsed.data;
          routedBy = 'ai';
        }
      } catch {
        route = null;
      }
    }
    if (!route) {
      return {
        question,
        answer:
          'I can answer questions about visitors, live activity, demand by city, onboarding targets, abandonment, city comparisons, searches, traffic channels, conversion and revenue. Try one of the examples.',
        examples: [
          'How many visitors today?',
          'Which city has the most demand?',
          'Where should we onboard the next 100 salons?',
          'Why are bookings abandoned?',
          'Compare Delhi-NCR vs Indore',
          'What are people searching for this week?',
        ],
        tool: null,
        routedBy: null,
        metrics: [],
        table: null,
        chart: null,
      };
    }
    if (!actor.capabilities.has(TOOL_CAPS[route.tool])) {
      return {
        question,
        answer:
          'Your role does not have access to the data needed for that question.',
        tool: route.tool,
        routedBy,
        metrics: [],
        table: null,
        chart: null,
      };
    }
    const period =
      periodOverride ??
      route.period ??
      (route.tool === 'live_now' ? 'today' : '7d');
    const q: ViQuery = {
      filters: { period },
      range: resolveViRange(period, new Date()),
    };
    const result = await this.run(route, q, actor);
    let answer = result.answer;
    if (llm && settings.aiSummariesEnabled && result.metrics.length) {
      try {
        const phrased = await llm.complete(
          VI_LLM_GUARD,
          `Question: ${question}\nAnswer in 2-3 sentences using only these computed results (period: ${VI_PERIOD_LABELS[period]}):\n${JSON.stringify({ metrics: result.metrics, table: result.table?.rows.slice(0, 10) })}`,
          false,
        );
        if (phrased.trim()) answer = phrased.trim().slice(0, 1200);
      } catch {
        // Keep the deterministic answer.
      }
    }
    await this.prisma.auditLog
      .create({
        data: {
          actorUserId: actor.userId,
          action: 'VI_ASK',
          entityType: 'VISITOR_INTELLIGENCE',
          entityId: route.tool,
          metadata: {
            question: question.slice(0, 300),
            period,
            routedBy,
          },
        },
      })
      .catch(() => undefined);
    return {
      question,
      ...result,
      answer,
      tool: route.tool,
      routedBy,
      period,
      periodLabel: VI_PERIOD_LABELS[period],
      from: q.range.from.toISOString(),
      to: q.range.to.toISOString(),
    };
  }

  private expandCities(names: string[]): string[] {
    return names.flatMap(
      (n) =>
        CITY_GROUPS[n.toLowerCase().trim()] ?? [
          n.trim().replace(/\b\w/g, (c) => c.toUpperCase()),
        ],
    );
  }

  private async run(
    route: Route,
    q: ViQuery,
    actor: ViActor,
  ): Promise<{
    answer: string;
    metrics: Array<{ label: string; value: string | number | null }>;
    table: {
      columns: string[];
      rows: Array<Array<string | number | null>>;
    } | null;
    chart: {
      type: 'bar' | 'line';
      points: Array<{ label: string; value: number }>;
    } | null;
  }> {
    switch (route.tool) {
      case 'visitors': {
        const o = await this.analytics.overview(q, actor);
        const k = o.kpis;
        return {
          answer: `${k.uniqueVisitors.current ?? 0} unique visitors (${k.visits.current ?? 0} visits)${k.uniqueVisitors.changePct != null ? `, ${k.uniqueVisitors.changePct > 0 ? 'up' : 'down'} ${Math.abs(k.uniqueVisitors.changePct)}% vs the previous period` : ''}. ${k.activeNow} active right now.`,
          metrics: [
            { label: 'Unique visitors', value: k.uniqueVisitors.current },
            { label: 'Visits', value: k.visits.current },
            { label: 'New visitors', value: k.newVisitors.current },
            { label: 'Returning visitors', value: k.returningVisitors.current },
            { label: 'Active now', value: k.activeNow },
          ],
          table: null,
          chart: {
            type: 'line',
            points: o.series.map((p) => ({ label: p.date, value: p.visitors })),
          },
        };
      }
      case 'live_now': {
        const l = await this.analytics.live(q, actor);
        return {
          answer: `${l.activeCount} visitors active in the last ${l.activityWindowMinutes} minutes${l.byCity[0] ? `, most from ${l.byCity[0].city}` : ''}.`,
          metrics: [
            { label: 'Active now', value: l.activeCount },
            { label: 'Recently inactive', value: l.inactiveCount },
          ],
          table: {
            columns: ['City', 'Active'],
            rows: l.byCity.map((c) => [c.city, c.count]),
          },
          chart: null,
        };
      }
      case 'top_demand_cities':
      case 'onboarding_targets': {
        const o = await this.analytics.opportunities(q, actor);
        const limit = route.limit ?? 10;
        const rows = o.rows.slice(
          0,
          route.tool === 'onboarding_targets' ? Math.min(limit, 50) : 10,
        );
        const top = rows[0];
        const answer =
          route.tool === 'onboarding_targets'
            ? rows.length
              ? `Based on demand per active salon, prioritise: ${rows
                  .slice(0, 5)
                  .map(
                    (r) =>
                      `${r.city} (${r.level}, ${r.searches} searches, ${r.activeSalons} salons)`,
                  )
                  .join(
                    '; ',
                  )}.${limit > rows.length ? ` Only ${rows.length} cities have measured demand in this period, so the next ${limit} salons should be split across them in proportion to demand.` : ''}`
              : 'There is no measured city demand in this period yet.'
            : top
              ? `${top.city} has the most unmet demand: ${top.searches} searches and ${top.visitors} visitors for ${top.activeSalons} active salons (${top.level}).`
              : 'There is no measured city demand in this period yet.';
        return {
          answer,
          metrics: top
            ? [
                { label: 'Top city', value: top.city },
                { label: 'Opportunity score', value: top.score },
              ]
            : [],
          table: {
            columns: [
              'City',
              'Level',
              'Score',
              'Searches',
              'Visitors',
              'Active salons',
            ],
            rows: rows.map((r) => [
              r.city,
              r.level,
              r.score,
              r.searches,
              r.visitors,
              r.activeSalons,
            ]),
          },
          chart: {
            type: 'bar',
            points: rows
              .slice(0, 10)
              .map((r) => ({ label: r.city, value: r.score })),
          },
        };
      }
      case 'abandonment': {
        const f = await this.analytics.funnel(q, actor, 'SALON_BOOKING');
        const obs = f.abandonment.observed
          .filter((o) => o.count > 0)
          .sort((a, b) => b.count - a.count);
        return {
          answer: obs.length
            ? `Measured reasons: ${obs
                .slice(0, 3)
                .map((o) => `${o.reason.toLowerCase()} (${o.count})`)
                .join(
                  ', ',
                )}.${f.abandonment.inferred.length ? ` Possible (inferred, unconfirmed): ${f.abandonment.inferred[0].reason.toLowerCase()}.` : ''}`
            : 'No abandonment signals were recorded in this period.',
          metrics: [
            { label: 'Booking funnel conversion %', value: f.overallPct },
          ],
          table: {
            columns: ['Observed reason', 'Count'],
            rows: obs.map((o) => [o.reason, o.count]),
          },
          chart: {
            type: 'bar',
            points: f.stages
              .filter((s) => !s.optional)
              .map((s) => ({ label: s.label, value: s.sessions })),
          },
        };
      }
      case 'compare_cities': {
        const geo = await this.analytics.geo(q, actor, 'city');
        const names = route.cities ?? [];
        const groups = names.map((n) => ({
          name: n,
          members: this.expandCities([n]).map((m) => m.toLowerCase()),
        }));
        const agg = groups.map((g) => {
          const rows = geo.rows.filter((r) =>
            g.members.includes(r.key.toLowerCase()),
          );
          const sum = (f: (r: (typeof rows)[number]) => number) =>
            rows.reduce((s, r) => s + f(r), 0);
          const sessions = sum((r) => r.sessions);
          return {
            name: g.name,
            visitors: sum((r) => r.visitors),
            searches: sum((r) => r.searches),
            bookings: sum((r) => r.bookings),
            revenueInr: sum((r) => r.revenuePaise) / 100,
            activeSalons: sum((r) => r.activeSalons),
            conversionPct: sessions
              ? Math.round((sum((r) => r.bookings) / sessions) * 1000) / 10
              : null,
          };
        });
        const [a, b] = agg;
        return {
          answer:
            a && b
              ? `${a.name}: ${a.visitors} visitors, ${a.searches} searches, ${a.bookings} bookings. ${b.name}: ${b.visitors} visitors, ${b.searches} searches, ${b.bookings} bookings.`
              : 'Name two cities to compare.',
          metrics: [],
          table: {
            columns: [
              'Area',
              'Visitors',
              'Searches',
              'Bookings',
              'Conversion %',
              'Value ₹',
              'Active salons',
            ],
            rows: agg.map((r) => [
              r.name,
              r.visitors,
              r.searches,
              r.bookings,
              r.conversionPct,
              r.revenueInr,
              r.activeSalons,
            ]),
          },
          chart: {
            type: 'bar',
            points: agg.map((r) => ({ label: r.name, value: r.visitors })),
          },
        };
      }
      case 'top_searches': {
        const s = await this.analytics.search(q, actor);
        return {
          answer: s.top.length
            ? `Top searches: ${s.top
                .slice(0, 5)
                .map((t) => `${t.query} (${t.count})`)
                .join(
                  ', ',
                )}. ${s.totals.zeroResultPct ?? 0}% of searches found nothing.`
            : 'No searches were recorded in this period.',
          metrics: [
            { label: 'Searches', value: s.totals.searches },
            { label: 'Zero-result %', value: s.totals.zeroResultPct },
            { label: 'Search → booking %', value: s.totals.searchToBookingPct },
          ],
          table: {
            columns: ['Search', 'Category', 'Count', 'No results', 'Bookings'],
            rows: s.top
              .slice(0, 20)
              .map((t) => [
                t.query,
                t.category,
                t.count,
                t.zeroResult,
                t.bookings,
              ]),
          },
          chart: null,
        };
      }
      case 'channels': {
        const rows = await this.analytics.breakdown(
          q,
          actor.scope,
          'channel',
          15,
        );
        return {
          answer: rows.length
            ? `Most visits came from ${rows[0].label} (${rows[0].sessions} sessions, ${rows[0].conversionPct ?? 0}% booked).`
            : 'No traffic recorded in this period.',
          metrics: [],
          table: {
            columns: [
              'Channel',
              'Visitors',
              'Sessions',
              'Bookings',
              'Conversion %',
            ],
            rows: rows.map((r) => [
              r.label,
              r.visitors,
              r.sessions,
              r.bookings,
              r.conversionPct,
            ]),
          },
          chart: {
            type: 'bar',
            points: rows.map((r) => ({ label: r.label, value: r.sessions })),
          },
        };
      }
      case 'conversion':
      case 'revenue': {
        const o = await this.analytics.overview(q, actor);
        const k = o.kpis;
        return {
          answer:
            route.tool === 'revenue'
              ? `Tracked booking and order value: ₹${Math.round((k.revenuePaise.current ?? 0) / 100)} (₹${Math.round((k.revenuePerVisitorPaise.current ?? 0) / 100)} per visitor).`
              : `Visitor → booking conversion is ${k.visitorToBookingPct.current ?? 0}% and visitor → purchase ${k.visitorToPurchasePct.current ?? 0}%.`,
          metrics: [
            {
              label: 'Visitor → booking %',
              value: k.visitorToBookingPct.current,
            },
            {
              label: 'Visitor → purchase %',
              value: k.visitorToPurchasePct.current,
            },
            { label: 'Bookings', value: k.bookings.current },
            {
              label: 'Value ₹',
              value: Math.round((k.revenuePaise.current ?? 0) / 100),
            },
          ],
          table: null,
          chart: {
            type: 'line',
            points: o.series.map((p) => ({
              label: p.date,
              value:
                route.tool === 'revenue' ? p.revenuePaise / 100 : p.bookings,
            })),
          },
        };
      }
    }
  }
}
