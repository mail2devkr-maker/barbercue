import { createHash } from 'crypto';
import type { CompetitionLevel, KeywordProviderName } from '@barbercue/shared';

/**
 * Keyword intelligence providers. Only `google_ads` returns real search data. `mock` exists so the
 * flow can be exercised without a Google Ads account: every row it returns is stored and shown with
 * isMock = true and a "MOCK — not real data" label. `none` (the default) refuses to run.
 *
 * Locations are city level (a Google Ads geo target constant). Neighbourhood volumes are never
 * requested and never estimated.
 */
export interface KeywordIdeaResult {
  keyword: string;
  avgMonthlySearches: number | null;
  monthly: Array<{ year: number; month: number; searches: number | null }>;
  competition: CompetitionLevel;
  competitionIndex: number | null;
  lowBidMicros: number | null;
  highBidMicros: number | null;
}

export interface KeywordRequest {
  seeds: string[];
  cityName: string;
  geoTargetConstant: string | null;
  language: string;
}

export interface KeywordProvider {
  readonly name: KeywordProviderName;
  readonly isMock: boolean;
  readonly configured: boolean;
  readonly note: string;
  generate(req: KeywordRequest): Promise<KeywordIdeaResult[]>;
}

export class KeywordProviderUnavailable extends Error {}

class NoKeywordProvider implements KeywordProvider {
  readonly name = 'none' as const;
  readonly isMock = false;
  readonly configured = false;
  readonly note =
    'No keyword provider is configured. Set GROWTH_AI_KEYWORD_PROVIDER=google_ads (real) or mock (labelled test data).';
  generate(): Promise<KeywordIdeaResult[]> {
    return Promise.reject(new KeywordProviderUnavailable(this.note));
  }
}

/** Deterministic, labelled test data. Same input → same output. Never real. */
export class MockKeywordProvider implements KeywordProvider {
  readonly name = 'mock' as const;
  readonly isMock = true;
  readonly configured = true;
  readonly note =
    'MOCK keyword data: invented numbers for testing the flow. Not real search demand.';

  generate(req: KeywordRequest): Promise<KeywordIdeaResult[]> {
    const city = req.cityName.toLowerCase();
    const keywords = new Set<string>();
    for (const seed of req.seeds) {
      const s = seed.toLowerCase().trim();
      keywords.add(s);
      if (!s.includes('near me')) keywords.add(`${s} near me`);
      keywords.add(`${s} ${city}`);
    }
    const now = new Date();
    return Promise.resolve(
      [...keywords].slice(0, 30).map((keyword) => {
        const h = createHash('sha256').update(`${keyword}|${city}`).digest();
        const avg = 20 + (h.readUInt16BE(0) % 2400);
        const index = h[2] % 101;
        const low = (5 + (h[3] % 20)) * 1_000_000;
        return {
          keyword,
          avgMonthlySearches: avg,
          monthly: Array.from({ length: 12 }, (_, i) => {
            const d = new Date(
              Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 12 + i, 1),
            );
            return {
              year: d.getUTCFullYear(),
              month: d.getUTCMonth() + 1,
              searches: Math.round(avg * (0.8 + ((h[4 + i] ?? 0) % 40) / 100)),
            };
          }),
          competition: index < 34 ? 'LOW' : index < 67 ? 'MEDIUM' : 'HIGH',
          competitionIndex: index,
          lowBidMicros: low,
          highBidMicros: low * (2 + (h[5] % 3)),
        };
      }),
    );
  }
}

type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
  },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

/** Google's own hosts only; no URL ever comes from a request, so there is nothing to redirect (SSRF). */
const GOOGLE_TOKEN_URL = 'https://www.googleapis.com/oauth2/v3/token';
const GOOGLE_ADS_HOST = 'https://googleads.googleapis.com';

const MONTHS = [
  'JANUARY',
  'FEBRUARY',
  'MARCH',
  'APRIL',
  'MAY',
  'JUNE',
  'JULY',
  'AUGUST',
  'SEPTEMBER',
  'OCTOBER',
  'NOVEMBER',
  'DECEMBER',
];
const num = (v: unknown): number | null => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Maps a GenerateKeywordIdeas REST response (camelCase JSON) to our rows; exported for tests. */
export function mapGoogleAdsIdeas(body: unknown): KeywordIdeaResult[] {
  const results = (body as { results?: unknown[] })?.results ?? [];
  return results.flatMap((r) => {
    const row = r as {
      text?: string;
      keywordIdeaMetrics?: Record<string, unknown>;
    };
    if (!row.text) return [];
    const m = row.keywordIdeaMetrics ?? {};
    const comp = typeof m.competition === 'string' ? m.competition : 'UNKNOWN';
    const volumes = Array.isArray(m.monthlySearchVolumes)
      ? (m.monthlySearchVolumes as Array<Record<string, unknown>>)
      : [];
    return [
      {
        keyword: row.text.slice(0, 120),
        avgMonthlySearches: num(m.avgMonthlySearches),
        monthly: volumes.map((v) => ({
          year: num(v.year) ?? 0,
          month: MONTHS.indexOf(String(v.month)) + 1 || (num(v.month) ?? 0),
          searches: num(v.monthlySearches),
        })),
        competition: (['LOW', 'MEDIUM', 'HIGH'].includes(comp)
          ? comp
          : 'UNKNOWN') as CompetitionLevel,
        competitionIndex: num(m.competitionIndex),
        lowBidMicros: num(m.lowTopOfPageBidMicros),
        highBidMicros: num(m.highTopOfPageBidMicros),
      },
    ];
  });
}

