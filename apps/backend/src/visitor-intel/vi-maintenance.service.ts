import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import {
  istDateKey,
  istDayStart,
  normalizeViSearch,
  viVisitorLabel,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ViConfigService } from './vi-config.service';
import {
  num,
  viBadRequest,
  viForbidden,
  viNotFound,
  viVisitorKey,
} from './vi-common';

/** Demo rows are recognisable by this visitorKey prefix and can be removed in one action. */
export const VI_DEMO_KEY_PREFIX = 'demo';

/**
 * Background upkeep (docs/visitor-intelligence/README.md (OPERATIONS)):
 *  - nightly daily rollups into vi_daily_metrics (kept for years, after raw data is pruned),
 *  - retention clean-up in small batches, using the configured retention periods,
 *  - privacy access / deletion requests,
 *  - clearly labelled, development-only demo data.
 */
@Injectable()
export class ViMaintenanceService {
  private readonly logger = new Logger(ViMaintenanceService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ViConfigService,
  ) {}

  // ---------- Rollups ----------

  @Cron('15 19 * * *') // 00:45 IST: yesterday is complete.
  async nightly(): Promise<void> {
    if (!ViConfigService.envEnabled()) return;
    try {
      const today = istDayStart(new Date());
      for (let i = 1; i <= 3; i++)
        await this.rollup(new Date(today.getTime() - i * 86_400_000));
      await this.retention();
    } catch (e) {
      this.logger.warn(
        `nightly maintenance failed: ${e instanceof Error ? e.message : e}`,
      );
    }
  }

  /** Recomputes one IST day of rollups (idempotent). */
  async rollup(dayStart: Date): Promise<number> {
    const from = istDayStart(dayStart);
    const to = new Date(from.getTime() + 86_400_000);
    const day = new Date(`${istDateKey(from)}T00:00:00Z`);
    const dims: Array<[string, Prisma.Sql]> = [
      ['all', Prisma.sql`''`],
      ['city', Prisma.sql`COALESCE(s.city,'Unknown')`],
      ['channel', Prisma.sql`s.channel`],
      ['device', Prisma.sql`s."deviceCategory"`],
    ];
    let n = 0;
    await this.prisma.viDailyMetric.deleteMany({ where: { day } });
    for (const [dimType, expr] of dims) {
      const rows = await this.prisma.$queryRaw<
        Array<{
          k: string;
          v: bigint;
          s: bigint;
          pv: bigint;
          se: bigint;
          b: bigint;
          p: bigint;
          rev: bigint;
          reg: bigint;
        }>
      >`
        SELECT ${expr} AS k, COUNT(DISTINCT s."visitorId") AS v, COUNT(*) AS s, COALESCE(SUM(s."pageViews"),0) AS pv,
          COALESCE(SUM(cardinality(s."searchTerms")),0) AS se, COUNT(*) FILTER (WHERE s."bookingConfirmed") AS b,
          COUNT(*) FILTER (WHERE s.purchased) AS p, COALESCE(SUM(s."revenuePaise"),0) AS rev, COUNT(*) FILTER (WHERE s.registered) AS reg
        FROM vi_sessions s WHERE s."startedAt" >= ${from} AND s."startedAt" < ${to} AND s."isBot" = false GROUP BY 1`;
      const data: Prisma.ViDailyMetricCreateManyInput[] = [];
      for (const r of rows) {
        const metrics: Record<string, number> = {
          visitors: num(r.v),
          sessions: num(r.s),
          pageViews: num(r.pv),
          searches: num(r.se),
          bookings: num(r.b),
          purchases: num(r.p),
          revenuePaise: num(r.rev),
          registrations: num(r.reg),
        };
        for (const [metric, value] of Object.entries(metrics))
          data.push({
            day,
            metric,
            dimType,
            dimValue: String(r.k ?? '').slice(0, 120),
            value,
          });
      }
      if (data.length)
        n += (
          await this.prisma.viDailyMetric.createMany({
            data,
            skipDuplicates: true,
          })
        ).count;
    }
    return n;
  }

  async dailyMetrics(metric: string, dimType: string, from: Date, to: Date) {
    return this.prisma.viDailyMetric.findMany({
      where: { metric, dimType, day: { gte: from, lt: to } },
      orderBy: { day: 'asc' },
      take: 5000,
    });
  }

