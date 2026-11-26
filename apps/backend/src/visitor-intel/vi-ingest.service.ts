import { Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Prisma, ViConversionType, ViGeoSource } from '@prisma/client';
import {
  VI_CONSENT_POLICY_VERSION,
  classifyViChannel,
  normalizeViSearch,
  parseViUserAgent,
  referrerDomain,
  sanitizeViProps,
  type ViCampaignKind,
  type ViCollectInput,
  type ViConsentInput,
  type ViEventInput,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { ViConfigService } from './vi-config.service';
import {
  countryFromTimezone,
  geoFromHeaders,
  geoFromIp,
  type ViGeo,
} from './vi-geo';
import { viVisitorKey } from './vi-common';
import { ViIntegrationsService } from './vi-integrations.service';

export interface ViEnvelope {
  input: ViCollectInput;
  userAgent: string | null;
  headers: Record<string, string | string[] | undefined>;
  /** Used only for an in-memory geo lookup; never persisted. */
  ip: string | null;
  userId: string | null;
  receivedAt: Date;
}

export type ViEnqueueResult =
  'queued' | 'no_consent' | 'bot' | 'sampled_out' | 'disabled' | 'overloaded';

const MAX_QUEUE = 5_000;
const FLUSH_MS = 500;
const SESSION_RANK: Record<ViGeoSource, number> = {
  NONE: 0,
  CDN_HEADER: 1,
  OFFLINE_DB: 1,
  USER_SELECTED: 2,
  BROWSER_PERMISSION: 3,
};
const CAMPAIGN_KINDS_TTL_MS = 60_000;

interface SessionDelta {
  pageViews: number;
  engagedMs: number;
  eventCount: number;
  currentPath?: string;
  previousPath?: string | null;
  searched?: boolean;
  viewedSalon?: boolean;
  bookingStarted?: boolean;
  bookingConfirmed?: boolean;
  bookingFailed?: boolean;
  addedToCart?: boolean;
  checkoutStarted?: boolean;
  purchased?: boolean;
  registered?: boolean;
  revenuePaise: bigint;
  searchTerms: string[];
  salonsViewed: number;
  productsViewed: number;
  city?: string | null;
  state?: string | null;
  country?: string | null;
  geoSource?: ViGeoSource;
}

/**
 * First-party event ingestion (docs/visitor-intelligence/README.md (ARCHITECTURE) §Ingestion).
 * The HTTP handler validates and enqueues, then returns 202 immediately; a single worker per
 * instance drains the queue every 500 ms in arrival order. Every event carries a client UUID, so
 * retries and duplicate beacons are dropped. Money is never taken from the browser: bookings and
 * orders are re-read from their own tables before they count as revenue.
 */
@Injectable()
export class ViIngestService implements OnModuleDestroy {
  private readonly logger = new Logger(ViIngestService.name);
  private queue: ViEnvelope[] = [];
  private timer: NodeJS.Timeout | null = null;
  private flushing: Promise<void> | null = null;
  private campaignCache = new Map<
    string,
    { at: number; id: string | null; kind: ViCampaignKind | null }
  >();
  private lastLiveEmit = 0;
  /** In-memory health counters (exposed on the settings page). */
  readonly stats = {
    accepted: 0,
    processed: 0,
    dropped: 0,
    bots: 0,
    noConsent: 0,
    sampledOut: 0,
    errors: 0,
    lastError: null as string | null,
    lastFlushAt: null as string | null,
  };
  private readonly ownHosts = (
    process.env.VI_OWN_HOSTS ?? 'fastque.com,fastque.in,localhost,127.0.0.1'
  )
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ViConfigService,
    @Optional() private readonly realtime?: RealtimeGateway,
    @Optional() private readonly integrations?: ViIntegrationsService,
  ) {}

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    await this.flush();
  }

  get queueLength(): number {
    return this.queue.length;
  }

  async enqueue(env: ViEnvelope): Promise<ViEnqueueResult> {
    if (!ViConfigService.envEnabled()) return 'disabled';
    const settings = await this.config.get();
    if (!settings.trackingEnabled) return 'disabled';
    // Consent first: without analytics consent nothing is stored, not even a counter row.
    if (!env.input.consent.analytics) {
      this.stats.noConsent++;
      return 'no_consent';
    }
    const ua = parseViUserAgent(env.userAgent);
    if (ua.bot) {
      this.stats.bots++;
      return 'bot';
    }
    // Deterministic per-visitor sampling keeps whole journeys intact at high volume.
    if (settings.samplingRate < 1) {
      const bucket =
        parseInt(
          createHash('sha1')
            .update(env.input.visitorId)
            .digest('hex')
            .slice(0, 8),
          16,
        ) / 0xffffffff;
      if (bucket >= settings.samplingRate) {
        this.stats.sampledOut++;
        return 'sampled_out';
      }
    }
    if (this.queue.length >= MAX_QUEUE) {
      this.stats.dropped++;
      return 'overloaded';
    }
    this.queue.push(env);
    this.stats.accepted++;
    this.schedule();
    return 'queued';
  }

  private schedule(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, FLUSH_MS);
  }

  /** Drains the queue. Safe to call concurrently (one drain at a time). */
  async flush(): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = (async () => {
      while (this.queue.length) {
        const batch = this.queue.splice(0, 200);
        for (const env of batch) {
          try {
            await this.process(env);
            this.stats.processed++;
          } catch (e) {
            this.stats.errors++;
            this.stats.lastError =
              e instanceof Error ? e.message.slice(0, 300) : 'unknown';
            this.logger.warn(
              `visitor-intel batch failed: ${this.stats.lastError}`,
            );
          }
        }
      }
      this.stats.lastFlushAt = new Date().toISOString();
      this.emitLive();
    })().finally(() => {
      this.flushing = null;
    });
    return this.flushing;
  }

  private emitLive(): void {
    if (!this.realtime?.server || Date.now() - this.lastLiveEmit < 2_000)
      return;
    this.lastLiveEmit = Date.now();
    try {
      this.realtime.server
        .to('vi:live')
        .emit('vi.live.updated', { revision: this.lastLiveEmit });
    } catch {
      // Live push is best-effort; the dashboard also polls.
    }
  }

  private async campaign(
    code: string | null | undefined,
  ): Promise<{ id: string | null; kind: ViCampaignKind | null }> {
    if (!code) return { id: null, kind: null };
    const key = code.trim().toLowerCase().slice(0, 40);
    const hit = this.campaignCache.get(key);
    if (hit && Date.now() - hit.at < CAMPAIGN_KINDS_TTL_MS) return hit;
    const row = await this.prisma.viCampaign.findUnique({
      where: { code: key },
      select: { id: true, kind: true, status: true },
    });
    const value = {
      at: Date.now(),
      id: row && row.status !== 'ARCHIVED' ? row.id : null,
      kind:
        row && row.status !== 'ARCHIVED' ? (row.kind as ViCampaignKind) : null,
    };
    this.campaignCache.set(key, value);
    return value;
  }

  private async geo(env: ViEnvelope): Promise<ViGeo> {
    const fromHeaders = geoFromHeaders(env.headers);
    if (fromHeaders) return fromHeaders;
    const fromDb = await geoFromIp(env.ip);
    if (fromDb) return fromDb;
    const country = countryFromTimezone(env.input.context.timezone);
    return {
      country,
      state: null,
      city: null,
      source: country ? 'CDN_HEADER' : 'NONE',
    };
  }

  /** Processes one browser batch. Public for tests. */
  async process(env: ViEnvelope): Promise<void> {
    const { input } = env;
    const ctx = input.context;
    const now = env.receivedAt;
    const visitorKey = viVisitorKey(input.visitorId);
    const ua = parseViUserAgent(env.userAgent, ctx.screenWidth ?? null);
    const geo = await this.geo(env);
    const camp = await this.campaign(ctx.campaignCode);
    const refDomain = referrerDomain(ctx.referrer, this.ownHosts);
    const channel = classifyViChannel({
      utmSource: ctx.utmSource,
      utmMedium: ctx.utmMedium,
      referrerDomain: refDomain,
      gclid: !!ctx.gclid,
      fbclid: !!ctx.fbclid,
      campaignKind: camp.kind,
    });
    const source = ctx.utmSource ?? refDomain ?? null;
    const campaignName = ctx.utmCampaign ?? null;

    // ---- visitor ----
    const visitor = await this.prisma.viVisitor.upsert({
      where: { visitorKey },
      create: {
        visitorKey,
        firstChannel: channel,
        firstSource: source,
        firstCampaign: campaignName,
        firstCampaignId: camp.id,
        lastChannel: channel,
        lastSource: source,
        lastCampaign: campaignName,
        lastCampaignId: camp.id,
        country: geo.country,
        state: geo.state,
        city: geo.city,
        deviceCategory: ua.device,
        consentAnalytics: true,
        consentMarketing: input.consent.marketing,
        firstSeenAt: now,
        lastSeenAt: now,
      },
      update: {
        lastSeenAt: now,
        consentAnalytics: true,
        consentMarketing: input.consent.marketing,
        deviceCategory: ua.device,
      },
    });

    // ---- session ----
    let session = await this.prisma.viSession.findUnique({
      where: { clientSessionId: input.sessionId },
    });
    if (session && session.visitorId !== visitor.id) return; // a session id can never move between browsers
    if (!session) {
      const firstTs = Math.min(...input.events.map((e) => e.ts));
      const startedAt = this.clampTs(firstTs, now);
      session = await this.prisma.viSession.upsert({
        where: { clientSessionId: input.sessionId },
        create: {
          clientSessionId: input.sessionId,
          visitorId: visitor.id,
          startedAt,
          lastActivityAt: startedAt,
          entryPath: (ctx.landingPath ?? input.events[0].path).slice(0, 300),
          referrerDomain: refDomain,
          channel,
          utmSource: ctx.utmSource ?? null,
          utmMedium: ctx.utmMedium ?? null,
          utmCampaign: ctx.utmCampaign ?? null,
          utmContent: ctx.utmContent ?? null,
          utmTerm: ctx.utmTerm ?? null,
          campaignId: camp.id,
          clickIdType: ctx.gclid ? 'gclid' : ctx.fbclid ? 'fbclid' : null,
          deviceCategory: ua.device,
          browser: ua.browser,
          os: ua.os,
          country: geo.country,
          state: geo.state,
          city: geo.city,
          geoSource: geo.source,
          isNewVisitor: visitor.sessionCount === 0,
        },
        update: {},
      });
      const touched = channel !== 'DIRECT' || !!camp.id;
      await this.prisma.viVisitor.update({
        where: { id: visitor.id },
        data: {
          sessionCount: { increment: 1 },
          ...(touched
            ? {
                lastChannel: channel,
                lastSource: source,
                lastCampaign: campaignName,
                lastCampaignId: camp.id,
              }
            : {}),
          ...(geo.city || !visitor.country
            ? {
                country: geo.country ?? visitor.country,
                state: geo.state ?? visitor.state,
                city: geo.city ?? visitor.city,
              }
            : {}),
        },
      });
    }

    // ---- identity link (only with analytics consent, which every processed batch has) ----
    let userId: string | null = session.userId;
    if (env.userId && (!visitor.userId || visitor.userId === env.userId)) {
      userId = env.userId;
      if (!visitor.userId)
        await this.prisma.viVisitor.update({
          where: { id: visitor.id },
          data: { userId, linkedAt: now },
        });
    }

    // ---- events (dedupe on client UUID) ----
    const ids = input.events.map((e) => e.id);
    const seen = new Set(
      (
        await this.prisma.viEvent.findMany({
          where: { clientEventId: { in: ids } },
          select: { clientEventId: true },
        })
      ).map((r) => r.clientEventId),
    );
    const fresh = input.events
      .filter((e) => !seen.has(e.id))
      .sort((a, b) => a.ts - b.ts);
    if (!fresh.length) return;

    const delta: SessionDelta = {
      pageViews: 0,
      engagedMs: 0,
      eventCount: 0,
      revenuePaise: 0n,
      searchTerms: [],
      salonsViewed: 0,
      productsViewed: 0,
    };
    let currentPath = session.currentPath;
    let lastTs = session.lastActivityAt;
    const visitorInc = {
      pageViews: 0,
      searches: 0,
      salonViews: 0,
      productViews: 0,
      bookingAttempts: 0,
      bookings: 0,
      purchases: 0,
      revenue: 0n,
      engaged: 0,
    };
    const searchRows: Prisma.ViSearchEventCreateManyInput[] = [];
    const eventRows: Prisma.ViEventCreateManyInput[] = [];
    const categories: string[] = [];
    let priceMin: number | null = null;
    let priceMax: number | null = null;
    let city = session.city;
    let geoSource = session.geoSource;
    const conversions: Array<() => Promise<void>> = [];
    const verified = new Map<string, bigint>();

    for (const e of fresh) {
      const at = this.clampTs(e.ts, now);
      if (at > lastTs) lastTs = at;
      const props = sanitizeViProps(e.props);
      const eventId = createUuidFrom(e.id);
      delta.eventCount++;
      switch (e.type) {
        case 'page_view':
          delta.pageViews++;
          visitorInc.pageViews++;
          if (currentPath !== e.path) {
            delta.previousPath = currentPath;
            currentPath = e.path;
            delta.currentPath = e.path;
          }
          break;
        case 'engagement': {
          const ms =
            typeof props.engagedMs === 'number'
              ? Math.max(0, Math.min(30 * 60_000, Math.round(props.engagedMs)))
              : 0;
          delta.engagedMs += ms;
          visitorInc.engaged += ms;
          break;
        }
        case 'search': {
          const q = typeof props.query === 'string' ? props.query : '';
          const n = normalizeViSearch(q);
          if (!n.normalized) break;
          delta.searched = true;
          visitorInc.searches++;
          if (delta.searchTerms.length < 10) delta.searchTerms.push(n.original);
          if (n.category) categories.push(n.category);
          const pMin =
            typeof props.priceMin === 'number'
              ? Math.round(props.priceMin)
              : null;
          const pMax =
            typeof props.priceMax === 'number'
              ? Math.round(props.priceMax)
              : null;
          if (pMin != null)
            priceMin = priceMin == null ? pMin : Math.min(priceMin, pMin);
          if (pMax != null)
            priceMax = priceMax == null ? pMax : Math.max(priceMax, pMax);
          const resultCount =
            typeof props.resultCount === 'number'
              ? Math.max(0, Math.round(props.resultCount))
              : null;
          const locationText =
            typeof props.location === 'string'
              ? props.location.slice(0, 120)
              : null;
          searchRows.push({
            eventId,
            visitorId: visitor.id,
            sessionId: session.id,
            occurredAt: at,
            kind:
              typeof props.searchKind === 'string' &&
              /^[A-Z_]{3,20}$/.test(props.searchKind)
                ? props.searchKind
                : 'SERVICE',
            rawQuery: n.original,
            normalizedQuery: n.normalized.slice(0, 120),
            category: n.category,
            locationText,
            country: session.country,
            state: session.state,
            city: (typeof props.city === 'string' && props.city) || city,
            filters: pickFilters(props),
            priceMinInr: pMin,
            priceMaxInr: pMax,
            resultCount,
            zeroResult: resultCount === 0,
          });
          break;
        }
        case 'search_results': {
          const rc =
            typeof props.resultCount === 'number'
              ? Math.max(0, Math.round(props.resultCount))
              : null;
          const last = searchRows[searchRows.length - 1];
          if (last && rc != null) {
            last.resultCount = rc;
            last.zeroResult = rc === 0;
          } else if (rc != null) {
            await this.prisma
              .$executeRaw`UPDATE vi_search_events SET "resultCount" = ${rc}, "zeroResult" = ${rc === 0}
              WHERE id = (SELECT id FROM vi_search_events WHERE "sessionId" = ${session.id}::uuid ORDER BY "occurredAt" DESC LIMIT 1)`;
          }
          break;
        }
        case 'location_set':
        case 'near_me': {
          const chosen =
            typeof props.city === 'string' && props.city
              ? props.city.slice(0, 80)
              : null;
          const src: ViGeoSource =
            e.type === 'near_me' ? 'BROWSER_PERMISSION' : 'USER_SELECTED';
          let resolved = chosen;
          if (
            !resolved &&
            e.type === 'near_me' &&
            typeof props.lat === 'number' &&
            typeof props.lng === 'number'
          ) {
            resolved = await this.nearestCity(props.lat, props.lng);
          }
          if (resolved && SESSION_RANK[src] >= SESSION_RANK[geoSource]) {
            city = resolved;
            geoSource = src;
            delta.city = resolved;
            delta.geoSource = src;
          }
          // Coordinates are never stored: only the resolved city name.
          delete props.lat;
          delete props.lng;
          break;
        }
        case 'salon_view':
          delta.viewedSalon = true;
          delta.salonsViewed++;
          visitorInc.salonViews++;
          break;
        case 'product_view':
          delta.productsViewed++;
          visitorInc.productViews++;
          break;
        case 'add_to_cart':
          delta.addedToCart = true;
          break;
        case 'checkout_start':
          delta.checkoutStarted = true;
          break;
        case 'booking_start':
          delta.bookingStarted = true;
          visitorInc.bookingAttempts++;
          break;
        case 'booking_failed':
        case 'payment_failed':
          delta.bookingFailed = true;
          break;
        case 'booking_confirmed':
          delta.bookingStarted = true;
          if (e.entityId) {
            const booking = await this.verifyBooking(e.entityId, userId, now);
            if (booking) {
              delta.bookingConfirmed = true;
              delta.revenuePaise += booking.valuePaise;
              visitorInc.bookings++;
              visitorInc.revenue += booking.valuePaise;
              e.salonId = booking.salonId;
              verified.set(e.id, booking.valuePaise);
              conversions.push(() =>
                this.recordConversion(
                  'BOOKING',
                  booking.id,
                  booking.valuePaise,
                  at,
                  visitor,
                  session,
                  userId,
                  booking.salonId,
                  booking.city,
                  'SALON_BOOKING',
                ),
              );
            }
          }
          break;
        case 'queue_join':
          if (e.entityId) {
            const entry = await this.prisma.queueEntry
              .findUnique({
                where: { id: e.entityId },
                select: { id: true, salonId: true, joinedAt: true },
              })
              .catch(() => null);
            if (
              entry &&
              Math.abs(entry.joinedAt.getTime() - now.getTime()) < 48 * 3600_000
            ) {
              e.salonId = entry.salonId;
              conversions.push(() =>
                this.recordConversion(
                  'QUEUE_JOIN',
                  entry.id,
                  0n,
                  at,
                  visitor,
                  session,
                  userId,
                  entry.salonId,
                  null,
                  'LIVE_QUEUE',
                ),
              );
            }
          }
          break;
        case 'purchase':
          if (e.entityId) {
            const order = await this.verifyOrder(e.entityId, userId, now);
            if (order) {
              delta.purchased = true;
              delta.revenuePaise += order.valuePaise;
              visitorInc.purchases++;
              visitorInc.revenue += order.valuePaise;
              verified.set(e.id, order.valuePaise);
              conversions.push(() =>
                this.recordConversion(
                  'PURCHASE',
                  order.id,
                  order.valuePaise,
                  at,
                  visitor,
                  session,
                  userId,
                  null,
                  null,
                  'MARKETPLACE',
                ),
              );
            }
          }
          break;
        case 'sign_up':
          if (userId) {
            const user = await this.prisma.user.findUnique({
              where: { id: userId },
              select: { createdAt: true },
            });
            if (
              user &&
              now.getTime() - user.createdAt.getTime() < 48 * 3600_000
            ) {
              delta.registered = true;
              conversions.push(() =>
                this.recordConversion(
                  'REGISTRATION',
                  userId,
                  0n,
                  at,
                  visitor,
                  session,
                  userId,
                  null,
                  null,
                  'CONTENT',
                ),
              );
            }
          }
          break;
        case 'partner_registration':
          if (e.entityId)
            conversions.push(() =>
              this.recordConversion(
                'PARTNER_REGISTRATION',
                e.entityId!,
                0n,
                at,
                visitor,
                session,
                userId,
                null,
                null,
                'PARTNER',
              ),
            );
          break;
        default:
          break;
      }
      eventRows.push({
        id: eventId,
        clientEventId: e.id,
        visitorId: visitor.id,
        sessionId: session.id,
        userId,
        type: e.type,
        occurredAt: at,
        receivedAt: now,
        module: e.module ?? moduleFor(e),
        path: e.path.slice(0, 300),
        entityType: e.entityType ?? null,
        entityId: e.entityId ?? null,
        salonId: e.salonId ?? null,
        country: session.country,
        state: session.state,
        city,
        geoSource,
        channel: session.channel,
        campaignId: session.campaignId,
        deviceCategory: session.deviceCategory,
        consentStatus: input.consent.marketing
          ? 'analytics+marketing'
          : 'analytics',
        metadata: Object.keys(props).length ? props : Prisma.JsonNull,
      });
    }

    await this.prisma.viEvent.createMany({
      data: eventRows,
      skipDuplicates: true,
    });
    if (searchRows.length)
      await this.prisma.viSearchEvent.createMany({
        data: searchRows,
        skipDuplicates: true,
      });
    if (delta.viewedSalon)
      await this.markSearches(session.id, 'ledToSalonView');
    if (delta.bookingConfirmed)
      await this.markSearches(session.id, 'ledToBooking');
    if (delta.purchased) await this.markSearches(session.id, 'ledToPurchase');

    const terms = delta.searchTerms.length
      ? [...session.searchTerms, ...delta.searchTerms].slice(-10)
      : undefined;
    await this.prisma.viSession.update({
      where: { id: session.id },
      data: {
        lastActivityAt: lastTs,
        userId,
        pageViews: { increment: delta.pageViews },
        engagedMs: { increment: delta.engagedMs },
        eventCount: { increment: delta.eventCount },
        salonsViewed: { increment: delta.salonsViewed },
        productsViewed: { increment: delta.productsViewed },
        revenuePaise: { increment: delta.revenuePaise },
        ...(delta.currentPath
          ? {
              currentPath: delta.currentPath.slice(0, 300),
              previousPath: delta.previousPath?.slice(0, 300) ?? null,
            }
          : {}),
        ...(terms ? { searchTerms: terms } : {}),
        ...(delta.searched ? { searched: true } : {}),
        ...(delta.viewedSalon ? { viewedSalon: true } : {}),
        ...(delta.bookingStarted ? { bookingStarted: true } : {}),
        ...(delta.bookingConfirmed ? { bookingConfirmed: true } : {}),
        ...(delta.bookingFailed ? { bookingFailed: true } : {}),
        ...(delta.addedToCart ? { addedToCart: true } : {}),
        ...(delta.checkoutStarted ? { checkoutStarted: true } : {}),
        ...(delta.purchased ? { purchased: true } : {}),
        ...(delta.registered ? { registered: true } : {}),
        ...(delta.city ? { city: delta.city, geoSource: delta.geoSource } : {}),
      },
    });

    const topServices = categories.length
      ? mergeTop(
          (visitor.topServices as Record<string, number> | null) ?? {},
          categories,
        )
      : undefined;
    await this.prisma.viVisitor.update({
      where: { id: visitor.id },
      data: {
        pageViews: { increment: visitorInc.pageViews },
        searches: { increment: visitorInc.searches },
        salonViews: { increment: visitorInc.salonViews },
        productViews: { increment: visitorInc.productViews },
        bookingAttempts: { increment: visitorInc.bookingAttempts },
        bookings: { increment: visitorInc.bookings },
        purchases: { increment: visitorInc.purchases },
        revenuePaise: { increment: visitorInc.revenue },
        engagedMs: { increment: BigInt(visitorInc.engaged) },
        ...(topServices ? { topServices } : {}),
        ...(priceMin != null
          ? {
              priceMinInr:
                visitor.priceMinInr == null
                  ? priceMin
                  : Math.min(visitor.priceMinInr, priceMin),
            }
          : {}),
        ...(priceMax != null
          ? {
              priceMaxInr:
                visitor.priceMaxInr == null
                  ? priceMax
                  : Math.max(visitor.priceMaxInr, priceMax),
            }
          : {}),
        ...(delta.city ? { city: delta.city } : {}),
      },
    });

    for (const run of conversions) await run();

    // Server-side copies for GA4 / Meta CAPI (consent-aware, deduplicated by the same event id).
    if (this.integrations) {
      void this.integrations
        .forwardEvents(fresh, {
          visitorKey,
          marketing: input.consent.marketing,
          userAgent: env.userAgent,
          sessionId: input.sessionId,
          verified,
        })
        .catch(() => undefined);
    }
  }

  private clampTs(ts: number, now: Date): Date {
    const t = new Date(ts);
    // Reject clocks far in the future or stale queued beacons older than a day: use the receive time.
    if (
      Number.isNaN(t.getTime()) ||
      t.getTime() > now.getTime() + 5 * 60_000 ||
      t.getTime() < now.getTime() - 24 * 3600_000
    )
      return now;
    return t;
  }

  private async markSearches(
    sessionId: string,
    field: 'ledToSalonView' | 'ledToBooking' | 'ledToPurchase',
  ): Promise<void> {
    await this.prisma.viSearchEvent.updateMany({
      where: { sessionId, [field]: false },
      data: { [field]: true },
    });
  }

  private async nearestCity(lat: number, lng: number): Promise<string | null> {
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    const rows = await this.prisma.$queryRaw<Array<{ name: string }>>`
      SELECT name FROM cities WHERE latitude IS NOT NULL AND longitude IS NOT NULL
      ORDER BY (latitude - ${lat})^2 + ((longitude - ${lng}) * cos(radians(${lat})))^2 ASC LIMIT 1`;
    return rows[0]?.name ?? null;
  }

  private async verifyBooking(id: string, userId: string | null, now: Date) {
    const b = await this.prisma.booking
      .findUnique({
        where: { id },
        select: {
          id: true,
          customerId: true,
          createdAt: true,
          salonId: true,
          onlineBookingDiscountAmount: true,
          services: { select: { price: true } },
          salon: { select: { city: { select: { name: true } } } },
        },
      })
      .catch(() => null);
    if (!b) return null;
    if (Math.abs(now.getTime() - b.createdAt.getTime()) > 48 * 3600_000)
      return null;
    if (userId && b.customerId && b.customerId !== userId) return null;
    const gross = b.services.reduce((s, x) => s + Number(x.price), 0);
    const value = Math.max(
      0,
      gross - Number(b.onlineBookingDiscountAmount ?? 0),
    );
    return {
      id: b.id,
      salonId: b.salonId,
      city: b.salon.city?.name ?? null,
      valuePaise: BigInt(Math.round(value * 100)),
    };
  }

  private async verifyOrder(id: string, userId: string | null, now: Date) {
    const o = await this.prisma.commerceOrder
      .findFirst({
        // The browser knows the order number; a UUID id is accepted too.
        where: /^[0-9a-f-]{36}$/i.test(id)
          ? { id }
          : { orderNumber: id.slice(0, 20) },
        select: { id: true, customerUserId: true, placedAt: true, total: true },
      })
      .catch(() => null);
    if (!o) return null;
    if (Math.abs(now.getTime() - o.placedAt.getTime()) > 48 * 3600_000)
      return null;
    if (userId && o.customerUserId && o.customerUserId !== userId) return null;
    return { id: o.id, valuePaise: BigInt(Math.round(Number(o.total) * 100)) };
  }

  private async recordConversion(
    type: ViConversionType,
    entityId: string,
    valuePaise: bigint,
    at: Date,
    visitor: {
      id: string;
      firstChannel: string | null;
      firstCampaignId: string | null;
    },
    session: {
      id: string;
      channel: string;
      campaignId: string | null;
      city: string | null;
    },
    userId: string | null,
    salonId: string | null,
    city: string | null,
    module: string,
  ): Promise<void> {
    await this.prisma.viConversion
      .create({
        data: {
          type,
          entityId: entityId.slice(0, 80),
          visitorId: visitor.id,
          sessionId: session.id,
          userId,
          salonId,
          city: city ?? session.city,
          valuePaise,
          occurredAt: at,
          firstChannel: visitor.firstChannel,
          lastChannel: session.channel,
          firstCampaignId: visitor.firstCampaignId,
          lastCampaignId: session.campaignId,
          module,
        },
      })
      .catch((e: unknown) => {
        // Unique (type, entityId): the same booking reported twice counts once.
        if (!(
          e instanceof Prisma.PrismaClientKnownRequestError &&
          e.code === 'P2002'
        ))
          throw e;
      });
  }

  /** Consent change: recorded with the pseudonymous key only (no IP, no user agent). */
  async recordConsent(input: ViConsentInput): Promise<void> {
    const visitorKey = viVisitorKey(input.visitorId);
    await this.prisma.viConsentRecord.create({
      data: {
        visitorKey,
        analytics: input.analytics,
        marketing: input.marketing,
        preciseLocation: input.preciseLocation ?? null,
        policyVersion: input.policyVersion || VI_CONSENT_POLICY_VERSION,
        source: input.source,
      },
    });
    // Withdrawal stops future collection and removes marketing eligibility on the existing profile.
    await this.prisma.viVisitor.updateMany({
      where: { visitorKey },
      data: {
        consentAnalytics: input.analytics,
        consentMarketing: input.analytics && input.marketing,
      },
    });
  }
}