/**
 * Google Ads API KeywordPlanIdeaService.GenerateKeywordIdeas over REST (verified against the v26 docs,
 * 2026-11-25). Needs Basic or Standard API access for the Google Cloud project (Explorer access cannot
 * use planning services). Not exercised against the live API in this slice: no account is connected.
 */
export class GoogleAdsKeywordProvider implements KeywordProvider {
  readonly name = 'google_ads' as const;
  readonly isMock = false;
  readonly configured: boolean;
  readonly note: string;
  private readonly env = {
    customerId:
      process.env.GOOGLE_ADS_CUSTOMER_ID?.replace(/-/g, '').trim() ?? '',
    loginCustomerId:
      process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID?.replace(/-/g, '').trim() ?? '',
    developerToken: process.env.GOOGLE_ADS_DEVELOPER_TOKEN?.trim() ?? '',
    clientId: process.env.GOOGLE_ADS_CLIENT_ID?.trim() ?? '',
    clientSecret: process.env.GOOGLE_ADS_CLIENT_SECRET?.trim() ?? '',
    refreshToken: process.env.GOOGLE_ADS_REFRESH_TOKEN?.trim() ?? '',
    version: /^v\d{2}$/.test(process.env.GOOGLE_ADS_API_VERSION ?? '')
      ? (process.env.GOOGLE_ADS_API_VERSION as string)
      : 'v26',
  };

  constructor(private readonly fetchImpl: FetchLike = fetch) {
    const e = this.env;
    this.configured =
      /^\d{10}$/.test(e.customerId) &&
      !!e.clientId &&
      !!e.clientSecret &&
      !!e.refreshToken;
    this.note = this.configured
      ? `Google Ads Keyword Planner (${e.version}).`
      : 'Google Ads is selected but not configured (GOOGLE_ADS_CUSTOMER_ID, GOOGLE_ADS_CLIENT_ID, GOOGLE_ADS_CLIENT_SECRET, GOOGLE_ADS_REFRESH_TOKEN).';
  }

  private async accessToken(): Promise<string> {
    const e = this.env;
    const res = await this.fetchImpl(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: e.clientId,
        client_secret: e.clientSecret,
        refresh_token: e.refreshToken,
      }).toString(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok)
      throw new KeywordProviderUnavailable(
        `Google sign-in failed (${res.status}).`,
      );
    const token = (await res.json()) as { access_token?: string };
    if (!token.access_token)
      throw new KeywordProviderUnavailable(
        'Google sign-in returned no access token.',
      );
    return token.access_token;
  }

  async generate(req: KeywordRequest): Promise<KeywordIdeaResult[]> {
    if (!this.configured) throw new KeywordProviderUnavailable(this.note);
    if (!req.geoTargetConstant)
      throw new KeywordProviderUnavailable(
        'A city-level Google Ads location (geo target constant) is required for real data.',
      );
    const e = this.env;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${await this.accessToken()}`,
      'Content-Type': 'application/json',
    };
    if (e.developerToken) headers['developer-token'] = e.developerToken;
    if (/^\d{10}$/.test(e.loginCustomerId))
      headers['login-customer-id'] = e.loginCustomerId;
    const res = await this.fetchImpl(
      `${GOOGLE_ADS_HOST}/${e.version}/customers/${e.customerId}:generateKeywordIdeas`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({
          language: req.language,
          geoTargetConstants: [req.geoTargetConstant],
          keywordPlanNetwork: 'GOOGLE_SEARCH',
          includeAdultKeywords: false,
          keywordSeed: { keywords: req.seeds.slice(0, 20) },
          pageSize: 100,
        }),
        signal: AbortSignal.timeout(20_000),
      },
    );
    if (!res.ok) {
      const text = (await res.text()).slice(0, 200).replace(/\s+/g, ' ');
      throw new KeywordProviderUnavailable(
        `Google Ads returned ${res.status}: ${text}`,
      );
    }
    return mapGoogleAdsIdeas(await res.json()).slice(0, 100);
  }
}

export function keywordProviderFromEnv(): KeywordProvider {
  switch (process.env.GROWTH_AI_KEYWORD_PROVIDER) {
    case 'mock':
      return new MockKeywordProvider();
    case 'google_ads':
      return new GoogleAdsKeywordProvider();
    default:
      return new NoKeywordProvider();
  }
}
