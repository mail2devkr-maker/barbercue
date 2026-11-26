/**
 * Real-Postgres integration test for Visitor Intelligence. Runs only when VI_TEST_DATABASE_URL names a
 * disposable, fully migrated database (e.g. postgresql://postgres:postgres@127.0.0.1:5432/visitor_intel_ci);
 * otherwise it is skipped so the default unit run needs no database.
 */
import { randomUUID } from 'node:crypto';
import {
  Role,
  resolveViRange,
  type ViCollectInput,
  type ViFilters,
} from '@barbercue/shared';

const url = process.env.VI_TEST_DATABASE_URL;
if (url) process.env.DATABASE_URL = url;

// Imported after DATABASE_URL is set so the client connects to the disposable database.
/* eslint-disable @typescript-eslint/no-require-imports */
const { PrismaService } =
  require('../prisma/prisma.service') as typeof import('../prisma/prisma.service');
const { ViConfigService } =
  require('./vi-config.service') as typeof import('./vi-config.service');
const { ViIngestService } =
  require('./vi-ingest.service') as typeof import('./vi-ingest.service');
const { ViAnalyticsService } =
  require('./vi-analytics.service') as typeof import('./vi-analytics.service');
const { ViMaintenanceService } =
  require('./vi-maintenance.service') as typeof import('./vi-maintenance.service');
const { ViSegmentsService } =
  require('./vi-segments.service') as typeof import('./vi-segments.service');
const { ViAlertsService } =
  require('./vi-alerts.service') as typeof import('./vi-alerts.service');
const { viVisitorKey } = require('./vi-common') as typeof import('./vi-common');
/* eslint-enable @typescript-eslint/no-require-imports */
import type { ViActor } from './vi-access.service';

const CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36';
const platform: ViActor = {
  userId: 'test',
  roles: [Role.PLATFORM_ADMIN],
  staffRoles: [],
  capabilities: new Set(['pii', 'overview']),
  scope: { kind: 'platform' },
};
const q = (period: ViFilters['period'] = 'today') => ({
  filters: { period } as ViFilters,
  range: resolveViRange(period, new Date()),
});