  // ---------- Retention ----------

  async retention(): Promise<Record<string, number>> {
    const s = await this.config.get();
    const now = Date.now();
    const cut = (days: number) => new Date(now - days * 86_400_000);
    const batch = async (sql: Prisma.Sql) => {
      let total = 0;
      for (let i = 0; i < 200; i++) {
        const n = await this.prisma.$executeRaw(sql);
        total += n;
        if (n < 10_000) break;
      }
      return total;
    };
    const events = await batch(
      Prisma.sql`DELETE FROM vi_events WHERE id IN (SELECT id FROM vi_events WHERE "occurredAt" < ${cut(s.rawEventRetentionDays)} LIMIT 10000)`,
    );
    const searches = await batch(
      Prisma.sql`DELETE FROM vi_search_events WHERE id IN (SELECT id FROM vi_search_events WHERE "occurredAt" < ${cut(s.rawEventRetentionDays)} LIMIT 10000)`,
    );
    const sessions = await batch(
      Prisma.sql`DELETE FROM vi_sessions WHERE id IN (SELECT id FROM vi_sessions WHERE "startedAt" < ${cut(s.sessionRetentionDays)} LIMIT 10000)`,
    );
    const visitors = await batch(
      Prisma.sql`DELETE FROM vi_visitors WHERE id IN (SELECT id FROM vi_visitors v WHERE v."lastSeenAt" < ${cut(s.sessionRetentionDays)} AND NOT EXISTS (SELECT 1 FROM vi_sessions x WHERE x."visitorId" = v.id) LIMIT 10000)`,
    );
    const metrics = await this.prisma.viDailyMetric.deleteMany({
      where: { day: { lt: cut(s.aggregateRetentionDays) } },
    });
    const alerts = await this.prisma.viAlertEvent.deleteMany({
      where: { firedAt: { lt: cut(365) } },
    });
    // Consent records are evidence of a choice: kept 3 years, then removed.
    const consent = await this.prisma.viConsentRecord.deleteMany({
      where: { createdAt: { lt: cut(1095) } },
    });
    return {
      events,
      searches,
      sessions,
      visitors,
      metrics: metrics.count,
      alerts: alerts.count,
      consent: consent.count,
    };
  }

  // ---------- Privacy (DPDP access / erasure) ----------

