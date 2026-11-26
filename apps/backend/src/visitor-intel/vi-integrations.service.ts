import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { JWT } from 'google-auth-library';
import {
  VI_INTEGRATION_FIELDS,
  VI_INTEGRATION_PROVIDERS,
  istDateKey,
  type ViEventInput,
  type ViIntegrationProvider,
} from '@barbercue/shared';
import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../auth/services/crypto.service';
import { viBadRequest } from './vi-common';

/**
 * External analytics/ad platforms (docs/visitor-intelligence/INTEGRATIONS.md). Everything is OFF unless
 *   1. VI_INTEGRATIONS_ENABLED=true on the server (global kill switch, default off), and
 *   2. the provider is enabled on the Tracking Settings page with its credentials saved.
 * Secrets are AES-256-GCM encrypted with the existing CryptoService key (TOTP_ENCRYPTION_KEY) and are
 * never returned by any API. No name, email, phone or other direct identifier is ever sent to Google.
 * Meta receives only a SHA-256 of the pseudonymous visitor key plus the browser user agent, and only
 * when the visitor allowed marketing cookies. Core first-party analytics never depends on any of this.
 */
const META_EVENT: Partial<Record<ViEventInput['type'], string>> = {
  page_view: 'PageView',
  salon_view: 'ViewContent',
  product_view: 'ViewContent',
  search: 'Search',
  sign_up: 'CompleteRegistration',
  add_to_cart: 'AddToCart',
  checkout_start: 'InitiateCheckout',
  booking_confirmed: 'Schedule',
  purchase: 'Purchase',
};
/** Server-side GA4 copies are limited to verified outcomes; page views come from the browser tag. */
const GA4_EVENT: Partial<Record<ViEventInput['type'], string>> = {
  sign_up: 'sign_up',
  booking_confirmed: 'booking_complete',
  purchase: 'purchase',
};

export interface ViForwardContext {
  visitorKey: string;
  marketing: boolean;
  userAgent: string | null;
  sessionId: string;
  /** clientEventId → verified value in paise (bookings/orders re-read from the database). */
  verified?: Map<string, bigint>;
}

interface Loaded {
  enabled: boolean;
  config: Record<string, string>;
  secrets: Record<string, string>;
}