/** Stable UUID for the server row derived from the client UUID (keeps ids opaque but deterministic). */
function createUuidFrom(clientId: string): string {
  const h = createHash('sha256').update(`vi-event:${clientId}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function pickFilters(
  p: Record<string, string | number | boolean | null>,
): Prisma.InputJsonValue | typeof Prisma.JsonNull {
  const keys = [
    'priceMin',
    'priceMax',
    'distanceKm',
    'gender',
    'minRating',
    'preferredTime',
  ] as const;
  const out: Record<string, string | number | boolean | null> = {};
  for (const k of keys) if (p[k] !== undefined) out[k] = p[k];
  return Object.keys(out).length ? out : Prisma.JsonNull;
}

function mergeTop(
  existing: Record<string, number>,
  add: string[],
): Record<string, number> {
  const m = { ...existing };
  for (const c of add) m[c] = (m[c] ?? 0) + 1;
  return Object.fromEntries(
    Object.entries(m)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8),
  );
}

function moduleFor(e: ViEventInput): string | null {
  if (
    e.type.startsWith('booking') ||
    e.type === 'salon_view' ||
    e.type === 'service_select' ||
    e.type === 'price_compare'
  )
    return 'SALON_BOOKING';
  if (e.type === 'queue_join') return 'LIVE_QUEUE';
  if (e.type.startsWith('home_')) return 'HOME_SERVICES';
  if (e.type === 'stylist_view') return 'FREELANCE_STYLIST';
  if (
    ['product_view', 'add_to_cart', 'checkout_start', 'purchase'].includes(
      e.type,
    )
  )
    return 'MARKETPLACE';
  if (e.type.startsWith('job_')) return 'JOBS';
  if (e.type === 'staffing_request') return 'INSTANT_HIRING';
  if (e.type.startsWith('partner_')) return 'PARTNER';
  if (e.type === 'loyalty_join') return 'LOYALTY';
  if (e.path.startsWith('/shop')) return 'MARKETPLACE';
  if (e.path.startsWith('/home-services') || e.path.startsWith('/home-pro'))
    return 'HOME_SERVICES';
  if (e.path.startsWith('/work') || e.path.startsWith('/careers'))
    return 'JOBS';
  if (e.path.startsWith('/list-your-salon')) return 'PARTNER';
  if (
    e.path.startsWith('/book') ||
    e.path.startsWith('/search') ||
    e.path.startsWith('/s/')
  )
    return 'SALON_BOOKING';
  if (e.path.startsWith('/q') || e.path.startsWith('/queue'))
    return 'LIVE_QUEUE';
  return 'CONTENT';
}