  async privacyRequests() {
    return this.prisma.viPrivacyRequest.findMany({
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  /** Access: everything held about a browser or account. Delete: removes it (bookings themselves are untouched). */
  async handlePrivacy(
    type: 'ACCESS' | 'DELETE',
    ids: { visitorId?: string; userId?: string },
    note: string | null | undefined,
    actorUserId: string,
  ) {
    const visitorKey = ids.visitorId ? viVisitorKey(ids.visitorId) : null;
    const visitors = await this.prisma.viVisitor.findMany({
      where: {
        OR: [
          ...(visitorKey ? [{ visitorKey }] : []),
          ...(ids.userId ? [{ userId: ids.userId }] : []),
        ],
      },
    });
    const visitorIds = visitors.map((v) => v.id);
    let result: Record<string, unknown>;
    if (type === 'ACCESS') {
      const [sessions, events, searches, conversions, consents, prefs] =
        await Promise.all([
          this.prisma.viSession.findMany({
            where: { visitorId: { in: visitorIds } },
            take: 1000,
          }),
          this.prisma.viEvent.findMany({
            where: { visitorId: { in: visitorIds } },
            take: 5000,
            orderBy: { occurredAt: 'asc' },
            select: {
              type: true,
              occurredAt: true,
              path: true,
              entityType: true,
              entityId: true,
              city: true,
              metadata: true,
            },
          }),
          this.prisma.viSearchEvent.findMany({
            where: { visitorId: { in: visitorIds } },
            take: 2000,
            select: {
              occurredAt: true,
              rawQuery: true,
              city: true,
              resultCount: true,
            },
          }),
          this.prisma.viConversion.findMany({
            where: { visitorId: { in: visitorIds } },
          }),
          visitorKey
            ? this.prisma.viConsentRecord.findMany({ where: { visitorKey } })
            : Promise.resolve([]),
          ids.userId
            ? this.prisma.viMarketingPreference.findMany({
                where: { userId: ids.userId },
              })
            : Promise.resolve([]),
        ]);
      result = JSON.parse(
        JSON.stringify(
          {
            visitors: visitors.map((v) => ({
              ...v,
              label: viVisitorLabel(v.guestNumber),
            })),
            sessions,
            events,
            searches,
            conversions,
            consents,
            marketingPreferences: prefs,
          },
          (_k, v: unknown) => (typeof v === 'bigint' ? Number(v) : v),
        ),
      ) as Record<string, unknown>;
    } else {
      const [ev, se, cv] = await this.prisma.$transaction([
        this.prisma.viEvent.deleteMany({
          where: { visitorId: { in: visitorIds } },
        }),
        this.prisma.viSearchEvent.deleteMany({
          where: { visitorId: { in: visitorIds } },
        }),
        this.prisma.viConversion.deleteMany({
          where: { visitorId: { in: visitorIds } },
        }),
      ]);
      const vs = await this.prisma.viVisitor.deleteMany({
        where: { id: { in: visitorIds } },
      }); // sessions cascade
      if (visitorKey)
        await this.prisma.viConsentRecord.deleteMany({ where: { visitorKey } });
      if (ids.userId)
        await this.prisma.viMarketingPreference.updateMany({
          where: { userId: ids.userId },
          data: { optedIn: false, suppressed: true, reason: 'Erasure request' },
        });
      result = {
        deleted: {
          visitors: vs.count,
          events: ev.count,
          searches: se.count,
          conversions: cv.count,
        },
        note: 'Bookings, orders and the account itself are managed by their own modules and were not changed.',
      };
    }
    const row = await this.prisma.viPrivacyRequest.create({
      data: {
        type,
        visitorKey,
        userId: ids.userId ?? null,
        status: 'COMPLETED',
        note: note ?? null,
        result: (type === 'ACCESS'
          ? { visitors: visitors.length }
          : result) as Prisma.InputJsonValue,
        requestedByUserId: actorUserId,
        completedAt: new Date(),
      },
    });
    await this.prisma.auditLog
      .create({
        data: {
          actorUserId,
          action: `VI_PRIVACY_${type}`,
          entityType: 'VISITOR_INTELLIGENCE',
          entityId: row.id,
          metadata: { visitors: visitors.length },
        },
      })
      .catch(() => undefined);
    return {
      requestId: row.id,
      type,
      matchedVisitors: visitors.length,
      result,
    };
  }

  // ---------- Demo data (development only) ----------

  static demoAllowed(): boolean {
    return (
      process.env.NODE_ENV !== 'production' &&
      process.env.VI_DEMO_DATA_ENABLED === 'true'
    );
  }

  async demoStatus() {
    const n = await this.prisma.viVisitor.count({
      where: { visitorKey: { startsWith: VI_DEMO_KEY_PREFIX } },
    });
    return { allowed: ViMaintenanceService.demoAllowed(), demoVisitors: n };
  }

  async clearDemo(): Promise<{ removed: number }> {
    const visitors = await this.prisma.viVisitor.findMany({
      where: { visitorKey: { startsWith: VI_DEMO_KEY_PREFIX } },
      select: { id: true },
    });
    const ids = visitors.map((v) => v.id);
    if (!ids.length) return { removed: 0 };
    await this.prisma.viEvent.deleteMany({ where: { visitorId: { in: ids } } });
    await this.prisma.viSearchEvent.deleteMany({
      where: { visitorId: { in: ids } },
    });
    await this.prisma.viConversion.deleteMany({
      where: { visitorId: { in: ids } },
    });
    await this.prisma.viCampaign.deleteMany({
      where: { code: { startsWith: 'demo-' } },
    });
    const r = await this.prisma.viVisitor.deleteMany({
      where: { id: { in: ids } },
    });
    return { removed: r.count };
  }

  /** Synthetic, labelled demo traffic so dashboards can be reviewed locally. Never available in production. */
  async seedDemo(
    visitors = 400,
  ): Promise<{ visitors: number; sessions: number; events: number }> {
    if (!ViMaintenanceService.demoAllowed())
      throw viForbidden(
        'Demo data is only available in development with VI_DEMO_DATA_ENABLED=true.',
      );
    if (visitors < 1 || visitors > 5000)
      throw viBadRequest('1 to 5000 visitors.');
    await this.clearDemo();
    const rnd = mulberry32(42);
    const pick = <T>(a: readonly T[]) => a[Math.floor(rnd() * a.length)];
    const cities = [
      ['Indore', 'Madhya Pradesh', 5],
      ['Delhi', 'Delhi', 6],
      ['Gurugram', 'Haryana', 4],
      ['Noida', 'Uttar Pradesh', 4],
      ['Bhopal', 'Madhya Pradesh', 3],
      ['Mumbai', 'Maharashtra', 5],
      ['Pune', 'Maharashtra', 3],
      ['Jaipur', 'Rajasthan', 2],
      ['Lucknow', 'Uttar Pradesh', 2],
      ['Bengaluru', 'Karnataka', 4],
    ] as const;
    const weighted = cities.flatMap(
      (c) => Array(c[2]).fill(c) as Array<(typeof cities)[number]>,
    );
    const channels = [
      'GOOGLE_ORGANIC',
      'GOOGLE_ORGANIC',
      'DIRECT',
      'DIRECT',
      'INSTAGRAM',
      'WHATSAPP',
      'FACEBOOK',
      'SALON_QR',
      'GOOGLE_ADS',
      'META_ADS',
      'REFERRAL',
      'FIELD_SALES',
    ];
    const queries = [
      'haircut',
      'hair cut near me',
      'beard trim',
      'facial',
      'face treatment',
      'bridal makeup',
      'wedding makeup',
      'hair spa',
      'keratin',
      'hair colour',
      'pedicure',
      'threading',
      'head massage',
      'smoothening',
      'nail art',
    ];
    const devices = ['mobile', 'mobile', 'mobile', 'desktop', 'tablet'];
    const campaign = await this.prisma.viCampaign.create({
      data: {
        code: 'demo-indore-pamphlet',
        name: '[DEMO] Indore pamphlet QR',
        kind: 'PAMPHLET_QR',
        landingPath: '/search',
        utmSource: 'qr',
        utmMedium: 'qr',
        utmCampaign: 'demo-indore',
        city: 'Indore',
        createdByUserId: 'demo',
      },
    });
    let sessionsN = 0;
    let eventsN = 0;
    const now = Date.now();
    for (let i = 0; i < visitors; i++) {
      const [city, state] = pick(weighted);
      const device = pick(devices);
      const v = await this.prisma.viVisitor.create({
        data: {
          visitorKey:
            `${VI_DEMO_KEY_PREFIX}${randomUUID().replace(/-/g, '')}`.slice(
              0,
              64,
            ),
          country: 'India',
          state,
          city,
          deviceCategory: device,
          consentAnalytics: true,
          consentMarketing: rnd() < 0.4,
          firstSeenAt: new Date(now - rnd() * 60 * 86_400_000),
        },
      });
      const nSessions = 1 + Math.floor(rnd() ** 2 * 5);
      for (let k = 0; k < nSessions; k++) {
        const start = new Date(
          Math.max(v.firstSeenAt.getTime(), now - rnd() * 30 * 86_400_000) +
            (i === 0 && k === 0 ? 0 : 0),
        );
        const recent = rnd() < 0.03;
        const startedAt = recent ? new Date(now - rnd() * 4 * 60_000) : start;
        const channel =
          city === 'Indore' && rnd() < 0.25 ? 'SALON_QR' : pick(channels);
        const searched = rnd() < 0.6;
        const viewed = searched && rnd() < 0.55;
        const started = viewed && rnd() < 0.35;
        const confirmed = started && rnd() < 0.55;
        const value = confirmed
          ? BigInt(Math.round(200 + rnd() * 1800) * 100)
          : 0n;
        const q = searched ? pick(queries) : null;
        const pv = 1 + Math.floor(rnd() * 8);
        const s = await this.prisma.viSession.create({
          data: {
            clientSessionId: randomUUID(),
            visitorId: v.id,
            startedAt,
            lastActivityAt: new Date(startedAt.getTime() + pv * 40_000),
            engagedMs: Math.round(rnd() * 300_000),
            pageViews: pv,
            eventCount: pv + 3,
            entryPath: pick([
              '/',
              '/search',
              '/delhi-ncr',
              '/services/haircut',
              '/shop',
              '/list-your-salon',
            ]),
            currentPath: pick(['/search', '/book/demo-salon', '/', '/shop']),
            channel,
            campaignId:
              channel === 'SALON_QR' && city === 'Indore' ? campaign.id : null,
            deviceCategory: device,
            browser: pick(['Chrome', 'Chrome', 'Safari', 'Samsung Internet']),
            os:
              device === 'desktop'
                ? 'Windows'
                : pick(['Android', 'Android', 'iOS']),
            country: 'India',
            state,
            city,
            geoSource: rnd() < 0.5 ? 'USER_SELECTED' : 'CDN_HEADER',
            isNewVisitor: k === 0,
            searched,
            viewedSalon: viewed,
            bookingStarted: started,
            bookingConfirmed: confirmed,
            registered: confirmed && rnd() < 0.3,
            revenuePaise: value,
            searchTerms: q ? [q] : [],
            salonsViewed: viewed ? 1 + Math.floor(rnd() * 3) : 0,
            addedToCart: rnd() < 0.05,
          },
        });
        sessionsN++;
        const evs: Prisma.ViEventCreateManyInput[] = [
          {
            clientEventId: randomUUID(),
            visitorId: v.id,
            sessionId: s.id,
            type: 'page_view',
            occurredAt: startedAt,
            path: s.entryPath ?? '/',
            city,
            channel,
            deviceCategory: device,
            module: 'CONTENT',
          },
        ];
        let t = startedAt.getTime();
        const push = (
          type: string,
          extra: Partial<Prisma.ViEventCreateManyInput> = {},
        ) => {
          t += 20_000 + rnd() * 60_000;
          evs.push({
            clientEventId: randomUUID(),
            visitorId: v.id,
            sessionId: s.id,
            type,
            occurredAt: new Date(t),
            path: '/search',
            city,
            channel,
            deviceCategory: device,
            module: 'SALON_BOOKING',
            ...extra,
          });
        };
        if (rnd() < 0.5) push('location_set', { metadata: { city } });
        if (q) {
          const zero =
            rnd() < (q === 'nail art' || q === 'keratin' ? 0.7 : 0.12);
          push('search', {
            metadata: {
              query: q,
              resultCount: zero ? 0 : 3 + Math.floor(rnd() * 20),
            },
          });
          const n = normalizeViSearch(q);
          await this.prisma.viSearchEvent.create({
            data: {
              eventId: randomUUID(),
              visitorId: v.id,
              sessionId: s.id,
              occurredAt: new Date(t),
              kind: 'SERVICE',
              rawQuery: n.original,
              normalizedQuery: n.normalized,
              category: n.category,
              city,
              state,
              country: 'India',
              resultCount: zero ? 0 : 5,
              zeroResult: zero,
              ledToSalonView: viewed,
              ledToBooking: confirmed,
              priceMinInr: rnd() < 0.3 ? 200 : null,
              priceMaxInr: rnd() < 0.3 ? 800 + Math.round(rnd() * 1500) : null,
            },
          });
          if (!zero) push('search_results', { metadata: { resultCount: 5 } });
        }
        if (viewed)
          push('salon_view', { entityType: 'salon', entityId: 'demo-salon' });
        if (viewed && rnd() < 0.4) push('price_compare');
        if (started) push('booking_start');
        if (started && !confirmed && rnd() < 0.3)
          push(rnd() < 0.5 ? 'payment_failed' : 'booking_failed', {
            metadata: { reason: 'no_slots' },
          });
        if (confirmed) {
          push('booking_confirmed', {
            entityType: 'booking',
            entityId: `demo-${s.id}`,
          });
          await this.prisma.viConversion.create({
            data: {
              type: 'BOOKING',
              entityId: `demo-${s.id}`,
              visitorId: v.id,
              sessionId: s.id,
              city,
              valuePaise: value,
              occurredAt: new Date(t),
              firstChannel: channel,
              lastChannel: channel,
              lastCampaignId: s.campaignId,
              module: 'SALON_BOOKING',
            },
          });
        }
        await this.prisma.viEvent.createMany({ data: evs });
        eventsN += evs.length;
      }
      await this.prisma.viVisitor.update({
        where: { id: v.id },
        data: {
          sessionCount: nSessions,
          lastSeenAt: new Date(now - rnd() * 5 * 86_400_000),
          firstChannel: pick(channels),
          lastChannel: pick(channels),
        },
      });
    }
    return { visitors, sessions: sessionsN, events: eventsN };
  }
}

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export { viNotFound };