@Injectable()
export class ViIntegrationsService {
  private readonly logger = new Logger(ViIntegrationsService.name);
  private cache = new Map<string, { at: number; value: Loaded | null }>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
  ) {}

  static globallyEnabled(): boolean {
    return process.env.VI_INTEGRATIONS_ENABLED === 'true';
  }

  private async load(provider: ViIntegrationProvider): Promise<Loaded | null> {
    const hit = this.cache.get(provider);
    if (hit && Date.now() - hit.at < 60_000) return hit.value;
    const row = await this.prisma.viIntegrationSetting.findUnique({
      where: { provider },
    });
    let value: Loaded | null = null;
    if (row) {
      let secrets: Record<string, string> = {};
      if (row.secretsCipher) {
        try {
          secrets = JSON.parse(
            this.crypto.decrypt(row.secretsCipher),
          ) as Record<string, string>;
        } catch {
          secrets = {};
        }
      }
      value = {
        enabled: row.enabled,
        config: (row.config as Record<string, string>) ?? {},
        secrets,
      };
    }
    this.cache.set(provider, { at: Date.now(), value });
    return value;
  }

  private async active(
    provider: ViIntegrationProvider,
  ): Promise<Loaded | null> {
    if (!ViIntegrationsService.globallyEnabled()) return null;
    const l = await this.load(provider);
    if (!l?.enabled) return null;
    const missing = VI_INTEGRATION_FIELDS[provider].filter(
      (f) =>
        !optionalField(f.key) &&
        !(f.secret ? l.secrets[f.key] : l.config[f.key]),
    );
    return missing.length ? null : l;
  }

  async list() {
    const rows = await this.prisma.viIntegrationSetting.findMany();
    return {
      globallyEnabled: ViIntegrationsService.globallyEnabled(),
      encryptionConfigured: !!process.env.TOTP_ENCRYPTION_KEY,
      providers: VI_INTEGRATION_PROVIDERS.map((provider) => {
        const row = rows.find((r) => r.provider === provider);
        let secretKeys: string[] = [];
        if (row?.secretsCipher) {
          try {
            secretKeys = Object.keys(
              JSON.parse(this.crypto.decrypt(row.secretsCipher)) as object,
            );
          } catch {
            secretKeys = [];
          }
        }
        const config = (row?.config as Record<string, string>) ?? {};
        return {
          provider,
          enabled: row?.enabled ?? false,
          fields: VI_INTEGRATION_FIELDS[provider].map((f) => ({
            key: f.key,
            label: f.label,
            secret: f.secret,
            optional: optionalField(f.key),
            value: f.secret ? null : (config[f.key] ?? ''),
            isSet: f.secret ? secretKeys.includes(f.key) : !!config[f.key],
          })),
          lastSyncAt: row?.lastSyncAt?.toISOString() ?? null,
          lastStatus: row?.lastStatus ?? null,
          lastError: row?.lastError ?? null,
        };
      }),
    };
  }

  async update(
    provider: ViIntegrationProvider,
    enabled: boolean,
    values: Record<string, string>,
    userId: string,
  ) {
    if (!VI_INTEGRATION_PROVIDERS.includes(provider))
      throw viBadRequest('Unknown integration.');
    const current = (await this.load(provider)) ?? {
      enabled: false,
      config: {},
      secrets: {},
    };
    const config = { ...current.config };
    const secrets = { ...current.secrets };
    for (const f of VI_INTEGRATION_FIELDS[provider]) {
      const v = values[f.key];
      if (v === undefined) continue;
      const target = f.secret ? secrets : config;
      if (v === '__clear__' || (!f.secret && v.trim() === ''))
        delete target[f.key];
      else if (v.trim() !== '') target[f.key] = v.trim();
    }
    const missing = VI_INTEGRATION_FIELDS[provider].filter(
      (f) =>
        !optionalField(f.key) && !(f.secret ? secrets[f.key] : config[f.key]),
    );
    if (enabled && missing.length)
      throw viBadRequest(`Missing: ${missing.map((m) => m.label).join(', ')}`);
    if (Object.keys(secrets).length && !process.env.TOTP_ENCRYPTION_KEY) {
      throw viBadRequest(
        'Server encryption key (TOTP_ENCRYPTION_KEY) is not configured, so secrets cannot be stored.',
      );
    }
    const secretsCipher = Object.keys(secrets).length
      ? this.crypto.encrypt(JSON.stringify(secrets))
      : null;
    await this.prisma.viIntegrationSetting.upsert({
      where: { provider },
      create: {
        provider,
        enabled,
        config,
        secretsCipher,
        updatedByUserId: userId,
      },
      update: { enabled, config, secretsCipher, updatedByUserId: userId },
    });
    this.cache.delete(provider);
    return this.list();
  }

  // ---------- Outbound event copies ----------

  async forwardEvents(
    events: ViEventInput[],
    ctx: ViForwardContext,
  ): Promise<void> {
    if (!ViIntegrationsService.globallyEnabled()) return;
    await Promise.allSettled([
      this.forwardGa4(events, ctx),
      this.forwardMeta(events, ctx),
    ]);
  }

  private async forwardGa4(
    events: ViEventInput[],
    ctx: ViForwardContext,
  ): Promise<void> {
    const ga = await this.active('GA4');
    if (!ga) return;
    const mapped = events
      .filter(
        (e) =>
          GA4_EVENT[e.type] &&
          (e.type === 'sign_up' || ctx.verified?.has(e.id)),
      )
      .map((e) => {
        const paise = ctx.verified?.get(e.id);
        return {
          name: GA4_EVENT[e.type]!,
          params: {
            session_id: ctx.sessionId.slice(0, 36),
            engagement_time_msec: 1,
            page_location: e.path.slice(0, 300),
            ...(paise != null
              ? {
                  value: Number(paise) / 100,
                  currency: 'INR',
                  transaction_id: e.entityId ?? e.id,
                }
              : {}),
          },
        };
      });
    if (!mapped.length) return;
    // client_id is derived from the pseudonymous key; it cannot be linked back to a person.
    const clientId = `${parseInt(ctx.visitorKey.slice(0, 8), 16)}.${parseInt(ctx.visitorKey.slice(8, 16), 16)}`;
    const url = `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(ga.config.measurementId)}&api_secret=${encodeURIComponent(ga.secrets.apiSecret)}`;
    await this.post('GA4', url, {
      client_id: clientId,
      events: mapped.slice(0, 25),
    });
  }

  private async forwardMeta(
    events: ViEventInput[],
    ctx: ViForwardContext,
  ): Promise<void> {
    if (!ctx.marketing) return; // Meta only with marketing consent.
    const meta = await this.active('META');
    if (!meta) return;
    const site = (
      process.env.WEB_PUBLIC_URL ??
      process.env.WEB_BASE_URL ??
      'https://fastque.com'
    ).replace(/\/+$/, '');
    const data = events
      .filter(
        (e) =>
          META_EVENT[e.type] &&
          (!['booking_confirmed', 'purchase'].includes(e.type) ||
            ctx.verified?.has(e.id)),
      )
      .map((e) => {
        const paise = ctx.verified?.get(e.id);
        return {
          event_name: META_EVENT[e.type]!,
          event_time: Math.floor(e.ts / 1000),
          // Same id the browser Pixel used, so Meta deduplicates browser vs server copies.
          event_id: e.id,
          action_source: 'website',
          event_source_url: `${site}${e.path}`.slice(0, 500),
          user_data: {
            external_id: [
              createHash('sha256').update(ctx.visitorKey).digest('hex'),
            ],
            ...(ctx.userAgent
              ? { client_user_agent: ctx.userAgent.slice(0, 400) }
              : {}),
          },
          ...(paise != null
            ? { custom_data: { value: Number(paise) / 100, currency: 'INR' } }
            : {}),
        };
      });
    if (!data.length) return;
    const body: Record<string, unknown> = { data };
    if (meta.config.testEventCode)
      body.test_event_code = meta.config.testEventCode;
    await this.post(
      'META',
      `https://graph.facebook.com/v19.0/${encodeURIComponent(meta.config.pixelId)}/events?access_token=${encodeURIComponent(meta.secrets.accessToken)}`,
      body,
    );
  }

  private async post(
    provider: ViIntegrationProvider,
    url: string,
    body: unknown,
  ): Promise<void> {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(5_000),
      });
      if (!res.ok) await this.status(provider, 'ERROR', `HTTP ${res.status}`);
    } catch (e) {
      await this.status(
        provider,
        'ERROR',
        e instanceof Error ? e.message : 'request failed',
      );
    }
  }

  private async status(
    provider: ViIntegrationProvider,
    status: string,
    error: string | null,
    synced = false,
  ): Promise<void> {
    await this.prisma.viIntegrationSetting
      .update({
        where: { provider },
        data: {
          lastStatus: status,
          lastError: error?.slice(0, 500) ?? null,
          ...(synced ? { lastSyncAt: new Date() } : {}),
        },
      })
      .catch(() => undefined);
  }

  // ---------- Inbound syncs (aggregates only) ----------

  @Cron('30 22 * * *') // 04:00 IST
  async nightlySync(): Promise<void> {
    if (!ViIntegrationsService.globallyEnabled()) return;
    for (const p of ['SEARCH_CONSOLE', 'GOOGLE_ADS', 'META'] as const)
      await this.sync(p).catch(() => undefined);
  }

  async sync(
    provider: ViIntegrationProvider,
    days = 7,
  ): Promise<{ ok: boolean; rows: number; message: string }> {
    const l = await this.active(provider);
    if (!l)
      return {
        ok: false,
        rows: 0,
        message: ViIntegrationsService.globallyEnabled()
          ? 'Not enabled or missing credentials.'
          : 'VI_INTEGRATIONS_ENABLED is off on the server.',
      };
    const end = new Date(Date.now() - 86_400_000);
    const start = new Date(end.getTime() - (days - 1) * 86_400_000);
    try {
      let rows = 0;
      if (provider === 'SEARCH_CONSOLE')
        rows = await this.syncSearchConsole(
          l,
          istDateKey(start),
          istDateKey(end),
        );
      else if (provider === 'GOOGLE_ADS')
        rows = await this.syncGoogleAds(l, istDateKey(start), istDateKey(end));
      else if (provider === 'META')
        rows = await this.syncMetaAds(l, istDateKey(start), istDateKey(end));
      else
        return {
          ok: true,
          rows: 0,
          message: 'GA4 is send-only; nothing to import.',
        };
      await this.status(provider, 'OK', null, true);
      return { ok: true, rows, message: `Imported ${rows} rows.` };
    } catch (e) {
      const message = e instanceof Error ? e.message : 'sync failed';
      await this.status(provider, 'ERROR', message);
      return { ok: false, rows: 0, message };
    }
  }

  private async upsertMetric(
    provider: string,
    day: string,
    kind: string,
    key: string,
    dims: Record<string, unknown>,
    metrics: Record<string, number>,
  ) {
    const d = new Date(`${day}T00:00:00Z`);
    await this.prisma.viExternalMetric.upsert({
      where: {
        provider_day_kind_key: {
          provider,
          day: d,
          kind,
          key: key.slice(0, 300),
        },
      },
      create: {
        provider,
        day: d,
        kind,
        key: key.slice(0, 300),
        dims: dims as Prisma.InputJsonValue,
        metrics,
      },
      update: { dims: dims as Prisma.InputJsonValue, metrics },
    });
  }

  private async syncSearchConsole(
    l: Loaded,
    startDate: string,
    endDate: string,
  ): Promise<number> {
    const key = JSON.parse(l.secrets.serviceAccountJson) as {
      client_email: string;
      private_key: string;
    };
    const client = new JWT({
      email: key.client_email,
      key: key.private_key,
      scopes: ['https://www.googleapis.com/auth/webmasters.readonly'],
    });
    const site = encodeURIComponent(l.config.siteUrl);
    const res = await client.request<{
      rows?: Array<{
        keys: string[];
        clicks: number;
        impressions: number;
        ctr: number;
        position: number;
      }>;
    }>({
      url: `https://searchconsole.googleapis.com/webmasters/v3/sites/${site}/searchAnalytics/query`,
      method: 'POST',
      data: {
        startDate,
        endDate,
        dimensions: ['date', 'query', 'page', 'country'],
        rowLimit: 5000,
      },
    });
    let n = 0;
    for (const r of res.data.rows ?? []) {
      const [date, query, page, country] = r.keys;
      await this.upsertMetric(
        'SEARCH_CONSOLE',
        date,
        'query',
        `${query}|${page}|${country}`,
        { query, page, country },
        {
          clicks: r.clicks,
          impressions: r.impressions,
          ctr: r.ctr,
          position: r.position,
        },
      );
      n++;
    }
    return n;
  }

  private async syncGoogleAds(
    l: Loaded,
    startDate: string,
    endDate: string,
  ): Promise<number> {
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: l.config.oauthClientId,
        client_secret: l.secrets.oauthClientSecret,
        refresh_token: l.secrets.refreshToken,
        grant_type: 'refresh_token',
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!tokenRes.ok) throw new Error(`Google OAuth HTTP ${tokenRes.status}`);
    const { access_token } = (await tokenRes.json()) as {
      access_token: string;
    };
    const customer = l.config.customerId.replace(/-/g, '');
    const query = `SELECT segments.date, campaign.id, campaign.name, metrics.cost_micros, metrics.clicks, metrics.impressions, metrics.conversions, metrics.conversions_value FROM campaign WHERE segments.date BETWEEN '${startDate}' AND '${endDate}'`;
    const res = await fetch(
      `https://googleads.googleapis.com/v17/customers/${customer}/googleAds:searchStream`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${access_token}`,
          'developer-token': l.secrets.developerToken,
          ...(l.config.loginCustomerId
            ? {
                'login-customer-id': l.config.loginCustomerId.replace(/-/g, ''),
              }
            : {}),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query }),
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (!res.ok) throw new Error(`Google Ads HTTP ${res.status}`);
    const chunks = (await res.json()) as Array<{
      results?: Array<{
        segments: { date: string };
        campaign: { id: string; name: string };
        metrics: Record<string, string | number>;
      }>;
    }>;
    let n = 0;
    for (const c of chunks) {
      for (const r of c.results ?? []) {
        const m = r.metrics;
        await this.upsertMetric(
          'GOOGLE_ADS',
          r.segments.date,
          'campaign',
          r.campaign.id,
          { name: r.campaign.name },
          {
            spendInr: Number(m.costMicros ?? 0) / 1e6,
            clicks: Number(m.clicks ?? 0),
            impressions: Number(m.impressions ?? 0),
            conversions: Number(m.conversions ?? 0),
            conversionValueInr: Number(m.conversionsValue ?? 0),
          },
        );
        n++;
      }
    }
    return n;
  }

  private async syncMetaAds(
    l: Loaded,
    since: string,
    until: string,
  ): Promise<number> {
    if (!l.config.adAccountId) return 0;
    const params = new URLSearchParams({
      level: 'campaign',
      time_increment: '1',
      fields: 'campaign_id,campaign_name,spend,clicks,impressions,actions',
      time_range: JSON.stringify({ since, until }),
      access_token: l.secrets.accessToken,
    });
    const res = await fetch(
      `https://graph.facebook.com/v19.0/${encodeURIComponent(l.config.adAccountId)}/insights?${params}`,
      { signal: AbortSignal.timeout(20_000) },
    );
    if (!res.ok) throw new Error(`Meta HTTP ${res.status}`);
    const body = (await res.json()) as {
      data?: Array<{
        date_start: string;
        campaign_id: string;
        campaign_name: string;
        spend: string;
        clicks: string;
        impressions: string;
        actions?: Array<{ action_type: string; value: string }>;
      }>;
    };
    let n = 0;
    for (const r of body.data ?? []) {
      const conversions = (r.actions ?? [])
        .filter((a) =>
          /purchase|schedule|complete_registration/.test(a.action_type),
        )
        .reduce((s, a) => s + Number(a.value), 0);
      await this.upsertMetric(
        'META',
        r.date_start,
        'campaign',
        r.campaign_id,
        { name: r.campaign_name },
        {
          spendInr: Number(r.spend ?? 0),
          clicks: Number(r.clicks ?? 0),
          impressions: Number(r.impressions ?? 0),
          conversions,
        },
      );
      n++;
    }
    return n;
  }
}

function optionalField(key: string): boolean {
  return (
    key === 'testEventCode' ||
    key === 'loginCustomerId' ||
    key === 'adAccountId'
  );
}