(url ? describe : describe.skip)('Visitor Intelligence (Postgres)', () => {
  const prisma = new PrismaService();
  const config = new ViConfigService(prisma);
  const ingest = new ViIngestService(prisma, config);
  const analytics = new ViAnalyticsService(prisma, config);
  const maintenance = new ViMaintenanceService(prisma, config);
  const segments = new ViSegmentsService(prisma);
  const alerts = new ViAlertsService(prisma, ingest);

  const batch = (
    visitorId: string,
    sessionId: string,
    events: ViCollectInput['events'],
    consent = true,
    ctx: Partial<ViCollectInput['context']> = {},
  ): ViCollectInput => ({
    visitorId,
    sessionId,
    consent: { analytics: consent, marketing: false },
    context: {
      landingPath: '/',
      referrer: 'https://www.instagram.com/',
      ...ctx,
    },
    events,
  });
  const ev = (
    type: ViCollectInput['events'][number]['type'],
    extra: Partial<ViCollectInput['events'][number]> = {},
  ) => ({ id: randomUUID(), type, ts: Date.now(), path: '/search', ...extra });
  const env = (
    input: ViCollectInput,
    headers: Record<string, string> = {},
  ) => ({
    input,
    userAgent: CHROME,
    headers,
    ip: '203.0.113.9',
    userId: null,
    receivedAt: new Date(),
  });

  beforeAll(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE vi_events, vi_search_events, vi_sessions, vi_visitors, vi_conversions, vi_consent_records, vi_alert_events, vi_alert_rules, vi_daily_metrics RESTART IDENTITY CASCADE',
    );
  });
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('stores nothing without analytics consent, and nothing for bots', async () => {
    const vid = randomUUID();
    expect(
      await ingest.enqueue(
        env(batch(vid, randomUUID(), [ev('page_view')], false)),
      ),
    ).toBe('no_consent');
    expect(
      await ingest.enqueue({
        ...env(batch(vid, randomUUID(), [ev('page_view')])),
        userAgent: 'Googlebot/2.1',
      }),
    ).toBe('bot');
    await ingest.flush();
    expect(
      await prisma.viVisitor.count({
        where: { visitorKey: viVisitorKey(vid) },
      }),
    ).toBe(0);
  });

  it('ingests a journey, dedupes retries, never trusts a client booking id and keeps no raw IP', async () => {
    const vid = randomUUID();
    const sid = randomUUID();
    const pv = ev('page_view', { path: '/' });
    const search = ev('search', {
      props: {
        query: 'Hair Cutting 9876543210',
        resultCount: 0,
        city: 'Indore',
        priceMax: 500,
      },
    });
    const input = batch(vid, sid, [
      pv,
      ev('location_set', { props: { city: 'Indore' } }),
      search,
      ev('salon_view', {
        entityType: 'salon',
        entityId: 'salon-a',
        salonId: 'salon-a',
      }),
      ev('booking_start'),
      ev('booking_confirmed', {
        entityType: 'booking',
        entityId: randomUUID(),
      }),
    ]);
    await ingest.process(
      env(input, { 'cf-ipcountry': 'IN', 'cf-ipcity': 'Bhopal' }),
    );
    await ingest.process(
      env(input, { 'cf-ipcountry': 'IN', 'cf-ipcity': 'Bhopal' }),
    ); // retry: no double counting

    const visitor = await prisma.viVisitor.findUniqueOrThrow({
      where: { visitorKey: viVisitorKey(vid) },
    });
    expect(visitor.sessionCount).toBe(1);
    expect(visitor.pageViews).toBe(1);
    expect(visitor.searches).toBe(1);
    expect(visitor.bookings).toBe(0); // the booking id does not exist, so no conversion and no revenue
    expect(Number(visitor.revenuePaise)).toBe(0);
    expect(visitor.firstChannel).toBe('INSTAGRAM');

    const session = await prisma.viSession.findUniqueOrThrow({
      where: { clientSessionId: sid },
    });
    expect(session.city).toBe('Indore'); // the visitor's own choice beats IP city
    expect(session.geoSource).toBe('USER_SELECTED');
    expect(session.bookingStarted).toBe(true);
    expect(session.bookingConfirmed).toBe(false);
    expect(
      await prisma.viEvent.count({ where: { sessionId: session.id } }),
    ).toBe(6);

    const s = await prisma.viSearchEvent.findFirstOrThrow({
      where: { sessionId: session.id },
    });
    expect(s.rawQuery).toBe('Hair Cutting'); // phone number removed before storage
    expect(s.category).toBe('haircut');
    expect(s.zeroResult).toBe(true);
    expect(s.ledToSalonView).toBe(true);

    const dump = JSON.stringify(
      await prisma.viEvent.findMany({ where: { sessionId: session.id } }),
    );
    expect(dump).not.toContain('203.0.113.9');
    expect(dump).not.toContain('9876543210');
    expect(await prisma.viConversion.count()).toBe(0);
  });

  it('a session id cannot be hijacked by another browser', async () => {
    const sid = randomUUID();
    await ingest.process(env(batch(randomUUID(), sid, [ev('page_view')])));
    const intruder = randomUUID();
    await ingest.process(
      env(batch(intruder, sid, [ev('page_view'), ev('page_view')])),
    );
    const session = await prisma.viSession.findUniqueOrThrow({
      where: { clientSessionId: sid },
    });
    expect(session.pageViews).toBe(1);
  });

  it('overview, live, search, geo and funnels read the stored data', async () => {
    const o = await analytics.overview(q('today'), platform);
    expect(o.kpis.uniqueVisitors.current).toBeGreaterThanOrEqual(2);
    expect(o.kpis.serviceSearches.current).toBe(1);
    expect(o.kpis.activeNow).toBeGreaterThanOrEqual(1);
    expect(o.funnel[0].sessions).toBe(o.kpis.visits.current);

    const live = await analytics.live(q('today'), platform);
    expect(live.activeCount).toBeGreaterThanOrEqual(1);
    expect(live.sessions[0].visitorLabel).toMatch(/^Guest #\d+$/);

    const search = await analytics.search(q('today'), platform);
    expect(search.top[0]).toMatchObject({
      query: 'hair cutting',
      category: 'haircut',
      zeroResult: 1,
    });

    const geo = await analytics.geo(q('today'), platform, 'city');
    expect(geo.rows.find((r) => r.key === 'Indore')?.searches).toBe(1);

    const f = await analytics.funnel(
      q('today'),
      platform,
      'SALON_BOOKING',
      'device',
    );
    expect(f.stages.find((s) => s.key === 'initiated')?.sessions).toBe(1);
    expect(f.stages.find((s) => s.key === 'confirmed')?.sessions).toBe(0);
    expect(
      f.abandonment.observed.find((r) => r.reason.startsWith('No matching'))
        ?.count,
    ).toBe(1);
  });

  it('salon and territory scopes never see other data', async () => {
    const own: ViActor = {
      ...platform,
      scope: { kind: 'salon', salonIds: ['salon-a'] },
    };
    const other: ViActor = {
      ...platform,
      scope: { kind: 'salon', salonIds: ['salon-z'] },
    };
    const territory: ViActor = {
      ...platform,
      scope: { kind: 'territory', cities: ['Pune'] },
    };
    expect(
      (await analytics.overview(q('today'), own)).kpis.visits.current,
    ).toBe(1);
    expect(
      (await analytics.overview(q('today'), other)).kpis.visits.current,
    ).toBe(0);
    expect(
      (await analytics.overview(q('today'), territory)).kpis.visits.current,
    ).toBe(0);
    await expect(analytics.visitors(q('today'), own, 1, 10)).rejects.toThrow();
  });

  it('rollups, segments, alerts and consent withdrawal work end to end', async () => {
    expect(await maintenance.rollup(new Date())).toBeGreaterThan(0);
    const total = await prisma.viDailyMetric.findFirst({
      where: { metric: 'sessions', dimType: 'all' },
    });
    expect(total?.value).toBeGreaterThanOrEqual(2);

    const counts = await segments.counts({
      base: 'abandoned_booking',
      lookbackDays: 7,
    });
    expect(counts.total).toBe(1);
    expect(counts.marketingConsented).toBe(0); // no marketing consent → not reachable

    await alerts.ensureDefaults();
    await prisma.viAlertRule.updateMany({
      where: { kind: 'ZERO_RESULT_SEARCHES' },
      data: { threshold: 1 },
    });
    expect(await alerts.evaluate()).toBeGreaterThanOrEqual(1);
    expect(
      await prisma.viAlertEvent.count({
        where: { kind: 'ZERO_RESULT_SEARCHES' },
      }),
    ).toBe(1);
    expect(await alerts.evaluate()).toBe(0); // cooldown

    const vid = randomUUID();
    await ingest.process(
      env(batch(vid, randomUUID(), [ev('page_view')], true)),
    );
    await ingest.recordConsent({
      visitorId: vid,
      analytics: false,
      marketing: false,
      policyVersion: '2026-11',
      source: 'PREFERENCES',
    });
    const v = await prisma.viVisitor.findUniqueOrThrow({
      where: { visitorKey: viVisitorKey(vid) },
    });
    expect(v.consentAnalytics).toBe(false);
  });

  it('erasure removes a visitor completely', async () => {
    const vid = randomUUID();
    await ingest.process(
      env(
        batch(vid, randomUUID(), [
          ev('page_view'),
          ev('search', { props: { query: 'facial' } }),
        ]),
      ),
    );
    const access = await maintenance.handlePrivacy(
      'ACCESS',
      { visitorId: vid },
      null,
      randomUUID(),
    );
    expect(access.matchedVisitors).toBe(1);
    await maintenance.handlePrivacy(
      'DELETE',
      { visitorId: vid },
      null,
      randomUUID(),
    );
    expect(
      await prisma.viVisitor.count({
        where: { visitorKey: viVisitorKey(vid) },
      }),
    ).toBe(0);
    expect(
      await prisma.viConsentRecord.count({
        where: { visitorKey: viVisitorKey(vid) },
      }),
    ).toBe(0);
  });

  it('retention removes raw rows older than the configured window and keeps recent ones', async () => {
    const vid = randomUUID();
    const sid = randomUUID();
    await ingest.process(
      env(batch(vid, sid, [ev('page_view'), ev('page_view', { path: '/x' })])),
    );
    const session = await prisma.viSession.findUniqueOrThrow({
      where: { clientSessionId: sid },
    });
    await prisma.viEvent.updateMany({
      where: { sessionId: session.id, path: '/x' },
      data: { occurredAt: new Date(Date.now() - 400 * 86_400_000) },
    });
    const before = await prisma.viEvent.count({
      where: { sessionId: session.id },
    });
    const removed = await maintenance.retention();
    expect(removed.events).toBeGreaterThanOrEqual(1);
    expect(
      await prisma.viEvent.count({ where: { sessionId: session.id } }),
    ).toBe(before - 1);
  });

  it('ingests 2,000 events in batches quickly (performance smoke)', async () => {
    const started = Date.now();
    for (let i = 0; i < 40; i++) {
      const vid = randomUUID();
      const sid = randomUUID();
      await ingest.process(
        env(
          batch(
            vid,
            sid,
            Array.from({ length: 50 }, (_, k) =>
              ev(k % 5 === 0 ? 'search' : 'page_view', {
                path: `/p/${k}`,
                props: { query: 'beard trim' },
              }),
            ),
          ),
        ),
      );
    }
    const ms = Date.now() - started;
    expect(
      await prisma.viEvent.count({ where: { path: { startsWith: '/p/' } } }),
    ).toBe(2000);
    // ~50 ms per 50-event batch on a laptop; generous bound so CI noise does not fail it.
    expect(ms).toBeLessThan(60_000);
    console.log(`visitor-intel perf: 2000 events / 40 batches in ${ms} ms`);
    const t = Date.now();
    await analytics.overview(q('30d'), platform);
    console.log(`visitor-intel perf: overview (30d) in ${Date.now() - t} ms`);
  });
});
