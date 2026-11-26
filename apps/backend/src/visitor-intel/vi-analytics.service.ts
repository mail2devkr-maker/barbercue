import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  VI_CHANNEL_LABELS,
  VI_GEO_SOURCE_LABELS,
  istDateKey,
  scoreViOpportunity,
  viKpi,
  viVisitorLabel,
  type ViBreakdownRow,
  type ViChannel,
  type ViFunnelStage,
  type ViGeoSource,
  type ViLiveDto,
  type ViLiveSessionDto,
  type ViOverviewDto,
  type ViScope,
  type ViSeriesPoint,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import type { ViActor } from './vi-access.service';
import { ViConfigService } from './vi-config.service';
import { geoConfidence } from './vi-geo';
import {
  maskContact,
  num,
  pct,
  sessionWhere,
  viBadRequest,
  viForbidden,
  viNotFound,
  type ViQuery,
} from './vi-common';

const BREAKDOWN_DIMS = {
  channel: Prisma.sql`s.channel`,
  device: Prisma.sql`s."deviceCategory"`,
  city: Prisma.sql`COALESCE(s.city, 'Unknown')`,
  state: Prisma.sql`COALESCE(s.state, 'Unknown')`,
  country: Prisma.sql`COALESCE(s.country, 'Unknown')`,
  landing: Prisma.sql`COALESCE(s."entryPath", '/')`,
  browser: Prisma.sql`COALESCE(s.browser, 'Other')`,
  os: Prisma.sql`COALESCE(s.os, 'Other')`,
  source: Prisma.sql`COALESCE(s."utmSource", s."referrerDomain", '(direct)')`,
  medium: Prisma.sql`COALESCE(s."utmMedium", '(none)')`,
  utmCampaign: Prisma.sql`COALESCE(s."utmCampaign", '(none)')`,
  referrer: Prisma.sql`COALESCE(s."referrerDomain", '(none)')`,
  campaign: Prisma.sql`COALESCE(s."campaignId"::text, '(none)')`,
  day: Prisma.sql`to_char(s."startedAt" AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD')`,
  hour: Prisma.sql`to_char(s."startedAt" AT TIME ZONE 'Asia/Kolkata', 'HH24')`,
} as const;
export type ViBreakdownDim = keyof typeof BREAKDOWN_DIMS;
export const VI_BREAKDOWN_DIMS = Object.keys(
  BREAKDOWN_DIMS,
) as ViBreakdownDim[];

interface KpiRow {
  unique_visitors: bigint;
  visits: bigint;
  new_visitors: bigint;
  returning_visitors: bigint;
  registered_visitors: bigint;
  anonymous_visitors: bigint;
  page_views: bigint | null;
  avg_engaged_ms: number | null;
  engaged_sessions: bigint;
  salon_views: bigint | null;
  product_views: bigint | null;
  registrations: bigint;
  bookings: bigint;
  purchases: bigint;
  booking_visitors: bigint;
  purchase_visitors: bigint;
  revenue: bigint | null;
  searches: bigint;
}

/** Funnel definitions per module. `optional` steps are skipped (carried forward) when absent. */
export const VI_FUNNELS: Record<
  string,
  {
    label: string;
    steps: Array<{
      key: string;
      label: string;
      types: string[];
      optional?: boolean;
      where?: string;
    }>;
  }
> = {
  SALON_BOOKING: {
    label: 'Salon booking',
    steps: [
      { key: 'visit', label: 'Visit', types: [] },
      {
        key: 'location',
        label: 'Location chosen',
        types: ['location_set', 'near_me'],
        optional: true,
      },
      { key: 'search', label: 'Service search', types: ['search'] },
      {
        key: 'results',
        label: 'Results shown',
        types: ['search_results', 'search'],
        where: 'results',
        optional: true,
      },
      { key: 'salon', label: 'Salon profile', types: ['salon_view'] },
      {
        key: 'compare',
        label: 'Price comparison',
        types: ['price_compare'],
        optional: true,
      },
      {
        key: 'service',
        label: 'Service selected',
        types: ['service_select'],
        optional: true,
      },
      {
        key: 'auth',
        label: 'Login / registration',
        types: ['login', 'sign_up'],
        optional: true,
      },
      {
        key: 'initiated',
        label: 'Booking initiated',
        types: ['booking_start'],
      },
      {
        key: 'payment',
        label: 'Payment',
        types: ['booking_payment'],
        optional: true,
      },
      {
        key: 'confirmed',
        label: 'Confirmed',
        types: ['booking_confirmed'],
        where: 'verified:BOOKING',
      },
    ],
  },
  LIVE_QUEUE: {
    label: 'Live queue',
    steps: [
      { key: 'visit', label: 'Visit', types: [] },
      {
        key: 'salon',
        label: 'Salon / queue page',
        types: ['salon_view', 'page_view'],
        where: 'queuePath',
      },
      {
        key: 'join',
        label: 'Queue joined',
        types: ['queue_join'],
        where: 'verified:QUEUE_JOIN',
      },
    ],
  },
  HOME_SERVICES: {
    label: 'Home services',
    steps: [
      { key: 'visit', label: 'Visit', types: [] },
      {
        key: 'view',
        label: 'Home service viewed',
        types: ['home_service_view'],
      },
      { key: 'start', label: 'Booking initiated', types: ['booking_start'] },
      {
        key: 'confirmed',
        label: 'Home booking confirmed',
        types: ['home_booking_confirmed'],
      },
    ],
  },
  MARKETPLACE: {
    label: 'Marketplace purchase',
    steps: [
      { key: 'visit', label: 'Visit', types: [] },
      {
        key: 'search',
        label: 'Product search',
        types: ['search'],
        optional: true,
        where: 'productSearch',
      },
      { key: 'view', label: 'Product viewed', types: ['product_view'] },
      { key: 'cart', label: 'Added to cart', types: ['add_to_cart'] },
      { key: 'checkout', label: 'Checkout started', types: ['checkout_start'] },
      {
        key: 'purchase',
        label: 'Purchased',
        types: ['purchase'],
        where: 'verified:PURCHASE',
      },
    ],
  },
  PARTNER: {
    label: 'Partner registration',
    steps: [
      { key: 'visit', label: 'Visit', types: [] },
      {
        key: 'start',
        label: 'Registration started',
        types: ['partner_registration_start'],
      },
      {
        key: 'done',
        label: 'Registration submitted',
        types: ['partner_registration'],
      },
    ],
  },
  FREELANCE_STYLIST: {
    label: 'Freelance stylist (not live yet)',
    steps: [
      { key: 'visit', label: 'Visit', types: [] },
      { key: 'view', label: 'Stylist viewed', types: ['stylist_view'] },
      {
        key: 'confirmed',
        label: 'Booking confirmed',
        types: ['booking_confirmed'],
      },
    ],
  },
  JOBS: {
    label: 'Jobs (FastQue Talent, wired later)',
    steps: [
      { key: 'visit', label: 'Visit', types: [] },
      {
        key: 'search',
        label: 'Job search',
        types: ['search'],
        where: 'jobSearch',
      },
      { key: 'view', label: 'Job viewed', types: ['job_view'] },
      { key: 'apply', label: 'Applied', types: ['job_apply'] },
    ],
  },
  INSTANT_HIRING: {
    label: 'Instant hiring (wired later)',
    steps: [
      { key: 'visit', label: 'Visit', types: [] },
      {
        key: 'search',
        label: 'Staffing search',
        types: ['search'],
        where: 'staffingSearch',
      },
      {
        key: 'request',
        label: 'Staffing requested',
        types: ['staffing_request'],
      },
    ],
  },
  LOYALTY: {
    label: 'Loyalty & subscriptions (not live yet)',
    steps: [
      { key: 'visit', label: 'Visit', types: [] },
      { key: 'join', label: 'Joined', types: ['loyalty_join'] },
    ],
  },
};

function stepCondition(step: { types: string[]; where?: string }): Prisma.Sql {
  const types = Prisma.join(step.types);
  switch (step.where) {
    case 'results':
      return Prisma.sql`(e.type = 'search_results' AND COALESCE((e.metadata->>'resultCount')::int, 0) > 0) OR (e.type = 'search' AND COALESCE((e.metadata->>'resultCount')::int, 0) > 0)`;
    case 'queuePath':
      return Prisma.sql`e.type = 'salon_view' OR (e.type = 'page_view' AND (e.path LIKE '/q/%' OR e.path LIKE '/queue%'))`;
    case 'productSearch':
      return Prisma.sql`e.type = 'search' AND e.metadata->>'searchKind' = 'PRODUCT'`;
    case 'jobSearch':
      return Prisma.sql`e.type = 'search' AND e.metadata->>'searchKind' = 'JOB'`;
    case 'staffingSearch':
      return Prisma.sql`e.type = 'search' AND e.metadata->>'searchKind' = 'STAFFING'`;
    default:
      // Outcome steps count only when the server verified them (vi_conversions), never on a browser claim.
      if (step.where?.startsWith('verified:')) {
        const type = step.where.slice('verified:'.length);
        return Prisma.sql`e.type IN (${types}) AND EXISTS (SELECT 1 FROM vi_conversions vc WHERE vc."sessionId" = e."sessionId" AND vc.type::text = ${type})`;
      }
      return Prisma.sql`e.type IN (${types})`;
  }
}

@Injectable()
export class ViAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ViConfigService,
  ) {}

  // ---------- Overview ----------

  private async kpis(
    q: ViQuery,
    scope: ViScope,
    from: Date,
    to: Date,
  ): Promise<KpiRow> {
    const where = sessionWhere(q, scope, { from, to });
    const [row] = await this.prisma.$queryRaw<KpiRow[]>`
      WITH s AS (SELECT * FROM vi_sessions s WHERE ${where})
      SELECT
        COUNT(DISTINCT "visitorId") AS unique_visitors,
        COUNT(*) AS visits,
        COUNT(DISTINCT "visitorId") FILTER (WHERE "isNewVisitor") AS new_visitors,
        COUNT(DISTINCT "visitorId") FILTER (WHERE NOT "isNewVisitor") AS returning_visitors,
        COUNT(DISTINCT "visitorId") FILTER (WHERE "userId" IS NOT NULL) AS registered_visitors,
        COUNT(DISTINCT "visitorId") FILTER (WHERE "userId" IS NULL) AS anonymous_visitors,
        SUM("pageViews") AS page_views,
        AVG("engagedMs")::float AS avg_engaged_ms,
        COUNT(*) FILTER (WHERE "engagedMs" >= 10000 OR "pageViews" >= 2 OR searched OR "bookingConfirmed" OR purchased) AS engaged_sessions,
        SUM("salonsViewed") AS salon_views,
        SUM("productsViewed") AS product_views,
        COUNT(*) FILTER (WHERE registered) AS registrations,
        COUNT(*) FILTER (WHERE "bookingConfirmed") AS bookings,
        COUNT(*) FILTER (WHERE purchased) AS purchases,
        COUNT(DISTINCT "visitorId") FILTER (WHERE "bookingConfirmed") AS booking_visitors,
        COUNT(DISTINCT "visitorId") FILTER (WHERE purchased) AS purchase_visitors,
        SUM("revenuePaise") AS revenue,
        (SELECT COUNT(*) FROM vi_search_events se WHERE se."sessionId" IN (SELECT id FROM s)) AS searches
      FROM s`;
    return row;
  }

  async overview(q: ViQuery, actor: ViActor): Promise<ViOverviewDto> {
    const { range } = q;
    const settings = await this.config.get();
    const [cur, prev, active, series, byChannel, byDevice, byCity, funnel] =
      await Promise.all([
        this.kpis(q, actor.scope, range.from, range.to),
        this.kpis(q, actor.scope, range.previousFrom, range.previousTo),
        this.activeNow(q, actor.scope, settings.activityWindowMinutes),
        this.series(q, actor.scope),
        this.breakdown(q, actor.scope, 'channel', 12),
        this.breakdown(q, actor.scope, 'device', 6),
        this.breakdown(q, actor.scope, 'city', 12),
        this.simpleFunnel(q, actor.scope),
      ]);
    const k = (f: (r: KpiRow) => number | null) => viKpi(f(cur), f(prev));
    const rate = (r: KpiRow, part: keyof KpiRow, whole: keyof KpiRow) =>
      pct(num(r[part]), num(r[whole]));
    const perVisitor = (r: KpiRow) =>
      num(r.unique_visitors)
        ? Math.round(num(r.revenue) / num(r.unique_visitors))
        : null;
    const totalVisits = num(cur.visits);
    return {
      from: range.from.toISOString(),
      to: range.to.toISOString(),
      previousFrom: range.previousFrom.toISOString(),
      previousTo: range.previousTo.toISOString(),
      generatedAt: new Date().toISOString(),
      scope: actor.scope.kind,
      kpis: {
        uniqueVisitors: k((r) => num(r.unique_visitors)),
        visits: k((r) => num(r.visits)),
        activeNow: active,
        newVisitors: k((r) => num(r.new_visitors)),
        returningVisitors: k((r) => num(r.returning_visitors)),
        anonymousVisitors: k((r) => num(r.anonymous_visitors)),
        registeredVisitors: k((r) => num(r.registered_visitors)),
        pageViews: k((r) => num(r.page_views)),
        avgEngagementSeconds: k((r) =>
          r.avg_engaged_ms == null
            ? null
            : Math.round(r.avg_engaged_ms / 100) / 10,
        ),
        engagementRatePct: k((r) => rate(r, 'engaged_sessions', 'visits')),
        serviceSearches: k((r) => num(r.searches)),
        salonProfileViews: k((r) => num(r.salon_views)),
        productViews: k((r) => num(r.product_views)),
        registrations: k((r) => num(r.registrations)),
        bookings: k((r) => num(r.bookings)),
        purchases: k((r) => num(r.purchases)),
        visitorToBookingPct: k((r) =>
          rate(r, 'booking_visitors', 'unique_visitors'),
        ),
        visitorToPurchasePct: k((r) =>
          rate(r, 'purchase_visitors', 'unique_visitors'),
        ),
        revenuePaise: k((r) => num(r.revenue)),
        revenuePerVisitorPaise: k(perVisitor),
      },
      series,
      byChannel: byChannel.map((r) => ({
        ...r,
        label: VI_CHANNEL_LABELS[r.key as ViChannel] ?? r.key,
      })),
      byDevice,
      byCity,
      funnel,
      dataNote:
        totalVisits === 0
          ? 'No tracked visits in this period yet. Visitors are counted only after they accept analytics cookies.'
          : null,
    };
  }

  private async activeNow(
    q: ViQuery,
    scope: ViScope,
    windowMin: number,
  ): Promise<number> {
    const since = new Date(Date.now() - windowMin * 60_000);
    const where = sessionWhere(q, scope, {
      from: new Date(Date.now() - 24 * 3600_000),
      to: new Date(Date.now() + 60_000),
    });
    const [r] = await this.prisma.$queryRaw<
      Array<{ n: bigint }>
    >`SELECT COUNT(*) AS n FROM vi_sessions s WHERE ${where} AND s."lastActivityAt" >= ${since}`;
    return num(r?.n);
  }

  async series(q: ViQuery, scope: ViScope) {
    const where = sessionWhere(q, scope);
    const rows = await this.prisma.$queryRaw<
      Array<{
        d: string;
        v: bigint;
        s: bigint;
        pv: bigint;
        b: bigint;
        p: bigint;
        rev: bigint;
        se: bigint;
      }>
    >`
      SELECT to_char(s."startedAt" AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS d,
        COUNT(DISTINCT s."visitorId") AS v, COUNT(*) AS s, COALESCE(SUM(s."pageViews"),0) AS pv,
        COUNT(*) FILTER (WHERE s."bookingConfirmed") AS b, COUNT(*) FILTER (WHERE s.purchased) AS p,
        COALESCE(SUM(s."revenuePaise"),0) AS rev,
        COALESCE(SUM(cardinality(s."searchTerms")),0) AS se
      FROM vi_sessions s WHERE ${where} GROUP BY 1 ORDER BY 1`;
    const byDay = new Map(rows.map((r) => [r.d, r]));
    const out: ViSeriesPoint[] = [];
    for (
      let t = q.range.from.getTime();
      t < q.range.to.getTime() && out.length < 800;
      t += 86_400_000
    ) {
      const d = istDateKey(new Date(t));
      const r = byDay.get(d);
      out.push({
        date: d,
        visitors: num(r?.v),
        sessions: num(r?.s),
        pageViews: num(r?.pv),
        searches: num(r?.se),
        bookings: num(r?.b),
        purchases: num(r?.p),
        revenuePaise: num(r?.rev),
      });
    }
    return out;
  }

  async breakdown(
    q: ViQuery,
    scope: ViScope,
    dim: ViBreakdownDim,
    limit = 50,
  ): Promise<
    Array<
      ViBreakdownRow & {
        pageViews: number;
        searches: number;
        avgEngagedSeconds: number | null;
      }
    >
  > {
    const expr = BREAKDOWN_DIMS[dim];
    if (!expr) throw viBadRequest('Unknown dimension.');
    const where = sessionWhere(q, scope);
    const rows = await this.prisma.$queryRaw<
      Array<{
        k: string;
        v: bigint;
        s: bigint;
        b: bigint;
        rev: bigint;
        pv: bigint;
        se: bigint;
        eng: number | null;
      }>
    >`
      SELECT ${expr} AS k, COUNT(DISTINCT s."visitorId") AS v, COUNT(*) AS s,
        COUNT(*) FILTER (WHERE s."bookingConfirmed") AS b, COALESCE(SUM(s."revenuePaise"),0) AS rev,
        COALESCE(SUM(s."pageViews"),0) AS pv, COALESCE(SUM(cardinality(s."searchTerms")),0) AS se, AVG(s."engagedMs")::float AS eng
      FROM vi_sessions s WHERE ${where} GROUP BY 1 ORDER BY ${dim === 'day' || dim === 'hour' ? Prisma.sql`1 ASC` : Prisma.sql`3 DESC`} LIMIT ${Math.min(limit, 500)}`;
    let labels = new Map<string, string>();
    if (dim === 'campaign') {
      const ids = rows.map((r) => r.k).filter((k) => /^[0-9a-f-]{36}$/.test(k));
      const camps = ids.length
        ? await this.prisma.viCampaign.findMany({
            where: { id: { in: ids } },
            select: { id: true, name: true },
          })
        : [];
      labels = new Map(camps.map((c) => [c.id, c.name]));
    }
    return rows.map((r) => ({
      key: r.k,
      label:
        dim === 'channel'
          ? (VI_CHANNEL_LABELS[r.k as ViChannel] ?? r.k)
          : (labels.get(r.k) ?? r.k),
      visitors: num(r.v),
      sessions: num(r.s),
      bookings: num(r.b),
      revenuePaise: num(r.rev),
      conversionPct: pct(num(r.b), num(r.s)),
      pageViews: num(r.pv),
      searches: num(r.se),
      avgEngagedSeconds: r.eng == null ? null : Math.round(r.eng / 1000),
    }));
  }

  private async simpleFunnel(
    q: ViQuery,
    scope: ViScope,
  ): Promise<ViFunnelStage[]> {
    const where = sessionWhere(q, scope);
    const [r] = await this.prisma.$queryRaw<
      Array<{ a: bigint; b: bigint; c: bigint; d: bigint; e: bigint }>
    >`
      SELECT COUNT(*) AS a, COUNT(*) FILTER (WHERE searched) AS b,
        COUNT(*) FILTER (WHERE "viewedSalon") AS c, COUNT(*) FILTER (WHERE "bookingStarted") AS d,
        COUNT(*) FILTER (WHERE "bookingConfirmed") AS e FROM vi_sessions s WHERE ${where}`;
    const vals = [num(r?.a), num(r?.b), num(r?.c), num(r?.d), num(r?.e)];
    const labels = [
      ['visits', 'Visits'],
      ['search', 'Searched'],
      ['salon', 'Viewed a salon'],
      ['initiated', 'Booking initiated'],
      ['confirmed', 'Booking confirmed'],
    ];
    return labels.map(([key, label], i) => ({
      key,
      label,
      sessions: vals[i],
      conversionFromPrevPct: i === 0 ? null : pct(vals[i], vals[i - 1]),
      dropOffPct:
        i === 0
          ? null
          : vals[i - 1]
            ? Math.round((1 - vals[i] / vals[i - 1]) * 1000) / 10
            : null,
      medianSecondsFromPrev: null,
    }));
  }

  // ---------- Live ----------

  async live(
    q: ViQuery,
    actor: ViActor,
    windowOverride?: number,
  ): Promise<ViLiveDto> {
    const settings = await this.config.get();
    const windowMin = Math.max(
      1,
      Math.min(120, windowOverride ?? settings.activityWindowMinutes),
    );
    const now = Date.now();
    const activeSince = new Date(now - windowMin * 60_000);
    const shownSince = new Date(now - Math.max(30, windowMin * 3) * 60_000);
    const where = sessionWhere(q, actor.scope, {
      from: new Date(now - 24 * 3600_000),
      to: new Date(now + 60_000),
    });
    const rows = await this.prisma.$queryRaw<
      Array<{
        id: string;
        guest: number;
        userId: string | null;
        country: string | null;
        state: string | null;
        city: string | null;
        locality: string | null;
        geoSource: ViGeoSource;
        currentPath: string | null;
        previousPath: string | null;
        entryPath: string | null;
        searchTerms: string[];
        salonsViewed: number;
        productsViewed: number;
        bookingStarted: boolean;
        bookingConfirmed: boolean;
        bookingFailed: boolean;
        addedToCart: boolean;
        checkoutStarted: boolean;
        purchased: boolean;
        startedAt: Date;
        lastActivityAt: Date;
        deviceCategory: string;
        browser: string | null;
        os: string | null;
        channel: string;
        utmCampaign: string | null;
        campaignName: string | null;
      }>
    >`
      SELECT s.id, v."guestNumber" AS guest, s."userId", s.country, s.state, s.city, s.locality, s."geoSource", s."currentPath", s."previousPath",
        s."entryPath", s."searchTerms", s."salonsViewed", s."productsViewed", s."bookingStarted", s."bookingConfirmed", s."bookingFailed",
        s."addedToCart", s."checkoutStarted", s.purchased, s."startedAt", s."lastActivityAt", s."deviceCategory", s.browser, s.os, s.channel,
        s."utmCampaign", c.name AS "campaignName"
      FROM vi_sessions s JOIN vi_visitors v ON v.id = s."visitorId" LEFT JOIN vi_campaigns c ON c.id = s."campaignId"
      WHERE ${where} AND s."lastActivityAt" >= ${shownSince}
      ORDER BY s."lastActivityAt" DESC LIMIT 300`;

    const userIds = [
      ...new Set(rows.map((r) => r.userId).filter((u): u is string => !!u)),
    ];
    const users =
      userIds.length && actor.capabilities.has('pii')
        ? await this.prisma.user.findMany({
            where: { id: { in: userIds } },
            select: { id: true, phone: true, email: true },
          })
        : [];
    const userMap = new Map(users.map((u) => [u.id, u]));
    const showLocality = settings.storeLocality;

    const sessions: ViLiveSessionDto[] = rows.map((r) => {
      const u = r.userId ? userMap.get(r.userId) : undefined;
      return {
        sessionId: r.id,
        visitorLabel: viVisitorLabel(r.guest),
        registered: !!r.userId,
        identity: r.userId
          ? {
              userId: actor.capabilities.has('pii') ? r.userId : '',
              name: u
                ? (u.phone ?? u.email ?? null)
                : r.userId
                  ? 'Registered customer'
                  : null,
            }
          : null,
        country: r.country,
        state: r.state,
        city: r.city,
        locality: showLocality ? r.locality : null,
        geoSource: r.geoSource,
        geoConfidence: geoConfidence(r.geoSource, !!r.city),
        currentPath: r.currentPath,
        previousPath: r.previousPath,
        entryPath: r.entryPath,
        searches: r.searchTerms.slice(-5),
        salonsViewed: r.salonsViewed,
        productsViewed: r.productsViewed,
        bookingStatus: r.bookingConfirmed
          ? 'confirmed'
          : r.bookingFailed
            ? 'failed'
            : r.bookingStarted
              ? 'started'
              : 'none',
        purchaseStatus: r.purchased
          ? 'purchased'
          : r.checkoutStarted
            ? 'checkout'
            : r.addedToCart
              ? 'cart'
              : 'none',
        startedAt: r.startedAt.toISOString(),
        lastActivityAt: r.lastActivityAt.toISOString(),
        durationSeconds: Math.max(
          0,
          Math.round(
            (r.lastActivityAt.getTime() - r.startedAt.getTime()) / 1000,
          ),
        ),
        device: r.deviceCategory,
        browser: r.browser,
        os: r.os,
        channel: r.channel as ViChannel,
        campaign: r.campaignName ?? r.utmCampaign,
        active: r.lastActivityAt >= activeSince,
      };
    });
    const activeRows = sessions.filter((s) => s.active);
    const tally = (vals: string[]) =>
      [
        ...vals.reduce(
          (m, v) => m.set(v, (m.get(v) ?? 0) + 1),
          new Map<string, number>(),
        ),
      ]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10);
    return {
      generatedAt: new Date(now).toISOString(),
      activityWindowMinutes: windowMin,
      activeCount: activeRows.length,
      inactiveCount: sessions.length - activeRows.length,
      byCity: tally(activeRows.map((s) => s.city ?? 'Unknown')).map(
        ([city, count]) => ({ city, count }),
      ),
      byPath: tally(activeRows.map((s) => s.currentPath ?? '/')).map(
        ([path, count]) => ({ path, count }),
      ),
      sessions,
    };
  }

  // ---------- Visitor history ----------

  async visitors(
    q: ViQuery,
    actor: ViActor,
    page: number,
    pageSize: number,
    search?: string,
    sort?: string,
  ) {
    if (actor.scope.kind === 'salon') throw viForbidden();
    const f = q.filters;
    const conds: Prisma.Sql[] = [
      Prisma.sql`v."isBot" = false`,
      Prisma.sql`v."lastSeenAt" >= ${q.range.from}`,
      Prisma.sql`v."firstSeenAt" < ${q.range.to}`,
    ];
    if (f.city) conds.push(Prisma.sql`v.city = ${f.city}`);
    if (f.state) conds.push(Prisma.sql`v.state = ${f.state}`);
    if (f.country) conds.push(Prisma.sql`v.country = ${f.country}`);
    if (f.channel)
      conds.push(
        Prisma.sql`(v."firstChannel" = ${f.channel} OR v."lastChannel" = ${f.channel})`,
      );
    if (f.device) conds.push(Prisma.sql`v."deviceCategory" = ${f.device}`);
    if (f.visitorType === 'registered')
      conds.push(Prisma.sql`v."userId" IS NOT NULL`);
    if (f.visitorType === 'anonymous')
      conds.push(Prisma.sql`v."userId" IS NULL`);
    if (f.visitorType === 'new') conds.push(Prisma.sql`v."sessionCount" <= 1`);
    if (f.visitorType === 'returning')
      conds.push(Prisma.sql`v."sessionCount" > 1`);
    if (actor.scope.kind === 'territory')
      conds.push(
        actor.scope.cities.length
          ? Prisma.sql`lower(v.city) IN (${Prisma.join(actor.scope.cities.map((c) => c.toLowerCase()))})`
          : Prisma.sql`false`,
      );
    if (search) {
      const guest = search.replace(/^guest\s*#?/i, '').trim();
      const like = `%${search.replace(/[%_]/g, '')}%`;
      const parts: Prisma.Sql[] = [Prisma.sql`v.city ILIKE ${like}`];
      if (/^\d{1,9}$/.test(guest))
        parts.push(Prisma.sql`v."guestNumber" = ${Number(guest)}`);
      // Contact search only for roles that may see contact details.
      if (actor.capabilities.has('pii') && search.length >= 4) {
        parts.push(
          Prisma.sql`v."userId" IN (SELECT id FROM users WHERE phone ILIKE ${like} OR email ILIKE ${like})`,
        );
      }
      conds.push(Prisma.sql`(${Prisma.join(parts, ' OR ')})`);
    }
    const where = Prisma.join(conds, ' AND ');
    const order =
      sort === 'visits'
        ? Prisma.sql`v."sessionCount" DESC`
        : sort === 'revenue'
          ? Prisma.sql`v."revenuePaise" DESC`
          : sort === 'first'
            ? Prisma.sql`v."firstSeenAt" DESC`
            : Prisma.sql`v."lastSeenAt" DESC`;
    const [countRow] = await this.prisma.$queryRaw<
      Array<{ n: bigint }>
    >`SELECT COUNT(*) AS n FROM vi_visitors v WHERE ${where}`;
    const rows = await this.prisma.$queryRaw<
      Array<
        Record<string, unknown> & {
          id: string;
          userId: string | null;
          guestNumber: number;
          revenuePaise: bigint;
          engagedMs: bigint;
        }
      >
    >`
      SELECT v.id, v."guestNumber", v."userId", v."firstSeenAt", v."lastSeenAt", v."sessionCount", v."pageViews", v.searches, v."salonViews",
        v."productViews", v."bookingAttempts", v.bookings, v.purchases, v."revenuePaise", v."engagedMs", v."firstChannel", v."lastChannel",
        v."firstSource", v."lastSource", v.country, v.state, v.city, v."deviceCategory", v."topServices", v."priceMinInr", v."priceMaxInr", v."consentMarketing"
      FROM vi_visitors v WHERE ${where} ORDER BY ${order} LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`;
    const contacts = await this.contacts(
      rows.map((r) => r.userId),
      actor,
    );
    return {
      total: num(countRow?.n),
      page,
      pageSize,
      items: rows.map((r) => ({
        ...r,
        label: viVisitorLabel(r.guestNumber),
        revenuePaise: num(r.revenuePaise),
        engagedSeconds: Math.round(num(r.engagedMs) / 1000),
        registered: !!r.userId,
        contact: r.userId ? (contacts.get(r.userId) ?? null) : null,
        userId: actor.capabilities.has('pii') ? r.userId : null,
      })),
    };
  }

  private async contacts(
    userIds: Array<string | null>,
    actor: ViActor,
  ): Promise<Map<string, string | null>> {
    const ids = [...new Set(userIds.filter((u): u is string => !!u))];
    if (!ids.length) return new Map();
    const users = await this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, phone: true, email: true },
    });
    const full = actor.capabilities.has('pii');
    return new Map(
      users.map((u) => [
        u.id,
        full ? (u.phone ?? u.email ?? null) : maskContact(u.phone ?? u.email),
      ]),
    );
  }

  async visitorDetail(id: string, actor: ViActor) {
    if (actor.scope.kind === 'salon') throw viForbidden();
    const v = await this.prisma.viVisitor.findUnique({ where: { id } });
    if (!v) throw viNotFound('Visitor');
    if (
      actor.scope.kind === 'territory' &&
      !actor.scope.cities.some(
        (c) => c.toLowerCase() === (v.city ?? '').toLowerCase(),
      )
    )
      throw viForbidden();
    const [sessions, searches, salonViews, conversions] = await Promise.all([
      this.prisma.viSession.findMany({
        where: { visitorId: id },
        orderBy: { startedAt: 'desc' },
        take: 50,
      }),
      this.prisma.viSearchEvent.groupBy({
        by: ['normalizedQuery', 'category'],
        where: { visitorId: id },
        _count: { _all: true },
        orderBy: { _count: { normalizedQuery: 'desc' } },
        take: 15,
      }),
      this.prisma.viEvent.groupBy({
        by: ['entityId'],
        where: { visitorId: id, type: 'salon_view', entityId: { not: null } },
        _count: { _all: true },
        orderBy: { _count: { entityId: 'desc' } },
        take: 10,
      }),
      this.prisma.viConversion.findMany({
        where: { visitorId: id },
        orderBy: { occurredAt: 'desc' },
        take: 50,
      }),
    ]);
    const salonIds = salonViews.map((s) => s.entityId!).filter(Boolean);
    const salons = salonIds.length
      ? await this.prisma.salon.findMany({
          where: { OR: [{ id: { in: salonIds } }, { slug: { in: salonIds } }] },
          select: { id: true, slug: true, name: true },
        })
      : [];
    const salonName = (k: string) =>
      salons.find((s) => s.id === k || s.slug === k)?.name ?? k;

    let registered: Record<string, unknown> | null = null;
    if (v.userId) {
      const full = actor.capabilities.has('pii');
      const user = await this.prisma.user.findUnique({
        where: { id: v.userId },
        select: { id: true, phone: true, email: true, createdAt: true },
      });
      const bookings = await this.prisma.booking.findMany({
        where: { customerId: v.userId },
        select: {
          id: true,
          status: true,
          slotStart: true,
          salonId: true,
          onlineBookingDiscountAmount: true,
          services: { select: { price: true } },
          salon: { select: { name: true } },
        },
        orderBy: { slotStart: 'desc' },
        take: 500,
      });
      const value = (b: (typeof bookings)[number]) =>
        Math.max(
          0,
          b.services.reduce((s, x) => s + Number(x.price), 0) -
            Number(b.onlineBookingDiscountAmount ?? 0),
        );
      const completed = bookings.filter((b) => b.status === 'COMPLETED');
      const preferred = [
        ...completed.reduce(
          (m, b) => m.set(b.salon.name, (m.get(b.salon.name) ?? 0) + 1),
          new Map<string, number>(),
        ),
      ]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3);
      const orders = await this.prisma.commerceOrder
        .aggregate({
          where: { customerUserId: v.userId },
          _count: { _all: true },
          _sum: { total: true },
        })
        .catch(() => null);
      const spend =
        completed.reduce((s, b) => s + value(b), 0) +
        Number(orders?._sum.total ?? 0);
      registered = {
        userId: full ? v.userId : null,
        contact: full
          ? (user?.phone ?? user?.email ?? null)
          : maskContact(user?.phone ?? user?.email),
        contactMasked: !full,
        registeredAt: user?.createdAt?.toISOString() ?? null,
        completedBookings: completed.length,
        cancelledBookings: bookings.filter((b) => b.status === 'CANCELLED')
          .length,
        noShows: bookings.filter((b) => b.status === 'NO_SHOW').length,
        purchases: orders?._count._all ?? 0,
        totalSpendInr: Math.round(spend),
        // Historical CLV: realised value to date (no forecast is presented as fact).
        clvInr: Math.round(spend),
        preferredSalons: preferred.map(([name, n]) => ({ name, bookings: n })),
        lastBookingAt: bookings[0]?.slotStart?.toISOString() ?? null,
        loyalty: null,
      };
    }
    return {
      id: v.id,
      label: viVisitorLabel(v.guestNumber),
      firstSeenAt: v.firstSeenAt,
      lastSeenAt: v.lastSeenAt,
      visits: v.sessionCount,
      pageViews: v.pageViews,
      engagedSeconds: Math.round(Number(v.engagedMs) / 1000),
      location: {
        country: v.country,
        state: v.state,
        city: v.city,
        note: 'Approximate. Never an address.',
      },
      device: v.deviceCategory,
      firstTouch: {
        channel: v.firstChannel,
        source: v.firstSource,
        campaign: v.firstCampaign,
      },
      lastTouch: {
        channel: v.lastChannel,
        source: v.lastSource,
        campaign: v.lastCampaign,
      },
      frequentServices: searches.map((s) => ({
        query: s.normalizedQuery,
        category: s.category,
        count: s._count._all,
      })),
      inferredPriceRange:
        v.priceMinInr != null || v.priceMaxInr != null
          ? {
              minInr: v.priceMinInr,
              maxInr: v.priceMaxInr,
              basis: 'Price filters the visitor used',
            }
          : null,
      salonsViewed: salonViews.map((s) => ({
        salon: salonName(s.entityId!),
        views: s._count._all,
      })),
      productsViewed: v.productViews,
      bookingAttempts: v.bookingAttempts,
      bookings: v.bookings,
      purchases: v.purchases,
      revenueInr: Number(v.revenuePaise) / 100,
      marketingConsent: v.consentMarketing,
      registered,
      conversions: conversions.map((c) => ({
        type: c.type,
        at: c.occurredAt,
        valueInr: Number(c.valuePaise) / 100,
        channel: c.lastChannel,
      })),
      sessions: sessions.map((s) => ({
        id: s.id,
        startedAt: s.startedAt,
        lastActivityAt: s.lastActivityAt,
        durationSeconds: Math.round(
          (s.lastActivityAt.getTime() - s.startedAt.getTime()) / 1000,
        ),
        pageViews: s.pageViews,
        channel: s.channel,
        entryPath: s.entryPath,
        city: s.city,
        geoSource: s.geoSource,
        geoSourceLabel: VI_GEO_SOURCE_LABELS[s.geoSource],
        device: s.deviceCategory,
        bookingConfirmed: s.bookingConfirmed,
        purchased: s.purchased,
      })),
    };
  }

  async timeline(sessionId: string, actor: ViActor) {
    const s = await this.prisma.viSession.findUnique({
      where: { id: sessionId },
      include: { visitor: { select: { guestNumber: true, city: true } } },
    });
    if (!s) throw viNotFound('Session');
    if (
      actor.scope.kind === 'territory' &&
      !actor.scope.cities.some(
        (c) => c.toLowerCase() === (s.city ?? '').toLowerCase(),
      )
    )
      throw viForbidden();
    if (actor.scope.kind === 'salon') throw viForbidden();
    const events = await this.prisma.viEvent.findMany({
      where: { sessionId },
      orderBy: { occurredAt: 'asc' },
      take: 1000,
      select: {
        type: true,
        occurredAt: true,
        path: true,
        entityType: true,
        entityId: true,
        module: true,
        metadata: true,
      },
    });
    return {
      sessionId,
      visitorLabel: viVisitorLabel(s.visitor.guestNumber),
      startedAt: s.startedAt,
      channel: s.channel,
      device: s.deviceCategory,
      city: s.city,
      geoSource: s.geoSource,
      note: 'Event-level timeline. FastQue never records keystrokes, form contents or screen recordings.',
      events,
    };
  }

  // ---------- Geography ----------

  async geo(
    q: ViQuery,
    actor: ViActor,
    level: 'country' | 'state' | 'city' | 'locality',
  ) {
    const settings = await this.config.get();
    if (level === 'locality' && !settings.storeLocality)
      return {
        level,
        rows: [],
        note: 'Locality is off: IP data is not reliable at locality level. Enable it in Tracking Settings to use visitor-chosen localities only.',
      };
    const col =
      level === 'country'
        ? Prisma.sql`COALESCE(s.country,'Unknown')`
        : level === 'state'
          ? Prisma.sql`COALESCE(s.state,'Unknown')`
          : level === 'city'
            ? Prisma.sql`COALESCE(s.city,'Unknown')`
            : Prisma.sql`COALESCE(s.locality,'Unknown')`;
    const where = sessionWhere(q, actor.scope);
    const activeSince = new Date(
      Date.now() - settings.activityWindowMinutes * 60_000,
    );
    const rows = await this.prisma.$queryRaw<
      Array<{
        k: string;
        country: string | null;
        state: string | null;
        v: bigint;
        s: bigint;
        live: bigint;
        b: bigint;
        p: bigint;
        rev: bigint;
        se: bigint;
        zr: bigint;
        price: number | null;
        src: string | null;
      }>
    >`
      SELECT ${col} AS k, MAX(s.country) AS country, MAX(s.state) AS state,
        COUNT(DISTINCT s."visitorId") AS v, COUNT(*) AS s,
        COUNT(*) FILTER (WHERE s."lastActivityAt" >= ${activeSince}) AS live,
        COUNT(*) FILTER (WHERE s."bookingConfirmed") AS b, COUNT(*) FILTER (WHERE s.purchased) AS p,
        COALESCE(SUM(s."revenuePaise"),0) AS rev,
        COALESCE(SUM((SELECT COUNT(*) FROM vi_search_events se WHERE se."sessionId" = s.id)),0) AS se,
        COALESCE(SUM((SELECT COUNT(*) FROM vi_search_events se WHERE se."sessionId" = s.id AND se."zeroResult")),0) AS zr,
        AVG((SELECT AVG(COALESCE((se."priceMinInr" + se."priceMaxInr") / 2.0, se."priceMaxInr", se."priceMinInr")) FROM vi_search_events se WHERE se."sessionId" = s.id))::float AS price,
        mode() WITHIN GROUP (ORDER BY s."geoSource") AS src
      FROM vi_sessions s WHERE ${where} GROUP BY 1 ORDER BY 5 DESC LIMIT 300`;

    // Supply: active FastQue salons by the same geography (cities table).
    const supply = new Map<string, number>();
    const coords = new Map<string, { lat: number; lng: number }>();
    if (level !== 'locality') {
      const sup = await this.prisma.$queryRaw<
        Array<{ k: string; n: bigint; lat: number | null; lng: number | null }>
      >`
        SELECT ${level === 'country' ? Prisma.sql`c.country` : level === 'state' ? Prisma.sql`c.state` : Prisma.sql`c.name`} AS k, COUNT(sa.id) AS n,
          AVG(c.latitude)::float AS lat, AVG(c.longitude)::float AS lng
        FROM cities c LEFT JOIN salons sa ON sa."cityId" = c.id AND sa.status = 'ACTIVE' GROUP BY 1`;
      for (const r of sup) {
        supply.set(r.k.toLowerCase(), num(r.n));
        if (r.lat != null && r.lng != null)
          coords.set(r.k.toLowerCase(), { lat: r.lat, lng: r.lng });
      }
    }
    const topServices =
      level === 'city'
        ? await this.topServicesByCity(q, actor.scope)
        : new Map<string, string[]>();
    return {
      level,
      note: 'Locations are approximate (IP/CDN or visitor-chosen) and never an address. Source and confidence are shown per row.',
      rows: rows.map((r) => {
        const activeSalons = supply.get(r.k.toLowerCase()) ?? 0;
        const opp = scoreViOpportunity({
          visitors: num(r.v),
          searches: num(r.se),
          activeSalons,
          zeroResultSearches: num(r.zr),
        });
        const source = (r.src ?? 'NONE') as ViGeoSource;
        return {
          key: r.k,
          country: r.country,
          state: r.state,
          visitors: num(r.v),
          sessions: num(r.s),
          liveVisitors: num(r.live),
          searches: num(r.se),
          zeroResultSearches: num(r.zr),
          bookings: num(r.b),
          purchases: num(r.p),
          revenuePaise: num(r.rev),
          conversionPct: pct(num(r.b), num(r.s)),
          activeSalons,
          avgSearchedPriceInr: r.price == null ? null : Math.round(r.price),
          topServices: topServices.get(r.k) ?? [],
          opportunity: opp,
          geoSource: source,
          geoSourceLabel: VI_GEO_SOURCE_LABELS[source],
          confidence: geoConfidence(
            source,
            level === 'city' || level === 'locality',
          ),
          coords: coords.get(r.k.toLowerCase()) ?? null,
        };
      }),
    };
  }

  private async topServicesByCity(
    q: ViQuery,
    scope: ViScope,
  ): Promise<Map<string, string[]>> {
    const where = sessionWhere(q, scope);
    const rows = await this.prisma.$queryRaw<
      Array<{ city: string; cat: string; n: bigint }>
    >`
      SELECT COALESCE(s.city,'Unknown') AS city, COALESCE(se.category, se."normalizedQuery") AS cat, COUNT(*) AS n
      FROM vi_search_events se JOIN vi_sessions s ON s.id = se."sessionId" WHERE ${where}
      GROUP BY 1,2 ORDER BY 1, 3 DESC`;
    const m = new Map<string, string[]>();
    for (const r of rows) {
      const list = m.get(r.city) ?? [];
      if (list.length < 3) list.push(r.cat);
      m.set(r.city, list);
    }
    return m;
  }

  async opportunities(q: ViQuery, actor: ViActor) {
    const geo = await this.geo(q, actor, 'city');
    const assignments = await this.prisma.viOpportunityAssignment.findMany({
      where: { createdAt: { gte: new Date(Date.now() - 60 * 86_400_000) } },
      orderBy: { createdAt: 'desc' },
    });
    return {
      formula:
        'demand = searches + 0.3 × visitors + 0.5 × zero-result searches; pressure = demand ÷ active salons. HIGH: demand ≥ 50 and pressure ≥ 25 (or no salons and demand ≥ 20); MEDIUM: demand ≥ 15 and pressure ≥ 8.',
      rows: geo.rows
        .filter((r) => r.key !== 'Unknown')
        .map((r) => ({
          city: r.key,
          state: r.state,
          visitors: r.visitors,
          searches: r.searches,
          zeroResultSearches: r.zeroResultSearches,
          activeSalons: r.activeSalons,
          bookings: r.bookings,
          topServices: r.topServices,
          ...r.opportunity,
          recommendedAction:
            r.opportunity.level === 'HIGH'
              ? `Onboard salons in ${r.key}${r.topServices.length ? ` offering ${r.topServices.join(', ')}` : ''}: demand far exceeds active supply.`
              : r.opportunity.level === 'MEDIUM'
                ? `Plan a field visit in ${r.key} and validate demand with a local campaign.`
                : 'Monitor.',
          lastAssignment:
            assignments.find(
              (a) => a.city.toLowerCase() === r.key.toLowerCase(),
            ) ?? null,
        }))
        .sort((a, b) => b.score - a.score),
    };
  }

  // ---------- Search intelligence ----------

  async search(q: ViQuery, actor: ViActor) {
    const where = sessionWhere(q, actor.scope);
    const prevWhere = sessionWhere(q, actor.scope, {
      from: q.range.previousFrom,
      to: q.range.previousTo,
    });
    const base = Prisma.sql`FROM vi_search_events se JOIN vi_sessions s ON s.id = se."sessionId" WHERE ${where}`;
    const [
      totals,
      top,
      prevTop,
      byCity,
      hourly,
      daily,
      kinds,
      unfulfilled,
      filters,
      categories,
    ] = await Promise.all([
      this.prisma.$queryRaw<
        Array<{
          n: bigint;
          zr: bigint;
          b: bigint;
          p: bigint;
          sv: bigint;
          u: bigint;
        }>
      >`
        SELECT COUNT(*) AS n, COUNT(*) FILTER (WHERE se."zeroResult") AS zr, COUNT(*) FILTER (WHERE se."ledToBooking") AS b,
          COUNT(*) FILTER (WHERE se."ledToPurchase") AS p, COUNT(*) FILTER (WHERE se."ledToSalonView") AS sv,
          COUNT(*) FILTER (WHERE NOT se."ledToSalonView" AND NOT se."ledToBooking" AND NOT se."ledToPurchase") AS u ${base}`,
      this.prisma.$queryRaw<
        Array<{
          q: string;
          example: string;
          cat: string | null;
          n: bigint;
          zr: bigint;
          b: bigint;
          p: bigint;
          avg_results: number | null;
        }>
      >`
        SELECT se."normalizedQuery" AS q, MAX(se."rawQuery") AS example, MAX(se.category) AS cat, COUNT(*) AS n,
          COUNT(*) FILTER (WHERE se."zeroResult") AS zr, COUNT(*) FILTER (WHERE se."ledToBooking") AS b,
          COUNT(*) FILTER (WHERE se."ledToPurchase") AS p, AVG(se."resultCount")::float AS avg_results
        ${base} GROUP BY 1 ORDER BY 4 DESC LIMIT 100`,
      this.prisma.$queryRaw<Array<{ q: string; n: bigint }>>`
        SELECT se."normalizedQuery" AS q, COUNT(*) AS n FROM vi_search_events se JOIN vi_sessions s ON s.id = se."sessionId" WHERE ${prevWhere} GROUP BY 1 ORDER BY 2 DESC LIMIT 500`,
      this.prisma.$queryRaw<Array<{ city: string; q: string; n: bigint }>>`
        SELECT COALESCE(se.city, s.city, 'Unknown') AS city, COALESCE(se.category, se."normalizedQuery") AS q, COUNT(*) AS n ${base} GROUP BY 1,2 ORDER BY 1, 3 DESC`,
      this.prisma.$queryRaw<
        Array<{ h: string; n: bigint }>
      >`SELECT to_char(se."occurredAt" AT TIME ZONE 'Asia/Kolkata','HH24') AS h, COUNT(*) AS n ${base} GROUP BY 1 ORDER BY 1`,
      this.prisma.$queryRaw<
        Array<{ d: string; n: bigint; zr: bigint }>
      >`SELECT to_char(se."occurredAt" AT TIME ZONE 'Asia/Kolkata','YYYY-MM-DD') AS d, COUNT(*) AS n, COUNT(*) FILTER (WHERE se."zeroResult") AS zr ${base} GROUP BY 1 ORDER BY 1`,
      this.prisma.$queryRaw<
        Array<{ k: string; n: bigint; zr: bigint }>
      >`SELECT se.kind AS k, COUNT(*) AS n, COUNT(*) FILTER (WHERE se."zeroResult") AS zr ${base} GROUP BY 1 ORDER BY 2 DESC`,
      this.prisma.$queryRaw<
        Array<{ q: string; city: string; n: bigint; zr: bigint }>
      >`
        SELECT COALESCE(se.category, se."normalizedQuery") AS q, COALESCE(se.city, s.city, 'Unknown') AS city, COUNT(*) AS n, COUNT(*) FILTER (WHERE se."zeroResult") AS zr
        ${base} AND (se."zeroResult" OR (NOT se."ledToSalonView" AND NOT se."ledToBooking")) GROUP BY 1,2 ORDER BY 3 DESC LIMIT 50`,
      this.prisma.$queryRaw<Array<{ k: string; n: bigint }>>`
        SELECT f.key AS k, COUNT(*) AS n FROM vi_search_events se JOIN vi_sessions s ON s.id = se."sessionId"
        CROSS JOIN LATERAL jsonb_object_keys(CASE WHEN jsonb_typeof(se.filters) = 'object' THEN se.filters ELSE '{}'::jsonb END) AS f(key)
        WHERE ${where} GROUP BY 1 ORDER BY 2 DESC`,
      this.prisma.$queryRaw<
        Array<{ cat: string; n: bigint; b: bigint; zr: bigint }>
      >`
        SELECT COALESCE(se.category, 'uncategorised') AS cat, COUNT(*) AS n, COUNT(*) FILTER (WHERE se."ledToBooking") AS b, COUNT(*) FILTER (WHERE se."zeroResult") AS zr ${base} GROUP BY 1 ORDER BY 2 DESC LIMIT 40`,
    ]);
    const t = totals[0];
    const prevMap = new Map(prevTop.map((r) => [r.q, num(r.n)]));
    const cityTop = new Map<string, Array<{ query: string; count: number }>>();
    for (const r of byCity) {
      const l = cityTop.get(r.city) ?? [];
      if (l.length < 5) l.push({ query: r.q, count: num(r.n) });
      cityTop.set(r.city, l);
    }
    const seasonal = await this.prisma.$queryRaw<
      Array<{ m: string; cat: string; n: bigint }>
    >`
      SELECT to_char(se."occurredAt" AT TIME ZONE 'Asia/Kolkata','YYYY-MM') AS m, COALESCE(se.category,'uncategorised') AS cat, COUNT(*) AS n
      FROM vi_search_events se WHERE se."occurredAt" >= ${new Date(Date.now() - 365 * 86_400_000)} GROUP BY 1,2 ORDER BY 1`;
    return {
      totals: {
        searches: num(t?.n),
        zeroResult: num(t?.zr),
        zeroResultPct: pct(num(t?.zr), num(t?.n)),
        searchToBookingPct: pct(num(t?.b), num(t?.n)),
        searchToPurchasePct: pct(num(t?.p), num(t?.n)),
        searchToSalonViewPct: pct(num(t?.sv), num(t?.n)),
        abandoned: num(t?.u),
      },
      top: top.map((r) => ({
        query: r.q,
        example: r.example,
        category: r.cat,
        count: num(r.n),
        zeroResult: num(r.zr),
        bookings: num(r.b),
        purchases: num(r.p),
        avgResults:
          r.avg_results == null ? null : Math.round(r.avg_results * 10) / 10,
        conversionPct: pct(num(r.b), num(r.n)),
      })),
      trending: top
        .map((r) => ({
          query: r.q,
          count: num(r.n),
          previous: prevMap.get(r.q) ?? 0,
        }))
        .filter((r) => r.count >= 3)
        .map((r) => ({
          ...r,
          growthPct: r.previous
            ? Math.round(((r.count - r.previous) / r.previous) * 1000) / 10
            : null,
          isNew: r.previous === 0,
        }))
        .sort((a, b) => (b.growthPct ?? 1e9) - (a.growthPct ?? 1e9))
        .slice(0, 20),
      byCity: [...cityTop]
        .map(([city, queries]) => ({ city, queries }))
        .slice(0, 30),
      hourly: Array.from({ length: 24 }, (_, h) => ({
        hour: h,
        count: num(hourly.find((r) => Number(r.h) === h)?.n),
      })),
      daily: daily.map((r) => ({
        date: r.d,
        count: num(r.n),
        zeroResult: num(r.zr),
      })),
      kinds: kinds.map((r) => ({
        kind: r.k,
        count: num(r.n),
        zeroResult: num(r.zr),
      })),
      highDemand: categories.map((r) => ({
        category: r.cat,
        count: num(r.n),
        bookings: num(r.b),
        zeroResult: num(r.zr),
        conversionPct: pct(num(r.b), num(r.n)),
      })),
      unfulfilled: unfulfilled.map((r) => ({
        query: r.q,
        city: r.city,
        count: num(r.n),
        zeroResult: num(r.zr),
      })),
      filtersUsed: filters.map((r) => ({ filter: r.k, count: num(r.n) })),
      seasonal: seasonal.map((r) => ({
        month: r.m,
        category: r.cat,
        count: num(r.n),
      })),
    };
  }

  // ---------- Journeys & funnels ----------

  async funnel(
    q: ViQuery,
    actor: ViActor,
    module: string,
    splitBy?: 'city' | 'device' | 'channel' | 'campaign',
  ) {
    const def = VI_FUNNELS[module];
    if (!def) throw viBadRequest('Unknown funnel.');
    const where = sessionWhere(q, actor.scope);
    const cols = def.steps
      .slice(1)
      .map(
        (st, i) =>
          Prisma.sql`MIN(e."occurredAt") FILTER (WHERE ${stepCondition(st)}) AS t${Prisma.raw(String(i + 1))}`,
      );
    const split = splitBy ? BREAKDOWN_DIMS[splitBy] : Prisma.sql`'all'`;
    const rows = await this.prisma.$queryRaw<
      Array<Record<string, Date | string | null>>
    >`
      SELECT ${split} AS grp, s."startedAt" AS t0, s."revenuePaise"::text AS rev, ${Prisma.join(cols, ', ')}
      FROM vi_sessions s LEFT JOIN vi_events e ON e."sessionId" = s.id
      WHERE ${where} GROUP BY s.id LIMIT 200000`;
    // Sequential, non-strict funnel: a required step counts only if every earlier required step happened;
    // optional steps are reported but never block later steps.
    const compute = (list: typeof rows) => {
      const n = def.steps.length;
      const counts = new Array<number>(n).fill(0);
      const gaps: number[][] = Array.from({ length: n }, () => []);
      let revenue = 0;
      for (const r of list) {
        let ok = true;
        let prevTime = r.t0 as Date;
        counts[0]++;
        for (let i = 1; i < n; i++) {
          const t = r[`t${i}`] as Date | null;
          const st = def.steps[i];
          if (!ok) break;
          if (t) {
            counts[i]++;
            if (prevTime && t >= prevTime)
              gaps[i].push((t.getTime() - prevTime.getTime()) / 1000);
            prevTime = t;
          } else if (!st.optional) ok = false;
        }
        if (ok) revenue += Number(r.rev ?? 0);
      }
      const median = (a: number[]) =>
        a.length
          ? Math.round(a.sort((x, y) => x - y)[Math.floor(a.length / 2)])
          : null;
      let lastRequired = counts[0];
      const stages: Array<ViFunnelStage & { optional: boolean }> =
        def.steps.map((st, i) => {
          const base = i === 0 ? null : lastRequired;
          const stage = {
            key: st.key,
            label: st.label,
            optional: !!st.optional,
            sessions: counts[i],
            conversionFromPrevPct: base == null ? null : pct(counts[i], base),
            dropOffPct:
              base == null || !base
                ? null
                : Math.round((1 - counts[i] / base) * 1000) / 10,
            medianSecondsFromPrev: median(gaps[i]),
          };
          if (!st.optional) lastRequired = counts[i];
          return stage;
        });
      return {
        stages,
        overallPct: pct(counts[n - 1], counts[0]),
        revenuePaise: revenue,
      };
    };
    const overall = compute(rows);
    let splits: Array<{
      key: string;
      label: string;
      sessions: number;
      overallPct: number | null;
    }> = [];
    if (splitBy) {
      const groups = new Map<string, typeof rows>();
      for (const r of rows) {
        const g = String(r.grp ?? 'Unknown');
        groups.set(g, [...(groups.get(g) ?? []), r]);
      }
      splits = [...groups]
        .map(([key, list]) => ({
          key,
          label:
            splitBy === 'channel'
              ? (VI_CHANNEL_LABELS[key as ViChannel] ?? key)
              : key,
          sessions: list.length,
          overallPct: compute(list).overallPct,
        }))
        .sort((a, b) => b.sessions - a.sessions)
        .slice(0, 15);
    }
    return {
      module,
      label: def.label,
      ...overall,
      splitBy: splitBy ?? null,
      splits,
      abandonment: await this.abandonment(q, actor.scope, module),
    };
  }

  /** Observed reasons come from measurable events; inferred reasons are labelled with their basis and confidence. */
  async abandonment(q: ViQuery, scope: ViScope, module: string) {
    const where = sessionWhere(q, scope);
    const [r] = await this.prisma.$queryRaw<Array<Record<string, bigint>>>`
      WITH s AS (SELECT id, "viewedSalon", "bookingStarted", "bookingConfirmed", "addedToCart", purchased, "deviceCategory", "engagedMs" FROM vi_sessions s WHERE ${where})
      SELECT
        (SELECT COUNT(*) FROM vi_search_events se WHERE se."sessionId" IN (SELECT id FROM s) AND se."zeroResult") AS zero_results,
        (SELECT COUNT(*) FROM vi_search_events se WHERE se."sessionId" IN (SELECT id FROM s) AND se."zeroResult" AND (se."priceMinInr" IS NOT NULL OR se."priceMaxInr" IS NOT NULL)) AS price_zero,
        (SELECT COUNT(*) FROM vi_search_events se WHERE se."sessionId" IN (SELECT id FROM s) AND se."zeroResult" AND se.kind = 'HOME_SERVICE') AS home_unavailable,
        (SELECT COUNT(*) FROM vi_events e WHERE e."sessionId" IN (SELECT id FROM s) AND e.type = 'booking_failed' AND e.metadata->>'reason' IN ('no_slots','no_availability','slot_taken')) AS no_availability,
        (SELECT COUNT(*) FROM vi_events e WHERE e."sessionId" IN (SELECT id FROM s) AND e.type = 'payment_failed') AS payment_failed,
        (SELECT COUNT(*) FROM vi_events e WHERE e."sessionId" IN (SELECT id FROM s) AND e.type = 'page_error') AS technical_errors,
        (SELECT COUNT(*) FROM vi_events e WHERE e."sessionId" IN (SELECT id FROM s) AND e.type IN ('booking_failed','add_to_cart') AND e.metadata->>'reason' = 'out_of_stock') AS out_of_stock,
        (SELECT COUNT(DISTINCT e."sessionId") FROM vi_events e WHERE e."sessionId" IN (SELECT id FROM s) AND e.type = 'sign_up_start'
           AND NOT EXISTS (SELECT 1 FROM vi_events e2 WHERE e2."sessionId" = e."sessionId" AND e2.type IN ('sign_up','login'))) AS registration_abandoned,
        (SELECT COUNT(*) FROM s WHERE "viewedSalon" AND NOT "bookingStarted") AS viewed_not_started,
        (SELECT COUNT(*) FROM s WHERE "bookingStarted" AND NOT "bookingConfirmed") AS started_not_confirmed,
        (SELECT COUNT(*) FROM s WHERE "addedToCart" AND NOT purchased) AS cart_abandoned,
        (SELECT COUNT(*) FROM s WHERE "bookingStarted" AND NOT "bookingConfirmed" AND "deviceCategory" = 'mobile') AS mobile_abandoned`;
    const n = (k: string) => num(r?.[k]);
    const observed = [
      {
        reason: 'No matching salon / zero search results',
        count: n('zero_results'),
      },
      { reason: 'Price filter returned no matches', count: n('price_zero') },
      {
        reason: 'No availability for the chosen time',
        count: n('no_availability'),
      },
      { reason: 'Payment failure', count: n('payment_failed') },
      { reason: 'Technical / page errors', count: n('technical_errors') },
      { reason: 'Registration abandoned', count: n('registration_abandoned') },
      {
        reason: 'Home service unavailable in area',
        count: n('home_unavailable'),
      },
      { reason: 'Out of stock', count: n('out_of_stock') },
      {
        reason: 'Booking started but not confirmed',
        count: n('started_not_confirmed'),
      },
      { reason: 'Cart abandoned', count: n('cart_abandoned') },
    ].filter((o) => o.count > 0 || module === 'SALON_BOOKING');
    const inferred: Array<{
      reason: string;
      basis: string;
      confidencePct: number;
    }> = [];
    if (
      n('viewed_not_started') > 20 &&
      n('viewed_not_started') > 3 * Math.max(1, n('started_not_confirmed'))
    ) {
      inferred.push({
        reason:
          'Visitors compare salons but do not start a booking (possible price or availability concerns)',
        basis: `${n('viewed_not_started')} sessions viewed a salon without starting a booking`,
        confidencePct: 45,
      });
    }
    if (
      n('started_not_confirmed') >= 10 &&
      n('mobile_abandoned') / Math.max(1, n('started_not_confirmed')) > 0.8
    ) {
      inferred.push({
        reason: 'Booking flow may be harder to complete on mobile',
        basis: `${n('mobile_abandoned')} of ${n('started_not_confirmed')} unfinished bookings were on mobile`,
        confidencePct: 40,
      });
    }
    return {
      observed,
      inferred,
      note: 'Observed reasons are counted from tracked events. Inferred reasons are hypotheses from patterns, never facts.',
    };
  }

  // ---------- Traffic sources ----------

  async sources(q: ViQuery, actor: ViActor) {
    const where = sessionWhere(q, actor.scope);
    const [
      lastTouch,
      firstTouch,
      sources,
      mediums,
      campaigns,
      referrers,
      landing,
      keywords,
    ] = await Promise.all([
      this.breakdown(q, actor.scope, 'channel', 30),
      this.prisma.$queryRaw<
        Array<{
          k: string | null;
          v: bigint;
          s: bigint;
          b: bigint;
          rev: bigint;
        }>
      >`
        SELECT v."firstChannel" AS k, COUNT(DISTINCT s."visitorId") AS v, COUNT(*) AS s, COUNT(*) FILTER (WHERE s."bookingConfirmed") AS b, COALESCE(SUM(s."revenuePaise"),0) AS rev
        FROM vi_sessions s JOIN vi_visitors v ON v.id = s."visitorId" WHERE ${where} GROUP BY 1 ORDER BY 3 DESC`,
      this.breakdown(q, actor.scope, 'source', 30),
      this.breakdown(q, actor.scope, 'medium', 20),
      this.breakdown(q, actor.scope, 'utmCampaign', 30),
      this.breakdown(q, actor.scope, 'referrer', 30),
      this.breakdown(q, actor.scope, 'landing', 30),
      this.prisma.$queryRaw<
        Array<{
          key: string;
          dims: unknown;
          clicks: number;
          impressions: number;
          position: number;
        }>
      >`
        SELECT dims->>'query' AS key, NULL AS dims, SUM((metrics->>'clicks')::float) AS clicks, SUM((metrics->>'impressions')::float) AS impressions,
          AVG((metrics->>'position')::float) AS position
        FROM vi_external_metrics WHERE provider = 'SEARCH_CONSOLE' AND day >= ${q.range.from} AND day < ${q.range.to} GROUP BY 1 ORDER BY 3 DESC LIMIT 50`,
    ]);
    return {
      lastTouch,
      firstTouch: firstTouch.map((r) => ({
        key: r.k ?? 'UNKNOWN',
        label: VI_CHANNEL_LABELS[(r.k ?? 'UNKNOWN') as ViChannel] ?? r.k,
        visitors: num(r.v),
        sessions: num(r.s),
        bookings: num(r.b),
        revenuePaise: num(r.rev),
        conversionPct: pct(num(r.b), num(r.s)),
      })),
      sources,
      mediums,
      campaigns,
      referrers,
      landingPages: landing,
      externalKeywords: keywords.map((k) => ({
        query: k.key,
        clicks: Math.round(num(k.clicks)),
        impressions: Math.round(num(k.impressions)),
        ctrPct: pct(num(k.clicks), num(k.impressions)),
        position: k.position == null ? null : Math.round(k.position * 10) / 10,
      })),
      externalKeywordsNote: keywords.length
        ? 'From Google Search Console (aggregated, no individual searches).'
        : 'Connect Google Search Console in Tracking Settings to see the Google queries that lead to FastQue. Private search history is never available or collected.',
    };
  }

  // ---------- Conversions ----------

  async conversions(q: ViQuery, actor: ViActor) {
    const where = sessionWhere(q, actor.scope);
    const [byType, byModule, trend, recent] = await Promise.all([
      this.prisma.$queryRaw<Array<{ t: string; n: bigint; v: bigint }>>`
        SELECT c.type::text AS t, COUNT(*) AS n, COALESCE(SUM(c."valuePaise"),0) AS v FROM vi_conversions c JOIN vi_sessions s ON s.id = c."sessionId" WHERE ${where} GROUP BY 1 ORDER BY 2 DESC`,
      this.prisma.$queryRaw<Array<{ m: string; n: bigint; v: bigint }>>`
        SELECT COALESCE(c.module,'CONTENT') AS m, COUNT(*) AS n, COALESCE(SUM(c."valuePaise"),0) AS v FROM vi_conversions c JOIN vi_sessions s ON s.id = c."sessionId" WHERE ${where} GROUP BY 1 ORDER BY 2 DESC`,
      this.prisma.$queryRaw<
        Array<{ d: string; t: string; n: bigint; v: bigint }>
      >`
        SELECT to_char(c."occurredAt" AT TIME ZONE 'Asia/Kolkata','YYYY-MM-DD') AS d, c.type::text AS t, COUNT(*) AS n, COALESCE(SUM(c."valuePaise"),0) AS v
        FROM vi_conversions c JOIN vi_sessions s ON s.id = c."sessionId" WHERE ${where} GROUP BY 1,2 ORDER BY 1`,
      this.prisma.$queryRaw<
        Array<{
          type: string;
          occurredAt: Date;
          valuePaise: bigint;
          lastChannel: string | null;
          firstChannel: string | null;
          city: string | null;
          guest: number;
        }>
      >`
        SELECT c.type::text AS type, c."occurredAt", c."valuePaise", c."lastChannel", c."firstChannel", c.city, v."guestNumber" AS guest
        FROM vi_conversions c JOIN vi_sessions s ON s.id = c."sessionId" JOIN vi_visitors v ON v.id = c."visitorId" WHERE ${where} ORDER BY c."occurredAt" DESC LIMIT 50`,
    ]);
    return {
      byType: byType.map((r) => ({
        type: r.t,
        count: num(r.n),
        valuePaise: num(r.v),
      })),
      byModule: byModule.map((r) => ({
        module: r.m,
        count: num(r.n),
        valuePaise: num(r.v),
      })),
      trend: trend.map((r) => ({
        date: r.d,
        type: r.t,
        count: num(r.n),
        valuePaise: num(r.v),
      })),
      recent: recent.map((r) => ({
        ...r,
        visitor: viVisitorLabel(r.guest),
        valuePaise: num(r.valuePaise),
      })),
      funnels: Object.entries(VI_FUNNELS).map(([key, f]) => ({
        key,
        label: f.label,
      })),
      note: 'Revenue is the value recorded on the booking or order itself (after online discount), not a browser-reported amount.',
    };
  }

  // ---------- Salon owner (own salon only) ----------

  async salonSummary(salonId: string, q: ViQuery) {
    const salon = await this.prisma.salon.findUnique({
      where: { id: salonId },
      select: { id: true, slug: true, name: true },
    });
    if (!salon) throw viNotFound('Salon');
    const keys = [salon.id, salon.slug];
    const { from, to, previousFrom, previousTo } = q.range;
    const one = async (f: Date, t: Date) => {
      const [r] = await this.prisma.$queryRaw<
        Array<{
          views: bigint;
          visitors: bigint;
          sessions: bigint;
          bookings: bigint;
          value: bigint;
        }>
      >`
        SELECT
          (SELECT COUNT(*) FROM vi_events e WHERE e.type = 'salon_view' AND (e."salonId" IN (${Prisma.join(keys)}) OR e."entityId" IN (${Prisma.join(keys)})) AND e."occurredAt" >= ${f} AND e."occurredAt" < ${t}) AS views,
          (SELECT COUNT(DISTINCT e."visitorId") FROM vi_events e WHERE e.type = 'salon_view' AND (e."salonId" IN (${Prisma.join(keys)}) OR e."entityId" IN (${Prisma.join(keys)})) AND e."occurredAt" >= ${f} AND e."occurredAt" < ${t}) AS visitors,
          (SELECT COUNT(DISTINCT e."sessionId") FROM vi_events e WHERE e.type = 'salon_view' AND (e."salonId" IN (${Prisma.join(keys)}) OR e."entityId" IN (${Prisma.join(keys)})) AND e."occurredAt" >= ${f} AND e."occurredAt" < ${t}) AS sessions,
          (SELECT COUNT(*) FROM vi_conversions c WHERE c."salonId" = ${salon.id} AND c.type = 'BOOKING' AND c."occurredAt" >= ${f} AND c."occurredAt" < ${t}) AS bookings,
          (SELECT COALESCE(SUM(c."valuePaise"),0) FROM vi_conversions c WHERE c."salonId" = ${salon.id} AND c.type = 'BOOKING' AND c."occurredAt" >= ${f} AND c."occurredAt" < ${t}) AS value`;
      return r;
    };
    const [cur, prev] = await Promise.all([
      one(from, to),
      one(previousFrom, previousTo),
    ]);
    const sources = await this.prisma.$queryRaw<
      Array<{ k: string; n: bigint }>
    >`
      SELECT s.channel AS k, COUNT(DISTINCT s.id) AS n FROM vi_sessions s
      WHERE s.id IN (SELECT e."sessionId" FROM vi_events e WHERE e.type = 'salon_view' AND (e."salonId" IN (${Prisma.join(keys)}) OR e."entityId" IN (${Prisma.join(keys)})) AND e."occurredAt" >= ${from} AND e."occurredAt" < ${to})
      GROUP BY 1 ORDER BY 2 DESC`;
    // Searches in the salon's own city for services it could serve: aggregate only, no other salon's data.
    const searches = await this.prisma.$queryRaw<
      Array<{ q: string; n: bigint }>
    >`
      SELECT COALESCE(se.category, se."normalizedQuery") AS q, COUNT(*) AS n FROM vi_search_events se
      WHERE se."sessionId" IN (SELECT e."sessionId" FROM vi_events e WHERE e.type = 'salon_view' AND (e."salonId" IN (${Prisma.join(keys)}) OR e."entityId" IN (${Prisma.join(keys)})) AND e."occurredAt" >= ${from} AND e."occurredAt" < ${to})
      GROUP BY 1 ORDER BY 2 DESC LIMIT 10`;
    return {
      salon: { id: salon.id, name: salon.name },
      from: from.toISOString(),
      to: to.toISOString(),
      profileViews: viKpi(num(cur.views), num(prev.views)),
      profileVisitors: viKpi(num(cur.visitors), num(prev.visitors)),
      bookings: viKpi(num(cur.bookings), num(prev.bookings)),
      bookingValuePaise: viKpi(num(cur.value), num(prev.value)),
      conversionPct: viKpi(
        pct(num(cur.bookings), num(cur.sessions)),
        pct(num(prev.bookings), num(prev.sessions)),
      ),
      sources: sources.map((s) => ({
        channel: s.k,
        label: VI_CHANNEL_LABELS[s.k as ViChannel] ?? s.k,
        sessions: num(s.n),
      })),
      searchesBeforeVisiting: searches.map((s) => ({
        query: s.q,
        count: num(s.n),
      })),
      note: 'Only visitors who accepted analytics cookies on fastque.com are counted. Figures cover your salon only.',
    };
  }
}
